import {
  classifyJobActionFailure,
  isJobActionRefused,
  isJobActionUnauthorized,
  type JobActionFailureKind,
} from '@/lib/jobAction';
import { isJobCancelled, isJobCompleted } from '@/lib/jobDetail';
import { isValidJobId } from '@/lib/jobPublish';
import type { JobResponse } from '@/types';

/**
 * POST /api/v1/jobs/{job_id}/confirm-payment — pure rules, no React, no network.
 *
 * WHAT THE LIVE OPENAPI ACTUALLY SAYS (read from openapi.json, not inferred from
 * the Swagger UI):
 *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
 *   - exactly ONE parameter: the required integer path `job_id`
 *   - **NO `requestBody` key at all** — no body is sent, and NO amount or payment
 *     method is accepted, so none is ever invented client-side
 *   - its ONLY documented responses are 200 (**the JobResponse DIRECTLY** — there is
 *     no `{ message, job }` envelope here) and 422 (HTTPValidationError)
 *   - VERIFIED LIVE (no token): POST → 401 {"detail":"Not authenticated"}; GET/PUT on
 *     the same path → 405, so POST is the registered method
 *
 * THE PAYABLE STATE IS THE BACKEND'S STATUS, NOT A GUESS. JobStatus is a 14-value
 * enum and exactly one of its values names payment: `PAYMENT_PENDING`. So the action
 * is offered only for a job whose status IS PAYMENT_PENDING and which is not
 * cancelled/completed. Nothing else is inferred — in particular the app does NOT
 * assume what the status becomes after confirmation, nor whether bidding reopens:
 * the 200 response is read and the UI follows it.
 *
 * WHERE THE MONEY MOVES IS NOT THIS ENDPOINT (confirmed from the spec, reported not
 * guessed): the payment mechanism is a separate set of endpoints —
 * GET /jobs/{job_id}/payment-options, GET /jobs/{job_id}/payments,
 * POST /jobs/{job_id}/installments/pay, GET /jobs/{job_id}/invoice — none of which
 * is connected in this app. This module therefore gates the call on the job's state
 * and on an explicit client confirmation, and never on an invented "amount paid"
 * flag. If a real gateway is connected later, this call must fire only AFTER the
 * gateway reports success.
 *
 * THE 200 BODY IS THE COMPLETE JOB (the same JobResponse GET /jobs/{job_id} returns,
 * with its `address` embedded — no extra address call), so callers replace their
 * cached job with it: status, is_bidding_open, is_editable, is_cancellable, the
 * can_* flags and the bidding window (bidding_started_at / bidding_ends_at /
 * remaining_bidding_seconds) all come from the response. A countdown shown anywhere
 * is re-initialised from the new remaining_bidding_seconds.
 */

/** Re-export so callers have one import for the whole action. */
export { isValidJobId };

/**
 * Whether the job is waiting for the client's payment. This is the ONLY payable
 * state — the backend's own status, never a client-derived guess.
 */
export function isPaymentPending(
  job: Pick<JobResponse, 'status'> | null | undefined
): boolean {
  return job?.status === 'PAYMENT_PENDING';
}

/**
 * Whether the "Confirm Payment" action may be OFFERED.
 *
 * Derived from the backend's status (there is no can_confirm_payment flag on
 * JobResponse) and deliberately conservative: the job must be PAYMENT_PENDING right
 * now, and must not be cancelled or completed. An already-confirmed job has moved on
 * to another status, so the action disappears by itself rather than being disabled by
 * a separate rule.
 */
export function canConfirmPayment(
  job: Pick<JobResponse, 'status' | 'cancelled_at' | 'completed_at'> | null | undefined
): boolean {
  if (!job) return false;
  if (!isPaymentPending(job)) return false;
  if (isJobCancelled(job)) return false;
  if (isJobCompleted(job)) return false;
  return true;
}

/**
 * True for the buckets that mean "the server refused because the job is no longer
 * payable" (already confirmed, cancelled, or past the window). These get their own
 * copy instead of a generic error.
 */
export function isPaymentNotAllowed(kind: JobActionFailureKind): boolean {
  return kind === 'badrequest' || kind === 'conflict';
}

/**
 * Whether the screen should re-read the job after a failure.
 *
 * A refusal means the status this screen gated on is stale — that is WHY the backend
 * said no (most likely the payment was already confirmed) — so the cached job is
 * re-synced. A 422 stays out on purpose (the path id itself was rejected, so
 * re-reading it changes nothing) and so do 5xx failures.
 *
 * NETWORK failures are handled separately by the caller: see paymentResolvedAfterResync.
 */
export function shouldResyncAfterPaymentFailure(kind: JobActionFailureKind): boolean {
  return isPaymentNotAllowed(kind) || isJobActionRefused(kind);
}

/**
 * Whether a network failure was in fact already carried out by the server.
 *
 * A request that never produced a response may still have been processed (the reply
 * was lost on the way back). Since this action involves money, a blind retry is the
 * wrong move: the caller re-reads the job first and, if it is no longer
 * PAYMENT_PENDING, treats the payment as already confirmed instead of offering
 * "Retry" — so a second confirmation cannot be fired on a payment that already went
 * through. `refetched` is null when the re-read itself failed, in which case nothing
 * is claimed and the normal network error + retry path applies.
 */
export function paymentResolvedAfterResync(
  refetched: Pick<JobResponse, 'status'> | null | undefined
): boolean {
  if (!refetched) return false;
  return !isPaymentPending(refetched);
}

/** A 401 that survived the shared client's refresh + single replay → login. */
export { isJobActionUnauthorized as isPaymentUnauthorized };

export type ConfirmPaymentErrorKey =
  | 'jobd_pay_err_invalid'
  | 'jobd_pay_err_notallowed'
  | 'jobd_pay_err_forbidden'
  | 'jobd_pay_err_notfound'
  | 'jobd_pay_err_server'
  | 'jobd_pay_err_network';

/**
 * Translated copy per bucket. 400 and 409 share the "no longer payable" copy;
 * `unauthorized` is absent because it never reaches the UI (the caller sends the
 * client to login, the same rule the other job actions use).
 */
export function confirmPaymentErrorKey(kind: JobActionFailureKind): ConfirmPaymentErrorKey {
  switch (kind) {
    case 'invalid':
      return 'jobd_pay_err_invalid';
    case 'badrequest':
    case 'conflict':
      return 'jobd_pay_err_notallowed';
    case 'forbidden':
      return 'jobd_pay_err_forbidden';
    case 'notfound':
      return 'jobd_pay_err_notfound';
    case 'network':
      return 'jobd_pay_err_network';
    default:
      return 'jobd_pay_err_server';
  }
}

/**
 * The body copy for a failure: the backend's own message when it sent one, otherwise
 * the translated copy for the bucket — so a specific reason (e.g. "payment already
 * confirmed") reaches the client as the server worded it.
 */
export function confirmPaymentFailureMessage(
  failure: { kind: JobActionFailureKind; message: string | null },
  translate: (key: ConfirmPaymentErrorKey) => string
): string {
  return failure.message ?? translate(confirmPaymentErrorKey(failure.kind));
}

/** Bucket a rejected payment confirmation (delegates to the shared core). */
export { classifyJobActionFailure as classifyConfirmPaymentFailure };
