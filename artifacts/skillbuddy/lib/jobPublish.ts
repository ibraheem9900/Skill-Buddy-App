import { firstErrorMessage } from '@/lib/jobList';

/**
 * POST /api/v1/jobs/{job_id}/publish — pure rules, no React, no network.
 *
 * Verified against the live OpenAPI: the operation has ONE required integer
 * path parameter and NO requestBody, and its documented responses are 200
 * (the FULL JobResponse, the same schema createJob returns) and 422.
 * Everything else in here is deliberately generic: the docs say NOTHING about
 * 400 / 401 / 403 / 404 / 409, so we never invent a meaning for them — we only
 * group them into user-facing buckets and pass the server's own `detail`
 * string through when the backend sends one.
 */

/**
 * A publishable id must be a real integer >= 1. Anything else (NaN, a float,
 * a string, 0, a negative) would build a malformed URL path, so it is refused
 * before a request is ever made.
 */
export function isValidJobId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * The Publish action is offered for DRAFT jobs ONLY — publishing opens bidding
 * and must never be run against a job that is already out there. `status` is
 * the value from the REAL server response, never an assumed placeholder.
 */
export function isDraftJob(job: { status?: string | null } | null | undefined): boolean {
  return job?.status === 'DRAFT';
}

export type PublishFailureKind =
  /** 422 — the documented validation error. */
  | 'invalid'
  /** 400 — undocumented; handled generically. */
  | 'badrequest'
  /** 401 that survived the shared client's refresh + single replay. */
  | 'unauthorized'
  /** 403 — undocumented; handled generically. */
  | 'forbidden'
  /** 404 — undocumented; handled generically. */
  | 'notfound'
  /** 409 — undocumented; handled generically (e.g. already published). */
  | 'conflict'
  /** 5xx. */
  | 'server'
  /** No response at all: offline, DNS, timeout. */
  | 'network'
  /** Anything else. */
  | 'unknown';

export interface PublishFailure {
  kind: PublishFailureKind;
  /**
   * The backend's own readable text (422 `detail[].msg`, or a plain-string
   * `detail`), when it sent one. `null` when there is nothing usable — the UI
   * then falls back to its translated message for `kind`.
   */
  message: string | null;
}

/**
 * Bucket a rejected publish request. Never throws: a malformed error object
 * degrades to the generic bucket rather than crashing the screen.
 */
export function classifyPublishFailure(err: unknown): PublishFailure {
  const anyErr = err as { response?: { status?: number; data?: unknown } } | null | undefined;
  const status = anyErr?.response?.status;
  const message = firstErrorMessage(anyErr?.response?.data);

  if (typeof status !== 'number') return { kind: 'network', message };
  if (status === 422) return { kind: 'invalid', message };
  if (status === 400) return { kind: 'badrequest', message };
  if (status === 401) return { kind: 'unauthorized', message };
  if (status === 403) return { kind: 'forbidden', message };
  if (status === 404) return { kind: 'notfound', message };
  if (status === 409) return { kind: 'conflict', message };
  if (status >= 500) return { kind: 'server', message };
  return { kind: 'unknown', message };
}

/** Translated copy for each bucket. `unauthorized` never reaches the UI. */
export type PublishErrorKey =
  | 'pub_err_invalid'
  | 'pub_err_badrequest'
  | 'pub_err_forbidden'
  | 'pub_err_notfound'
  | 'pub_err_conflict'
  | 'pub_err_server'
  | 'pub_err_network';

export function publishErrorKey(kind: PublishFailureKind): PublishErrorKey {
  switch (kind) {
    case 'invalid':
      return 'pub_err_invalid';
    case 'badrequest':
      return 'pub_err_badrequest';
    case 'forbidden':
      return 'pub_err_forbidden';
    case 'notfound':
      return 'pub_err_notfound';
    case 'conflict':
      return 'pub_err_conflict';
    case 'network':
      return 'pub_err_network';
    default:
      return 'pub_err_server';
  }
}
