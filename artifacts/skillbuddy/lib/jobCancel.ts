import {
  classifyJobActionFailure,
  isJobActionRefused,
  isJobActionUnauthorized,
  type JobActionFailureKind,
} from '@/lib/jobAction';
import { isJobCancelled, isJobCompleted } from '@/lib/jobDetail';
import { isValidJobId } from '@/lib/jobPublish';
import { isProviderRole, type JobActorRole } from '@/lib/jobStart';
import type { JobCancelRequest, JobResponse, ValidationErrorDetail } from '@/types';

/**
 * POST /api/v1/jobs/{job_id}/cancel — pure rules, no React, no network.
 *
 * WHAT THE LIVE OPENAPI ACTUALLY SAYS (read from openapi.json, not inferred from the
 * Swagger UI):
 *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
 *   - exactly ONE parameter: the required integer path `job_id`
 *   - a **REQUIRED `application/json` request body**, schema JobCancelRequest:
 *       `reason`  — REQUIRED, `type: string`, `minLength: 3`, `maxLength: 255`,
 *                   and **NO enum**;
 *       `notes`   — optional, `anyOf: [string, null]`.
 *   - its ONLY documented responses are 200 (**the JobResponse DIRECTLY** — there is
 *     no `{ message, job }` envelope here) and 422 (HTTPValidationError)
 *   - VERIFIED LIVE (no token): POST → 401 {"detail":"Not authenticated"}; GET/PUT on
 *     the same path → 405, so POST is the registered method
 *   - the operation carries NO description, and 0 of the 35 JobResponse properties
 *     carry one — so the rules below are taken from the schema itself, never invented.
 *
 * THE REASON IS FREE TEXT — CONFIRMED BY THE CONTRACT, NOT ASSUMED. The task allows
 * either "the agreed list from the team" or free text; `JobCancelRequest.reason`
 * declares no enum, only a length range, so the backend accepts arbitrary text and
 * FREE TEXT is the only option that invents nothing. (The mock cancel screen
 * `app/job/[id]/track.tsx` shows preset reason chips — that is app copy, not a backend
 * constraint; chips could later pre-fill this same field without any API change.)
 * The 3-character minimum is enforced client-side BEFORE the request so a blank or
 * whitespace-only reason can never be submitted — the server would 422 on it anyway.
 *
 * WHICH ROLE SEES IT — both, per the app's own designed flow: track.tsx offers its
 * cancel action from a shared status list with NO role guard, only the confirmation
 * copy differs by role (the provider sees a plain warning, the client sees the fee
 * notice). The API agrees: `/cancel` takes a reason, while the provider's separate path
 * is `POST /jobs/{job_id}/provider-cancel` ("Provider Cancel After Acceptance",
 * body-less) — a different endpoint that is NOT this task. So the gate here is the
 * backend's own `is_cancellable` flag, and the backend authorises the real party
 * (403 gets its own copy and a re-sync).
 *
 * THE FEE IS NEVER SHOWN FROM HERE. The client only learns whether a fee applies from
 * the 200 response's `cancellation_fee_charged`; Job Details renders it from that
 * value, and this screen never states an amount beforehand.
 */

/** Re-export so callers have one import for the whole action. */
export { isValidJobId };

/** Mirrors `JobCancelRequest.reason`: `minLength: 3`. */
export const CANCEL_REASON_MIN_LENGTH = 3;
/** Mirrors `JobCancelRequest.reason`: `maxLength: 255`. */
export const CANCEL_REASON_MAX_LENGTH = 255;

export type CancelReasonErrorKey =
  | 'jobd_cancel_err_reason_required'
  | 'jobd_cancel_err_reason_short'
  | 'jobd_cancel_err_reason_long';

/**
 * Validate the typed reason against the contract's own 3–255 rule.
 * Returns `null` when the reason is acceptable, otherwise the copy key to show.
 */
export function validateCancelReason(reason: string | null | undefined): CancelReasonErrorKey | null {
  const length = (reason ?? '').trim().length;
  if (length === 0) return 'jobd_cancel_err_reason_required';
  if (length < CANCEL_REASON_MIN_LENGTH) return 'jobd_cancel_err_reason_short';
  if (length > CANCEL_REASON_MAX_LENGTH) return 'jobd_cancel_err_reason_long';
  return null;
}

/**
 * Build the REQUIRED body. `reason` is trimmed (so padding cannot sneak past the
 * minimum), and blank `notes` become `null` — the schema's own nullable shape — rather
 * than an empty string.
 *
 * Only called once `validateCancelReason` has passed, so a rejected reason can never be
 * sent.
 */
export function buildCancelRequest(reason: string, notes?: string | null): JobCancelRequest {
  const trimmedNotes = (notes ?? '').trim();
  return {
    reason: reason.trim(),
    notes: trimmedNotes.length > 0 ? trimmedNotes : null,
  };
}

/**
 * Whether the "Cancel Job" action may be OFFERED.
 *
 * The gate is the backend's own `is_cancellable === true` (the task's rule; there is no
 * `can_cancel_job` flag), plus two guards that make a stale flag harmless: a job that is
 * already cancelled or already completed is never offered cancellation again. Nothing
 * about cancellability is recomputed from status or dates.
 */
