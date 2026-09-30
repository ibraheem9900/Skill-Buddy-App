import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobList } from '@/hooks/useJobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import {
  buildPauseRequest,
  classifyPauseJobFailure,
  isValidJobId,
  validatePauseDetails,
} from '@/lib/jobPause';
import type { JobActionFailure } from '@/lib/jobAction';
import type { JobResponse, ValidationErrorDetail } from '@/types';

/**
 * Pauses a job as its client (POST /api/v1/jobs/{job_id}/pause-by-client).
 *
 * The same shape as useDeclineJobByProvider — a protected POST with a REQUIRED body,
 * busy guard, both caches invalidated, the returned job adopted whole — with the
 * contract details this endpoint brings:
 *
 *  1. the body is the JobDetailsRequest `{ details }` (a single free-text string,
 *     3–1000 characters), NOT `reason`/`notes`; it is validated here as well as on the
 *     screen, so a blank explanation can never be posted;
 *  2. the 200 IS the job (no `{ message, job }` envelope and no `message` field), so
 *     the success toast is written by the caller;
 *  3. the details are passed in on EVERY call, so a retry after a network failure
 *     re-sends exactly what the client typed — the caller keeps the form state
 *     untouched for precisely this reason.
 *
 * On success the caller replaces its held job with the returned JobResponse: status,
 * is_editable, is_cancellable, the can_* flags, status_history and milestones all come
 * from the backend. Nothing is set locally — in particular the app never decides what
 * the paused status is called, it renders whatever the response carries.
 *
 * Double submissions are blocked twice over — `pausing` disables the button and
 * `inFlight` rejects a second call — because a second pause is exactly what the backend
 * is likely to reject.
 */
export type PauseJobOutcome =
  | { ok: true; job: JobResponse }
  | (({ ok: false } & JobActionFailure) & {
        /**
         * The raw 422 `detail[]`, kept so the screen can put a rejected `details`
         * message on the input instead of showing a generic error. Absent for every
         * other failure — the bucket copy is used there.
         */
        detail?: ValidationErrorDetail[];
      })
  /** A pause is already running; the caller should not treat this as an error. */
  | { ok: false; kind: 'busy'; message: null };

export function usePauseJobByClient() {
  const [pausing, setPausing] = useState(false);
  const inFlight = useRef(false);

  const pauseJob = useCallback(
    async (jobId: number, details: string): Promise<PauseJobOutcome> => {
      if (inFlight.current) return { ok: false, kind: 'busy', message: null };
      if (!isValidJobId(jobId)) return { ok: false, kind: 'badrequest', message: null };
      // Defence in depth: the screen validates first, but a rejected value must never
      // reach the API (it would be a pointless 422).
      if (validatePauseDetails(details) !== null) {
        return { ok: false, kind: 'invalid', message: null };
      }

      inFlight.current = true;
      setPausing(true);
      try {
        const { data } = await authApi.pauseJobByClient(jobId, buildPauseRequest(details));
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
        const failure = classifyPauseJobFailure(err);
        // Keep the 422 detail[] for field-level mapping (e.g. a too-short `details`).
        const rawDetail = (err as { response?: { data?: { detail?: unknown } } } | null | undefined)
          ?.response?.data?.detail;
        const detail = Array.isArray(rawDetail) ? (rawDetail as ValidationErrorDetail[]) : undefined;
        return { ok: false, ...failure, detail };
      } finally {
        inFlight.current = false;
        setPausing(false);
      }
    },
    []
  );

  return { pauseJob, pausing };
}

export default usePauseJobByClient;
