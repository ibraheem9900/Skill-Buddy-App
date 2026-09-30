import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobList } from '@/hooks/useJobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import {
  buildCancelRequest,
  classifyCancelJobFailure,
  isValidJobId,
  validateCancelReason,
} from '@/lib/jobCancel';
import type { JobActionFailure } from '@/lib/jobAction';
import type { JobResponse, ValidationErrorDetail } from '@/types';

/**
 * Cancels a job (POST /api/v1/jobs/{job_id}/cancel).
 *
 * The same shape as useAssignProvider — protected POST with a REQUIRED body, busy
 * guard, both caches invalidated, the returned job adopted whole and NOT wrapped in
 * `{ message, job }` — with the two contract details this endpoint brings:
 *
 *  1. it REQUIRES `{ reason, notes }` (unlike start/complete, which are body-less):
 *     `reason` is 3–255 characters of free text and is validated here as well as on
 *     the screen, so a blank reason can never be posted;
 *  2. the reason/notes are passed in on EVERY call, so a retry after a network failure
 *     re-sends exactly what the user typed — the caller keeps the form state untouched
 *     for precisely this reason.
 *
 * On success the caller replaces its held job with the returned JobResponse:
 * cancellation_reason, cancellation_notes, cancellation_fee_charged, cancelled_at,
 * status and the can_* flags all come from the backend. Nothing is set locally — in
 * particular the app never decides whether a fee applies; Job Details renders
 * `cancellation_fee_charged` from the response.
 *
 * Double submissions are blocked twice over — `cancelling` disables the button and
 * `inFlight` rejects a second call — because a second cancel is exactly what the
 * backend is likely to reject.
 */
export type CancelJobOutcome =
  | { ok: true; job: JobResponse }
  | (({ ok: false } & JobActionFailure) & {
        /**
         * The raw 422 `detail[]`, kept so the screen can put a rejected `reason` on
         * the reason input instead of showing a generic error. Absent for every other
         * failure — the bucket copy is used there.
         */
        detail?: ValidationErrorDetail[];
      })
  /** A cancellation is already running; the caller should not treat this as an error. */
  | { ok: false; kind: 'busy'; message: null };

export function useCancelJob() {
  const [cancelling, setCancelling] = useState(false);
  const inFlight = useRef(false);

  const cancelJob = useCallback(
    async (jobId: number, reason: string, notes?: string | null): Promise<CancelJobOutcome> => {
      if (inFlight.current) return { ok: false, kind: 'busy', message: null };
      if (!isValidJobId(jobId)) return { ok: false, kind: 'badrequest', message: null };
      // Defence in depth: the screen validates first, but a rejected reason must never
      // reach the API (it would be a pointless 422).
      if (validateCancelReason(reason) !== null) {
        return { ok: false, kind: 'invalid', message: null };
      }

      inFlight.current = true;
      setCancelling(true);
      try {
        const { data } = await authApi.cancelJob(jobId, buildCancelRequest(reason, notes));
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
        const failure = classifyCancelJobFailure(err);
        // Keep the 422 detail[] for field-level mapping (e.g. a too-short `reason`).
        const rawDetail = (err as { response?: { data?: { detail?: unknown } } } | null | undefined)
          ?.response?.data?.detail;
        const detail = Array.isArray(rawDetail) ? (rawDetail as ValidationErrorDetail[]) : undefined;
        return { ok: false, ...failure, detail };
      } finally {
        inFlight.current = false;
        setCancelling(false);
      }
    },
    []
  );

  return { cancelJob, cancelling };
}

export default useCancelJob;
