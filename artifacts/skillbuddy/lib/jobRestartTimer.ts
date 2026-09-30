import {
  classifyJobActionFailure,
  type JobActionFailure,
  type JobActionFailureKind,
} from '@/lib/jobAction';
import { isValidJobId } from '@/lib/jobPublish';
import type { JobResponse } from '@/types';

/**
 * POST /api/v1/jobs/{job_id}/restart-timer — pure rules, no React, no network.
 *
 * WHAT THE LIVE OPENAPI ACTUALLY SAYS (verified from openapi.json, not inferred
 * from the Swagger UI):
 *   - the operation declares `security: [{OAuth2PasswordBearer: []}]`
 *   - it declares exactly ONE parameter: the required integer path `job_id`
 *   - it declares **NO `requestBody` at all** — so the request is sent with no body
 *   - its ONLY documented responses are 200 (schema JobActionResponse =
 *     `{ message: string, job: JobResponse }`) and 422 (HTTPValidationError)
 *
 * THE RESTART LIMIT IS NOT DOCUMENTED. `timer_restart_count` and
 * `can_restart_timer` exist on JobResponse and plainly imply a cap, but the spec
 * states no limit value and no error for exceeding it, and no client in this repo
 * (web or mobile) implements it. Because that behaviour CANNOT be confirmed from
 * any available source, it is deliberately NOT invented here:
 *
 *   1. The flag is the mechanism: the action is only rendered while the backend
 *      says `can_restart_timer === true`, so once the cap is reached the backend
 *      flips the flag and the button disappears — no client-side counting.
 *   2. IF the backend instead rejects a restart with a 409, that is surfaced as a
 *      distinct "restart not allowed / limit reached" message rather than a
 *      generic failure. 409 is used because it is the conventional "this action
 *      conflicts with the resource's current state" code — it is an assumption
 *      about an undocumented case, and it is treated only as a *bucket*: the
 *      backend's own readable `detail` message ALWAYS wins over this copy, so
 *      whatever the real code and wording turn out to be, the user still sees the
 *      server's own explanation. No status code is treated as "the limit" silently.
 */

/** Re-export so callers have one import for the whole action. */
export { isValidJobId };

/**
 * Whether the Restart Timer action may be OFFERED.
 *
 * The backend's own flag decides — this app never re-derives it from status,
 * dates or `timer_restart_count`. A missing/non-boolean flag means "not
 * allowed", so an unexpected payload hides the action rather than offering one
 * that cannot work. Delegates to the shared job-detail rule so there is exactly
 * one definition of the flag's meaning.
 */
export function canRestartJobTimer(
  job: Pick<JobResponse, 'can_restart_timer'> | null | undefined
): boolean {
  return !!job && job.can_restart_timer === true;
}

export type RestartTimerFailureKind = JobActionFailureKind | 'limit';

export interface RestartTimerFailure {
  kind: RestartTimerFailureKind;
  /**
   * The backend's own readable text (422 `detail[].msg`, or a plain-string
   * `detail`), when it sent one. `null` when there is nothing usable, in which
   * case the UI falls back to its translated copy for `kind`. This always takes
   * precedence over the app's own wording, so an undocumented message still
   * reaches the user verbatim.
   */
  message: string | null;
}

/**
 * Bucket a rejected restart request. Never throws: a malformed error object
 * degrades to the generic bucket rather than crashing the screen.
 *
 * The status → bucket switch itself lives in lib/jobAction (shared with the other
 * job actions); the only restart-specific step is promoting an undocumented state
 * conflict (409) to the dedicated `limit` bucket, because for this action that is
 * the bucket a reached restart cap would land in.
 */
export function classifyRestartTimerFailure(err: unknown): RestartTimerFailure {
  const failure = classifyJobActionFailure(err);
  if (failure.kind === 'conflict') return { kind: 'limit', message: failure.message };
  return { kind: failure.kind, message: failure.message };
}

/** True for the buckets that mean "this restart is not allowed right now". */
export function isRestartNotAllowed(kind: RestartTimerFailureKind): boolean {
  return kind === 'limit';
}

export type RestartTimerErrorKey =
  | 'jobd_restart_err_invalid'
  | 'jobd_restart_err_badrequest'
  | 'jobd_restart_err_forbidden'
  | 'jobd_restart_err_notfound'
  | 'jobd_restart_err_server'
  | 'jobd_restart_err_network';

/**
 * Translated copy for each failure bucket. `unauthorized` is absent on purpose:
 * it never reaches the UI (the caller sends the user to login, the same rule the
 * other job actions use), and `limit` has its own dedicated copy handled by the
 * screen because it is a different kind of outcome, not just an error string.
 */
export function restartTimerErrorKey(kind: RestartTimerFailureKind): RestartTimerErrorKey {
  switch (kind) {
    case 'invalid':
      return 'jobd_restart_err_invalid';
    case 'badrequest':
      return 'jobd_restart_err_badrequest';
    case 'forbidden':
      return 'jobd_restart_err_forbidden';
    case 'notfound':
      return 'jobd_restart_err_notfound';
    case 'network':
      return 'jobd_restart_err_network';
    default:
      return 'jobd_restart_err_server';
  }
}

/**
 * The body copy for a failure: the backend's own message when it sent one,
 * otherwise the translated copy for the bucket. Keeps the "server text wins"
 * rule in one testable place instead of in the screen.
 */
export function restartTimerFailureMessage(
  failure: RestartTimerFailure,
  translate: (key: RestartTimerErrorKey) => string
): string {
  return failure.message ?? translate(restartTimerErrorKey(failure.kind));
}
