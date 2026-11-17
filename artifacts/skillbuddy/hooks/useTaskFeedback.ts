import { useCallback, useEffect, useRef, useState } from 'react';
import type { AxiosError } from 'axios';
import { classifyFeedbackFailure, type FeedbackFailureKind } from '@/lib/feedback';
import type { TaskFeedback } from '@/lib/taskFeedback';
import { listTaskFeedback } from '@/services/feedback';

/**
 * Task feedback history, cached per (job, task) for the session.
 *
 * The list changes only when somebody denies/disputes a Task, but it must be
 * fresh whenever the screen opens or the user pulls down — so a screen open
 * reads from cache and then revalidates, while pull-to-refresh / Try Again
 * force a request.
 *
 * Status:
 *   idle        — no valid ids
 *   loading     — first read, nothing cached yet
 *   ready       — data on screen (possibly revalidating: `refreshing`)
 *   error       — no data and the read failed (retry offered)
 *   notavailable— 403/404: the viewer is not a participant, or the Task is gone
 */
export type TaskFeedbackStatus = 'idle' | 'loading' | 'ready' | 'error' | 'notavailable';

const cache = new Map<string, TaskFeedback[]>();
const inFlight = new Map<string, Promise<TaskFeedback[]>>();

function keyOf(jobId: number, milestoneId: number): string {
  return `${jobId}:${milestoneId}`;
}

/** Shared read: one request per (job, task) even when several callers ask. */
function fetchFresh(jobId: number, milestoneId: number): Promise<TaskFeedback[]> {
  const key = keyOf(jobId, milestoneId);
  let pending = inFlight.get(key);
  if (!pending) {
    pending = listTaskFeedback(jobId, milestoneId).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending.then((fresh) => {
    cache.set(key, fresh);
    return fresh;
  });
}

/**
 * Drops the cache so the next screen open re-reads.
 *
 * TODO(feedback-submit / dispute-submit): call this from the write flow as soon
 * as the submit + attachment APIs are wired — after a denial or dispute is
 * created, `invalidateTaskFeedback(jobId, milestoneId)` (and then opening the
 * history) shows the new entry instead of a stale list.
 */
export function invalidateTaskFeedback(jobId?: number, milestoneId?: number): void {
  if (jobId === undefined) {
    cache.clear();
    return;
  }
  if (milestoneId === undefined) {
    for (const key of [...cache.keys()]) {
      if (key.startsWith(`${jobId}:`)) cache.delete(key);
    }
    return;
  }
  cache.delete(keyOf(jobId, milestoneId));
}

/** Exposed for tests / logout. */
export function clearTaskFeedbackCache(): void {
  cache.clear();
  inFlight.clear();
}

function failureFromError(error: unknown): {
  status: TaskFeedbackStatus;
  failure: FeedbackFailureKind;
} {
  const axiosError = error as AxiosError | undefined;
  const code = axiosError?.isAxiosError ? axiosError.response?.status ?? 0 : -1;
  if (code === 403 || code === 404) return { status: 'notavailable', failure: 'forbidden' };
  return {
    status: 'error',
    failure: code === -1 ? 'unknown' : classifyFeedbackFailure(code),
  };
}

export function useTaskFeedback(jobId: number | null, milestoneId: number | null) {
  const valid = jobId !== null && milestoneId !== null;
  const cached = valid ? cache.get(keyOf(jobId, milestoneId)) : undefined;
  const [items, setItems] = useState<TaskFeedback[]>(cached ?? []);
  const [status, setStatus] = useState<TaskFeedbackStatus>(
    valid ? (cached ? 'ready' : 'loading') : 'idle'
  );
  const [failure, setFailure] = useState<FeedbackFailureKind | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const token = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'retry') => {
      if (jobId === null || milestoneId === null) return;
      const ticket = ++token.current;
      const hit = cache.get(keyOf(jobId, milestoneId));

      if (!hit) setStatus('loading');
      if (mode !== 'initial') setRefreshing(true);
      setFailure(null);

      try {
        const fresh = await fetchFresh(jobId, milestoneId);
        if (!mounted.current || ticket !== token.current) return;
        setItems(fresh);
        setStatus('ready');
      } catch (error) {
        if (!mounted.current || ticket !== token.current) return;
        const stale = cache.get(keyOf(jobId, milestoneId));
        const outcome = failureFromError(error);
        setItems(stale ?? []);
        // A failed REFRESH keeps the list that is already on screen.
        setStatus(stale ? 'ready' : outcome.status);
        setFailure(outcome.failure);
      } finally {
        if (mounted.current && ticket === token.current) setRefreshing(false);
      }
    },
    [jobId, milestoneId]
  );

  useEffect(() => {
    if (jobId === null || milestoneId === null) {
      setItems([]);
      setStatus('idle');
      setFailure(null);
      return;
    }
    const hit = cache.get(keyOf(jobId, milestoneId));
    setItems(hit ?? []);
    setStatus(hit ? 'ready' : 'loading');
    setFailure(null);
    void load(hit ? 'refresh' : 'initial');
  }, [jobId, milestoneId, load]);

  /** Retry after an error, or pull-to-refresh. */
  const refetch = useCallback(
    (mode: 'refresh' | 'retry' = 'retry') => load(mode),
    [load]
  );

  return { items, status, failure, refreshing, refetch };
}

/**
 * Counts for the entry-point badges on Job Details: one read per Task, served
 * from (and seeded into) the same cache the history screen uses. Failures are
 * silent — a missing count must never break the Job screen, it just shows no
 * badge.
 */
export function useTaskFeedbackCounts(
  jobId: number | null,
  milestoneIds: readonly number[]
): Record<number, number> {
  const [counts, setCounts] = useState<Record<number, number>>({});
  const signature = milestoneIds.join(',');

  useEffect(() => {
    if (jobId === null || signature.length === 0) {
      setCounts({});
      return;
    }
    let cancelled = false;
    const ids = signature
      .split(',')
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);

    (async () => {
      const next: Record<number, number> = {};
      await Promise.all(
        ids.map(async (milestoneId) => {
          const hit = cache.get(keyOf(jobId, milestoneId));
          if (hit) {
            next[milestoneId] = hit.length;
            return;
          }
          try {
            next[milestoneId] = (await fetchFresh(jobId, milestoneId)).length;
          } catch {
            // No badge for this Task; the history screen reports the real error.
          }
        })
      );
      if (!cancelled) setCounts(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId, signature]);

  return counts;
}
