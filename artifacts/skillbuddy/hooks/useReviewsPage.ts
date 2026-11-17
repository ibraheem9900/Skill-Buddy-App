import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { AxiosError } from 'axios';
import { classifyFeedbackFailure, type FeedbackFailureKind } from '@/lib/feedback';
import {
  PROVIDER_REVIEWS_PAGE_SIZE,
  type ProviderReviewsSummary,
  type Review,
} from '@/lib/reviews';
import { listClientReviews, listProviderReviews } from '@/services/feedback';
import { registerSessionReset } from '@/lib/sessionReset';

/**
 * ONE paginated reviews reader for BOTH published-review lists:
 *   • GET /api/v1/providers/{provider_id}/reviews  (client reviews OF a pilot)
 *   • GET /api/v1/clients/{client_id}/reviews      (pilot reviews OF a client)
 * The two endpoints answer the same body shape and the same limit/offset
 * contract, so the pagination, caching, invalidation and error handling live
 * here once and the two hooks below are thin wrappers — provider behaviour is
 * unchanged by the client list's arrival.
 *
 * PAGINATION: page size 20, next offset = reviews already loaded, stop on a
 * short page / when the loaded count reaches `summary.review_count` / when a
 * page adds nothing new. Items are de-duplicated by review id and the SERVER
 * order is kept (no cross-page sorting — it would break offset pagination).
 *
 * CACHE: per subject+id, module level, for the session; a screen focus
 * revalidates only when the cached copy is older than STALE_MS, pull-to-refresh
 * always starts again at offset 0.
 *
 * ERRORS: a failing first page leaves the screen in its error state with Try
 * Again; a failing loadMore keeps everything already loaded and only surfaces
 * the inline "couldn't load more" row.
 */
const STALE_MS = 60_000;

export type ReviewSubject = 'provider' | 'client';

interface CachedPage {
  summary: ProviderReviewsSummary;
  reviews: Review[];
  fetchedAt: number;
}

const cache = new Map<string, CachedPage>();
let versions = 0;

function keyOf(subject: ReviewSubject, id: number): string {
  return `${subject}:${id}`;
}

/** Drops one subject's cached reviews (or all of them) — used after a submit. */
export function invalidateReviews(subject: ReviewSubject, id?: number): void {
  if (typeof id === 'number') cache.delete(keyOf(subject, id));
  else {
    for (const key of [...cache.keys()]) {
      if (key.startsWith(`${subject}:`)) cache.delete(key);
    }
  }
  versions += 1;
}

/** Exposed for tests / logout. */
export function clearReviewsCache(): void {
  cache.clear();
  versions = 0;
}

registerSessionReset(() => {
  cache.clear();
  versions = 0;
});

function fetchPage(
  subject: ReviewSubject,
  id: number,
  offset: number
): ReturnType<typeof listProviderReviews> {
  const params = { limit: PROVIDER_REVIEWS_PAGE_SIZE, offset };
  return subject === 'provider' ? listProviderReviews(id, params) : listClientReviews(id, params);
}

function failureFromError(error: unknown): FeedbackFailureKind {
  const axiosError = error as AxiosError | undefined;
  if (!axiosError?.isAxiosError) {
    return typeof axiosError === 'undefined' ? 'network' : 'unknown';
  }
  return classifyFeedbackFailure(axiosError.response?.status ?? 0);
}

function mergeReviews(existing: Review[], incoming: Review[]): Review[] {
  const seen = new Set(existing.map((review) => review.id));
  const merged = [...existing];
  for (const review of incoming) {
    if (seen.has(review.id)) continue;
    seen.add(review.id);
    merged.push(review);
  }
  return merged;
}

