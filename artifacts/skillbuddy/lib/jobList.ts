/**
 * jobList.ts
 *
 * Pure logic behind the client job list (GET /api/v1/jobs): query-string
 * building, paging/clamping, page merging with de-duplication, and turning the
 * list's bidding fields into a single countdown deadline.
 *
 * No React and no axios here, so each rule is unit-testable without a
 * renderer or a live token.
 */

import type {
  JobApiStatus,
  JobListItem,
  ListJobsParams,
  ValidationErrorDetail,
} from '@/types';

/** Server default and the value the app pages with. */
export const JOBS_PAGE_SIZE = 20;
export const JOBS_LIMIT_MAX = 100;

/** Clamp limit to the documented 1..100 range. */
export function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return JOBS_PAGE_SIZE;
  return Math.min(JOBS_LIMIT_MAX, Math.max(1, Math.trunc(value)));
}

/** Clamp offset to >= 0. */
export function clampOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/**
 * Build the query object for GET /api/v1/jobs.
 *
 * ONLY set values are included: null, undefined, NaN, empty strings and
 * `only_actively_bidding: false` (the server default) are all omitted, so a
 * request never carries a null/empty query parameter. Values are returned as
 * strings because that is what the URL needs; the server parses them back.
 */
export function buildListJobsQuery(
  params?: ListJobsParams | null
): Record<string, string> {
  const query: Record<string, string> = {};
  if (!params) return query;

  const {
    status,
    request_type,
    category_id,
    service_id,
    only_actively_bidding,
    limit,
    offset,
  } = params;

  if (typeof status === 'string' && status.length > 0) query.status = status;
  if (typeof request_type === 'string' && request_type.length > 0) {
    query.request_type = request_type;
  }
  if (typeof category_id === 'number' && Number.isFinite(category_id)) {
    query.category_id = String(category_id);
  }
  if (typeof service_id === 'number' && Number.isFinite(service_id)) {
    query.service_id = String(service_id);
  }
  // true → 'true'; false is the server default, so it is omitted entirely.
  if (only_actively_bidding === true) query.only_actively_bidding = 'true';
  if (typeof limit === 'number' && Number.isFinite(limit)) {
    query.limit = String(clampLimit(limit));
  }
  if (typeof offset === 'number' && Number.isFinite(offset)) {
    query.offset = String(clampOffset(offset));
  }

  return query;
}

/**
 * Append a fetched page to the accumulated list.
 *
 * The endpoint returns a BARE ARRAY with no total count, so "more pages exist"
 * can only be inferred from the page size: a page shorter than `limit` is the
 * last one. Items are de-duplicated by id (a job can shift between requests as
 * data changes, and overlapping pages must never render twice).
 */
export function mergeJobsPage(
  existing: JobListItem[],
  page: JobListItem[],
  limit: number
): { items: JobListItem[]; hasMore: boolean; added: number } {
  const safeLimit = clampLimit(limit);
  const incoming = Array.isArray(page) ? page : [];

  const seen = new Set(existing.map((job) => job.id));
  const fresh = incoming.filter((job) => {
    if (!job || typeof job.id !== 'number') return false;
    if (seen.has(job.id)) return false;
    seen.add(job.id);
    return true;
  });

  return {
    items: [...existing, ...fresh],
    hasMore: incoming.length >= safeLimit,
    added: fresh.length,
  };
}

/**
 * The countdown deadline for a list card, in epoch ms.
 *
 * `bidding_ends_at` is an absolute ISO timestamp and is preferred (it does not
 * drift with fetch latency). `remaining_bidding_seconds` is relative to the
 * moment the server answered, so it is converted against `nowMs` as a
 * fallback. Returns null when neither is usable, so the card renders no timer
 * instead of a fake one.
 */
