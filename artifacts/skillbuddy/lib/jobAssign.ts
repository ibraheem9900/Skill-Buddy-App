import {
  classifyJobActionFailure,
  isJobActionRefused,
  isJobActionUnauthorized,
  type JobActionFailureKind,
} from '@/lib/jobAction';
import { isJobCancelled, isJobCompleted } from '@/lib/jobDetail';
import { isValidJobId } from '@/lib/jobPublish';
import type { JobAssignProviderRequest, JobResponse } from '@/types';

/**
 * POST /api/v1/jobs/{job_id}/assign-provider — pure rules, no React, no network.
 *
 * WHAT THE LIVE OPENAPI ACTUALLY SAYS (read from openapi.json, not inferred from
 * the Swagger UI):
 *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
 *   - exactly ONE parameter: the required integer path `job_id`
 *   - a **REQUIRED `application/json` request body** (schema
 *     JobAssignProviderRequest) whose only property, `provider_id` (integer), is
 *     itself required — this endpoint is NOT body-less like the other job actions
 *   - its ONLY documented responses are 200 (**the JobResponse DIRECTLY** — there is
 *     no `{ message, job }` envelope here) and 422 (HTTPValidationError)
 *   - VERIFIED LIVE (no token): POST → 401 {"detail":"Not authenticated"} both with
 *     and without a body; GET/PUT/PATCH → 405, so POST is the registered method
 *
 * WHERE provider_id COMES FROM (confirmed from the spec, no invention):
 *   GET /api/v1/jobs/{job_id}/bids → JobBidsResponse =
 *     `{ job_id, recommended: BidResponse[], other_offers: BidResponse[], total_bids }`
 *   described by the spec as "Bids for a job, split the way the client app presents
 *   them: the top 3 scores as 'Recommended SkillBuddies', the rest behind 'View All
 *   Offers'." Every BidResponse carries
 *     `provider` (schema BidProviderSummary) which has an integer `id` —
 *   that is the `provider_id` to send. (The sibling
 *   POST /jobs/{job_id}/bids/{bid_id}/accept is the alternative bid-based route and
 *   is a separate endpoint.) That bids list is NOT connected in this app yet, so
 *   this action only ever fires when a real id is handed to the screen — see
 *   canAssignProvider + the screen's providerId param.
 *
 * ASSIGNMENT IS TREATED AS ONE-TIME (as instructed): there is NO backend flag for
 * assignment (JobResponse exposes is_editable, is_cancellable, can_restart_timer,
 * can_convert_to_regular and can_convert_to_urgent, but nothing like
 * can_assign_provider), so the gate is derived from the job's own state — still
 * open for assignment (bidding open, not cancelled, not completed) and not already
 * assigned. Whether re-assigning an already-assigned job is rejected or allowed to
 * reassign is NOT documented; until the team confirms it, the action is not offered
 * on an assigned job.
 *
 * The 200 body is the COMPLETE job (the same JobResponse GET /jobs/{job_id}
 * returns, with its `address` embedded — no extra address call is needed), so
 * callers replace their cached job with it rather than setting assigned_provider_id
 * locally: status, is_bidding_open, is_editable and the can_* flags all change once
 * a provider is assigned.
 */

/** Re-export so callers have one import for the whole action. */
export { isValidJobId };

/**
 * A real provider id must be a positive integer. Anything else (NaN, a float, a
 * string, 0, a negative) is refused BEFORE a request is made, so a malformed body
 * is never sent and a mock/catalogue id can never be posted to the API.
 */
export function isValidProviderId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * Build the REQUIRED body (schema JobAssignProviderRequest). Only called with a
 * validated id, so the body can never be sent half-formed.
 */
export function buildAssignProviderRequest(providerId: number): JobAssignProviderRequest {
  return { provider_id: providerId };
}

/**
 * The job's assigned provider id, or null when the job is NOT assigned yet.
 *
 * The task's rule: `assigned_provider_id` null/0 both mean "not assigned" (0 is the
 * schema's own placeholder value), so anything that is not a positive integer is
 * treated as unassigned.
 */
