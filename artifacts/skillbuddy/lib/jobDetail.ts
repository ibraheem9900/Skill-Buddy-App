import type { JobResponse, MilestoneStatus } from '@/types';

/**
 * Pure helpers for the Job Details screen (GET /api/v1/jobs/{job_id}).
 *
 * Everything here is read straight from the LIVE OpenAPI schemas — nothing is
 * guessed:
 *   - MilestoneStatus enum: 12 values (schema MilestoneStatus)
 *   - the permission flags are backend-owned booleans (schema JobResponse)
 *   - timestamps are UTC ISO strings (format: date-time) and every one of them
 *     is nullable except created_at / updated_at
 */

/* ------------------------------------------------------------------ *
 * Milestone status — schema MilestoneStatus (12 values, spec order)
 * ------------------------------------------------------------------ */

export const MILESTONE_STATUS_VALUES = [
  'PENDING',
  'IN_PROGRESS',
  'ON_HOLD',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_PROVIDER',
  'DISPUTED_BY_CLIENT',
  'DISPUTED_BY_PROVIDER',
  'PROVIDER_NO_SHOW',
  'CLIENT_NO_SHOW',
] as const satisfies readonly MilestoneStatus[];

export type MilestoneStatusLabelKey =
  | 'mst_pending'
  | 'mst_in_progress'
  | 'mst_on_hold'
  | 'mst_blocked'
  | 'mst_completed'
  | 'mst_cancelled'
  | 'mst_cancelled_by_client'
  | 'mst_cancelled_by_provider'
  | 'mst_disputed_by_client'
  | 'mst_disputed_by_provider'
  | 'mst_provider_no_show'
  | 'mst_client_no_show';

const MILESTONE_STATUS_LABEL_KEY: Record<MilestoneStatus, MilestoneStatusLabelKey> = {
  PENDING: 'mst_pending',
  IN_PROGRESS: 'mst_in_progress',
  ON_HOLD: 'mst_on_hold',
  BLOCKED: 'mst_blocked',
  COMPLETED: 'mst_completed',
  CANCELLED: 'mst_cancelled',
  CANCELLED_BY_CLIENT: 'mst_cancelled_by_client',
  CANCELLED_BY_PROVIDER: 'mst_cancelled_by_provider',
  DISPUTED_BY_CLIENT: 'mst_disputed_by_client',
  DISPUTED_BY_PROVIDER: 'mst_disputed_by_provider',
  PROVIDER_NO_SHOW: 'mst_provider_no_show',
  CLIENT_NO_SHOW: 'mst_client_no_show',
};

/**
 * Label key for a milestone status. Returns null for a value the app does not
 * know, so the badge is omitted rather than printing a raw enum string.
 */
export function milestoneStatusLabelKey(
  status: string | null | undefined
): MilestoneStatusLabelKey | null {
  if (typeof status !== 'string') return null;
  return (MILESTONE_STATUS_LABEL_KEY as Record<string, MilestoneStatusLabelKey>)[status] ?? null;
}

/* ------------------------------------------------------------------ *
 * Timestamps — UTC ISO (Z) in, LOCAL display out, never "Invalid Date"
 * ------------------------------------------------------------------ */

/** Parse a UTC ISO string; null for missing/blank/malformed input. */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * "12/03/2026, 14:05" in the DEVICE's timezone (the app's convention for its
 * other date copy is the platform locale formatter). Returns null rather than
 * the string "Invalid Date" when there is nothing to show.
 */
export function formatDateTime(value: string | null | undefined): string | null {
  const date = parseIsoDate(value);
  return date ? date.toLocaleString() : null;
}

/** Date only, local timezone. Null when there is nothing usable. */
export function formatDate(value: string | null | undefined): string | null {
  const date = parseIsoDate(value);
  return date ? date.toLocaleDateString() : null;
}

/* ------------------------------------------------------------------ *
 * Actions — the BACKEND's flags decide, the client never re-derives
 * ------------------------------------------------------------------ */

export const JOB_ACTION_IDS = [
  'edit',
  'cancel',
  'restartTimer',
  'convertToRegular',
  'convertToUrgent',
] as const;

export type JobActionId = (typeof JOB_ACTION_IDS)[number];

export type JobActionLabelKey =
  | 'job_edit'
  | 'job_cancel'
  | 'job_restart_timer'
  | 'job_convert_regular'
  | 'job_convert_urgent';

