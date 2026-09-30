import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobList } from '@/hooks/useJobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import { classifyConfirmPaymentFailure, isValidJobId } from '@/lib/jobPayment';
import type { JobActionFailure } from '@/lib/jobAction';
import type { JobResponse } from '@/types';

/**
 * Confirms the client's payment for a job
 * (POST /api/v1/jobs/{job_id}/confirm-payment).
 *
 * The same shape as useAssignProvider — protected POST, busy guard, both caches
 * invalidated, the returned job adopted whole and NOT wrapped in `{ message, job }` —
 * with one deliberate difference: this endpoint takes NO body at all, so nothing is
 * sent. No amount and no payment method is invented here; the docs accept neither.
 *
 * On success the caller replaces its held job with the returned JobResponse: status,
 * is_bidding_open, is_editable, the can_* flags and the bidding window all come from
 * the backend, and nothing (not even a "paid" flag) is set locally. Which status
 * follows PAYMENT_PENDING is read from the response, never assumed.
 *
 * Double submissions are blocked twice over — `confirming` disables the button and
 * `inFlight` rejects a second call — because this action involves money.
 */
export type ConfirmPaymentOutcome =
  | { ok: true; job: JobResponse }
  | ({ ok: false } & JobActionFailure)
  /** A confirmation is already running; the caller should not treat this as an error. */
  | { ok: false; kind: 'busy'; message: null };

export function useConfirmPayment() {
  const [confirming, setConfirming] = useState(false);
  const inFlight = useRef(false);

  const confirmPayment = useCallback(async (jobId: number): Promise<ConfirmPaymentOutcome> => {
    if (inFlight.current) return { ok: false, kind: 'busy', message: null };
    if (!isValidJobId(jobId)) return { ok: false, kind: 'badrequest', message: null };

    inFlight.current = true;
    setConfirming(true);
    try {
      const { data } = await authApi.confirmJobPayment(jobId);
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
      return { ok: false, ...classifyConfirmPaymentFailure(err) };
    } finally {
      inFlight.current = false;
      setConfirming(false);
    }
  }, []);

  return { confirmPayment, confirming };
}

export default useConfirmPayment;
