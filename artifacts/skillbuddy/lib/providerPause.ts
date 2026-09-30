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
 * POST /api/v1/jobs/{job_id}/pause-by-provider — pure rules, no React, no network.
 *
 * Swagger title: "Pause By Provider". This is the PROVIDER putting a job they are
 * working on temporarily on hold, with an explanation; its sibling
 * POST /jobs/{job_id}/pause-by-client (already connected) is the client's own version
 * of the same action.
 *
 * WHAT THE LIVE OPENAPI ACTUALLY SAYS (read from openapi.json, not inferred from the
 * Swagger UI):
 *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
 *   - exactly ONE parameter: the required integer path `job_id`
 *   - a **REQUIRED `application/json` request body** (schema JobDetailsRequest) whose
 *     single property is `details` — REQUIRED, `type: string`, `minLength: 3`,
 *     `maxLength: 1000`, and **NO enum**. `JobDetailsRequest` carries no per-field
 *     description, so `details` is honoured as the free-text explanation the shared
 *     schema is documented for ("Body for IN_PROGRESS actions that require an
 *     explanation: decline, pause, or reporting a blocker"). The field is `details`
 *     (one string), NOT `reason`/`notes`.
 *   - its 200 is the **JobResponse DIRECTLY** (no `{ message, job }` envelope and no
 *     `message` field), and 422 is HTTPValidationError. The success toast is therefore
 *     written in the app — unlike Restart Timer, which returns the wrapped envelope.
 *   - the operation declares NO description, and 0 of the 35 JobResponse properties
 *     carry one, so nothing about the resulting status is read off the schema as fact.
 *     The `JobStatus` enum DOES contain `PAUSED_BY_PROVIDER` (and `PAUSED_BY_CLIENT`),
 *     which is the status this action is expected to produce — but the UI does not
 *     assert it: the whole job is adopted from the 200 and rendered from whatever
 *     status it returns.
 *   - VERIFIED LIVE (no token): POST → 401 {"detail":"Not authenticated"}; GET on the
 *     same path → 405, so POST is the registered method.
 *
 * WHICH ROLE — the contract's own split: every genuinely two-sided action has a
 * per-role endpoint (pause-by-client / pause-by-provider, decline-by-* / cancel vs
 * provider-cancel), so this action is offered for `activeRole === 'PROVIDER'` only and
 * the client half of the app never shows it.
 *
 * THE GATE IS THE JOB'S OWN STATE, NOT A GUESS. JobResponse exposes no `can_pause`
 * flag, so the offer is derived from the fields the backend DOES return: the job
 * sitting in `IN_PROGRESS` (work under way), carrying a real `assigned_provider_id`,
 * and being neither cancelled, completed nor already paused. This is deliberately the
 * SAME window as the client's pause action (pause is a per-role action on the same
 * state), and it does not clash with the other provider actions: Decline owns
 * PROVIDER_ASSIGNED, and Pause / Cancel / Complete legitimately coexist at IN_PROGRESS
 * because they are different intents on the same state.
 *
 * WHERE THE EXPLANATION ENDS UP: the response's `status_history[]` rows carry a
 * nullable `note` (schema JobStatusHistoryResponse: id, status, note, changed_by,
 * created_at), which is where a pause explanation is surfaced to both sides — this
 * module never invents that shape, the screen renders only what the job returns.
 *
 * NO TIMER/BIDDING ARITHMETIC HERE: the Job Details countdown is driven by
 * `biddingDeadline`, which returns null unless `is_bidding_open === true`, so a paused
 * job simply shows no live countdown — from the response, never from an assumption.
 */

/** Re-export so callers have one import for the whole action. */
export { isValidJobId };

/** Mirrors `JobDetailsRequest.details`: `minLength: 3`. */
export const PROVIDER_PAUSE_DETAILS_MIN_LENGTH = 3;
/** Mirrors `JobDetailsRequest.details`: `maxLength: 1000`. */
export const PROVIDER_PAUSE_DETAILS_MAX_LENGTH = 1000;

export type ProviderPauseDetailsErrorKey =
  | 'jobd_ppause_err_details_required'
  | 'jobd_ppause_err_details_short'
  | 'jobd_ppause_err_details_long';

/**
 * Validate the typed details against the contract's own 3–1000 rule.
 * Returns `null` when the value is acceptable, otherwise the copy key to show.
 */
export function validateProviderPauseDetails(
  details: string | null | undefined
): ProviderPauseDetailsErrorKey | null {
  const length = (details ?? '').trim().length;
  if (length === 0) return 'jobd_ppause_err_details_required';
  if (length < PROVIDER_PAUSE_DETAILS_MIN_LENGTH) return 'jobd_ppause_err_details_short';
  if (length > PROVIDER_PAUSE_DETAILS_MAX_LENGTH) return 'jobd_ppause_err_details_long';
  return null;
}

/**
 * Build the REQUIRED body. The value is trimmed so padding cannot sneak past the
 * minimum. Only called once `validateProviderPauseDetails` has passed. The exact field
 * name is `details` — never `reason`/`notes`.
 */
export function buildProviderPauseRequest(details: string): JobDetailsRequest {
  return { details: details.trim() };
}

/**
 * The one lifecycle status that means "the work is under way" — the window where the
 * assigned provider may pause. A paused job has left it, so the action disappears by
 * itself.
 */
