import {
  classifyJobActionFailure,
  isJobActionRefused,
  isJobActionUnauthorized,
  type JobActionFailureKind,
} from '@/lib/jobAction';
import { isJobCancelled, isJobCompleted } from '@/lib/jobDetail';
import { isValidJobId } from '@/lib/jobPublish';
import type { JobApiStatus, JobResponse } from '@/types';

/**
 * POST /api/v1/jobs/{job_id}/start — pure rules, no React, no network.
 *
 * WHAT THE LIVE OPENAPI ACTUALLY SAYS (read from openapi.json, not inferred from the
 * Swagger UI):
 *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
 *   - exactly ONE parameter: the required integer path `job_id`
 *   - **NO `requestBody` key at all** — no body is sent, and nothing (a `started_at`,
 *     a location, …) is invented here
 *   - its ONLY documented responses are 200 (**the JobResponse DIRECTLY** — there is
 *     no `{ message, job }` envelope here) and 422 (HTTPValidationError)
 *   - VERIFIED LIVE (no token): POST → 401 {"detail":"Not authenticated"}; GET/PUT on
 *     the same path → 405, so POST is the registered method
 *   - the spec documents NO description for this operation, and 0 of the 35
 *     JobResponse properties carry one, so NOTHING about the role, the startable
 *     state or the resulting status can be read off the schema — see below for the
 *     evidence that is actually used, and what remains a team decision.
 *
 * WHICH ROLE STARTS A JOB — answered from the app's OWN designed flow, not a guess.
 * `app/job/[id]/track.tsx` (the in-progress job screen) gates its actions by role,
 * and the start action is the PROVIDER's:
 *
 *     {isProvider && job.status === 'task_assigned' && → mark arrived}
 *     {isProvider && job.status === 'arrived'      && → START JOB  (track_start)}
 *     {isProvider && job.status === 'in_progress'  && → mark done}
 *     {!isProvider && job.status === 'completed'   && → review}
 *
 * i.e. the provider arrives, starts the work, marks it done, and the client's only
 * in-progress action is reviewing the finished job. The API agrees structurally:
 * every genuinely two-sided action is split per role (pause-by-client /
 * pause-by-provider, decline-by-client / decline-by-provider, cancel vs
 * provider-cancel) — `start` is not split because it is not a client action. So the
 * action is rendered for `activeRole === 'PROVIDER'` only, and the client half of the
 * app never shows it.
 *
 * THE STARTABLE STATE IS DERIVED FROM THE BACKEND'S OWN STATUS. There is no
 * `can_start_job` flag on JobResponse (it exposes only is_editable, is_cancellable,
 * can_restart_timer, can_convert_to_regular and can_convert_to_urgent), so the gate
 * is the lifecycle status the task describes — "provider assigned AND payment
 * confirmed, not already started/completed/cancelled". In the backend's own
 * JobStatus enum exactly one value means that:
 *
 *     DRAFT → OPEN → PAYMENT_PENDING → PROVIDER_ASSIGNED → IN_PROGRESS → …
 *
 * `PROVIDER_ASSIGNED` sits AFTER `PAYMENT_PENDING` (so payment is settled) and BEFORE
 * `IN_PROGRESS` (so work has not begun) — the one status that satisfies the rule.
 * An already-started job is `IN_PROGRESS`, so the action disappears by itself once
 * the response moves the job on; nothing is inferred about what the status becomes,
 * it is read from the 200 body.
 *
 * The job must additionally carry a real `assigned_provider_id`, because "payment
 * cleared but nobody assigned" must never offer a start.
 */


/** Re-export so callers have one import for the whole action. */
export { isValidJobId };

/**
 * The two sides of a job, mirroring `ActiveRole` in context/RoleContext.
 *
 * Declared here rather than imported so this stays a PURE module — importing the
 * context would drag React into every consumer of the rules (and into the lib test
 * compile). The unions are identical, so the screen's `ActiveRole` is assignable as
 * is; the test pins the two literals so a divergence cannot slip through silently.
 */
export type JobActorRole = 'CLIENT' | 'PROVIDER';

/**
 * The one lifecycle status that means "provider assigned, payment settled, work not
 * started yet". An already-started job has left this status, which is why the action
 * needs no separate "already started" rule.
 */
export const STARTABLE_JOB_STATUS: JobApiStatus = 'PROVIDER_ASSIGNED';

/** Whether the job currently sits in the startable status. */
export function isStartableStatus(
  job: Pick<JobResponse, 'status'> | null | undefined
): boolean {
  return job?.status === STARTABLE_JOB_STATUS;
}

/** The provider who was assigned (a real server id), or null when nobody is assigned. */
export function assignedProviderId(
  job: Pick<JobResponse, 'assigned_provider_id'> | null | undefined
): number | null {
  const id = job?.assigned_provider_id;
  return typeof id === 'number' && Number.isInteger(id) && id >= 1 ? id : null;
}

