import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import {
  buildBidRejectRequest,
  isUsableBidResponse,
  isValidBidId,
  isValidJobId,
  validateBidRejectReason,
} from '@/lib/bid';
import { classifyJobActionFailure, type JobActionFailure } from '@/lib/jobAction';
import type { BidResponse, ValidationErrorDetail } from '@/types';

/**
 * The CLIENT's Decline (Reject) Bid
 * (POST /api/v1/jobs/{job_id}/bids/{bid_id}/reject).
 *
 * ── ONE REQUEST, ON PURPOSE ───────────────────────────────────────────────
 * Unlike useAcceptBid this hook does NOT re-read the offers first. Accepting
 * commits the client to a provider and cannot be taken back, so a stale offer
 * there would be a real mistake; declining commits to nothing — the worst a race
 * can produce is the backend refusing (the bid was withdrawn, already decided, or
 * the job moved on), which has its own clear copy and a re-read of the list. The
 * 200 is therefore sent straight through and there is no `changed`/`stale` state
 * to confirm again. The screen may still hold the sheet open on a transport
 * failure (the typed reason is preserved) — see the outcome types below.
 *
 * ── WHAT IS NOT SET LOCALLY ───────────────────────────────────────────────
 * No status and no timestamp is ever written by this hook: it returns the
 * server's own BidResponse (validated with lib/bid.isUsableBidResponse — a
 * malformed payload is reported as a `server` failure rather than adopted, which
 * would otherwise put a status nobody sent on screen). The CALLER then drops that
 * bid locally and re-reads the offers so the server's own ordering and
 * `is_recommended` split decide which bid is recommended next.
 *
 * ── THE JOB CACHES ARE NOT INVALIDATED, AND HERE IS WHY ───────────────────
 * A rejected bid changes no field of the job: neither JobResponse nor JobListItem
 * carries a bid count or a per-bid flag (checked against the schemas), so
 * dropping the job caches would be a false signal AND an extra request per
 * decline. The offers are held by the screen (hooks/useJobBids), and that is what
 * this hook's caller re-reads. Nothing about auth changes here either: the
 * request goes through the shared axios client, which attaches the Bearer token
 * and refreshes once on 401.
 *
 * ── DOUBLE SUBMITS ────────────────────────────────────────────────────────
 * Blocked twice: `rejecting` disables the confirm control and `inFlight` rejects
 * a second call outright, so a double tap cannot decline two offers.
 */

export type RejectBidOutcome =
  | { ok: true; bid: BidResponse }
  /** A decline is already running; the caller must not report a second one. */
  | { ok: false; kind: 'busy'; message: null }
  | (({ ok: false } & JobActionFailure) & {
      /**
       * The raw 422 `detail[]`, kept so the screen can put a rejected reason on
       * the reason input instead of showing a generic error. Absent for every
       * other failure — the bucket copy is used there.
       */
      detail?: ValidationErrorDetail[];
    });

export function useRejectBid() {
  const [rejecting, setRejecting] = useState(false);
  const inFlight = useRef(false);

  const rejectBid = useCallback(
    async (
      jobId: number,
      bidId: number,
      reason: string | null | undefined
    ): Promise<RejectBidOutcome> => {
      if (inFlight.current) return { ok: false, kind: 'busy', message: null };
      if (!isValidJobId(jobId) || !isValidBidId(bidId)) {
        return { ok: false, kind: 'badrequest', message: null };
      }
      // Defence in depth: the sheet validates first, but an over-long reason must
      // never reach the API (the backend answers 422 string_too_long on it).
      if (!validateBidRejectReason(reason).ok) {
        return { ok: false, kind: 'invalid', message: null };
      }

      inFlight.current = true;
      setRejecting(true);
      try {
        const { data } = await authApi.rejectBid(
          jobId,
          bidId,
          buildBidRejectRequest(reason)
        );
        if (!isUsableBidResponse(data)) return { ok: false, kind: 'server', message: null };
        return { ok: true, bid: data };
      } catch (err) {
        const failure = classifyJobActionFailure(err);
        // Keep the 422 detail[] for field-level mapping (a rejected reason).
        const rawDetail = (err as { response?: { data?: { detail?: unknown } } } | null | undefined)
          ?.response?.data?.detail;
        const detail = Array.isArray(rawDetail)
          ? (rawDetail as ValidationErrorDetail[])
          : undefined;
        return { ok: false, ...failure, detail };
      } finally {
        inFlight.current = false;
        setRejecting(false);
      }
    },
    []
  );

  return { rejectBid, rejecting };
}

export default useRejectBid;