export const PROVIDER_PAUSABLE_STATUS: JobApiStatus = 'IN_PROGRESS';

/** Whether the job currently sits in the provider-pausable status. */
export function isProviderPausableStatus(
  job: Pick<JobResponse, 'status'> | null | undefined
): boolean {
  return job?.status === PROVIDER_PAUSABLE_STATUS;
}

/**
 * Whether the job is in the window where its assigned provider may pause it, ignoring
 * WHO is looking at it: the status must be IN_PROGRESS, a real provider must be
 * assigned, and the job must be neither cancelled, completed nor already paused.
 *
 * The cancelled check is status-aware (`isJobCancelledStatus`) and the paused check uses
 * the server's own PAUSED_BY_* statuses, so a paused job never offers another pause from
 * either side.
 */
export function isJobInProviderPausableState(
  job:
    | Pick<JobResponse, 'assigned_provider_id' | 'cancelled_at' | 'completed_at' | 'status'>
    | null
    | undefined
): boolean {
  if (!job) return false;
  if (!isProviderPausableStatus(job)) return false;
  if (assignedProviderId(job) === null) return false;
  if (isJobCancelledStatus(job)) return false;
  if (isJobCompleted(job)) return false;
  if (isJobPausedStatus(job)) return false;
  return true;
}

/**
 * Whether the "Pause Job" action may be OFFERED: the provider role AND a job in the
 * provider-pausable window. Both halves are required together so there is a single
 * authority for the gate and no screen can accidentally render it for the client.
 */
export function canProviderPauseJob(
  job:
    | Pick<JobResponse, 'assigned_provider_id' | 'cancelled_at' | 'completed_at' | 'status'>
    | null
    | undefined,
  role: JobActorRole | null | undefined
): boolean {
  if (!isProviderRole(role)) return false;
  return isJobInProviderPausableState(job);
}

/**
 * True for the buckets that mean "the server refused because the job can no longer be
 * paused, or you are not the assigned provider" — these get their own copy instead of a
 * generic error.
 */
export function isProviderPauseNotAllowed(kind: JobActionFailureKind): boolean {
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
 * NETWORK failures are handled separately by the caller: see
 * providerPauseResolvedAfterResync.
 */
export function shouldResyncAfterProviderPauseFailure(kind: JobActionFailureKind): boolean {
  return isProviderPauseNotAllowed(kind) || isJobActionRefused(kind);
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
export function providerPauseResolvedAfterResync(
  refetched:
    | Pick<JobResponse, 'assigned_provider_id' | 'cancelled_at' | 'completed_at' | 'status'>
    | null
    | undefined
): boolean {
  if (!refetched) return false;
  return !isJobInProviderPausableState(refetched);
}

/** A 401 that survived the shared client's refresh + single replay → login. */
export { isJobActionUnauthorized as isProviderPauseUnauthorized };

export type ProviderPauseErrorKey =
  | 'jobd_ppause_err_invalid'
  | 'jobd_ppause_err_notallowed'
  | 'jobd_ppause_err_forbidden'
  | 'jobd_ppause_err_notfound'
  | 'jobd_ppause_err_server'
  | 'jobd_ppause_err_network';

/**
 * Translated copy per bucket. 400 and 409 share the "can no longer be paused" copy;
 * `unauthorized` is absent because it never reaches the UI (the caller sends the user to
 * login, the same rule the other job actions use).
 */
export function providerPauseErrorKey(kind: JobActionFailureKind): ProviderPauseErrorKey {
  switch (kind) {
    case 'invalid':
      return 'jobd_ppause_err_invalid';
    case 'badrequest':
    case 'conflict':
      return 'jobd_ppause_err_notallowed';
    case 'forbidden':
      return 'jobd_ppause_err_forbidden';
    case 'notfound':
      return 'jobd_ppause_err_notfound';
    case 'network':
      return 'jobd_ppause_err_network';
    default:
      return 'jobd_ppause_err_server';
  }
}

/**
 * The body copy for a failure: the backend's own message when it sent one (a 422
 * `detail[].msg`, or a plain-string `detail`), otherwise the translated copy for the
 * bucket — so the server's exact reason for refusing reaches the provider as worded.
 */
export function providerPauseFailureMessage(
  failure: { kind: JobActionFailureKind; message: string | null },
  translate: (key: ProviderPauseErrorKey) => string
): string {
  return failure.message ?? translate(providerPauseErrorKey(failure.kind));
}

/**
 * Pull the server's message for the `details` field out of a 422 `detail[]`, so a
 * rejected explanation is shown ON the input instead of as a generic failure.
 *
 * NOTE: the request field is `details` (plural) while the error array key is `detail`
 * (singular) — the two are deliberately not mixed up here.
 */
export function providerPauseDetailsFieldError(
  detail: ValidationErrorDetail[] | null | undefined
): string | null {
  if (!Array.isArray(detail)) return null;
  for (const entry of detail) {
    if (!entry || !Array.isArray(entry.loc)) continue;
    if (entry.loc.some((part) => part === 'details') && entry.msg) return entry.msg;
  }
  return null;
}

/** Bucket a rejected provider-pause request (delegates to the shared core). */
export { classifyJobActionFailure as classifyProviderPauseJobFailure };
