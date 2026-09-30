import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobList } from '@/hooks/useJobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import { classifyPublishFailure, isValidJobId, type PublishFailure } from '@/lib/jobPublish';
import type { JobResponse } from '@/types';

/**
 * Publishes a DRAFT job (POST /api/v1/jobs/{job_id}/publish).
 *
 * Shared by the job details screen and the create-job flow so both get the SAME
 * behaviour and the same error handling — one implementation, no duplication.
 *
 * On success the returned FULL JobResponse is handed back so the caller can
 * replace its local job with the server's truth (status, is_bidding_open, the
 * bidding window). Nothing about the published state is assumed: a job is only
 * ever published when `status === 'DRAFT'`, and the post-publish status comes
 * from the response.
 *
 * Both caches are invalidated on success so a mounted list (and any cached
 * detail) refetches rather than showing the stale DRAFT status.
 *
 * Double taps: `publishing` disables the button, and `inFlight` rejects a
 * second call outright even if two call sites race.
 */
export type PublishOutcome =
  | { ok: true; job: JobResponse }
  | ({ ok: false } & PublishFailure)
  /** A publish is already running; the caller should not treat this as an error. */
  | { ok: false; kind: 'busy'; message: null };

export function usePublishJob() {
  const [publishing, setPublishing] = useState(false);
  const inFlight = useRef(false);

  const publish = useCallback(async (jobId: number): Promise<PublishOutcome> => {
    if (inFlight.current) return { ok: false, kind: 'busy', message: null };
    if (!isValidJobId(jobId)) return { ok: false, kind: 'badrequest', message: null };

    inFlight.current = true;
    setPublishing(true);
    try {
      const { data } = await authApi.publishJob(jobId);
      // The list must not keep showing the old DRAFT row, and a cached detail
      // must not survive: the caller re-applies the fresh job right after this.
      invalidateJobList();
      invalidateJobDetail(jobId);
      return { ok: true, job: data };
    } catch (err) {
      return { ok: false, ...classifyPublishFailure(err) };
    } finally {
      inFlight.current = false;
      setPublishing(false);
    }
  }, []);

  return { publish, publishing };
}

export default usePublishJob;
