import {
  classifyJobActionFailure,
  isJobActionRefused,
  isJobActionUnauthorized,
  type JobActionFailureKind,
} from '@/lib/jobAction';
import { isJobCancelled, isJobCompleted } from '@/lib/jobDetail';
import { isValidJobId } from '@/lib/jobPublish';
import { assignedProviderId, isProviderRole, type JobActorRole } from '@/lib/jobStart';
import type { JobApiStatus, JobResponse } from '@/types';

/**
 * POST /api/v1/jobs/{job_id}/complete — pure rules, no React, no network.
 *
 * WHAT THE LIVE OPENAPI ACTUALLY SAYS (read from openapi.json, not inferred from the
 * Swagger UI):
 *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
 *   - exactly ONE parameter: the required integer path `job_id`
 *   - **NO `requestBody` key at all** — no body is sent, and nothing (`completed_at`,
 *     a rating, a review, …) is invented here
 *   - its ONLY documented responses are 200 (**the JobResponse DIRECTLY** — there is
 *     no `{ message, job }` envelope here) and 422 (HTTPValidationError)
 *   - VERIFIED LIVE (no token): POST → 401 {"detail":"Not authenticated"}; GET/PUT on
 *     the same path → 405, so POST is the registered method
 *   - the operation carries NO description, and 0 of the 35 JobResponse properties
 *     carry one, so nothing about the role, the completable state or the resulting
 *     status can be read off the schema — see below for the evidence that IS used.
 *
 * WHICH ROLE COMPLETES A JOB — answered from the app's OWN designed flow, not a guess.
 * `app/job/[id]/track.tsx` (the in-progress job screen) gates its actions by role and
 * makes marking done the PROVIDER's action:
 *
 *     {isProvider && status === 'task_assigned' && → "I've Arrived"}
 *     {isProvider && status === 'arrived'      && → start job}
 *     {isProvider && status === 'in_progress'  && → "Mark as Done"}   ← this action
 *     {!isProvider && status === 'completed'   && → review}
 *
 * and its own confirmation copy says so outright: "This cannot be undone. The CLIENT
 * will be notified and asked to review the completed job." So the provider finishes
 * the work and the client's only post-completion step is the review. The API agrees
 * structurally: every genuinely two-sided action is split per role (pause-by-client /
 * pause-by-provider, decline-by-client / decline-by-provider, cancel vs
 * provider-cancel) — `complete` is not split because it is not a client action. So the
 * action is rendered for `activeRole === 'PROVIDER'` only.
 *
 * THE COMPLETABLE STATE IS THE BACKEND'S OWN STATUS. There is no `can_complete_job`
 * flag on JobResponse (it exposes only is_editable, is_cancellable, can_restart_timer,
 * can_convert_to_regular and can_convert_to_urgent), so the gate is the state the task
 * describes — "only after the job has been started / is in progress". In the backend's
 * own JobStatus enum the value produced by POST /jobs/{job_id}/start and never left
 * until the job ends is exactly one:
 *
 *     … → PAYMENT_PENDING → PROVIDER_ASSIGNED → IN_PROGRESS → COMPLETED → …
 *
 * `IN_PROGRESS` sits after `PROVIDER_ASSIGNED` (so it was started) and before
 * `COMPLETED` (so it is not already finished) — the one status that satisfies the
 * rule, and the same enum-order reasoning that gated Start Job one step earlier. An
 * already-completed job has left this status, so the action disappears by itself; a
 * cancelled or paused job is refused by its own check as well.
 *
 * WHAT HAPPENS AFTER COMPLETION IS NOT READ, IT IS ADOPTED: the 200 body carries
 * `completed_at`, `status`, `status_history` and `milestones`, so the screen shows
 * whatever the backend set rather than assuming `COMPLETED`. The rating/review and any
 * payment release are separate tasks — the mock review screen
 * (`app/job/[id]/review.tsx`) is untouched here.
 */

/** Re-export so callers have one import for the whole action. */
export { isValidJobId };

/**
 * The one lifecycle status that means "started, not finished yet". An already-completed
 * job has left this status, which is why the action needs no separate "already
 * completed" rule — but the cancelled/completed checks below still guard the edge
 * cases where those fields are set without a status change.
 */
export const COMPLETABLE_JOB_STATUS: JobApiStatus = 'IN_PROGRESS';

/** Whether the job currently sits in the completable status. */
export function isCompletableStatus(
  job: Pick<JobResponse, 'status'> | null | undefined
): boolean {
  return job?.status === COMPLETABLE_JOB_STATUS;
}

/** Re-exported: the role rule lives with the start action so both gates agree. */
export { isProviderRole };

