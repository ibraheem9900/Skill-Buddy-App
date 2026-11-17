import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { AxiosError } from 'axios';
import { classifyFeedbackFailure, type FeedbackFailureKind } from '@/lib/feedback';
import type { JobReviews, Review } from '@/lib/reviews';
import { getJobReviews } from '@/services/feedback';

/**
 * GET /api/v1/jobs/{job_id}/reviews, cached per job for the session.
 *
 * Refresh triggers, all covered here so every screen behaves the same:
 *   • first open of a job            → initial read
 *   • returning to the screen        → useFocusEffect revalidates
 *   • app coming back to the foreground → AppState('active') revalidates
 *   • pull-to-refresh / Try Again    → refetch() forces a request
 *   • after a successful Submit Review → invalidateJobReviews(jobId) drops the
 *     cache entry and every mounted hook holding that job revalidates
 *
 * Status:
 *   idle         — no job id
 *   loading      — first read, nothing cached
 *   ready        — data on screen (may be revalidating: `refreshing`)
 *   error        — nothing cached and the read failed (retry offered)
 *   notavailable — 403/404: not a participant, or the job is gone
 */
export type JobReviewsStatus = 'idle' | 'loading' | 'ready' | 'error' | 'notavailable';

const cache = new Map<number, JobReviews>();
const inFlight = new Map<number, Promise<JobReviews>>();
/** Bumped on invalidation/update so mounted hooks know the cache moved. */
const versions = new Map<number, number>();
/** Mounted hooks per job, so a cache update re-renders them immediately. */
const listeners = new Map<number, Set<() => void>>();

function bump(jobId: number) {
  versions.set(jobId, (versions.get(jobId) ?? 0) + 1);
  const subscribers = listeners.get(jobId);
  if (!subscribers) return;
  for (const notify of subscribers) notify();
}

function subscribe(jobId: number, notify: () => void): () => void {
  let subscribers = listeners.get(jobId);
  if (!subscribers) {
    subscribers = new Set();
    listeners.set(jobId, subscribers);
  }
  subscribers.add(notify);
  return () => {
    subscribers?.delete(notify);
    if (subscribers && subscribers.size === 0) listeners.delete(jobId);
  };
}

/** Drops one job (or all) so the next read is fresh. */
export function invalidateJobReviews(jobId?: number): void {
  if (jobId === undefined) {
    cache.clear();
    for (const key of [...versions.keys()]) bump(key);
    return;
  }
  cache.delete(jobId);
  bump(jobId);
}

/**
 * A review gained a photo: the 201 body is the updated JobReviewResponse, so its
 * `my_review` replaces the cached one without a second GET. Mounted hooks are
 * notified and render the server attachments at once.
 */
export function updateJobReviewsMyReview(jobId: number, review: Review): void {
  const cached = cache.get(jobId);
  if (cached) cache.set(jobId, { ...cached, my_review: review });
  bump(jobId);
}

/** Exposed for tests / logout. */
export function clearJobReviewsCache(): void {
  cache.clear();
  inFlight.clear();
  versions.clear();
  listeners.clear();
}

function fetchFresh(jobId: number): Promise<JobReviews> {
  let pending = inFlight.get(jobId);
  if (!pending) {
    pending = getJobReviews(jobId).finally(() => inFlight.delete(jobId));
    inFlight.set(jobId, pending);
  }
  return pending.then((fresh) => {
    cache.set(jobId, fresh);
    return fresh;
  });
}

function failureFromError(error: unknown): { status: JobReviewsStatus; failure: FeedbackFailureKind } {
  const axiosError = error as AxiosError | undefined;
  const code = axiosError?.isAxiosError ? axiosError.response?.status ?? 0 : -1;
  if (code === 403 || code === 404) return { status: 'notavailable', failure: 'forbidden' };
  return {
    status: 'error',
    failure: code === -1 ? 'unknown' : classifyFeedbackFailure(code),
  };
}

export function useJobReviews(jobId: number | null) {
  const cached = jobId !== null ? cache.get(jobId) : undefined;
  const [data, setData] = useState<JobReviews | null>(cached ?? null);
  const [status, setStatus] = useState<JobReviewsStatus>(
    jobId === null ? 'idle' : cached ? 'ready' : 'loading'
  );
  const [failure, setFailure] = useState<FeedbackFailureKind | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const token = useRef(0);
  const version = useRef(jobId !== null ? versions.get(jobId) ?? 0 : 0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'retry') => {
      if (jobId === null) return;
      const ticket = ++token.current;
      const hit = cache.get(jobId);

      if (!hit) setStatus('loading');
      if (mode !== 'initial') setRefreshing(true);
      setFailure(null);

      try {
        const fresh = await fetchFresh(jobId);
        if (!mounted.current || ticket !== token.current) return;
        setData(fresh);
        setStatus('ready');
        version.current = versions.get(jobId) ?? 0;
      } catch (error) {
        if (!mounted.current || ticket !== token.current) return;
        const stale = cache.get(jobId);
        const outcome = failureFromError(error);
        // A failed REFRESH keeps what is already on screen.
        setData(stale ?? null);
        setStatus(stale ? 'ready' : outcome.status);
        setFailure(outcome.failure);
      } finally {
        if (mounted.current && ticket === token.current) setRefreshing(false);
      }
    },
    [jobId]
  );

  /* Seed from cache when the job changes. */
  useEffect(() => {
    if (jobId === null) {
      setData(null);
      setStatus('idle');
      setFailure(null);
      setRefreshing(false);
      return;
    }
    const hit = cache.get(jobId);
    setData(hit ?? null);
    setStatus(hit ? 'ready' : 'loading');
    setFailure(null);
  }, [jobId]);

  /* Open + re-focus: always revalidate, so returning from the review screen
     shows the review that was just submitted. */
  useFocusEffect(
    useCallback(() => {
      if (jobId === null) return;
      void load(cache.has(jobId) ? 'refresh' : 'initial');
    }, [jobId, load])
  );

  /* Cache notifications: a submitted review's photo upload (or an invalidation)
     reaches every mounted hook for this job at once instead of waiting for the
     next focus/foreground event. */
  useEffect(() => {
    if (jobId === null) return;
    return subscribe(jobId, () => {
      const hit = cache.get(jobId);
      version.current = versions.get(jobId) ?? version.current;
      if (hit) {
        setData(hit);
        setStatus('ready');
        setFailure(null);
        return;
      }
      void load('refresh');
    });
  }, [jobId, load]);

  /* Invalidation (e.g. the submit hook) clears the cache entry; this effect
     notices the version bump and re-reads. */
  useEffect(() => {
    if (jobId === null) return;
    const current = versions.get(jobId) ?? 0;
    if (current === version.current) return;
    version.current = current;
    void load('refresh');
  }, [jobId, load, status]);

  /* Background → foreground revalidates, so a review written elsewhere appears. */
  useEffect(() => {
    if (jobId === null) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void load('refresh');
    });
    return () => sub.remove();
  }, [jobId, load]);

  const refetch = useCallback(
    (mode: 'refresh' | 'retry' = 'retry') => load(mode),
    [load]
  );

  return { data, status, failure, refreshing, refetch };
}

export default useJobReviews;
