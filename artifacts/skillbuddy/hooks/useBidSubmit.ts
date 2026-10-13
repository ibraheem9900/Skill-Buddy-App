import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import { invalidateJobList } from '@/hooks/useJobList';
import {
  buildBidCreateRequest,
  isUsableBidResponse,
  validateBidMessage,
  validateBidPrice,
  validateEtaMinutes,
} from '@/lib/bid';
import { classifyJobActionFailure, type JobActionFailure } from '@/lib/jobAction';
import { isValidJobId } from '@/lib/jobPublish';
import type { BidResponse, ValidationErrorDetail } from '@/types';

/**
 * The provider's SUBMIT path of the Bids group:
 *
 *   POST /api/v1/jobs/{job_id}/bids  → createBidForJob (BidCreate)
 *
 * The provider's own-bid READ (GET /api/v1/jobs/{job_id}/bids/mine) is NOT here:
 * it belongs to hooks/useMyBid, which owns that answer's three states, its
 * polling and its per-account cache. Keeping one owner is what stops the two
 * from disagreeing about what a 404 means.
 *
 * The call goes through the shared `authApi` axios instance, so the Bearer token
 * and its once-only refresh-and-replay are already handled — a 401 that survives
 * that refresh is reported to the caller rather than retried here.
 *
 * VALIDATION IS REPEATED HERE on purpose. The screen validates for inline
 * errors; the hook re-checks before it will touch the network, so a rejected
 * value can never become a pointless 422 (the same defence in depth
 * usePauseJobByProvider uses).
 */

export type CreateBidOutcome =
  | { ok: true; bid: BidResponse }
  | ({ ok: false } & JobActionFailure & {
        /**
         * The raw 422 `detail[]`, kept so the screen can put a rejected price /
         * eta / message on its own input instead of a generic error.
         */
        detail?: ValidationErrorDetail[];
      })
  /** A submit is already running; the caller must not treat this as an error. */
  | { ok: false; kind: 'busy'; message: null };

export function useBidSubmit() {
  const [bidSubmitting, setBidSubmitting] = useState(false);
  const inFlight = useRef(false);

  const createBidForJob = useCallback(
    async (
      jobId: number,
      priceInput: string,
      etaInput: string,
      messageInput: string,
      /**
       * Optional client-side ceiling for offered_price. The live schema sets NO
       * maximum (only `exclusiveMinimum: 0`), so the only bound the app applies
       * is a sanity guard inside validateBidPrice; this stays overridable for the
       * same reason the validator allows it.
       */
      options: { maxPrice?: number } = {}
    ): Promise<CreateBidOutcome> => {
      if (inFlight.current) return { ok: false, kind: 'busy', message: null };
      if (!isValidJobId(jobId)) return { ok: false, kind: 'badrequest', message: null };

      // Re-validated here so a rejected value can never reach the network.
      const price = validateBidPrice(priceInput, options);
      if (!price.ok) return { ok: false, kind: 'invalid', message: null };
      const eta = validateEtaMinutes(etaInput);
      if (!eta.ok) return { ok: false, kind: 'invalid', message: null };
      const message = validateBidMessage(messageInput);
      if (!message.ok) return { ok: false, kind: 'invalid', message: null };

      inFlight.current = true;
      setBidSubmitting(true);
      try {
        const { data } = await authApi.createBid(
          jobId,
          buildBidCreateRequest(price.value, eta.value, message.value)
        );
        // The job's own flags change once a bid exists, and the list rows show
        // bid counts, so both caches are dropped rather than patched.
        invalidateJobList();
        invalidateJobDetail(jobId);
        // A malformed 201 must never be adopted: the screen would show a
        // fabricated status. 201 is the ONLY documented success shape.
        if (!isUsableBidResponse(data)) return { ok: false, kind: 'server', message: null };
        return { ok: true, bid: data };
      } catch (err) {
        const failure = classifyJobActionFailure(err);
        const rawDetail = (err as { response?: { data?: { detail?: unknown } } } | null | undefined)
          ?.response?.data?.detail;
        const detail = Array.isArray(rawDetail)
          ? (rawDetail as ValidationErrorDetail[])
          : undefined;
        return { ok: false, ...failure, detail };
      } finally {
        inFlight.current = false;
        setBidSubmitting(false);
      }
    },
    []
  );

  return { createBidForJob, bidSubmitting };
}

export default useBidSubmit;
