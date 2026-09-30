import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobList } from '@/hooks/useJobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import { classifyProviderCancelJobFailure, isValidJobId } from '@/lib/providerCancel';
import type { JobActionFailure } from '@/lib/jobAction';
import type { JobResponse } from '@/types';

/**
 * Withdraws the provider from a job they were assigned
 * (POST /api/v1/jobs/{job_id}/provider-cancel, Swagger "Provider Cancel After
 * Acceptance").
 *
 * The same shape as useRestartJobTimer / useConvertJobToRegular — a protected,
 * BODY-LESS POST returning the WRAPPED `{ message, job }` — with two contract
 * details specific to this endpoint:
 *
 *  1. it takes NO body (unlike the client's /cancel, which sends reason + notes), so
 *     nothing is serialised here;
 *  2. the 200 is the envelope, so the JOB is read from `data.job` (NOT the top level)
 *     and `data.message` is handed back for the toast.
 *
 * On success the caller replaces its held job with `data.job`: status,
 * assigned_provider_id, is_bidding_open, the can_* flags, cancelled_at and
 * cancellation_fee_charged all come from the backend. Nothing is patched locally —
 * in particular the app never decides whether the job reopens for bidding or whether
 * a fee applies; the screen renders whatever the response carries.
 *
 * Both caches are invalidated on success so a mounted list (the provider's own jobs)
 * refetches instead of still showing the withdrawn job, and a cached detail cannot
 * outlive the cancellation.
 *
 * Double taps: `providerCancelling` disables the button, and `inFlight` rejects a
 * second call outright.
 */
export type ProviderCancelOutcome =
  | { ok: true; job: JobResponse; message: string | null }
  | ({ ok: false } & JobActionFailure)
  /** A cancellation is already running; the caller should not treat this as an error. */
  | { ok: false; kind: 'busy'; message: null };

export function useProviderCancelJob() {
  const [providerCancelling, setProviderCancelling] = useState(false);
  const inFlight = useRef(false);

  const providerCancelJob = useCallback(async (jobId: number): Promise<ProviderCancelOutcome> => {
    if (inFlight.current) return { ok: false, kind: 'busy', message: null };
    if (!isValidJobId(jobId)) return { ok: false, kind: 'badrequest', message: null };

    inFlight.current = true;
    setProviderCancelling(true);
    try {
      const { data } = await authApi.providerCancelJob(jobId);
      invalidateJobList();
      invalidateJobDetail(jobId);
      // `job` is required by the schema, but a malformed payload must never put a
      // bogus object into the screen's state — treat it as a retryable failure
      // instead of adopting `undefined` and wiping the screen.
      if (!data || typeof data !== 'object' || !data.job || typeof data.job.id !== 'number') {
        return { ok: false, kind: 'server', message: null };
      }
      return {
        ok: true,
        job: data.job,
        message:
          typeof data.message === 'string' && data.message.trim().length > 0
            ? data.message.trim()
            : null,
      };
    } catch (err) {
      return { ok: false, ...classifyProviderCancelJobFailure(err) };
    } finally {
      inFlight.current = false;
      setProviderCancelling(false);
    }
  }, []);

  return { providerCancelJob, providerCancelling };
}

export default useProviderCancelJob;