/**
 * Whether the job is in a completable state, ignoring WHO is looking at it: the status
 * must be IN_PROGRESS, a real provider must be assigned, and the job must not be
 * cancelled or completed (the guard that catches a `completed_at` set by some other
 * path while the status still reads IN_PROGRESS).
 */
export function isJobInCompletableState(
  job:
    | Pick<JobResponse, 'status' | 'assigned_provider_id' | 'cancelled_at' | 'completed_at'>
    | null
    | undefined
): boolean {
  if (!job) return false;
  if (!isCompletableStatus(job)) return false;
  if (assignedProviderId(job) === null) return false;
  if (isJobCancelled(job)) return false;
  if (isJobCompleted(job)) return false;
  return true;
}

/**
 * Whether the "Complete Job" action may be OFFERED: the provider role AND a job in
 * progress. Both halves are required together so there is a single authority for the
 * gate and no screen can accidentally render it for the client.
 */
export function canCompleteJob(
  job:
    | Pick<JobResponse, 'status' | 'assigned_provider_id' | 'cancelled_at' | 'completed_at'>
    | null
    | undefined,
  role: JobActorRole | null | undefined
): boolean {
  if (!isProviderRole(role)) return false;
  return isJobInCompletableState(job);
}

/**
 * True for the buckets that mean "the server refused because the job can no longer be
 * completed" (already completed, never started, paused, …) — these get their own copy
 * instead of a generic error.
 */
export function isCompleteNotAllowed(kind: JobActionFailureKind): boolean {
  return kind === 'badrequest' || kind === 'conflict';
}

/**
 * Whether the screen should re-read the job after a failure.
 *
 * A refusal means the state this screen gated on is stale — that is WHY the backend
 * said no (most likely it was already completed) — so the cached job is re-synced. A
 * 422 stays out on purpose (the path id itself was rejected, so re-reading changes
 * nothing) and so do 5xx failures.
 *
 * NETWORK failures are handled separately by the caller: see completeResolvedAfterResync.
 */
export function shouldResyncAfterCompleteFailure(kind: JobActionFailureKind): boolean {
  return isCompleteNotAllowed(kind) || isJobActionRefused(kind);
}

/**
 * Whether a network failure was in fact already carried out by the server.
 *
 * A request that never produced a response may still have been processed (the reply
 * was lost on the way back). Completing twice is exactly what the backend is likely to
 * reject, so a blind retry is the wrong move: the caller re-reads the job first and,
 * if it has left the completable state, says the job has already moved on instead of
 * offering "Retry". `refetched` is null when the re-read itself failed, in which case
 * nothing is claimed and the normal network error + retry path applies.
 */
export function completeResolvedAfterResync(
  refetched:
    | Pick<JobResponse, 'status' | 'assigned_provider_id' | 'cancelled_at' | 'completed_at'>
    | null
    | undefined
): boolean {
  if (!refetched) return false;
  return !isJobInCompletableState(refetched);
}

/** A 401 that survived the shared client's refresh + single replay → login. */
export { isJobActionUnauthorized as isCompleteUnauthorized };

export type CompleteJobErrorKey =
  | 'jobd_complete_err_invalid'
  | 'jobd_complete_err_notallowed'
  | 'jobd_complete_err_forbidden'
  | 'jobd_complete_err_notfound'
  | 'jobd_complete_err_server'
  | 'jobd_complete_err_network';

/**
 * Translated copy per bucket. 400 and 409 share the "can no longer be completed" copy;
 * `unauthorized` is absent because it never reaches the UI (the caller sends the user
 * to login, the same rule the other job actions use).
 */
export function completeJobErrorKey(kind: JobActionFailureKind): CompleteJobErrorKey {
  switch (kind) {
    case 'invalid':
      return 'jobd_complete_err_invalid';
    case 'badrequest':
    case 'conflict':
      return 'jobd_complete_err_notallowed';
    case 'forbidden':
      return 'jobd_complete_err_forbidden';
    case 'notfound':
      return 'jobd_complete_err_notfound';
    case 'network':
      return 'jobd_complete_err_network';
    default:
      return 'jobd_complete_err_server';
  }
}

/**
 * The body copy for a failure: the backend's own message when it sent one (a 422
 * `detail[].msg`, or a plain-string `detail`), otherwise the translated copy for the
 * bucket — so a specific reason reaches the provider as the server worded it.
 */
export function completeJobFailureMessage(
  failure: { kind: JobActionFailureKind; message: string | null },
  translate: (key: CompleteJobErrorKey) => string
): string {
  return failure.message ?? translate(completeJobErrorKey(failure.kind));
}

/** Bucket a rejected completion request (delegates to the shared core). */
export { classifyJobActionFailure as classifyCompleteJobFailure };
