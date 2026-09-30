import {
  classifyJobActionFailure,
  isJobActionRefused,
  isJobActionUnauthorized,
  type JobActionFailureKind,
} from '@/lib/jobAction';
import { isJobCancelledStatus, isJobCompleted } from '@/lib/jobDetail';
import { isValidJobId } from '@/lib/jobPublish';
import { assignedProviderId } from '@/lib/jobStart';
import type { JobApiStatus, JobDetailsRequest, JobResponse, ValidationErrorDetail } from '@/types';

/**
 * POST /api/v1/jobs/{job_id}/blocker — pure rules, no React, no network.
 *
 * Swagger title: "Report Blocker". Either party to an active job describes what is
 * stopping it from proceeding.
 *
 * WHAT THE LIVE OPENAPI ACTUALLY SAYS (read from openapi.json, not inferred from the
 * Swagger UI):
 *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
 *   - exactly ONE parameter: the required integer path `job_id`
 *   - a **REQUIRED `application/json` request body** (schema JobDetailsRequest) whose
 *     single property is `details` — REQUIRED, `type: string`, `minLength: 3`,
 *     `maxLength: 1000`, and **NO enum**. That schema's own description reads "Body for
 *     IN_PROGRESS actions that require an explanation: decline, pause, or reporting a
 *     blocker", which is where this action's name comes from. The field is `details`
 *     (one string), NOT `reason`/`notes`.
 *   - its 200 is the **JobResponse DIRECTLY** (no `{ message, job }` envelope and no
 *     `message` field), and 422 is HTTPValidationError.
 *   - the operation declares NO description, and 0 of the 35 JobResponse properties
 *     carry one — so NOTHING about the server-side effect is asserted here. See below.
 *   - VERIFIED LIVE (no token): POST → 401 {"detail":"Not authenticated"}; GET on the
 *     same path → 405, so POST is the registered method.
 *
 * BOTH ROLES MAY REPORT — this is the One action in the set that is NOT split per role
 * (the API pairs every genuinely two-sided action: cancel vs provider-cancel,
 * decline-by-client vs decline-by-provider, pause-by-client vs pause-by-provider — but
 * ships a single `/blocker`). So this gate deliberately takes NO role: whoever is
 * looking at an active job may report what is blocking it, and the backend authorises
 * the real party.
 *
 * THE GATE IS THE JOB'S OWN STATE, NOT A GUESS. JobResponse exposes no blocker flag, so
 * the offer is derived from what the backend DOES return: the job must still be in an
 * ACTIVE window — `PROVIDER_ASSIGNED` (assigned, work not begun) or `IN_PROGRESS`
 * (work under way) — with a real `assigned_provider_id`, and not cancelled or completed.
 * A job still open for bidding is out (nobody is blocked yet), and a `BLOCKED` job is
 * out too, so the same blocker cannot be re-reported in a loop.
 *
 * WHAT HAPPENS SERVER-SIDE IS ADOPTED, NOT ASSUMED. The 200 is the authoritative job and
 * the screen replaces its cached copy with it, so whatever the backend changed — status,
 * `status_history`, flags — is rendered from the response. The `JobStatus` enum does
 * contain `BLOCKED`, which is the expected outcome, but the UI never asserts it and
 * never names it: the status chip renders whatever the response carries. The
 * explanation a user typed surfaces in `status_history[].note` (schema
 * JobStatusHistoryResponse: id, status, note, changed_by, created_at) — again, rendered
 * only if the backend returns it.
 *
 * NO "SEE YOUR BLOCKERS" UI: there is no blockers collection endpoint anywhere in the
 * API (no GET /jobs/{id}/blockers), so the app cannot list reported blockers. The
 * success copy therefore states only that the report was sent — it makes no claim about
 * who can see it or what happens next, because the contract does not say.
 */

/** Re-export so callers have one import for the whole action. */
export { isValidJobId };

/** Mirrors `JobDetailsRequest.details`: `minLength: 3`. */
export const BLOCKER_DETAILS_MIN_LENGTH = 3;
/** Mirrors `JobDetailsRequest.details`: `maxLength: 1000`. */
export const BLOCKER_DETAILS_MAX_LENGTH = 1000;

export type BlockerDetailsErrorKey =
  | 'jobd_blocker_err_details_required'
  | 'jobd_blocker_err_details_short'
  | 'jobd_blocker_err_details_long';

/**
 * Validate the typed details against the contract's own 3–1000 rule.
 * Returns `null` when the value is acceptable, otherwise the copy key to show.
 */
export function validateBlockerDetails(
  details: string | null | undefined
): BlockerDetailsErrorKey | null {
  const length = (details ?? '').trim().length;
  if (length === 0) return 'jobd_blocker_err_details_required';
  if (length < BLOCKER_DETAILS_MIN_LENGTH) return 'jobd_blocker_err_details_short';
  if (length > BLOCKER_DETAILS_MAX_LENGTH) return 'jobd_blocker_err_details_long';
  return null;
}

/**
 * Build the REQUIRED body. The value is trimmed so padding cannot sneak past the
 * minimum. Only called once `validateBlockerDetails` has passed. The exact field name is
 * `details` — never `reason`/`notes`.
 */
export function buildBlockerRequest(details: string): JobDetailsRequest {
  return { details: details.trim() };
}

/**
 * The lifecycle statuses that mean "the job is under way on both sides" — the window
 * where either party may report a blocker: assigned-but-not-started, and in progress. A
 * job still being bid on is excluded (nobody is blocked yet) and so is a `BLOCKED` job
 * (the block is already recorded, so a repeat report is pointless).
 */
