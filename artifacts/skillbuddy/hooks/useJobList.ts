import { useCallback, useEffect, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { JOBS_PAGE_SIZE, firstErrorMessage, mergeJobsPage } from '@/lib/jobList';
import type { JobApiStatus, JobListItem, JobRequestType } from '@/types';

/**
 * The authenticated user's jobs (GET /api/v1/jobs), paginated.
 *
 * PAGING: the endpoint returns a BARE ARRAY with NO total count, so a page
 * shorter than `limit` is the last page (inferred in lib/jobList.mergeJobsPage,
 * which also de-duplicates by id). offset advances by the number of items
 * actually held, so overlap from a shifting list can never duplicate a row.
 *
 * STATES
 *  - idle          not started
 *  - loading       FIRST page in flight (screen shows the skeleton)
 *  - ready         list loaded (possibly empty)
 *  - invalid       422 — the query was rejected; `serverMessage` carries the
 *                  server's readable message (it is data, not UI copy)
 *  - unauthorized  401 that survived the client's automatic refresh + retry,
 *                  i.e. the session is over
 *  - error         timeout / network / 5xx
 *
 * SOFT ERRORS: a failure while refreshing or paginating must NOT hide jobs the
 * user is already looking at, so those set `inlineError` and leave the list and
 * `status` untouched.
 *
 * 401: no bespoke token handling here — the shared axios client refreshes once
 * and replays the request, and clears the session when that fails.
 *
 * INVALIDATION: `invalidateJobList()` is called after a job is created so this
 * list cannot show stale data (requirement: a newly created job must appear).
 */
export type JobListStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'invalid'
  | 'unauthorized'
  | 'error';

export interface JobListFilters {
  status: JobApiStatus | null;
  requestType: JobRequestType | null;
  onlyActivelyBidding: boolean;
}

export const EMPTY_JOB_FILTERS: JobListFilters = {
  status: null,
  requestType: null,
  onlyActivelyBidding: false,
};

/** True when any filter is narrowing the list (drives the empty-state copy). */
export function hasActiveFilters(filters: JobListFilters): boolean {
  return (
    filters.status !== null ||
    filters.requestType !== null ||
    filters.onlyActivelyBidding
  );
}

/* ── Module-level invalidation ─────────────────────────────────────────────── */

type InvalidateListener = () => void;
const listeners = new Set<InvalidateListener>();

/**
 * Tell every mounted job list that its data is stale. Called after a job is
 * created (201) so the list refetches instead of showing stale data.
 */
export function invalidateJobList(): void {
  listeners.forEach((listener) => listener());
}

function subscribeJobList(listener: InvalidateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* ── Hook ─────────────────────────────────────────────────────────────────── */

type LoadMode = 'initial' | 'refresh' | 'more';

export function useJobList() {
  const [filters, setFiltersState] = useState<JobListFilters>(EMPTY_JOB_FILTERS);
  const [status, setStatus] = useState<JobListStatus>('idle');
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [inlineError, setInlineError] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const jobsRef = useRef<JobListItem[]>([]);
  const filtersRef = useRef<JobListFilters>(EMPTY_JOB_FILTERS);
  const offsetRef = useRef(0);
  /** The seq of the request currently in flight, if any. */
  const inFlightSeq = useRef<number | null>(null);
  /** Bumped on every load and on filter changes, so stale responses are dropped. */
  const seqRef = useRef(0);

  const applyJobs = useCallback((next: JobListItem[]) => {
    jobsRef.current = next;
    setJobs(next);
  }, []);

  const fetchPage = useCallback(
    async (mode: LoadMode) => {
      // Never run two pagination/refresh requests at once. A superseding
      // 'initial' load (filter change) is always allowed — the seq guard below
      // discards whatever was in flight.
      if (mode !== 'initial' && inFlightSeq.current !== null) return;

      const seq = ++seqRef.current;
      inFlightSeq.current = seq;

      const active = filtersRef.current;
      const offset = mode === 'more' ? offsetRef.current : 0;

      if (mode === 'initial') {
        setStatus('loading');
        setInlineError(false);
        setServerMessage(null);
      } else if (mode === 'refresh') {
        setRefreshing(true);
      } else {
        setLoadingMore(true);
        setInlineError(false);
      }

      try {
        const { data } = await authApi.listJobs({
          status: active.status ?? undefined,
          request_type: active.requestType ?? undefined,
          only_actively_bidding: active.onlyActivelyBidding,
          limit: JOBS_PAGE_SIZE,
          offset,
        });

        if (seq !== seqRef.current) return; // superseded by a filter change

        const page = Array.isArray(data) ? data : [];

        if (mode === 'more') {
          const merged = mergeJobsPage(jobsRef.current, page, JOBS_PAGE_SIZE);
          applyJobs(merged.items);
          // Advance by what the SERVER returned, not by what the list kept:
          // de-duplication can drop overlapping rows, and paging off the kept
          // count would then re-request the same window forever.
          offsetRef.current += page.length;
          setHasMore(merged.hasMore);
        } else {
          applyJobs(page);
          offsetRef.current = page.length;
          setHasMore(page.length >= JOBS_PAGE_SIZE);
        }

        setStatus('ready');
        setServerMessage(null);
      } catch (err: any) {
        if (seq !== seqRef.current) return;

        const httpStatus: number | undefined = err?.response?.status;
        const message = firstErrorMessage(err?.response?.data);

        if (mode !== 'initial' && httpStatus !== 401) {
          // Keep what the user can already see; just flag the soft failure.
          setInlineError(true);
        } else if (httpStatus === 422) {
          setServerMessage(message);
          setStatus('invalid');
        } else if (httpStatus === 401) {
          setStatus('unauthorized');
        } else {
          setStatus('error');
        }
      } finally {
        if (inFlightSeq.current === seq) inFlightSeq.current = null;
        if (seq === seqRef.current) {
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [applyJobs]
  );

  // Drop any late response after unmount (no state update, no leak).
  useEffect(() => {
    return () => {
      seqRef.current += 1;
    };
  }, []);

  // A created job invalidates the list.
  useEffect(() => {
    return subscribeJobList(() => {
      void fetchPage('refresh');
    });
  }, [fetchPage]);

  // First load.
  useEffect(() => {
    if (status === 'idle') void fetchPage('initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Change filters: reset paging, clear the list, refetch from offset 0. */
  const setFilters = useCallback(
    (next: JobListFilters) => {
      filtersRef.current = next;
      setFiltersState(next);

      seqRef.current += 1; // discard anything in flight
      inFlightSeq.current = null;
      applyJobs([]);
      offsetRef.current = 0;
      setHasMore(false);
      setInlineError(false);
      setServerMessage(null);

      void fetchPage('initial');
    },
    [applyJobs, fetchPage]
  );

  /** Pull-to-refresh: back to offset 0 (the current page replaces the list). */
  const refresh = useCallback(() => {
    seqRef.current += 1;
    inFlightSeq.current = null;
    void fetchPage('refresh');
  }, [fetchPage]);

  /** Retry after a hard failure. */
  const retry = useCallback(() => {
    void fetchPage('initial');
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || refreshing) return;
    void fetchPage('more');
  }, [fetchPage, hasMore, loadingMore, refreshing]);

  return {
    status,
    jobs,
    hasMore,
    loadingMore,
    refreshing,
    inlineError,
    serverMessage,
    filters,
    setFilters,
    refresh,
    retry,
    loadMore,
  };
}

export default useJobList;