export function canCancelJob(
  job: Pick<JobResponse, 'is_cancellable' | 'cancelled_at' | 'completed_at'> | null | undefined
): boolean {
  if (!job) return false;
  if (job.is_cancellable !== true) return false;
  if (isJobCancelled(job)) return false;
  if (isJobCompleted(job)) return false;
  return true;
}

/**
 * Whether the Job Details screen should offer the CLIENT's "Cancel Job" row (the
 * `/job/{id}/cancel` form, POST /api/v1/jobs/{job_id}/cancel).
 *
 * This is the client's route only: a provider withdrawing from a job they were
 * assigned goes through the separate POST /api/v1/jobs/{job_id}/provider-cancel (see
 * lib/providerCancel), so a provider must never see this row even when
 * `is_cancellable` is true. Role is the app's active role; anything that is not the
 * provider role keeps the existing flag-driven behaviour unchanged.
 */
export function canClientCancelJob(
  job: Pick<JobResponse, 'is_cancellable' | 'cancelled_at' | 'completed_at'> | null | undefined,
  role: JobActorRole | null | undefined
): boolean {
  if (isProviderRole(role)) return false;
  return canCancelJob(job);
}

/**
 * True for the buckets that mean "the server refused because the job can no longer be
 * cancelled" (already cancelled, completed, or not cancellable) — these get their own
 * copy instead of a generic error.
 */
export function isCancelNotAllowed(kind: JobActionFailureKind): boolean {
  return kind === 'badrequest' || kind === 'conflict';
}

/**
 * Whether the screen should re-read the job after a failure.
 *
 * A refusal means the `is_cancellable` flag this screen gated on is stale — that is WHY
 * the backend said no — so the cached job is re-synced. A 422 stays out on purpose: it
 * normally means the TYPED reason was rejected (too short or too long), which
 * re-reading the job cannot fix. Network/5xx failures are not stale-data signals either.
 *
 * NETWORK failures are handled separately by the caller: see cancelResolvedAfterResync.
 */
export function shouldResyncAfterCancelFailure(kind: JobActionFailureKind): boolean {
  return isCancelNotAllowed(kind) || isJobActionRefused(kind);
}

/**
 * Whether a network failure was in fact already carried out by the server.
 *
 * A request that never produced a response may still have been processed (the reply was
 * lost on the way back). The caller re-reads the job first and, when it is already
 * CANCELLED, reports that instead of offering "Retry" — so a user is never asked to
 * cancel a job that was already cancelled. `refetched` is null when the re-read itself
 * failed, in which case nothing is claimed and the normal network error + retry path
 * applies (the typed reason and notes are preserved either way).
 */
export function cancelResolvedAfterResync(
  refetched: Pick<JobResponse, 'cancelled_at' | 'status'> | null | undefined
): boolean {
  if (!refetched) return false;
  return isJobCancelled(refetched);
}

/** A 401 that survived the shared client's refresh + single replay → login. */
export { isJobActionUnauthorized as isCancelUnauthorized };

export type CancelJobErrorKey =
  | 'jobd_cancel_err_invalid'
  | 'jobd_cancel_err_notallowed'
  | 'jobd_cancel_err_forbidden'
  | 'jobd_cancel_err_notfound'
  | 'jobd_cancel_err_server'
  | 'jobd_cancel_err_network';

/**
 * Translated copy per bucket. 400 and 409 share the "can no longer be cancelled" copy;
 * `unauthorized` is absent because it never reaches the UI (the caller sends the user
 * to login, the same rule the other job actions use).
 */
export function cancelJobErrorKey(kind: JobActionFailureKind): CancelJobErrorKey {
  switch (kind) {
    case 'invalid':
      return 'jobd_cancel_err_invalid';
    case 'badrequest':
    case 'conflict':
      return 'jobd_cancel_err_notallowed';
    case 'forbidden':
      return 'jobd_cancel_err_forbidden';
    case 'notfound':
      return 'jobd_cancel_err_notfound';
    case 'network':
      return 'jobd_cancel_err_network';
    default:
      return 'jobd_cancel_err_server';
  }
}

/**
 * The body copy for a failure: the backend's own message when it sent one (a 422
 * `detail[].msg` such as the reason rule, or a plain-string `detail`), otherwise the
 * translated copy for the bucket — so the server's exact reason for refusing reaches
 * the user as worded.
 */
export function cancelJobFailureMessage(
  failure: { kind: JobActionFailureKind; message: string | null },
  translate: (key: CancelJobErrorKey) => string
): string {
  return failure.message ?? translate(cancelJobErrorKey(failure.kind));
}

/**
 * Pull the server's message for the `reason` field out of a 422 `detail[]`, so a rejected
 * reason is shown ON the reason input instead of as a generic failure.
 *
 * FastAPI reports a body field as `loc: ["body", "reason"]`. Returns null when the
 * response had no detail array or said nothing about `reason` (the caller then falls
 * back to the bucket copy), so a malformed 422 degrades gracefully.
 */
export function cancelReasonFieldError(
  detail: ValidationErrorDetail[] | null | undefined
): string | null {
  if (!Array.isArray(detail)) return null;
  for (const entry of detail) {
    if (!entry || !Array.isArray(entry.loc)) continue;
    if (entry.loc.some((part) => part === 'reason') && entry.msg) return entry.msg;
  }
  return null;
}

/** Bucket a rejected cancellation (delegates to the shared core). */
export { classifyJobActionFailure as classifyCancelJobFailure };