export function useReviewsPage(subject: ReviewSubject, id: number | null) {
  const cacheKey = id !== null ? keyOf(subject, id) : null;
  const cached = cacheKey ? cache.get(cacheKey) : undefined;

  const [summary, setSummary] = useState<ProviderReviewsSummary>(
    cached?.summary ?? { star_rating: 0, review_average: null, review_count: 0 }
  );
  const [reviews, setReviews] = useState<Review[]>(cached?.reviews ?? []);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    id === null ? 'idle' : cached ? 'ready' : 'loading'
  );
  const [failure, setFailure] = useState<FeedbackFailureKind | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailure, setMoreFailure] = useState<FeedbackFailureKind | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const mounted = useRef(true);
  const token = useRef(0);
  const version = useRef(versions);
  const reviewsRef = useRef<Review[]>(reviews);
  const loadingMoreRef = useRef(false);
  const lastPageSize = useRef<number | null>(null);

  reviewsRef.current = reviews;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const hasMore =
    status === 'ready' &&
    !exhausted &&
    !moreFailure &&
    reviews.length > 0 &&
    (summary.review_count > 0
      ? reviews.length < summary.review_count
      : lastPageSize.current === null || lastPageSize.current >= PROVIDER_REVIEWS_PAGE_SIZE);

  /** Loads offset 0 and REPLACES the list (first load, refresh, retry). */
  const loadFirstPage = useCallback(
    async (mode: 'initial' | 'refresh' | 'retry') => {
      if (id === null) return;
      const key = keyOf(subject, id);
      const ticket = ++token.current;
      const hit = cache.get(key);

      if (!hit) setStatus('loading');
      if (mode !== 'initial') setRefreshing(true);
      setFailure(null);
      setMoreFailure(null);

      try {
        const page = await fetchPage(subject, id, 0);
        if (!mounted.current || ticket !== token.current) return;

        lastPageSize.current = page.reviews.length;
        setSummary(page.summary);
        setReviews(page.reviews);
        setStatus('ready');
        setExhausted(
          page.reviews.length < PROVIDER_REVIEWS_PAGE_SIZE ||
            (page.summary.review_count > 0 && page.reviews.length >= page.summary.review_count)
        );
        cache.set(key, {
          summary: page.summary,
          reviews: page.reviews,
          fetchedAt: Date.now(),
        });
        version.current = versions;
      } catch (error) {
        if (!mounted.current || ticket !== token.current) return;
        const stale = cache.get(key);
        if (stale) {
          // A failed refresh keeps the reviews already on screen.
          setSummary(stale.summary);
          setReviews(stale.reviews);
          setStatus('ready');
        } else {
          setStatus('error');
        }
        setFailure(failureFromError(error));
      } finally {
        if (mounted.current && ticket === token.current) setRefreshing(false);
      }
    },
    [id, subject]
  );

  /** Appends the next page. Guarded so fast scrolling cannot fire it twice. */
  const loadMore = useCallback(async () => {
    if (id === null) return;
    if (loadingMoreRef.current) return;
    if (!hasMore) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreFailure(null);
    const offset = reviewsRef.current.length;
    const ticket = token.current;

    try {
      const page = await fetchPage(subject, id, offset);
      if (!mounted.current || ticket !== token.current) return;

      const merged = mergeReviews(reviewsRef.current, page.reviews);
      lastPageSize.current = page.reviews.length;
      setSummary(page.summary);
      setReviews(merged);
      setExhausted(
        page.reviews.length < PROVIDER_REVIEWS_PAGE_SIZE ||
          merged.length === reviewsRef.current.length ||
          (page.summary.review_count > 0 && merged.length >= page.summary.review_count)
      );
      cache.set(keyOf(subject, id), {
        summary: page.summary,
        reviews: merged,
        fetchedAt: Date.now(),
      });
    } catch (error) {
      if (!mounted.current || ticket !== token.current) return;
      // Keep what is already loaded; the footer offers the inline retry.
      setMoreFailure(failureFromError(error));
    } finally {
      loadingMoreRef.current = false;
      if (mounted.current) setLoadingMore(false);
    }
  }, [hasMore, id, subject]);

  /** Pull-to-refresh / Try Again — always back to offset 0. */
  const refetch = useCallback(
    (mode: 'refresh' | 'retry' = 'retry') => loadFirstPage(mode),
    [loadFirstPage]
  );

  /** Retry a failed loadMore from the same offset. */
  const retryLoadMore = useCallback(() => {
    if (loadingMoreRef.current) return;
    setMoreFailure(null);
    void loadMore();
  }, [loadMore]);

  /* Subject/id change: show that cache or load it. */
  useEffect(() => {
    if (id === null) {
      setStatus('idle');
      return;
    }
    const hit = cache.get(keyOf(subject, id));
    if (hit) {
      setSummary(hit.summary);
      setReviews(hit.reviews);
      setStatus('ready');
    } else {
      setReviews([]);
      setSummary({ star_rating: 0, review_average: null, review_count: 0 });
      setStatus('loading');
    }
    setFailure(null);
    setMoreFailure(null);
    setExhausted(false);
    lastPageSize.current = null;
  }, [id, subject]);

  /* Focus: revalidate only when the cached copy is stale. */
  useFocusEffect(
    useCallback(() => {
      if (id === null) return;
      const hit = cache.get(keyOf(subject, id));
      if (!hit) {
        void loadFirstPage('initial');
        return;
      }
      if (Date.now() - hit.fetchedAt > STALE_MS) void loadFirstPage('refresh');
    }, [id, loadFirstPage, subject])
  );

  /* Invalidation from a successful submit. */
  useEffect(() => {
    if (versions === version.current) return;
    version.current = versions;
    void loadFirstPage('refresh');
  }, [loadFirstPage]);

  return {
    summary,
    reviews,
    /** First load only — the screen shows its skeleton. */
    loading: status === 'idle' || status === 'loading',
    loadingMore,
    refreshing,
    status,
    failure,
    moreFailure,
    hasMore,
    loadMore,
    retryLoadMore,
    refetch,
  };
}

export default useReviewsPage;
