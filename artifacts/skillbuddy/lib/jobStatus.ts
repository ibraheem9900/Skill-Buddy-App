/**
 * jobStatus.ts — THE status resolver for every job surface.
 *
 * The backend's `status` field alone is not enough to describe a job: a job can
 * still arrive as OPEN (and is_bidding_open: true) after its bidding window has
 * ended, especially on list endpoints. Rendering that raw value made the Jobs
 * list and Job Details say "Accepting Bids" while Place Your Bid correctly said
 * "Bidding is closed".
 *
 * This module is the single place that combines:
 *   • the backend status (all 14 JobApiStatus values),
 *   • the bidding deadline (absolute timestamp, remaining seconds, or
 *     created_at + the product's 30/180-minute window),
 *   • an assigned provider,
 *   • the correct clock (server time when the API Date header is known),
 * and returns ONE display status plus whether bidding is open.
 *
 * Pure: no React and no axios, so every branch is unit-testable.
 */

import {
  jobStatusLabelKey,
  jobStatusTone,
  type JobStatusLabelKey,
  type JobStatusTone,
} from '@/lib/jobList';
import { parseApiDeadlineMs } from '@/lib/countdown';
import type { JobApiStatus } from '@/types';

/** The product bidding windows. */
export const URGENT_BIDDING_WINDOW_MINUTES = 30;
export const REGULAR_BIDDING_WINDOW_MINUTES = 180;

/** A display status: a real API status, the derived closed state, or unknown. */
export type JobDisplayStatus = JobApiStatus | 'BIDDING_CLOSED' | 'UNKNOWN';

export type JobDisplayLabelKey = JobStatusLabelKey | 'status_bidding_closed' | 'status_unknown';

export interface JobStatusInput {
  status?: string | null;
  is_bidding_open?: boolean | null;
  bidding_ends_at?: string | null;
  remaining_bidding_seconds?: number | null;
  created_at?: string | null;
  request_type?: string | null;
  is_urgent?: boolean | null;
  assigned_provider_id?: number | null;
}

export interface ResolvedJobStatus {
  /** What every chip/title must show. */
  displayStatus: JobDisplayStatus;
  /** Translation key for that display status (always a translated label). */
  labelKey: JobDisplayLabelKey;
  tone: JobStatusTone;
  /** True only when a provider may still submit a bid. */
  biddingOpen: boolean;
  /** Absolute deadline in epoch ms, or null when no countdown should render. */
  deadlineMs: number | null;
  /** False when the value came from the API enum unchanged. */
  derived: boolean;
  /** The raw enum value, retained for diagnostics (never rendered directly). */
  rawStatus: string | null;
}

const warnedUnknown = new Set<string>();

const KNOWN_STATUSES = new Set<string>([
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
  'CLOSED',
  'CANCELLED',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_PROVIDER',
]);

/**
 * The absolute deadline for a bid window, independent of whether the server
 * still calls the job OPEN. Exported because permissions and tests need the
 * same arithmetic.
 */
export function resolveJobDeadlineMs(
  job: JobStatusInput,
  nowMs: number
): number | null {
  if (typeof job.bidding_ends_at === 'string' && job.bidding_ends_at.trim().length > 0) {
    const absolute = parseApiDeadlineMs(job.bidding_ends_at);
    if (absolute !== null) return absolute;
  }

  if (
    typeof job.remaining_bidding_seconds === 'number' &&
    Number.isFinite(job.remaining_bidding_seconds)
  ) {
    return nowMs + job.remaining_bidding_seconds * 1000;
  }

  if (typeof job.created_at === 'string' && job.created_at.trim().length > 0) {
    const created = parseApiDeadlineMs(job.created_at);
    if (created !== null) {
      const minutes =
        job.is_urgent === true || String(job.request_type ?? '').toUpperCase() === 'URGENT'
          ? URGENT_BIDDING_WINDOW_MINUTES
          : REGULAR_BIDDING_WINDOW_MINUTES;
      return created + minutes * 60_000;
    }
  }

  return null;
}

