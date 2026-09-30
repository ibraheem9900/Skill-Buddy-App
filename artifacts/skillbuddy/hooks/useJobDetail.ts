import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { firstErrorMessage } from '@/lib/jobList';
import type { JobResponse } from '@/types';

/**
 * ONE job in FULL (GET /api/v1/jobs/{job_id}).
 *
 *  - idle          not started
 *  - loading       fetch in flight
 *  - ready         detail loaded
 *  - notfound      404 — no such job for this user
 *  - forbidden     403 — the job exists but is not this user's (undocumented
 *                  in Swagger; observed/handled generically)
 *  - invalid       422 — the path id was rejected; `serverMessage` carries the
 *                  server's readable text (data, not UI copy)
 *  - unauthorized  401 that survived the shared client's refresh + retry
 *  - error         timeout / network / 5xx
 *
 * This is the details screen's ONLY source. The list response is a lighter
 * object (no description, address, attachments, status_history or can_* flags),
 * so a list row can never satisfy this view — hence a separate per-id cache,
 * and hence the list item is never passed here as a seed.
 *
 * 401 carries no bespoke handling: the shared axios client refreshes once and
 * replays, and a failure that survives that is reported as `unauthorized`.
 */
export type JobDetailStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'notfound'
  | 'forbidden'
  | 'invalid'
  | 'unauthorized'
  | 'error';

const cache = new Map<number, JobResponse>();

/** Drop a cached job (call after a mutation so the next open re-reads it). */
export function invalidateJobDetail(jobId?: number): void {
  if (jobId === undefined) cache.clear();
  else cache.delete(jobId);
}

export function useJobDetail(jobId: number | null) {
  const [status, setStatus] = useState<JobDetailStatus>(
    jobId !== null && cache.has(jobId) ? 'ready' : 'idle'
  );
  const [job, setJob] = useState<JobResponse | null>(
    jobId !== null ? cache.get(jobId) ?? null : null
  );
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(
    async (force = false) => {
      if (jobId === null || inFlight.current) return;
      if (!force && cache.has(jobId)) {
        setJob(cache.get(jobId)!);
        setStatus('ready');
        return;
      }
      inFlight.current = true;
      setStatus('loading');
      setServerMessage(null);
      try {
        const { data } = await authApi.getJob(jobId);
        cache.set(jobId, data);
        setJob(data);
        setStatus('ready');
      } catch (err: any) {
        const httpStatus: number | undefined = err?.response?.status;
        if (httpStatus === 404) {
          setServerMessage(firstErrorMessage(err?.response?.data));
          setStatus('notfound');
        } else if (httpStatus === 403) {
          setServerMessage(firstErrorMessage(err?.response?.data));
          setStatus('forbidden');
        } else if (httpStatus === 422) {
          setServerMessage(firstErrorMessage(err?.response?.data));
          setStatus('invalid');
        } else if (httpStatus === 401) {
          setStatus('unauthorized');
        } else {
          setStatus('error');
        }
      } finally {
        inFlight.current = false;
      }
    },
    [jobId]
  );

  const retry = useCallback(() => {
    void load(true);
  }, [load]);

  /**
   * Background refresh, used when the screen regains focus or the bidding
   * countdown reaches zero.
   *
   * Unlike `load(true)` it does NOT drop back to the full-screen loader when a
   * job is already on screen — a focus refresh must never blank the view. A 404
   * is still surfaced (the job is gone) and a 401 still ends the session; any
   * other failure keeps the data the user can already see, and the next focus
   * or countdown expiry retries.
   *
   * Returns the freshly fetched job (or null when it could not be re-read) so a
   * caller that NEEDS the new value — e.g. the edit screen checking whether
   * is_editable flipped while it was open — does not have to fetch again.
   */
  const refetch = useCallback(async (): Promise<JobResponse | null> => {
    if (jobId === null || inFlight.current) return null;
    const hadData = cache.has(jobId);
    inFlight.current = true;
    if (!hadData) setStatus('loading');
    try {
      const { data } = await authApi.getJob(jobId);
      cache.set(jobId, data);
      setJob(data);
      setServerMessage(null);
      setStatus('ready');
      return data;
    } catch (err: any) {
      const httpStatus: number | undefined = err?.response?.status;
      if (httpStatus === 404) {
        cache.delete(jobId);
        setServerMessage(firstErrorMessage(err?.response?.data));
        setStatus('notfound');
      } else if (httpStatus === 401) {
        setStatus('unauthorized');
      } else if (!hadData) {
        // Nothing on screen to fall back to, so behave like a first load.
        if (httpStatus === 403) {
          setServerMessage(firstErrorMessage(err?.response?.data));
          setStatus('forbidden');
        } else if (httpStatus === 422) {
          setServerMessage(firstErrorMessage(err?.response?.data));
          setStatus('invalid');
        } else {
          setStatus('error');
        }
      }
      return null;
    } finally {
      inFlight.current = false;
    }
  }, [jobId]);

  /**
   * Adopt a job we already hold from a write endpoint.
   *
   * After POST /api/v1/jobs/{job_id}/publish the server returns the full,
   * authoritative job — so there is no reason to re-fetch it. Writing it into
   * the cache AND the current state keeps a later re-open consistent with what
   * this screen is showing, and leaves no window where the UI still says DRAFT
   * while the server says otherwise.
   */
  const applyJob = useCallback((next: JobResponse) => {
    cache.set(next.id, next);
    setJob(next);
    setServerMessage(null);
    setStatus('ready');
  }, []);

  return {
    status,
    job,
    serverMessage,
    load,
    retry,
    refetch,
    applyJob,
    refresh: () => load(true),
  };
}

export default useJobDetail;
