import { firstErrorMessage } from '@/lib/jobList';

/**
 * Shared core for the job ACTION endpoints (schema JobActionResponse).
 *
 * The Jobs group has four of these and they are all the same shape — a protected,
 * BODY-LESS POST that returns `{ message, job }`:
 *
 *   POST /api/v1/jobs/{job_id}/convert-to-regular   (this task)
 *   POST /api/v1/jobs/{job_id}/restart-timer
 *   POST /api/v1/jobs/{job_id}/convert-to-urgent
 *   (cancel)
 *
 * Verified against the live OpenAPI spec: each declares
 * `security: [{OAuth2PasswordBearer: []}]`, exactly one required integer path
 * parameter, NO `requestBody` at all, and only 200 (JobActionResponse) and 422
 * (HTTPValidationError) as documented responses. The spec says NOTHING about
 * 400/403/404/409 for any of them — so this module never invents a meaning for
 * those; it groups them into honest buckets and always prefers the backend's own
 * readable `detail` text when it sends one.
 *
 * This exists so each action does not carry its own copy of the same
 * status → bucket switch. Action-specific wording and any extra bucket (e.g. the
 * restart limit) stay in that action's own module.
 */

export type JobActionFailureKind =
  /** 422 — the only documented failure. */
  | 'invalid'
  /** 400 — undocumented; handled generically. */
  | 'badrequest'
  /** 401 that survived the shared client's refresh + single replay. */
  | 'unauthorized'
  /** 409 — undocumented state conflict (the action is not allowed in this state). */
  | 'conflict'
  /** 403 — undocumented; handled generically. */
  | 'forbidden'
  /** 404 — undocumented; handled generically. */
  | 'notfound'
  /** 5xx. */
  | 'server'
  /** No response at all: offline, DNS, timeout. */
  | 'network'
  /** Anything else. */
  | 'unknown';

export interface JobActionFailure {
  kind: JobActionFailureKind;
  /**
   * The backend's own readable text (422 `detail[].msg`, or a plain-string
   * `detail`), when it sent one. `null` when there is nothing usable — the UI
   * then falls back to its translated copy. This always takes precedence over the
   * app's own wording, so an undocumented message reaches the user verbatim.
   */
  message: string | null;
}

/**
 * Bucket a rejected job-action request. Never throws: a malformed error object
 * degrades to the generic bucket rather than crashing the screen.
 */
export function classifyJobActionFailure(err: unknown): JobActionFailure {
  const anyErr = err as { response?: { status?: number; data?: unknown } } | null | undefined;
  const status = anyErr?.response?.status;
  const message = firstErrorMessage(anyErr?.response?.data);

  if (typeof status !== 'number') return { kind: 'network', message };
  if (status === 422) return { kind: 'invalid', message };
  if (status === 400) return { kind: 'badrequest', message };
  if (status === 401) return { kind: 'unauthorized', message };
  if (status === 409) return { kind: 'conflict', message };
  if (status === 403) return { kind: 'forbidden', message };
  if (status === 404) return { kind: 'notfound', message };
  if (status >= 500) return { kind: 'server', message };
  return { kind: 'unknown', message };
}

/**
 * True for the buckets that mean "the server refused because of the job's current
 * state" rather than a transport problem. A screen that hits one of these should
 * re-read the job: the flags it was gating on (is_editable, can_convert_to_*,
 * can_restart_timer, is_bidding_open …) are stale, which is exactly why the
 * backend said no.
 */
export function isJobActionRefused(kind: JobActionFailureKind): boolean {
  return kind === 'conflict' || kind === 'forbidden' || kind === 'notfound';
}

/** True when the user must be sent to login instead of shown an error. */
export function isJobActionUnauthorized(kind: JobActionFailureKind): boolean {
  return kind === 'unauthorized';
}
