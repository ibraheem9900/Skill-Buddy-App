import type {
  JobMilestoneResponse,
  JobMilestoneTimeSlotResponse,
  JobResponse,
  MilestoneStatus,
} from '@/types';

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
 * Parse a timestamp from the jobs API as the UTC instant the server means.
 *
 * VERIFIED LIVE (2026-10-14, jobs 2/3/4): POST action responses carry a proper
 * UTC stamp ("2026-10-14T21:24:44.723087Z") while GET /api/v1/jobs/{job_id}
 * returns the SAME clock digits with the timezone marker stripped — created_at,
 * updated_at, bidding_ends_at and status_history all arrive as naive strings
 * (e.g. "2026-10-14T21:24:49"; bidding_ends_at is exactly 180 minutes after
 * created_at, so the digits are UTC). `new Date()` reads a marker-less stamp as
 * DEVICE-LOCAL time, which would shift every deadline read from a GET by the
 * device's whole UTC offset. Marker-less stamps are therefore parsed as UTC
 * here — matching what the server demonstrably sends — while stamps that carry
 * a zone marker are left to the platform, exactly as before.
 */
export function parseApiIsoUtc(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const raw = value.trim();
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const date = new Date(hasZone ? raw : `${raw}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * "12/03/2026, 14:05" in the DEVICE's timezone (the app's convention for its
 * other date copy is the platform locale formatter). Returns null rather than
 * the string "Invalid Date" when there is nothing to show.
 */
export function formatDateTime(value: string | null | undefined): string | null {
  // `scheduled_at`, `created_at`, `bidding_ends_at` … all come from GET as
  // marker-less UTC digits (see parseApiIsoUtc), so they MUST be read with the
  // UTC rule — `new Date(naive)` reads them as device-local and shifted every
  // appointment by the device's whole offset (8:00 AM showed as 5:00 AM).
  const date = parseApiIsoUtc(value);
  return date ? date.toLocaleString() : null;
}

/** Date only, local timezone. Null when there is nothing usable. */
export function formatDate(value: string | null | undefined): string | null {
  const date = parseApiIsoUtc(value);
  return date ? date.toLocaleDateString() : null;
}

/* ------------------------------------------------------------------ *
 * Task hours and time slots — read from what the CLIENT entered
 * ------------------------------------------------------------------ */

/** `HH:MM` (or `HH:MM:SS`) → local minutes since midnight, or null. */
export function clockMinutes(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export interface MinuteRange {
  startMinutes: number;
  endMinutes: number;
}

/**
 * A task's stored slots, sorted by start time and MERGED where they touch.
 *
 * A task can legitimately store five 3-hour slots (8-11, 11-2, 2-5, 5-8, 8-11)
 * that together describe ONE continuous 8:00 AM - 11:00 PM window. Rendering
 * them raw produced a comma-separated wall of text with an unsorted order; this
 * returns the readable ranges instead (8:00 AM - 11:00 PM in that example).
 * Overlapping slots are merged too, so no minute is counted twice.
 */
export function mergedSlotRanges(
  slots: readonly JobMilestoneTimeSlotResponse[] | null | undefined
): MinuteRange[] {
  const ranges: MinuteRange[] = [];
  for (const slot of slots ?? []) {
    const start = clockMinutes(slot?.start_time);
    const end = clockMinutes(slot?.end_time);
    if (start === null || end === null || end <= start) continue;
    ranges.push({ startMinutes: start, endMinutes: end });
  }
  ranges.sort(
    (a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes
  );

  const merged: MinuteRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.startMinutes <= last.endMinutes) {
      last.endMinutes = Math.max(last.endMinutes, range.endMinutes);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * The hours the CLIENT entered for one task.
 *
 * The job's stored `expected_hours` per milestone is often the length of a
 * SINGLE slot (3 h) rather than the task's booked total, so a task built from
 * five slots rendered "3 hrs" and the job total came out as 4 × 3 = 12 h
 * instead of 3/9/15/15 = 42 h. The slots the client chose are the truth: merged
 * they span exactly the booked hours. `expected_hours` remains the fallback for
 * legacy milestones that carry no slots.
 */
export function taskExpectedHours(
  milestone:
    | Pick<JobMilestoneResponse, 'expected_hours' | 'time_slots'>
    | null
    | undefined
): number | null {
  if (!milestone) return null;

  const merged = mergedSlotRanges(milestone.time_slots);
  if (merged.length > 0) {
    const minutes = merged.reduce(
      (sum, range) => sum + (range.endMinutes - range.startMinutes),
      0
    );
    if (minutes > 0) {
      // Whole hours stay whole; anything else keeps one decimal (7.5 h).
      return minutes % 60 === 0 ? minutes / 60 : Math.round(minutes / 6) / 10;
    }
  }

  const raw = milestone.expected_hours;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Total expected hours = the SUM of the tasks' own hours (never a guess). */
export function totalTaskHours(
  milestones: readonly Pick<JobMilestoneResponse, 'expected_hours' | 'time_slots'>[] | null | undefined
): number | null {
  let total = 0;
  let found = false;
  for (const milestone of milestones ?? []) {
    const hours = taskExpectedHours(milestone);
    if (hours === null) continue;
    total += hours;
    found = true;
  }
  return found ? Math.round(total * 10) / 10 : null;
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
  // parseApiIsoUtc, not parseIsoDate: GET returns bidding_ends_at WITHOUT the
  // timezone marker (live-verified), and a device-local reading of those digits
  // would move the countdown by the whole UTC offset. See the function's header.
  const deadline = parseApiIsoUtc(job.bidding_ends_at);
  if (deadline) return deadline.getTime();
  const seconds = job.remaining_bidding_seconds;
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    return nowMs + seconds * 1000;
  }
  return null;
}
