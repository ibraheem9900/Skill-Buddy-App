import {
  classifyJobActionFailure,
  isJobActionRefused,
  isJobActionUnauthorized,
  type JobActionFailureKind,
} from '@/lib/jobAction';
import { isJobCancelledStatus, isJobCompleted, isJobPausedStatus } from '@/lib/jobDetail';
import { isValidJobId } from '@/lib/jobPublish';
import { assignedProviderId, isProviderRole, type JobActorRole } from '@/lib/jobStart';
import type { JobApiStatus, JobDetailsRequest, JobResponse, ValidationErrorDetail } from '@/types';

/**
 * POST /api/v1/jobs/{job_id}/pause-by-client — pure rules, no React, no network.
 *
 * Swagger title: "Pause By Client". This is the CLIENT temporarily halting a job that
 * is already under way; the provider's own counterpart
 * (POST /jobs/{job_id}/pause-by-provider) is a separate, not-yet-connected endpoint.
 *
 * WHAT THE LIVE OPENAPI ACTUALLY SAYS (read from openapi.json, not inferred from the
 * Swagger UI):
 *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
 *   - exactly ONE parameter: the required integer path `job_id`
 *   - a **REQUIRED `application/json` request body** (schema JobDetailsRequest) whose
 *     single property is `details` — REQUIRED, `type: string`, `minLength: 3`,
 *     `maxLength: 1000`, and **NO enum** (the schema's own description: "Body for
 *     IN_PROGRESS actions that require an explanation: decline, pause, or reporting a
 *     blocker"). The field is `details` (one string), NOT `reason`/`notes`.
 *   - its 200 is the **JobResponse DIRECTLY** (no `{ message, job }` envelope and no
 *     `message` field), and 422 is HTTPValidationError. The success toast is therefore
 *     written in the app.
 *   - VERIFIED LIVE (no token): POST → 401 {"detail":"Not authenticated"}; GET on the
 *     same path → 405, so POST is the registered method.
 *
 * WHICH ROLE — the contract's own split: every genuinely two-sided action has a per-role
 * endpoint (pause-by-client / pause-by-provider, decline-by-* / cancel vs
 * provider-cancel), so this action is offered for the CLIENT side only
 * (`isProviderRole(role) === false`) and the provider half of the app never shows it.
 *
 * THE GATE IS THE JOB'S OWN STATE, NOT A GUESS. JobResponse exposes no `can_pause`
 * flag, so the offer is derived from the fields the backend DOES return: the job
 * sitting in `IN_PROGRESS` (work under way), carrying a real `assigned_provider_id`,
 * and being neither cancelled, completed nor already paused. Nothing about which status
 * the pause produces is assumed — the screen adopts whatever the 200 returns, and the
 * paused banner keys off the returned status via `isJobPausedStatus`, never a literal.
 *
 * NO RESUME IS BUILT HERE: the app has no resume endpoint connected, so once a job is
 * paused the screen says so plainly instead of leaving a dead end.
 */

/** Re-export so callers have one import for the whole action. */
export { isValidJobId };

/** Mirrors `JobDetailsRequest.details`: `minLength: 3`. */
export const PAUSE_DETAILS_MIN_LENGTH = 3;
/** Mirrors `JobDetailsRequest.details`: `maxLength: 1000`. */
export const PAUSE_DETAILS_MAX_LENGTH = 1000;

export type PauseDetailsErrorKey =
  | 'jobd_pause_err_details_required'
  | 'jobd_pause_err_details_short'
  | 'jobd_pause_err_details_long';

/**
 * Validate the typed details against the contract's own 3–1000 rule.
 * Returns `null` when the value is acceptable, otherwise the copy key to show.
 */
export function validatePauseDetails(
  details: string | null | undefined
): PauseDetailsErrorKey | null {
  const length = (details ?? '').trim().length;
  if (length === 0) return 'jobd_pause_err_details_required';
  if (length < PAUSE_DETAILS_MIN_LENGTH) return 'jobd_pause_err_details_short';
  if (length > PAUSE_DETAILS_MAX_LENGTH) return 'jobd_pause_err_details_long';
  return null;
}

/**
 * Build the REQUIRED body. The value is trimmed so padding cannot sneak past the
 * minimum. Only called once `validatePauseDetails` has passed. The exact field name is
 * `details` — never `reason`/`notes`.
 */
export function buildPauseRequest(details: string): JobDetailsRequest {
  return { details: details.trim() };
}

/**
 * The one lifecycle status that means "the work is under way" — the window where the
 * client may pause. A paused job has left it, so the action disappears by itself.
 */
export const PAUSABLE_JOB_STATUS: JobApiStatus = 'IN_PROGRESS';

/** Whether the job currently sits in the pausable status. */
export function isPausableStatus(
  job: Pick<JobResponse, 'status'> | null | undefined
): boolean {
  return job?.status === PAUSABLE_JOB_STATUS;
}

/**
 * Whether the job is in the window where its client may pause it, ignoring WHO is
 * looking at it: the status must be IN_PROGRESS, a real provider must be assigned, and
 * the job must be neither cancelled, completed nor already paused.
 *
 * The cancelled check is status-aware (`isJobCancelledStatus`), so a job the backend
 * already moved to a cancelled status no longer offers the action; the paused check
 * uses the server's own PAUSED_BY_* statuses so a second pause is never offered.
 */