/** Whether the signed-in user is acting as the provider. */
export function isProviderRole(role: JobActorRole | null | undefined): boolean {
  return role === 'PROVIDER';
}

/**
 * Whether the job is in a startable state, ignoring WHO is looking at it: the status
 * must be PROVIDER_ASSIGNED, a real provider must be assigned, and the job must not be
 * cancelled or completed. "Provider assigned and payment confirmed" is exactly this
 * status — see the header for why.
 */
export function isJobInStartableState(
  job:
    | Pick<JobResponse, 'status' | 'assigned_provider_id' | 'cancelled_at' | 'completed_at'>
    | null
    | undefined
): boolean {
  if (!job) return false;
  if (!isStartableStatus(job)) return false;
  if (assignedProviderId(job) === null) return false;
  if (isJobCancelled(job)) return false;
  if (isJobCompleted(job)) return false;
  return true;
}

/**
 * Whether the "Start Job" action may be OFFERED: the provider role AND a startable
 * job. Both halves are required together so there is a single authority for the gate
 * and no screen can accidentally render it for the client.
 */
export function canStartJob(
  job:
    | Pick<JobResponse, 'status' | 'assigned_provider_id' | 'cancelled_at' | 'completed_at'>
    | null
    | undefined,
  role: JobActorRole | null | undefined
): boolean {
  if (!isProviderRole(role)) return false;
  return isJobInStartableState(job);
}

/**
 * True for the buckets that mean "the server refused because the job can no longer be
 * started, or you are not the provider on it" — these get their own copy instead of a
 * generic error.
 */
export function isStartNotAllowed(kind: JobActionFailureKind): boolean {
  return kind === 'badrequest' || kind === 'conflict';
}

/**
 * Whether the screen should re-read the job after a failure.
 *
 * A refusal means the state this screen gated on is stale — that is WHY the backend
 * said no (most likely it was already started) — so the cached job is re-synced. A 422
 * stays out on purpose (the path id itself was rejected, so re-reading changes
 * nothing) and so do 5xx failures.
 *
 * NETWORK failures are handled separately by the caller: see startResolvedAfterResync.
 */
export function shouldResyncAfterStartFailure(kind: JobActionFailureKind): boolean {
  return isStartNotAllowed(kind) || isJobActionRefused(kind);
}

/**
 * Whether a network failure was in fact already carried out by the server.
 *
 * A request that never produced a response may still have been processed (the reply
 * was lost on the way back). Starting twice is exactly what the backend is likely to
 * reject, so a blind retry is the wrong move: the caller re-reads the job first and,
 * if it has left the startable state, says the job has already moved on instead of
 * offering "Retry". `refetched` is null when the re-read itself failed, in which case
 * nothing is claimed and the normal network error + retry path applies.
 */
export function startResolvedAfterResync(
  refetched:
    | Pick<JobResponse, 'status' | 'assigned_provider_id' | 'cancelled_at' | 'completed_at'>
    | null
    | undefined
): boolean {
  if (!refetched) return false;
  return !isJobInStartableState(refetched);
}

/** A 401 that survived the shared client's refresh + single replay → login. */
export { isJobActionUnauthorized as isStartUnauthorized };

export type StartJobErrorKey =
  | 'jobd_start_err_invalid'
  | 'jobd_start_err_notallowed'
  | 'jobd_start_err_forbidden'
  | 'jobd_start_err_notfound'
  | 'jobd_start_err_server'
  | 'jobd_start_err_network';

/**
 * Translated copy per bucket. 400 and 409 share the "can no longer be started" copy;
 * `unauthorized` is absent because it never reaches the UI (the caller sends the user
 * to login, the same rule the other job actions use).
 */
export function startJobErrorKey(kind: JobActionFailureKind): StartJobErrorKey {
  switch (kind) {
    case 'invalid':
      return 'jobd_start_err_invalid';
    case 'badrequest':
    case 'conflict':
      return 'jobd_start_err_notallowed';
    case 'forbidden':
      return 'jobd_start_err_forbidden';
    case 'notfound':
      return 'jobd_start_err_notfound';
    case 'network':
      return 'jobd_start_err_network';
    default:
      return 'jobd_start_err_server';
  }
}

/**
 * The body copy for a failure: the backend's own message when it sent one (a 422
 * `detail[].msg`, or a plain-string `detail`), otherwise the translated copy for the
 * bucket — so a specific reason reaches the provider as the server worded it.
 */
export function startJobFailureMessage(
  failure: { kind: JobActionFailureKind; message: string | null },
  translate: (key: StartJobErrorKey) => string
): string {
  return failure.message ?? translate(startJobErrorKey(failure.kind));
}

/** Bucket a rejected start request (delegates to the shared core). */
export { classifyJobActionFailure as classifyStartJobFailure };