function hasProvider(job: JobStatusInput): boolean {
  return typeof job.assigned_provider_id === 'number' && Number.isFinite(job.assigned_provider_id);
}

/**
 * Resolve ONE job for display. Never returns a raw unknown string.
 *
 * Rules, in order:
 *  1. Unknown/missing status → UNKNOWN (translated), logged once.
 *  2. Not OPEN → that exact status, no countdown.
 *  3. OPEN + assigned provider → PROVIDER_ASSIGNED (bidding is over).
 *  4. OPEN + backend says is_bidding_open:false → BIDDING_CLOSED.
 *  5. OPEN + known deadline at/before now → BIDDING_CLOSED.
 *  6. OPEN otherwise → OPEN with the deadline for a live countdown.
 */
export function resolveJobStatus(
  job: JobStatusInput | null | undefined,
  options: { nowMs?: number } = {}
): ResolvedJobStatus {
  const nowMs = options.nowMs ?? Date.now();
  const raw = typeof job?.status === 'string' ? job.status : null;

  if (!job || !raw || !KNOWN_STATUSES.has(raw)) {
    const key = raw ?? '(missing)';
    if (!warnedUnknown.has(key)) {
      warnedUnknown.add(key);
      // Safe diagnostic only: the enum value, never user data.
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(`[jobStatus] unrecognised job status: ${key}`);
      }
    }
    return {
      displayStatus: 'UNKNOWN',
      labelKey: 'status_unknown',
      tone: 'muted',
      biddingOpen: false,
      deadlineMs: null,
      derived: true,
      rawStatus: raw,
    };
  }

  const status = raw as JobApiStatus;

  if (status !== 'OPEN') {
    return {
      displayStatus: status,
      labelKey: jobStatusLabelKey(status) ?? 'status_unknown',
      tone: jobStatusTone(status),
      biddingOpen: false,
      deadlineMs: null,
      derived: false,
      rawStatus: raw,
    };
  }

  if (hasProvider(job)) {
    return {
      displayStatus: 'PROVIDER_ASSIGNED',
      labelKey: 'status_provider_assigned',
      tone: jobStatusTone('PROVIDER_ASSIGNED'),
      biddingOpen: false,
      deadlineMs: null,
      derived: true,
      rawStatus: raw,
    };
  }

  const deadlineMs = resolveJobDeadlineMs(job, nowMs);
  const explicitlyClosed = job.is_bidding_open === false;
  const expired = deadlineMs !== null && deadlineMs <= nowMs;

  if (explicitlyClosed || expired) {
    return {
      displayStatus: 'BIDDING_CLOSED',
      labelKey: 'status_bidding_closed',
      tone: 'muted',
      biddingOpen: false,
      deadlineMs: null,
      derived: true,
      rawStatus: raw,
    };
  }

  // No deadline is not an open window. Only the backend's own true flag may
  // keep it OPEN, so a partial payload can never offer a bid form by accident.
  if (job.is_bidding_open !== true) {
    return {
      displayStatus: 'BIDDING_CLOSED',
      labelKey: 'status_bidding_closed',
      tone: 'muted',
      biddingOpen: false,
      deadlineMs: null,
      derived: true,
      rawStatus: raw,
    };
  }

  return {
    displayStatus: 'OPEN',
    labelKey: 'status_open',
    tone: jobStatusTone('OPEN'),
    biddingOpen: true,
    deadlineMs,
    derived: false,
    rawStatus: raw,
  };
}

/**
 * Live ticking. Components pass the resolver's `biddingOpen` to this hook; it
 * returns a new server-clock timestamp every second only while a deadline is
 * pending, so the chip and countdown switch without a refetch.
 */
export function nextStatusTickAt(status: ResolvedJobStatus, nowMs: number): number | null {
  if (!status.biddingOpen || status.deadlineMs === null) return null;
  return Math.max(nowMs, status.deadlineMs) + 1;
}