export function isJobInPausableState(
  job:
    | Pick<JobResponse, 'assigned_provider_id' | 'cancelled_at' | 'completed_at' | 'status'>
    | null
    | undefined
): boolean {
  if (!job) return false;
  if (!isPausableStatus(job)) return false;
  if (assignedProviderId(job) === null) return false;
  if (isJobCancelledStatus(job)) return false;
  if (isJobCompleted(job)) return false;
  if (isJobPausedStatus(job)) return false;
  return true;
}

/**
 * Whether the "Pause Job" action may be OFFERED: the client role AND a job in the
 * pausable window. Both halves are required together so there is a single authority for
 * the gate and no screen can accidentally render it for the provider.
 */
export function canPauseJob(
  job:
    | Pick<JobResponse, 'assigned_provider_id' | 'cancelled_at' | 'completed_at' | 'status'>
    | null
    | undefined,
  role: JobActorRole | null | undefined
): boolean {
  if (isProviderRole(role)) return false;
  return isJobInPausableState(job);
}

/**
 * True for the buckets that mean "the server refused because the job can no longer be
 * paused, or you are not its client" — these get their own copy instead of a generic
 * error.
 */
export function isPauseNotAllowed(kind: JobActionFailureKind): boolean {
  return kind === 'badrequest' || kind === 'conflict';
}

/**
 * Whether the screen should re-read the job after a failure.
 *
 * A refusal means the state this screen gated on is stale — that is WHY the backend
 * said no (most likely it is already paused) — so the cached job is re-synced. A 422
 * stays out on purpose: it normally means the TYPED details were rejected (too short or
 * too long), which re-reading the job cannot fix. Network/5xx failures are not
 * stale-data signals either.
 *
 * NETWORK failures are handled separately by the caller: see pauseResolvedAfterResync.
 */
export function shouldResyncAfterPauseFailure(kind: JobActionFailureKind): boolean {
  return isPauseNotAllowed(kind) || isJobActionRefused(kind);
}

/**
 * Whether a network failure was in fact already carried out by the server.
 *
 * A request that never produced a response may still have been processed (the reply was
 * lost on the way back). Pausing twice is exactly what the backend is likely to reject,
 * so a blind retry is the wrong move: the caller re-reads the job first and, if it has
 * left the pausable window (paused, cancelled or progressed), reports that instead of
 * offering "Retry". `refetched` is null when the re-read itself failed, in which case
 * nothing is claimed and the normal network error + retry path applies (the typed
 * details are preserved either way).
 */
export function pauseResolvedAfterResync(
  refetched:
    | Pick<JobResponse, 'assigned_provider_id' | 'cancelled_at' | 'completed_at' | 'status'>
    | null
    | undefined
): boolean {
  if (!refetched) return false;
  return !isJobInPausableState(refetched);
}

/** A 401 that survived the shared client's refresh + single replay → login. */
export { isJobActionUnauthorized as isPauseUnauthorized };

export type PauseJobErrorKey =
  | 'jobd_pause_err_invalid'
  | 'jobd_pause_err_notallowed'
  | 'jobd_pause_err_forbidden'
  | 'jobd_pause_err_notfound'
  | 'jobd_pause_err_server'
  | 'jobd_pause_err_network';

/**
 * Translated copy per bucket. 400 and 409 share the "can no longer be paused" copy;
 * `unauthorized` is absent because it never reaches the UI (the caller sends the user to
 * login, the same rule the other job actions use).
 */
export function pauseJobErrorKey(kind: JobActionFailureKind): PauseJobErrorKey {
  switch (kind) {
    case 'invalid':
      return 'jobd_pause_err_invalid';
    case 'badrequest':
    case 'conflict':
      return 'jobd_pause_err_notallowed';
    case 'forbidden':
      return 'jobd_pause_err_forbidden';
    case 'notfound':
      return 'jobd_pause_err_notfound';
    case 'network':
      return 'jobd_pause_err_network';
    default:
      return 'jobd_pause_err_server';
  }
}

/**
 * The body copy for a failure: the backend's own message when it sent one (a 422
 * `detail[].msg`, or a plain-string `detail`), otherwise the translated copy for the
 * bucket — so the server's exact reason for refusing reaches the client as worded.
 */
export function pauseJobFailureMessage(
  failure: { kind: JobActionFailureKind; message: string | null },
  translate: (key: PauseJobErrorKey) => string
): string {
  return failure.message ?? translate(pauseJobErrorKey(failure.kind));
}

/**
 * Pull the server's message for the `details` field out of a 422 `detail[]`, so a
 * rejected explanation is shown ON the input instead of as a generic failure.
 *
 * NOTE: the request field is `details` (plural) while the error array key is `detail`
 * (singular) — the two are deliberately not mixed up here.
 */
export function pauseDetailsFieldError(
  detail: ValidationErrorDetail[] | null | undefined
): string | null {
  if (!Array.isArray(detail)) return null;
  for (const entry of detail) {
    if (!entry || !Array.isArray(entry.loc)) continue;
    if (entry.loc.some((part) => part === 'details') && entry.msg) return entry.msg;
  }
  return null;
}

/** Bucket a rejected pause request (delegates to the shared core). */
export { classifyJobActionFailure as classifyPauseJobFailure };
