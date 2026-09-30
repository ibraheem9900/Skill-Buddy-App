import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobList } from '@/hooks/useJobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import {
  buildBlockerRequest,
  classifyBlockerJobFailure,
  isValidJobId,
  validateBlockerDetails,
} from '@/lib/jobBlocker';
import type { JobActionFailure } from '@/lib/jobAction';
import type { JobResponse, ValidationErrorDetail } from '@/types';

/**
 * Reports a blocker on a job (POST /api/v1/jobs/{job_id}/blocker). Either party may
 * report, so nothing here is role-gated.
 *
 * The same shape as the other detail-body job actions — a protected POST with a REQUIRED
 * body, busy guard, both caches invalidated, the returned job adopted whole — with the
 * contract details this endpoint brings:
 *
 *  1. the body is the JobDetailsRequest `{ details }` (a single free-text string,
 *     3–1000 characters), NOT `reason`/`notes`; it is validated here as well as on the
 *     screen, so a blank explanation can never be posted;
 *  2. the 200 IS the job (no `{ message, job }` envelope and no `message` field), so the
 *     confirmation copy is written by the caller;
 *  3. the details are passed in on EVERY call, so a retry after a network failure
 *     re-sends exactly what the user typed — the caller keeps the form state untouched
 *     for precisely this reason.
 *
 * On success the caller replaces its held job with the returned JobResponse. The
 * contract documents nothing about what changed, so NOTHING is patched or assumed:
 * status, status_history, flags and milestones are all rendered from the response.
 *
 * Double submissions are blocked twice over — `reporting` disables the button and
 * `inFlight` rejects a second call — because filing the same blocker twice is exactly
 * what the backend is likely to reject.
 */
export type BlockerReportOutcome =
  | { ok: true; job: JobResponse }
  | (({ ok: false } & JobActionFailure) & {
        /**
         * The raw 422 `detail[]`, kept so the screen can put a rejected `details`
         * message on the input instead of showing a generic error. Absent for every
         * other failure — the bucket copy is used there.
         */
        detail?: ValidationErrorDetail[];
      })
  /** A report is already running; the caller should not treat this as an error. */
  | { ok: false; kind: 'busy'; message: null };

export function useReportJobBlocker() {
  const [reporting, setReporting] = useState(false);
  const inFlight = useRef(false);

  const reportBlocker = useCallback(
    async (jobId: number, details: string): Promise<BlockerReportOutcome> => {
      if (inFlight.current) return { ok: false, kind: 'busy', message: null };
      if (!isValidJobId(jobId)) return { ok: false, kind: 'badrequest', message: null };
      // Defence in depth: the screen validates first, but a rejected value must never
      // reach the API (it would be a pointless 422).
      if (validateBlockerDetails(details) !== null) {
        return { ok: false, kind: 'invalid', message: null };
      }

      inFlight.current = true;
      setReporting(true);
      try {
        const { data } = await authApi.reportJobBlocker(jobId, buildBlockerRequest(details));
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
        const failure = classifyBlockerJobFailure(err);
        // Keep the 422 detail[] for field-level mapping (e.g. a too-short `details`).
        const rawDetail = (err as { response?: { data?: { detail?: unknown } } } | null | undefined)
          ?.response?.data?.detail;
        const detail = Array.isArray(rawDetail) ? (rawDetail as ValidationErrorDetail[]) : undefined;
        return { ok: false, ...failure, detail };
      } finally {
        inFlight.current = false;
        setReporting(false);
      }
    },
    []
  );

  return { reportBlocker, reporting };
}

export default useReportJobBlocker;
