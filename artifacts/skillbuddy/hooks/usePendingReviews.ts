import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { AxiosError } from 'axios';
import { classifyFeedbackFailure, type FeedbackFailureKind } from '@/lib/feedback';
import type { PendingReview } from '@/lib/reviews';
import { listPendingReviews } from '@/services/feedback';
import { useRole } from '@/context/RoleContext';

/**
 * GET /api/v1/reviews/pending — the closed jobs this user can still review.
 *
 * One session cache shared by every surface (Home card, Profile badge, the
 * "Reviews to write" screen), so the count on the badge and the list can never
 * disagree.
 *
 * Refresh triggers:
 *   • first use / screen focus        → initial or refresh
 *   • app returning to the foreground → refresh
 *   • login or role switch            → refresh (the list is per-user + per-role)
 *   • pull-to-refresh / Try Again     → refetch()
 *   • a successful Submit Review      → invalidatePendingReviews() from
 *     useSubmitReview, plus invalidateJobReviews(jobId) for that job
 *
 * Errors never break a host screen: the Home card simply does not render (the
 * hook reports `status`), while the dedicated screen shows Try Again.
 */
export type PendingReviewsStatus = 'idle' | 'loading' | 'ready' | 'error';

const cache = new Map<string, PendingReview[]>();
const inFlight = new Map<string, Promise<PendingReview[]>>();
let versions = 0;

/** Drops the cache; mounted hooks revalidate on the next focus/version bump. */
export function invalidatePendingReviews(): void {
  cache.clear();
  versions += 1;
}

/** Exposed for tests / logout. */
export function clearPendingReviewsCache(): void {
  cache.clear();
  inFlight.clear();
  versions = 0;
}

/** Cache key: the list is per role, so a role switch is a different list. */
function keyOf(role: string): string {
  return role;
}

function fetchFresh(role: string): Promise<PendingReview[]> {
  const key = keyOf(role);
  let pending = inFlight.get(key);
  if (!pending) {
    pending = listPendingReviews().finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending.then((fresh) => {
    cache.set(key, fresh);
    return fresh;
  });
}

function failureFromError(error: unknown): FeedbackFailureKind {
  const axiosError = error as AxiosError | undefined;
  const code = axiosError?.isAxiosError ? axiosError.response?.status ?? 0 : -1;
  return code === -1 ? 'unknown' : classifyFeedbackFailure(code);
}

export function usePendingReviews() {
  const { activeRole } = useRole();
  const role = activeRole === 'PROVIDER' ? 'PROVIDER' : 'CLIENT';
  const cached = cache.get(keyOf(role));

  const [data, setData] = useState<PendingReview[]>(cached ?? []);
  const [status, setStatus] = useState<PendingReviewsStatus>(cached ? 'ready' : 'loading');
  const [failure, setFailure] = useState<FeedbackFailureKind | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const token = useRef(0);
  const version = useRef(versions);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'retry') => {
      const ticket = ++token.current;
      const hit = cache.get(keyOf(role));

      if (!hit) setStatus('loading');
      if (mode !== 'initial') setRefreshing(true);
      setFailure(null);

      try {
        const fresh = await fetchFresh(role);
        if (!mounted.current || ticket !== token.current) return;
        setData(fresh);
        setStatus('ready');
        version.current = versions;
      } catch (error) {
        if (!mounted.current || ticket !== token.current) return;
        const stale = cache.get(keyOf(role));
        // A failed refresh keeps the list already on screen.
        setData(stale ?? []);
        setStatus(stale ? 'ready' : 'error');
        setFailure(failureFromError(error));
      } finally {
        if (mounted.current && ticket === token.current) setRefreshing(false);
      }
    },
    [role]
  );

  /* Role switch: different list. */
  useEffect(() => {
    const hit = cache.get(keyOf(role));
    setData(hit ?? []);
    setStatus(hit ? 'ready' : 'loading');
    setFailure(null);
  }, [role]);

  /* Focus revalidates (returning from the review screen shows the item gone). */
  useFocusEffect(
    useCallback(() => {
      void load(cache.has(keyOf(role)) ? 'refresh' : 'initial');
    }, [load, role])
  );

  /* Invalidation from a submit bumps `versions`. */
  useEffect(() => {
    if (versions === version.current) return;
    version.current = versions;
    void load('refresh');
  }, [load]);

  /* Foreground: the deadline countdown and the list are both time-sensitive. */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void load('refresh');
    });
    return () => sub.remove();
  }, [load]);

  const refetch = useCallback((mode: 'refresh' | 'retry' = 'retry') => load(mode), [load]);

  return {
    items: data,
    count: data.length,
    /** Deadline-first item, or null — used by the reminder card's hint. */
    soonest: data[0] ?? null,
    status,
    failure,
    refreshing,
    refetch,
  };
}

export default usePendingReviews;