export function resolveBiddingEndsAt(
  job: Pick<JobListItem, 'bidding_ends_at' | 'remaining_bidding_seconds'> | null | undefined,
  nowMs: number
): number | null {
  if (!job) return null;

  if (typeof job.bidding_ends_at === 'string' && job.bidding_ends_at.length > 0) {
    const parsed = Date.parse(job.bidding_ends_at);
    if (Number.isFinite(parsed)) return parsed;
  }

  if (
    typeof job.remaining_bidding_seconds === 'number' &&
    Number.isFinite(job.remaining_bidding_seconds)
  ) {
    return nowMs + job.remaining_bidding_seconds * 1000;
  }

  return null;
}

/**
 * Parse the list's `expected_hours`, which is a numeric STRING on the wire
 * (nullable). Returns null for anything unusable so the card can hide it.
 */
export function parseExpectedHours(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Human-readable message from an error body, for a 422 or any other failure. */
export function firstErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;

  const detail = (body as { detail?: unknown }).detail;
  // FastAPI validation error: detail is an ARRAY of {loc,msg,...}.
  if (Array.isArray(detail)) {
    for (const item of detail) {
      const msg = (item as ValidationErrorDetail | undefined)?.msg;
      if (typeof msg === 'string' && msg.length > 0) return msg;
    }
    return null;
  }
  // Plain-string detail (e.g. {"detail":"Not authenticated"}).
  if (typeof detail === 'string' && detail.length > 0) return detail;

  return null;
}

/* ── Status enum + labels ──────────────────────────────────────────────────── */

/**
 * The 14 JobStatus values, in the order the live OpenAPI documents them. The
 * status filter offers exactly these — nothing invented, nothing missing.
 */
export const JOB_STATUS_VALUES = [
  'DRAFT',
  'OPEN',
  'PAYMENT_PENDING',
  'PROVIDER_ASSIGNED',
  'IN_PROGRESS',
  'DECLINED_BY_PROVIDER',
  'DECLINED_BY_CLIENT',
  'PAUSED_BY_CLIENT',
  'PAUSED_BY_PROVIDER',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_PROVIDER',
] as const satisfies readonly JobApiStatus[];

/** Translation keys for those statuses — labels are never shown as raw enums. */
export type JobStatusLabelKey =
  | 'status_draft'
  | 'status_open'
  | 'status_payment_pending'
  | 'status_provider_assigned'
  | 'status_in_progress'
  | 'status_declined_by_provider'
  | 'status_declined_by_client'
  | 'status_paused_by_client'
  | 'status_paused_by_provider'
  | 'status_blocked'
  | 'status_completed'
  | 'status_cancelled'
  | 'status_cancelled_by_client'
  | 'status_cancelled_by_provider';

const STATUS_LABEL_KEY: Record<JobApiStatus, JobStatusLabelKey> = {
  DRAFT: 'status_draft',
  OPEN: 'status_open',
  PAYMENT_PENDING: 'status_payment_pending',
  PROVIDER_ASSIGNED: 'status_provider_assigned',
  IN_PROGRESS: 'status_in_progress',
  DECLINED_BY_PROVIDER: 'status_declined_by_provider',
  DECLINED_BY_CLIENT: 'status_declined_by_client',
  PAUSED_BY_CLIENT: 'status_paused_by_client',
  PAUSED_BY_PROVIDER: 'status_paused_by_provider',
  BLOCKED: 'status_blocked',
  COMPLETED: 'status_completed',
  CANCELLED: 'status_cancelled',
  CANCELLED_BY_CLIENT: 'status_cancelled_by_client',
  CANCELLED_BY_PROVIDER: 'status_cancelled_by_provider',
};

/**
 * Label key for a status. Returns null for a value the app does not know, so
 * the UI can omit the chip instead of printing a raw enum string.
 */
export function jobStatusLabelKey(status: string | null | undefined): JobStatusLabelKey | null {
  if (typeof status !== 'string') return null;
  return (STATUS_LABEL_KEY as Record<string, JobStatusLabelKey>)[status] ?? null;
}