export function assignedProviderId(
  job: Pick<JobResponse, 'assigned_provider_id'> | null | undefined
): number | null {
  const id = job?.assigned_provider_id;
  return isValidProviderId(id) ? id : null;
}

/**
 * Whether the job can still receive an assignment: bidding must be OPEN (a DRAFT
 * job that was never published, or one whose window closed, cannot be assigned),
 * and it must not be cancelled or completed.
 */
export function isJobOpenForAssignment(
  job:
    | Pick<JobResponse, 'is_bidding_open' | 'cancelled_at' | 'completed_at'>
    | null
    | undefined
): boolean {
  if (!job) return false;
  if (job.is_bidding_open !== true) return false;
  if (isJobCancelled(job)) return false;
  if (isJobCompleted(job)) return false;
  return true;
}

/**
 * Whether the "Assign Provider" action may be OFFERED for this job.
 *
 * Derived (there is no backend flag for assignment, see the header) and deliberately
 * conservative: open for assignment AND not already assigned. That means an
 * already-assigned job never shows the action, so an undocumented re-assign cannot
 * be triggered by this app before the team confirms the rule.
 */
export function canAssignProvider(
  job:
    | Pick<
        JobResponse,
        'assigned_provider_id' | 'is_bidding_open' | 'cancelled_at' | 'completed_at'
      >
    | null
    | undefined
): boolean {
  if (!job) return false;
  if (assignedProviderId(job) !== null) return false;
  return isJobOpenForAssignment(job);
}

/**
 * True for the buckets that mean "the server refused because of the job's current
 * state" — already assigned, provider ineligible, or the window has moved on. These
 * get their own copy instead of a generic error.
 */
export function isAssignNotAllowed(kind: JobActionFailureKind): boolean {
  return kind === 'badrequest' || kind === 'conflict';
}

/**
 * Whether the screen should re-read the job after a failure.
 *
 * A refusal means the flags this screen gates on are stale — that is WHY the backend
 * said no (most likely it is already assigned) — so the cached job is re-synced. A
 * 422 stays out on purpose: it normally means the body's `provider_id` itself was
 * rejected, and re-reading the job would not fix an invalid provider. Network/5xx
 * failures are clearly not stale-data signals either.
 */
export function shouldResyncAfterAssignFailure(kind: JobActionFailureKind): boolean {
  return isAssignNotAllowed(kind) || isJobActionRefused(kind);
}

/** A 401 that survived the shared client's refresh + single replay → login. */
export { isJobActionUnauthorized as isAssignUnauthorized };

export type AssignProviderErrorKey =
  | 'jobd_assign_err_invalid'
  | 'jobd_assign_err_notallowed'
  | 'jobd_assign_err_forbidden'
  | 'jobd_assign_err_notfound'
  | 'jobd_assign_err_server'
  | 'jobd_assign_err_network';

/**
 * Translated copy per bucket. 400 and 409 share the "can no longer be assigned"
 * copy; `unauthorized` is absent because it never reaches the UI (the caller sends
 * the client to login, the same rule the other job actions use).
 */
export function assignProviderErrorKey(kind: JobActionFailureKind): AssignProviderErrorKey {
  switch (kind) {
    case 'invalid':
      return 'jobd_assign_err_invalid';
    case 'badrequest':
    case 'conflict':
      return 'jobd_assign_err_notallowed';
    case 'forbidden':
      return 'jobd_assign_err_forbidden';
    case 'notfound':
      return 'jobd_assign_err_notfound';
    case 'network':
      return 'jobd_assign_err_network';
    default:
      return 'jobd_assign_err_server';
  }
}

/**
 * The body copy for a failure: the backend's own message when it sent one (a 422
 * `detail[].msg` such as an unknown provider, or a plain-string `detail`), otherwise
 * the translated copy for the bucket — so "invalid provider_id" reaches the client
 * as the server worded it rather than as a generic string.
 */
export function assignProviderFailureMessage(
  failure: { kind: JobActionFailureKind; message: string | null },
  translate: (key: AssignProviderErrorKey) => string
): string {
  return failure.message ?? translate(assignProviderErrorKey(failure.kind));
}

/** Bucket a rejected assignment request (delegates to the shared core). */
export { classifyJobActionFailure as classifyAssignProviderFailure };
