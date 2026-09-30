import {
  classifyJobActionFailure,
  isJobActionRefused,
  isJobActionUnauthorized,
  type JobActionFailureKind,
} from '@/lib/jobAction';
import { isJobCancelledStatus, isJobCompleted } from '@/lib/jobDetail';
import { isValidJobId } from '@/lib/jobPublish';
import { assignedProviderId, isProviderRole, type JobActorRole } from '@/lib/jobStart';
import type { JobApiStatus, JobResponse } from '@/types';

/**
 * POST /api/v1/jobs/{job_id}/provider-cancel — pure rules, no React, no network.
 *
 * Swagger title: "Provider Cancel After Acceptance". This is the PROVIDER's own
 * withdrawal from a job the client already assigned to them — a different endpoint
 * from the client's POST /api/v1/jobs/{job_id}/cancel (which takes reason + notes).
 *
 * WHAT THE CONTRACT SAYS:
 *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
 *   - exactly ONE parameter: the required integer path `job_id`
 *   - **NO `requestBody`** — no reason/notes are accepted, so nothing is invented
 *   - its 200 is the WRAPPED `JobActionResponse` `{ message, job }` (the same
 *     envelope as convert-to-regular / restart-timer), NOT the direct job the
 *     client's `/cancel` returns — see the hook, which reads `data.job` / `data.message`
 *   - 422 is HTTPValidationError; the spec documents nothing else
 *
 * WHICH ROLE — answered from the contract's own split: the Jobs group gives every
 * genuinely two-sided action its own per-role endpoint (cancel vs provider-cancel,
 * decline-by-client vs decline-by-provider, pause-by-client vs pause-by-provider), so
 * this action is offered for `activeRole === 'PROVIDER'` only and the client half of
 * the app never shows it.
 *
 * THE GATE IS THE JOB'S OWN STATE, NOT A GUESS. JobResponse exposes no
 * `can_provider_cancel` flag, so the offer is derived from the fields the backend
 * DOES return: the job sitting in `IN_PROGRESS` (the status POST /jobs/{job_id}/start
 * produces — i.e. the provider has STARTED the work, which is what "cancelling out of
 * an already accepted job" means) AND carrying a real `assigned_provider_id`, and
 * being neither cancelled nor completed. Nothing about which status the cancellation
 * produces is assumed; the screen adopts whatever the 200 returns.
 *
 * WHY IN_PROGRESS SPECIFICALLY — the split with the sibling DECLINE action
 * (lib/providerDecline, POST /jobs/{job_id}/decline-by-provider): the two actions must
 * never be offered on the same state, and the product distinguishes "right after
 * being assigned" (decline) from "an already accepted, started job" (cancel). So
 * decline owns the `PROVIDER_ASSIGNED` window (assigned, work not begun) and this
 * action owns `IN_PROGRESS` (work begun). A job in either window therefore shows
 * exactly one of the two buttons. Paused/blocked states are deliberately NOT included
 * (they have their own pause/blocker endpoints) — flagged for team confirmation.
 *
 * WHETHER THE JOB RETURNS TO BIDDING OR BECOMES CANCELLED, AND WHETHER A PENALTY
 * APPLIES, ARE NOT DECIDED HERE. The 200 body carries status, is_bidding_open,
 * remaining_bidding_seconds, cancellation_fee_charged, cancelled_at, … so the UI is
 * driven entirely by that response — this module never states an amount or a
 * resulting status.
 */

/** Re-export so callers have one import for the whole action. */
export { isValidJobId };

/**
 * The one lifecycle status that means "the provider accepted the job and the work has
 * STARTED" — the window where a provider may cancel out of an already accepted job.
 * The sibling decline action owns PROVIDER_ASSIGNED (see lib/providerDecline), so the
 * two never overlap.
 */
export const PROVIDER_CANCELLABLE_STATUS: JobApiStatus = 'IN_PROGRESS';

/** Whether the job currently sits in the provider-cancellable status. */
export function isProviderCancellableStatus(
  job: Pick<JobResponse, 'status'> | null | undefined
): boolean {
  return job?.status === PROVIDER_CANCELLABLE_STATUS;
}

/**
 * Whether the job is in the window where its assigned provider may cancel out of it,
 * ignoring WHO is looking at it: the status must be IN_PROGRESS (work started), a real
 * provider must be assigned, and the job must not be cancelled or completed (the guard
 * that catches a `cancelled_at`/`completed_at` stamp set while the status still reads
 * IN_PROGRESS).
 *
 * The cancelled check is status-aware (`isJobCancelledStatus` via the status field),
 * so a job the backend has already moved to `CANCELLED_BY_PROVIDER` — even before a
 * `cancelled_at` stamp — no longer offers the action.
 */
export function isJobInProviderCancellableState(
  job:
    | Pick<JobResponse, 'assigned_provider_id' | 'cancelled_at' | 'completed_at' | 'status'>
    | null
    | undefined
): boolean {
  if (!job) return false;
  if (!isProviderCancellableStatus(job)) return false;
  if (assignedProviderId(job) === null) return false;
  // `isJobCancelledStatus` covers both the cancelled_at stamp AND the backend's own
  // cancelled statuses (CANCELLED / CANCELLED_BY_CLIENT / CANCELLED_BY_PROVIDER).
  if (isJobCancelledStatus(job)) return false;
  if (isJobCompleted(job)) return false;
  return true;
}