export const JOB_ACTION_LABEL_KEY: Record<JobActionId, JobActionLabelKey> = {
  edit: 'job_edit',
  cancel: 'job_cancel',
  restartTimer: 'job_restart_timer',
  convertToRegular: 'job_convert_regular',
  convertToUrgent: 'job_convert_urgent',
};

/**
 * The flags are the source of truth for what the user may do — no date or
 * status arithmetic on the client. A flag that is missing/non-boolean is
 * treated as "not allowed", so an unexpected payload hides a button rather
 * than showing one that cannot work.
 */
export function canRunJobAction(
  job: Pick<
    JobResponse,
    | 'is_editable'
    | 'is_cancellable'
    | 'can_restart_timer'
    | 'can_convert_to_regular'
    | 'can_convert_to_urgent'
  >,
  action: JobActionId
): boolean {
  switch (action) {
    case 'edit':
      return job.is_editable === true;
    case 'cancel':
      return job.is_cancellable === true;
    case 'restartTimer':
      return job.can_restart_timer === true;
    case 'convertToRegular':
      return job.can_convert_to_regular === true;
    case 'convertToUrgent':
      return job.can_convert_to_urgent === true;
    default:
      return false;
  }
}

/** The actions the backend permits, in a stable display order. */
export function visibleJobActions(job: JobResponse): JobActionId[] {
  return JOB_ACTION_IDS.filter((action) => canRunJobAction(job, action));
}

/* ------------------------------------------------------------------ *
 * Job-state sections — each is rendered only when the data exists
 * ------------------------------------------------------------------ */

/** A provider is assigned once the backend reports one. */
export function isProviderAssigned(job: Pick<JobResponse, 'assigned_provider_id'>): boolean {
  return typeof job.assigned_provider_id === 'number';
}

/** The job is cancelled once the backend stamps cancelled_at. */
export function isJobCancelled(job: Pick<JobResponse, 'cancelled_at'>): boolean {
  return parseIsoDate(job.cancelled_at) !== null;
}

/**
 * The job is finished as a cancellation by EITHER the `cancelled_at` stamp OR one of
 * the backend's OWN cancelled statuses (`CANCELLED`, `CANCELLED_BY_CLIENT`,
 * `CANCELLED_BY_PROVIDER` — all three are in the server's JobStatus enum). Used where
 * a response may move the job to a cancelled status without necessarily stamping
 * `cancelled_at` (e.g. the provider-cancel path); nothing is guessed — the status
 * values are the server's.
 */
export function isJobCancelledStatus(
  job: Pick<JobResponse, 'cancelled_at' | 'status'> | null | undefined
): boolean {
  if (!job) return false;
  if (isJobCancelled(job)) return true;
  return (
    job.status === 'CANCELLED' ||
    job.status === 'CANCELLED_BY_CLIENT' ||
    job.status === 'CANCELLED_BY_PROVIDER'
  );
}

/**
 * The job is on hold by EITHER side's own status (`PAUSED_BY_CLIENT`,
 * `PAUSED_BY_PROVIDER`) — both are in the server's JobStatus enum, so nothing is
 * guessed. Used to surface the paused state clearly: while a job is paused the
 * pause/complete actions no longer apply, and there is (yet) no resume endpoint
 * connected in the app.
 */
export function isJobPausedStatus(
  job: Pick<JobResponse, 'status'> | null | undefined
): boolean {
  if (!job) return false;
  return job.status === 'PAUSED_BY_CLIENT' || job.status === 'PAUSED_BY_PROVIDER';
}

/** Completed_at is the backend's completion stamp (nullable until then). */
export function isJobCompleted(job: Pick<JobResponse, 'completed_at'>): boolean {
  return parseIsoDate(job.completed_at) !== null;
}

/**
 * The countdown anchor: an absolute deadline is preferred because it stays
 * correct across suspends, and remaining_bidding_seconds is only a fallback
 * for a response that omits the deadline. Returns null when bidding is closed
 * or neither field is usable — the caller then renders no countdown at all.
 */
export function biddingDeadline(
  job: Pick<
    JobResponse,
    'is_bidding_open' | 'bidding_ends_at' | 'remaining_bidding_seconds'
  >,
  nowMs: number
): number | null {
  if (job.is_bidding_open !== true) return null;
  const deadline = parseIsoDate(job.bidding_ends_at);
  if (deadline) return deadline.getTime();
  const seconds = job.remaining_bidding_seconds;
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    return nowMs + seconds * 1000;
  }
  return null;
}
