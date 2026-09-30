import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobList } from '@/hooks/useJobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import { classifyStartJobFailure, isValidJobId } from '@/lib/jobStart';
import type { JobActionFailure } from '@/lib/jobAction';
import type { JobResponse } from '@/types';

/**
 * Starts the provider's work on a job (POST /api/v1/jobs/{job_id}/start).
 *
 * The same shape as useAssignProvider / useConfirmPayment — protected POST, busy guard,
 * both caches invalidated, the returned job adopted whole and NOT wrapped in
 * `{ message, job }` — with the two contract details this endpoint brings:
 *
 *  1. it takes NO body at all (the spec declares only the job_id path parameter), so
 *     nothing is sent and no `started_at` / location is invented;
 *  2. it is the PROVIDER's action, so the caller must gate on the role as well as on
 *     the startable state (see canStartJob in lib/jobStart) — the backend enforces the
 *     real authorisation, and a 403 is surfaced as its own message rather than a
 *     generic failure.
 *
 * On success the caller replaces its held job with the returned JobResponse: status,
 * is_editable, the can_* flags, status_history and milestones all come from the
 * backend, and if the response closes bidding the screen's countdown disappears with
 * it. Nothing is set locally.
 *
 * Double submissions are blocked twice over — `starting` disables the button and
 * `inFlight` rejects a second call — because a second start is exactly what the
 * backend is likely to reject (or worse, to record twice).
 */
export type StartJobOutcome =
  | { ok: true; job: JobResponse }
  | ({ ok: false } & JobActionFailure)
  /** A start is already running; the caller should not treat this as an error. */
  | { ok: false; kind: 'busy'; message: null };

export function useStartJob() {
  const [starting, setStarting] = useState(false);
  const inFlight = useRef(false);

  const startJob = useCallback(async (jobId: number): Promise<StartJobOutcome> => {
    if (inFlight.current) return { ok: false, kind: 'busy', message: null };
    if (!isValidJobId(jobId)) return { ok: false, kind: 'badrequest', message: null };

    inFlight.current = true;
    setStarting(true);
    try {
      const { data } = await authApi.startJob(jobId);
      invalidateJobList();
      invalidateJobDetail(jobId);
      // The 200 IS the job here (no envelope). A malformed payload must never put a
      // bogus object into the screen's state — treat it as a retryable failure
      // instead of adopting `undefined` and wiping the screen.
      if (!data || typeof data !== 'object' || typeof data.id !== 'number') {
        return { ok: false, kind: 'server', message: null };
      }
      return { ok: true, job: data };
    } catch (err) {
      return { ok: false, ...classifyStartJobFailure(err) };
    } finally {
      inFlight.current = false;
      setStarting(false);
    }
  }, []);

  return { startJob, starting };
}

export default useStartJob;
