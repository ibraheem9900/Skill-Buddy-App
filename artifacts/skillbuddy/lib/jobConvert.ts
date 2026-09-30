import {
  classifyJobActionFailure,
  isJobActionRefused,
  isJobActionUnauthorized,
  type JobActionFailureKind,
} from '@/lib/jobAction';
import { isValidJobId } from '@/lib/jobPublish';
import type { JobResponse } from '@/types';

/**
 * The two CONVERT endpoints — pure rules, no React, no network:
 *
 *   POST /api/v1/jobs/{job_id}/convert-to-regular   (URGENT → REGULAR)
 *   POST /api/v1/jobs/{job_id}/convert-to-urgent    (REGULAR → URGENT)
 *
 * They are exact siblings, so they live together: the same contract, the same
 * gating shape (a backend-owned `can_convert_to_*` flag plus "the job must not
 * already be in the target state"), the same failure buckets and the same
 * "the backend's own message wins" rule. Only the flag and the copy keys differ.
 *
 * WHAT THE LIVE OPENAPI ACTUALLY SAYS (read from openapi.json, not inferred from
 * the Swagger UI) — identically for EACH of the two operations:
 *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
 *   - exactly ONE parameter: the required integer path `job_id`
 *   - **NO `requestBody` key at all** — so the request is sent with no body
 *   - its ONLY documented responses are 200 (schema JobActionResponse =
 *     `{ message: string, job: JobResponse }`) and 422 (HTTPValidationError)
 *   - VERIFIED LIVE (no token): POST → 401 {"detail":"Not authenticated"}, while
 *     GET/PUT on the same path → 405, so POST is the registered method
 *
 * The 200 `job` is the COMPLETE job object (the same JobResponse that GET
 * /jobs/{job_id} returns, with its `address` embedded — so no extra address call
 * is needed), so callers replace their cached job with it rather than patching
 * `is_urgent` / `request_type` locally. That is what keeps is_bidding_open,
 * can_restart_timer, can_convert_to_regular/urgent, remaining_bidding_seconds and
 * the bidding window in sync with the backend.
 *
 * NOT DOCUMENTED ANYWHERE (reported, not guessed): the spec says nothing about how
 * a conversion affects bidding timing, fees or `expected_hours` — in either
 * direction. This module therefore hard-codes NO urgency → window rule: after a
 * conversion the screen re-renders the timer and terms from the response's own
 * `bidding_ends_at`, `remaining_bidding_seconds`, `expected_hours` and
 * `request_type`, so whatever the backend's rule turns out to be is reflected
 * without a client-side copy of it.
 */

/** Re-export so callers have one import for the whole action. */
export { isValidJobId };

/**
 * Whether the job is currently urgent, by the two fields the backend exposes.
 *
 * `request_type` is the enum and `is_urgent` the derived boolean; they are
 * expected to agree. Either one reporting urgent is enough, so a lagging field can
 * never hide the job's urgency from the user.
 */
export function isUrgentJob(
  job: Pick<JobResponse, 'is_urgent' | 'request_type'> | null | undefined
): boolean {
  if (!job) return false;
  return job.is_urgent === true || job.request_type === 'URGENT';
}

/**
 * Whether the job is currently regular — the exact complement of isUrgentJob, so
 * the two can never both be true (or both be false) for the same payload.
 */
export function isRegularJob(
  job: Pick<JobResponse, 'is_urgent' | 'request_type'> | null | undefined
): boolean {
  return !isUrgentJob(job);
}

/**
 * Whether the "Convert to Regular" action may be OFFERED.
 *
 * The backend's OWN flag decides: it is the thing that knows about assignment,
 * progress and the eligible window, and this app never re-derives that. On top of
 * it the job must still actually be urgent — an action that converts an
 * already-regular job is nonsense, and the task is explicit that it must not be
 * offered for one. (That conjunction only ever HIDES the action when the two
 * signals disagree; it never shows one the flag forbids.)
 */
export function canConvertJobToRegular(
  job:
    | (Pick<JobResponse, 'can_convert_to_regular'> &
        Partial<Pick<JobResponse, 'is_urgent' | 'request_type'>>)
    | null
    | undefined
): boolean {
  if (!job) return false;
  if (job.can_convert_to_regular !== true) return false;
  return isUrgentJob(job as Pick<JobResponse, 'is_urgent' | 'request_type'>);
}

/**
 * Whether the "Convert to Urgent" action may be OFFERED — the mirror image.
 *
 * Same rule, other flag: the backend's `can_convert_to_urgent` decides, and the
 * job must still be regular, so the action is never offered on a job that is
 * already urgent (or on one the backend has stopped allowing this transition for,
 * e.g. once a provider is assigned).
 */
export function canConvertJobToUrgent(
  job:
    | (Pick<JobResponse, 'can_convert_to_urgent'> &
        Partial<Pick<JobResponse, 'is_urgent' | 'request_type'>>)
    | null
    | undefined
): boolean {
  if (!job) return false;
  if (job.can_convert_to_urgent !== true) return false;
  return isRegularJob(job as Pick<JobResponse, 'is_urgent' | 'request_type'>);
}

