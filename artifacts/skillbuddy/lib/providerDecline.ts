import {
  classifyJobActionFailure,
  isJobActionRefused,
  isJobActionUnauthorized,
  type JobActionFailureKind,
} from '@/lib/jobAction';
import { isJobCancelledStatus, isJobCompleted } from '@/lib/jobDetail';
import { isValidJobId } from '@/lib/jobPublish';
import { assignedProviderId, isProviderRole, type JobActorRole } from '@/lib/jobStart';
import type { JobApiStatus, JobDetailsRequest, JobResponse, ValidationErrorDetail } from '@/types';

/**
 * POST /api/v1/jobs/{job_id}/decline-by-provider — pure rules, no React, no network.
 *
 * Swagger title: "Decline By Provider". This is the PROVIDER's rejection of a job that
 * was assigned to them but whose work has NOT started — the counterpart of the client's
 * decline-by-client (a separate, already-handled task) and the sibling of the provider's
 * POST /jobs/{job_id}/provider-cancel.
 *
 * WHAT THE LIVE OPENAPI ACTUALLY SAYS (read from openapi.json, not inferred from the
 * Swagger UI):
 *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
 *   - exactly ONE parameter: the required integer path `job_id`
 *   - a **REQUIRED `application/json` request body** (schema JobDetailsRequest) whose
 *     single property is `details` — REQUIRED, `type: string`, `minLength: 3`,
 *     `maxLength: 1000`, and **NO enum**. The field is `details` (one string), NOT
 *     `reason`/`notes`; no field is renamed and no reason list is invented.
 *   - its 200 is the **JobResponse DIRECTLY** (there is no `{ message, job }` envelope
 *     and no `message` field at all, unlike provider-cancel/convert) and 422 is
 *     HTTPValidationError. The success toast is therefore written in the app.
 *   - VERIFIED LIVE (no token): POST → 401 {"detail":"Not authenticated"}; GET on the
 *     same path → 405, so POST is the registered method.
 *
 * THE SAME JobDetailsRequest IS SHARED by decline-by-client, pause-by-client,
 * pause-by-provider and blocker — its own description calls these "IN_PROGRESS actions
 * that require an explanation". That is why the split with provider-cancel is made
 * explicit below by STATUS rather than left to overlap.
 *
 * WHY THIS OWNS `PROVIDER_ASSIGNED` — the product distinguishes declining a job
 * "before or right after being assigned" from cancelling out of an "already accepted"
 * job. lib/providerCancel owns IN_PROGRESS (work started); this action owns
 * PROVIDER_ASSIGNED (assigned, work not begun), so a job in either window shows exactly
 * ONE of the two buttons and they can never both appear. Nothing about which status the
 * decline produces is assumed — the screen adopts whatever the 200 returns.
 *
 * THE DETAILS ARE FREE TEXT — CONFIRMED BY THE CONTRACT, NOT ASSUMED. `details`
 * declares no enum, only a 3–1000 length range, so the backend accepts arbitrary text
 * and free text is the only option that invents nothing. The minimum is enforced
 * client-side BEFORE the request so a blank or whitespace-only explanation can never be
 * submitted (the server would 422 on it anyway).
 */

/** Re-export so callers have one import for the whole action. */
export { isValidJobId };

/** Mirrors `JobDetailsRequest.details`: `minLength: 3`. */
export const DECLINE_DETAILS_MIN_LENGTH = 3;
/** Mirrors `JobDetailsRequest.details`: `maxLength: 1000`. */
export const DECLINE_DETAILS_MAX_LENGTH = 1000;

export type DeclineDetailsErrorKey =
  | 'jobd_decline_err_details_required'
  | 'jobd_decline_err_details_short'
  | 'jobd_decline_err_details_long';

/**
 * Validate the typed details against the contract's own 3–1000 rule.
 * Returns `null` when the value is acceptable, otherwise the copy key to show.
 */
export function validateDeclineDetails(
  details: string | null | undefined
): DeclineDetailsErrorKey | null {
  const length = (details ?? '').trim().length;
  if (length === 0) return 'jobd_decline_err_details_required';
  if (length < DECLINE_DETAILS_MIN_LENGTH) return 'jobd_decline_err_details_short';
  if (length > DECLINE_DETAILS_MAX_LENGTH) return 'jobd_decline_err_details_long';
  return null;
}

/**
 * Build the REQUIRED body. The value is trimmed so padding cannot sneak past the
 * minimum.
 *
 * Only called once `validateDeclineDetails` has passed, so a rejected value can never
 * be sent. The exact field name is `details` — never `reason`/`notes`.
 */
export function buildDeclineRequest(details: string): JobDetailsRequest {
  return { details: details.trim() };
}

/**
 * The one lifecycle status that means "assigned, but the work has not started yet" —
 * the window where a provider may decline. The sibling provider-cancel action owns
 * IN_PROGRESS, so the two never overlap.
 */
export const DECLINABLE_JOB_STATUS: JobApiStatus = 'PROVIDER_ASSIGNED';

/** Whether the job currently sits in the declinable status. */
export function isDeclinableStatus(
  job: Pick<JobResponse, 'status'> | null | undefined
): boolean {
  return job?.status === DECLINABLE_JOB_STATUS;
}

/**
 * Whether the job is in the window where its assigned provider may decline, ignoring
 * WHO is looking at it: the status must be PROVIDER_ASSIGNED, a real provider must be
 * assigned, and the job must not be cancelled or completed.
 *
 * The cancelled check is status-aware (`isJobCancelledStatus`), so a job the backend
 * already moved to a cancelled/declined status no longer offers the action.
 */
