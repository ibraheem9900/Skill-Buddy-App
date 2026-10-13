import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobList } from '@/hooks/useJobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import {
  acceptResolvedAfterResync,
  bidById,
  bidSelectionMatches,
  isUsableBidResponse,
  isValidBidId,
  isValidJobId,
} from '@/lib/bid';
import { classifyJobActionFailure, type JobActionFailureKind } from '@/lib/jobAction';
import type { BidResponse } from '@/types';

/**
 * The CLIENT's Accept Bid (POST /api/v1/jobs/{job_id}/bids/{bid_id}/accept).
 *
 * ── TWO REQUESTS, IN THIS ORDER, ON PURPOSE ────────────────────────────────
 * The accept is IRREVERSIBLE without the cancellation module (a separate task),
 * and a provider may edit or withdraw their offer at any moment — including
 * while the client reads the confirmation dialog. So this hook never posts
 * straight away:
 *
 *   1. GET /api/v1/jobs/{job_id}/bids   — re-read the offers
 *   2. compare the offer with the one on screen (price, expected time,
 *      `updated_at`, id) via lib/bid.bidSelectionMatches
 *   3. POST …/accept                     — only when it is still the same offer
 *
 * If the re-read shows a DIFFERENT offer the hook returns `changed` and nothing
 * is sent, so the screen re-renders the dialog and asks again. If the bid is
 * gone or is no longer PENDING it returns `stale`, also without sending. A
 * failed re-read returns the classifier's own bucket: the app does not accept
 * what it could not verify.
 *
 * ── A LOST REPLY IS NOT A FAILURE ──────────────────────────────────────────
 * On a transport failure (offline, timeout, connection dropped) the outcome is
 * honestly `network` — but the pick may still have been processed, so the JOB is
 * re-read before the screen offers anything. `resolved` carries that answer:
 *   true   the job is no longer open for a pick — the accept went through
 *   false  the job is still OPEN — a retry is safe
 *   null   the re-read itself failed, so nothing is claimed either way
 * The job is re-read through the same shared client, so nothing about auth
 * changes here.
 *
 * ── WHAT IS NOT SET LOCALLY ────────────────────────────────────────────────
 * No status, no `assigned_provider_id` and no "paid" flag is ever written by
 * this hook: it returns the server's own BidResponse and invalidates the job
 * list and job detail caches, so the screens re-read the authoritative state.
 * The 200 is validated with lib/bid.isUsableBidResponse — a malformed payload is
 * reported as a `server` failure rather than adopted (the card would otherwise
 * show a status nobody sent).
 *
 * Double submissions are blocked twice: `accepting` disables the button and
 * `inFlight` rejects a second call outright, because a double tap here would be
 * a second irreversible decision.
 */

export interface AcceptBidFailure {
  kind: JobActionFailureKind;
  /** The backend's own readable text when it sent one, else null. */
  message: string | null;
  /**
   * Transport failures only: did the job re-read show the pick already went
   * through? `undefined` for every other bucket, `null` when the re-read failed.
   */
  resolved?: boolean | null;
}

export type AcceptBidOutcome =
  | { ok: true; bid: BidResponse }
  /** A confirm is already running; the caller must not report a second one. */
  | { ok: false; kind: 'busy'; message: null }
  /** The re-read showed a DIFFERENT offer: the dialog must be re-confirmed. */
  | { ok: false; kind: 'changed'; message: null; bid: BidResponse }
  /** The re-read showed the bid is gone or no longer PENDING: nothing was sent. */
  | { ok: false; kind: 'stale'; message: null }
  | ({ ok: false } & AcceptBidFailure);

export function useAcceptBid() {
  const [accepting, setAccepting] = useState(false);
  const inFlight = useRef(false);

  const acceptBid = useCallback(
    async (
      jobId: number,
      bidId: number,
      shown: Pick<BidResponse, 'id' | 'offered_price' | 'eta_minutes' | 'updated_at'>
    ): Promise<AcceptBidOutcome> => {
      if (inFlight.current) return { ok: false, kind: 'busy', message: null };
      if (!isValidJobId(jobId) || !isValidBidId(bidId)) {
        return { ok: false, kind: 'badrequest', message: null };
      }

      inFlight.current = true;
      setAccepting(true);
      try {
        // ── 1. The safeguard: re-read the offer before committing to it ────
        let fresh: BidResponse | null = null;
        try {
          const { data } = await authApi.listJobBids(jobId);
          fresh = bidById(data, bidId);
        } catch (err) {
          // The offer could not be checked, so nothing is sent. The caller shows
          // this with the shared classifier's own words.
          return { ok: false, ...classifyJobActionFailure(err) };
        }
        if (!fresh || fresh.status !== 'PENDING') {
          return { ok: false, kind: 'stale', message: null };
        }
        if (!bidSelectionMatches(shown, fresh)) {
          return { ok: false, kind: 'changed', message: null, bid: fresh };
        }

        // ── 2. The accept itself: no body (the contract has no requestBody) ─
        const { data } = await authApi.acceptBid(jobId, bidId);
        if (!isUsableBidResponse(data)) return { ok: false, kind: 'server', message: null };
        invalidateJobList();
        invalidateJobDetail(jobId);
        return { ok: true, bid: data };
      } catch (err) {
        const failure = classifyJobActionFailure(err);
        if (failure.kind !== 'network') return { ok: false, ...failure };
        // The reply was lost. An irreversible action must not be retried
        // blindly, so the job is re-read first and the caller is told what it
        // found.
        let resolved: boolean | null = null;
        try {
          const { data } = await authApi.getJob(jobId);
          resolved = acceptResolvedAfterResync(data);
        } catch {
          resolved = null;
        }
        return { ok: false, ...failure, resolved };
      } finally {
        inFlight.current = false;
        setAccepting(false);
      }
    },
    []
  );

  return { acceptBid, accepting };
}

export default useAcceptBid;
