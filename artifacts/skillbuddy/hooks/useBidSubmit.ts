import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import { invalidateJobList } from '@/hooks/useJobList';
import {
  buildBidCreateRequest,
  validateBidMessage,
  validateBidPrice,
  validateEtaMinutes,
} from '@/lib/bid';
import {
  classifyJobActionFailure,
  type JobActionFailure,
  type JobActionFailureKind,
} from '@/lib/jobAction';
import { isValidJobId } from '@/lib/jobPublish';
import type { BidResponse, ValidationErrorDetail } from '@/types';

/**
 * The provider's side of the Bids group:
 *
 *   GET  /api/v1/jobs/{job_id}/bids/mine  → loadMyBid   (have I bid already?)
 *   POST /api/v1/jobs/{job_id}/bids       → createBidForJob (BidCreate)
 *
 * Both go through the shared `authApi` axios instance, so the Bearer token and
 * its once-only refresh-and-replay are already handled — a 401 that survives
 * that refresh is reported to the caller rather than retried here.
 *
 * VALIDATION IS REPEATED HERE on purpose. The screen validates for inline
 * errors; the hook re-checks before it will touch the network, so a rejected
 * value can never become a pointless 422 (the same defence in depth
 * usePauseJobByProvider uses).
 *
 * ── THE "NO BID" ANSWER OF /bids/mine IS NOT DOCUMENTED ────────────────────
 * The live OpenAPI declares ONLY `200 → BidResponse` (plus 422) for that
 * operation. What it returns when this provider has no bid on the job is
 * nowhere in the schema. This hook therefore treats a request that fails with a
 * 4xx as "no bid yet" — the optimistic reading, which shows the form — but
 * treats a missing/unusable 200 body as "no bid" too, and NEVER treats a
 * transport or 5xx failure that way: there the app cannot know whether a bid
 * exists, so it reports an error and offers a retry instead of letting a
 * provider submit a duplicate. The 4xx reading is UNVERIFIED and flagged in the
 * report; if the backend actually uses 404 for "no bid", this already matches.
 */

/** What /bids/mine told us — three states, because "unknown" is not "none". */
export type MyBidState =
  | { state: 'exists'; bid: BidResponse }
  | { state: 'none' }
  /** Could not be determined (offline / 5xx / 401). NOT the same as "no bid". */
  | { state: 'error'; kind: JobActionFailureKind };

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

/** A bid is only usable if it is the object the schema promises. */
function isUsableBid(data: unknown): data is BidResponse {
  if (!data || typeof data !== 'object') return false;
  const bid = data as Partial<BidResponse>;
  return typeof bid.id === 'number' && typeof bid.status === 'string';
}

export function useBidSubmit() {
  const [bidSubmitting, setBidSubmitting] = useState(false);
  const inFlight = useRef(false);

  const loadMyBid = useCallback(async (jobId: number): Promise<MyBidState> => {
    if (!isValidJobId(jobId)) return { state: 'error', kind: 'badrequest' };
    try {
      const { data } = await authApi.getMyBid(jobId);
      // A 200 with an empty/null body is a real possibility the schema does not
      // cover, and it means the same thing as "no bid" to the UI.
      return isUsableBid(data) ? { state: 'exists', bid: data } : { state: 'none' };
    } catch (err) {
      const failure = classifyJobActionFailure(err);
      // Anything but a transport/5xx/auth failure is read as "no bid yet" — see
      // the UNVERIFIED note above.
      if (
        failure.kind === 'network' ||
        failure.kind === 'server' ||
        failure.kind === 'unknown' ||
        failure.kind === 'unauthorized'
      ) {
        return { state: 'error', kind: failure.kind };
      }
      return { state: 'none' };
    }
  }, []);

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
        if (!isUsableBid(data)) return { ok: false, kind: 'server', message: null };
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

  return { createBidForJob, bidSubmitting, loadMyBid };
}

export default useBidSubmit;