export function isJobInDeclinableState(
  job:
    | Pick<JobResponse, 'assigned_provider_id' | 'cancelled_at' | 'completed_at' | 'status'>
    | null
    | undefined
): boolean {
  if (!job) return false;
  if (!isDeclinableStatus(job)) return false;
  if (assignedProviderId(job) === null) return false;
  if (isJobCancelledStatus(job)) return false;
  if (isJobCompleted(job)) return false;
  // `DECLINED_BY_PROVIDER` is this action's own outcome — never offer it twice.
  if (job.status === 'DECLINED_BY_PROVIDER') return false;
  return true;
}

/**
 * Whether the "Decline Job" action may be OFFERED: the provider role AND a job in the
 * declinable window. Both halves are required together so there is a single authority
 * for the gate and no screen can accidentally render it for the client.
 */
export function canDeclineJob(
  job:
    | Pick<JobResponse, 'assigned_provider_id' | 'cancelled_at' | 'completed_at' | 'status'>
    | null
    | undefined,
  role: JobActorRole | null | undefined
): boolean {
  if (!isProviderRole(role)) return false;
  return isJobInDeclinableState(job);
}

/**
 * True for the buckets that mean "the server refused because the job can no longer be
 * declined, or you are not the assigned provider" — these get their own copy instead
 * of a generic error.
 */
export function isDeclineNotAllowed(kind: JobActionFailureKind): boolean {
  return kind === 'badrequest' || kind === 'conflict';
}

/**
 * Whether the screen should re-read the job after a failure.
 *
 * A refusal means the state this screen gated on is stale — that is WHY the backend
 * said no — so the cached job is re-synced. A 422 stays out on purpose: it normally
 * means the TYPED details were rejected (too short or too long), which re-reading the
 * job cannot fix. Network/5xx failures are not stale-data signals either.
 *
 * NETWORK failures are handled separately by the caller: see declineResolvedAfterResync.
 */
export function shouldResyncAfterDeclineFailure(kind: JobActionFailureKind): boolean {
  return isDeclineNotAllowed(kind) || isJobActionRefused(kind);
}

/**
 * Whether a network failure was in fact already carried out by the server.
 *
 * A request that never produced a response may still have been processed (the reply
 * was lost on the way back). Declining twice is exactly what the backend is likely to
 * reject, so a blind retry is the wrong move: the caller re-reads the job first and,
 * if it has left the declinable window (declined, unassigned or progressed), reports
 * that instead of offering "Retry". `refetched` is null when the re-read itself failed,
 * in which case nothing is claimed and the normal network error + retry path applies
 * (the typed details are preserved either way).
 */
export function declineResolvedAfterResync(
  refetched:
    | Pick<JobResponse, 'assigned_provider_id' | 'cancelled_at' | 'completed_at' | 'status'>
    | null
    | undefined
): boolean {
  if (!refetched) return false;
  return !isJobInDeclinableState(refetched);
}

/** A 401 that survived the shared client's refresh + single replay → login. */
export { isJobActionUnauthorized as isDeclineUnauthorized };

export type DeclineJobErrorKey =
  | 'jobd_decline_err_invalid'
  | 'jobd_decline_err_notallowed'
  | 'jobd_decline_err_forbidden'
  | 'jobd_decline_err_notfound'
  | 'jobd_decline_err_server'
  | 'jobd_decline_err_network';

/**
 * Translated copy per bucket. 400 and 409 share the "can no longer be declined" copy;
 * `unauthorized` is absent because it never reaches the UI (the caller sends the user
 * to login, the same rule the other job actions use).
 */
export function declineJobErrorKey(kind: JobActionFailureKind): DeclineJobErrorKey {
  switch (kind) {
    case 'invalid':
      return 'jobd_decline_err_invalid';
    case 'badrequest':
    case 'conflict':
      return 'jobd_decline_err_notallowed';
    case 'forbidden':
      return 'jobd_decline_err_forbidden';
    case 'notfound':
      return 'jobd_decline_err_notfound';
    case 'network':
      return 'jobd_decline_err_network';
    default:
      return 'jobd_decline_err_server';
  }
}

/**
 * The body copy for a failure: the backend's own message when it sent one (a 422
 * `detail[].msg`, or a plain-string `detail`), otherwise the translated copy for the
 * bucket — so the server's exact reason for refusing reaches the provider as worded.
 */
export function declineJobFailureMessage(
  failure: { kind: JobActionFailureKind; message: string | null },
  translate: (key: DeclineJobErrorKey) => string
): string {
  return failure.message ?? translate(declineJobErrorKey(failure.kind));
}

/**
 * Pull the server's message for the `details` field out of a 422 `detail[]`, so a
 * rejected explanation is shown ON the input instead of as a generic failure.
 *
 * FastAPI reports a body field as `loc: ["body", "details"]`. Returns null when the
 * response had no detail array or said nothing about `details` (the caller then falls
 * back to the bucket copy), so a malformed 422 degrades gracefully.
 *
 * NOTE: the request field is `details` (plural) while the error array key is `detail`
 * (singular) — the two are deliberately not mixed up here.
 */
export function declineDetailsFieldError(
  detail: ValidationErrorDetail[] | null | undefined
): string | null {
  if (!Array.isArray(detail)) return null;
  for (const entry of detail) {
    if (!entry || !Array.isArray(entry.loc)) continue;
    if (entry.loc.some((part) => part === 'details') && entry.msg) return entry.msg;
  }
  return null;
}

/** Bucket a rejected decline request (delegates to the shared core). */
export { classifyJobActionFailure as classifyDeclineJobFailure };