export const BLOCKER_REPORTABLE_STATUSES: readonly JobApiStatus[] = [
  'PROVIDER_ASSIGNED',
  'IN_PROGRESS',
] as const;

/** Whether the job currently sits in a blocker-reportable status. */
export function isBlockerReportableStatus(
  job: Pick<JobResponse, 'status'> | null | undefined
): boolean {
  if (!job) return false;
  return BLOCKER_REPORTABLE_STATUSES.includes(job.status);
}

/**
 * Whether the "Report an Issue" action may be OFFERED, for EITHER party: the job must be
 * in an active window, carry a real assigned provider, and be neither cancelled nor
 * completed.
 *
 * Takes NO role on purpose — this is the one action the API does not split per role (see
 * the header). It stays a pure job predicate so both sides share a single authority for
 * the gate.
 */
export function canReportBlocker(
  job:
    | Pick<JobResponse, 'assigned_provider_id' | 'cancelled_at' | 'completed_at' | 'status'>
    | null
    | undefined
): boolean {
  if (!job) return false;
  if (!isBlockerReportableStatus(job)) return false;
  if (assignedProviderId(job) === null) return false;
  if (isJobCancelledStatus(job)) return false;
  if (isJobCompleted(job)) return false;
  return true;
}

/**
 * True for the buckets that mean "the server refused because the job can no longer take
 * a blocker report" — these get their own copy instead of a generic error.
 */
export function isBlockerNotAllowed(kind: JobActionFailureKind): boolean {
  return kind === 'badrequest' || kind === 'conflict';
}

/**
 * Whether the screen should re-read the job after a failure.
 *
 * A refusal means the state this screen gated on is stale — that is WHY the backend said
 * no — so the cached job is re-synced. A 422 stays out on purpose: it normally means the
 * TYPED details were rejected (too short or too long), which re-reading the job cannot
 * fix. Network/5xx failures are not stale-data signals either.
 */
export function shouldResyncAfterBlockerFailure(kind: JobActionFailureKind): boolean {
  return isBlockerNotAllowed(kind) || isJobActionRefused(kind);
}

/**
 * Whether a network failure was in fact already carried out by the server.
 *
 * A request that never produced a response may still have been processed (the reply was
 * lost on the way back). The caller re-reads the job first and, when the backend has
 * already moved it out of the active window (e.g. to `BLOCKED`), reports that instead of
 * offering "Retry" — so nobody is asked to file the same blocker twice. `refetched` is
 * null when the re-read itself failed, in which case nothing is claimed and the normal
 * network error + retry path applies (the typed details are preserved either way).
 */
export function blockerResolvedAfterResync(
  refetched:
    | Pick<JobResponse, 'assigned_provider_id' | 'cancelled_at' | 'completed_at' | 'status'>
    | null
    | undefined
): boolean {
  if (!refetched) return false;
  return !canReportBlocker(refetched);
}

/** A 401 that survived the shared client's refresh + single replay → login. */
export { isJobActionUnauthorized as isBlockerUnauthorized };

export type BlockerErrorKey =
  | 'jobd_blocker_err_invalid'
  | 'jobd_blocker_err_notallowed'
  | 'jobd_blocker_err_forbidden'
  | 'jobd_blocker_err_notfound'
  | 'jobd_blocker_err_server'
  | 'jobd_blocker_err_network';

/**
 * Translated copy per bucket. 400 and 409 share the "can no longer report" copy;
 * `unauthorized` is absent because it never reaches the UI (the caller sends the user to
 * login, the same rule the other job actions use).
 */
export function blockerErrorKey(kind: JobActionFailureKind): BlockerErrorKey {
  switch (kind) {
    case 'invalid':
      return 'jobd_blocker_err_invalid';
    case 'badrequest':
    case 'conflict':
      return 'jobd_blocker_err_notallowed';
    case 'forbidden':
      return 'jobd_blocker_err_forbidden';
    case 'notfound':
      return 'jobd_blocker_err_notfound';
    case 'network':
      return 'jobd_blocker_err_network';
    default:
      return 'jobd_blocker_err_server';
  }
}

/**
 * The body copy for a failure: the backend's own message when it sent one (a 422
 * `detail[].msg`, or a plain-string `detail`), otherwise the translated copy for the
 * bucket — so the server's exact reason for refusing reaches the user as worded.
 */
export function blockerFailureMessage(
  failure: { kind: JobActionFailureKind; message: string | null },
  translate: (key: BlockerErrorKey) => string
): string {
  return failure.message ?? translate(blockerErrorKey(failure.kind));
}

/**
 * Pull the server's message for the `details` field out of a 422 `detail[]`, so a
 * rejected explanation is shown ON the input instead of as a generic failure.
 *
 * NOTE: the request field is `details` (plural) while the error array key is `detail`
 * (singular) — the two are deliberately not mixed up here.
 */
export function blockerDetailsFieldError(
  detail: ValidationErrorDetail[] | null | undefined
): string | null {
  if (!Array.isArray(detail)) return null;
  for (const entry of detail) {
    if (!entry || !Array.isArray(entry.loc)) continue;
    if (entry.loc.some((part) => part === 'details') && entry.msg) return entry.msg;
  }
  return null;
}

/** Bucket a rejected blocker report (delegates to the shared core). */
export { classifyJobActionFailure as classifyBlockerJobFailure };
