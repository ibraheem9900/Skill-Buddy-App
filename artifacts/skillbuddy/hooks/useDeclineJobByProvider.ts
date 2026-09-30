import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobList } from '@/hooks/useJobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import {
  buildDeclineRequest,
  classifyDeclineJobFailure,
  isValidJobId,
  validateDeclineDetails,
} from '@/lib/providerDecline';
import type { JobActionFailure } from '@/lib/jobAction';
import type { JobResponse, ValidationErrorDetail } from '@/types';

/**
 * Declines a job as its assigned provider
 * (POST /api/v1/jobs/{job_id}/decline-by-provider).
 *
 * The same shape as useCancelJob — a protected POST with a REQUIRED body, busy guard,
 * both caches invalidated, the returned job adopted whole — with the contract details
 * this endpoint brings:
 *
 *  1. the body is the JobDetailsRequest `{ details }` (a single free-text string,
 *     3–1000 characters), NOT `reason`/`notes`; it is validated here as well as on the
 *     screen, so a blank explanation can never be posted;
 *  2. the 200 IS the job (no `{ message, job }` envelope and no `message` field), so
 *     the success toast is written by the caller;
 *  3. the details are passed in on EVERY call, so a retry after a network failure
 *     re-sends exactly what the provider typed — the caller keeps the form state
 *     untouched for precisely this reason.
 *
 * On success the caller replaces its held job with the returned JobResponse: status,
 * assigned_provider_id, is_bidding_open, the can_* flags and cancellation_fee_charged
 * all come from the backend. Nothing is set locally — in particular the app never
 * decides whether the job reopens for bidding or whether a fee applies.
 *
 * Double submissions are blocked twice over — `declining` disables the button and
 * `inFlight` rejects a second call — because a second decline is exactly what the
 * backend is likely to reject.
 */
export type DeclineJobOutcome =
  | { ok: true; job: JobResponse }
  | (({ ok: false } & JobActionFailure) & {
        /**
         * The raw 422 `detail[]`, kept so the screen can put a rejected `details`
         * message on the input instead of showing a generic error. Absent for every
         * other failure — the bucket copy is used there.
         */
        detail?: ValidationErrorDetail[];
      })
  /** A decline is already running; the caller should not treat this as an error. */
  | { ok: false; kind: 'busy'; message: null };

export function useDeclineJobByProvider() {
  const [declining, setDeclining] = useState(false);
  const inFlight = useRef(false);

  const declineJob = useCallback(
    async (jobId: number, details: string): Promise<DeclineJobOutcome> => {
      if (inFlight.current) return { ok: false, kind: 'busy', message: null };
      if (!isValidJobId(jobId)) return { ok: false, kind: 'badrequest', message: null };
      // Defence in depth: the screen validates first, but a rejected value must never
      // reach the API (it would be a pointless 422).
      if (validateDeclineDetails(details) !== null) {
        return { ok: false, kind: 'invalid', message: null };
      }

      inFlight.current = true;
      setDeclining(true);
      try {
        const { data } = await authApi.declineJobByProvider(jobId, buildDeclineRequest(details));
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
        const failure = classifyDeclineJobFailure(err);
        // Keep the 422 detail[] for field-level mapping (e.g. a too-short `details`).
        const rawDetail = (err as { response?: { data?: { detail?: unknown } } } | null | undefined)
          ?.response?.data?.detail;
        const detail = Array.isArray(rawDetail) ? (rawDetail as ValidationErrorDetail[]) : undefined;
        return { ok: false, ...failure, detail };
      } finally {
        inFlight.current = false;
        setDeclining(false);
      }
    },
    []
  );

  return { declineJob, declining };
}

export default useDeclineJobByProvider;