/**
 * Whether the "Cancel Job" (provider withdrawal) action may be OFFERED: the provider
 * role AND a job whose work has started (IN_PROGRESS) and that still carries a real
 * assigned provider. Both halves are required together so there is a single authority
 * for the gate and no screen can accidentally render it for the client.
 */
export function canProviderCancelJob(
  job:
    | Pick<JobResponse, 'assigned_provider_id' | 'cancelled_at' | 'completed_at' | 'status'>
    | null
    | undefined,
  role: JobActorRole | null | undefined
): boolean {
  if (!isProviderRole(role)) return false;
  return isJobInProviderCancellableState(job);
}

/**
 * True for the buckets that mean "the server refused because the job can no longer be
 * withdrawn from, or you are not the assigned provider" — these get their own copy
 * instead of a generic error.
 */
export function isProviderCancelNotAllowed(kind: JobActionFailureKind): boolean {
  return kind === 'badrequest' || kind === 'conflict';
}

/**
 * Whether the screen should re-read the job after a failure.
 *
 * A refusal means the assignment/state this screen gated on is stale — that is WHY
 * the backend said no — so the cached job is re-synced. A 422 stays out on purpose
 * (the path id itself was rejected, so re-reading changes nothing) and so do 5xx
 * failures.
 *
 * NETWORK failures are handled separately by the caller: see
 * providerCancelResolvedAfterResync.
 */
export function shouldResyncAfterProviderCancelFailure(kind: JobActionFailureKind): boolean {
  return isProviderCancelNotAllowed(kind) || isJobActionRefused(kind);
}

/**
 * Whether a network failure was in fact already carried out by the server.
 *
 * A request that never produced a response may still have been processed (the reply
 * was lost on the way back). Cancelling twice is exactly what the backend is likely
 * to reject, so a blind retry is the wrong move: the caller re-reads the job first
 * and, if it has left the provider-cancellable window (cancelled, unassigned or
 * completed), reports that instead of offering "Retry". `refetched` is null when the
 * re-read itself failed, in which case nothing is claimed and the normal network
 * error + retry path applies.
 */
export function providerCancelResolvedAfterResync(
  refetched:
    | Pick<JobResponse, 'assigned_provider_id' | 'cancelled_at' | 'completed_at' | 'status'>
    | null
    | undefined
): boolean {
  if (!refetched) return false;
  return !isJobInProviderCancellableState(refetched);
}

/** A 401 that survived the shared client's refresh + single replay → login. */
export { isJobActionUnauthorized as isProviderCancelUnauthorized };

export type ProviderCancelErrorKey =
  | 'jobd_pcancel_err_invalid'
  | 'jobd_pcancel_err_notallowed'
  | 'jobd_pcancel_err_forbidden'
  | 'jobd_pcancel_err_notfound'
  | 'jobd_pcancel_err_server'
  | 'jobd_pcancel_err_network';

/**
 * Translated copy per bucket. 400 and 409 share the "can no longer be cancelled"
 * copy; `unauthorized` is absent because it never reaches the UI (the caller sends
 * the user to login, the same rule the other job actions use).
 */
export function providerCancelErrorKey(kind: JobActionFailureKind): ProviderCancelErrorKey {
  switch (kind) {
    case 'invalid':
      return 'jobd_pcancel_err_invalid';
    case 'badrequest':
    case 'conflict':
      return 'jobd_pcancel_err_notallowed';
    case 'forbidden':
      return 'jobd_pcancel_err_forbidden';
    case 'notfound':
      return 'jobd_pcancel_err_notfound';
    case 'network':
      return 'jobd_pcancel_err_network';
    default:
      return 'jobd_pcancel_err_server';
  }
}

/**
 * The body copy for a failure: the backend's own message when it sent one (a 422
 * `detail[].msg` such as a bad id, or a plain-string `detail`), otherwise the
 * translated copy for the bucket — so the server's exact reason for refusing reaches
 * the provider as worded.
 */
export function providerCancelFailureMessage(
  failure: { kind: JobActionFailureKind; message: string | null },
  translate: (key: ProviderCancelErrorKey) => string
): string {
  return failure.message ?? translate(providerCancelErrorKey(failure.kind));
}

/** The copy key used when the 200 body carries no usable `message`. */
export type ProviderCancelSuccessKey = 'jobd_pcancel_success_msg';

/**
 * The toast copy after a successful withdrawal: the backend's OWN `message` when it
 * sent a non-empty one, otherwise the translated default. Nothing about the
 * resulting state is inferred from anything but the response.
 */
export function providerCancelSuccessMessage(
  message: string | null | undefined,
  translate: (key: ProviderCancelSuccessKey) => string
): string {
  const trimmed = (message ?? '').trim();
  return trimmed.length > 0 ? trimmed : translate('jobd_pcancel_success_msg');
}

/** Bucket a rejected provider-cancel request (delegates to the shared core). */
export { classifyJobActionFailure as classifyProviderCancelJobFailure };
