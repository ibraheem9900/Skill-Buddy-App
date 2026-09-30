import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobList } from '@/hooks/useJobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import { classifyCompleteJobFailure, isValidJobId } from '@/lib/jobComplete';
import type { JobActionFailure } from '@/lib/jobAction';
import type { JobResponse } from '@/types';

/**
 * Marks the provider's work on a job as finished
 * (POST /api/v1/jobs/{job_id}/complete).
 *
 * The same shape as useStartJob / useAssignProvider / useConfirmPayment — protected
 * POST, busy guard, both caches invalidated, the returned job adopted whole and NOT
 * wrapped in `{ message, job }` — with the two contract details this endpoint brings:
 *
 *  1. it takes NO body at all (the spec declares only the job_id path parameter), so
 *     nothing is sent: no `completed_at`, no rating, no review;
 *  2. it is the PROVIDER's action, so the caller must gate on the role as well as on
 *     the job being in progress (see canCompleteJob in lib/jobComplete) — the backend
 *     enforces the real authorisation, and a 403 is surfaced as its own message rather
 *     than a generic failure.
 *
 * On success the caller replaces its held job with the returned JobResponse: status,
 * completed_at, is_editable, is_cancellable, the can_* flags, status_history and
 * milestones all come from the backend, and any action that no longer makes sense on a
 * finished job (Start, Convert, Cancel) disappears from the returned flags by itself.
 * Nothing is set locally — in particular the app never writes `completed_at` or flips
 * the status itself.
 *
 * The rating/review and any payment release that follow completion are SEPARATE
 * tasks: nothing in this hook navigates to them.
 *
 * Double submissions are blocked twice over — `completing` disables the button and
 * `inFlight` rejects a second call — because a second completion is exactly what the
 * backend is likely to reject.
 */
export type CompleteJobOutcome =
  | { ok: true; job: JobResponse }
  | ({ ok: false } & JobActionFailure)
  /** A completion is already running; the caller should not treat this as an error. */
  | { ok: false; kind: 'busy'; message: null };

export function useCompleteJob() {
  const [completing, setCompleting] = useState(false);
  const inFlight = useRef(false);

  const completeJob = useCallback(async (jobId: number): Promise<CompleteJobOutcome> => {
    if (inFlight.current) return { ok: false, kind: 'busy', message: null };
    if (!isValidJobId(jobId)) return { ok: false, kind: 'badrequest', message: null };

    inFlight.current = true;
    setCompleting(true);
    try {
      const { data } = await authApi.completeJob(jobId);
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
      return { ok: false, ...classifyCompleteJobFailure(err) };
    } finally {
      inFlight.current = false;
      setCompleting(false);
    }
  }, []);

  return { completeJob, completing };
}

export default useCompleteJob;