/**
 * True for the buckets that mean "the server refused because of the job's current
 * state" — the conversion is not allowed any more (already assigned/in progress,
 * past the window, or simply not convertible). These get their own copy instead of
 * a generic error. Applies to BOTH directions.
 */
export function isConvertNotAllowed(kind: JobActionFailureKind): boolean {
  return kind === 'badrequest' || kind === 'conflict';
}

/**
 * Whether the screen should re-read the job after a failure. Applies to BOTH
 * directions.
 *
 * Every refusal means the flags this screen gates on are stale — that is WHY the
 * backend said no — so the cached job is re-synced. A 422 is left out on purpose
 * (the id itself was rejected, so re-reading it changes nothing), and so are
 * network/5xx failures (the cached job is not known to be stale).
 */
export function shouldResyncAfterConvertFailure(kind: JobActionFailureKind): boolean {
  return isConvertNotAllowed(kind) || isJobActionRefused(kind);
}

/** A 401 that survived the shared client's refresh + single replay → login. */
export { isJobActionUnauthorized as isConvertUnauthorized };

/**
 * The wording a bucket needs, independent of direction — one switch, then a
 * per-direction key table, so the two directions cannot drift apart in behaviour.
 *
 * 400 and 409 share the "not allowed any more" copy; `unauthorized` is absent
 * because it never reaches the UI (the caller sends the user to login, the same
 * rule the other job actions use).
 */
type ConvertErrorSlot = 'invalid' | 'notallowed' | 'forbidden' | 'notfound' | 'server' | 'network';

function convertErrorSlot(kind: JobActionFailureKind): ConvertErrorSlot {
  switch (kind) {
    case 'invalid':
      return 'invalid';
    case 'badrequest':
    case 'conflict':
      return 'notallowed';
    case 'forbidden':
      return 'forbidden';
    case 'notfound':
      return 'notfound';
    case 'network':
      return 'network';
    default:
      return 'server';
  }
}

export type ConvertToRegularErrorKey =
  | 'jobd_convert_err_invalid'
  | 'jobd_convert_err_notallowed'
  | 'jobd_convert_err_forbidden'
  | 'jobd_convert_err_notfound'
  | 'jobd_convert_err_server'
  | 'jobd_convert_err_network';

const TO_REGULAR_ERROR_KEYS: Record<ConvertErrorSlot, ConvertToRegularErrorKey> = {
  invalid: 'jobd_convert_err_invalid',
  notallowed: 'jobd_convert_err_notallowed',
  forbidden: 'jobd_convert_err_forbidden',
  notfound: 'jobd_convert_err_notfound',
  server: 'jobd_convert_err_server',
  network: 'jobd_convert_err_network',
};

export function convertToRegularErrorKey(
  kind: JobActionFailureKind
): ConvertToRegularErrorKey {
  return TO_REGULAR_ERROR_KEYS[convertErrorSlot(kind)];
}

/**
 * The body copy for a failure: the backend's own message when it sent one
 * (including the 422 `detail[].msg`), otherwise the translated copy for the
 * bucket. Keeps the "server text wins" rule in one testable place.
 */
export function convertToRegularFailureMessage(
  failure: { kind: JobActionFailureKind; message: string | null },
  translate: (key: ConvertToRegularErrorKey) => string
): string {
  return failure.message ?? translate(convertToRegularErrorKey(failure.kind));
}

export type ConvertToUrgentErrorKey =
  | 'jobd_urgent_err_invalid'
  | 'jobd_urgent_err_notallowed'
  | 'jobd_urgent_err_forbidden'
  | 'jobd_urgent_err_notfound'
  | 'jobd_urgent_err_server'
  | 'jobd_urgent_err_network';

const TO_URGENT_ERROR_KEYS: Record<ConvertErrorSlot, ConvertToUrgentErrorKey> = {
  invalid: 'jobd_urgent_err_invalid',
  notallowed: 'jobd_urgent_err_notallowed',
  forbidden: 'jobd_urgent_err_forbidden',
  notfound: 'jobd_urgent_err_notfound',
  server: 'jobd_urgent_err_server',
  network: 'jobd_urgent_err_network',
};

export function convertToUrgentErrorKey(kind: JobActionFailureKind): ConvertToUrgentErrorKey {
  return TO_URGENT_ERROR_KEYS[convertErrorSlot(kind)];
}

/** The mirror of convertToRegularFailureMessage. */
export function convertToUrgentFailureMessage(
  failure: { kind: JobActionFailureKind; message: string | null },
  translate: (key: ConvertToUrgentErrorKey) => string
): string {
  return failure.message ?? translate(convertToUrgentErrorKey(failure.kind));
}

/** Bucket a rejected conversion request (delegates to the shared core). */
export { classifyJobActionFailure as classifyConvertToRegularFailure };

/**
 * The same classifier for the urgent direction — the buckets are direction-agnostic
 * (they are decided by the HTTP status), so this is purely a readable alias.
 */
export { classifyJobActionFailure as classifyConvertToUrgentFailure };
