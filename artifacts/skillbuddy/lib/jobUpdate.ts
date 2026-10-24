import { firstErrorMessage, parseExpectedHours } from '@/lib/jobList';
import {
  localDay,
  selectionWindow,
  type TimeChoice,
} from '@/lib/jobBooking';
import {
  MAX_DAILY_EXPECTED_HOURS,
  buildScheduleLine,
  clampHours,
  clockOf,
  deriveSlotOf,
  exceedsHoursCap,
  formatDayLabel,
  formatTimeLabel,
  formatWindowLabel,
  localStartOf,
  maxHoursForStart,
  minutesOf,
  parseScheduleSegments,
  segmentsForTasks,
  stripScheduleBlock,
} from '@/lib/timeSlots';
import type { JobResponse, UpdateJobRequest, ValidationErrorDetail } from '@/types';

/**
 * jobUpdate.ts — pure helpers behind the Edit Job screen
 * (PATCH /api/v1/jobs/{job_id}, schema JobUpdate).
 *
 * ── WHAT THE ENDPOINT REALLY ACCEPTS (live OpenAPI, re-read 2026-10-22) ────
 * `JobUpdate` has EXACTLY four optional properties: title, description,
 * scheduled_at, expected_hours. There is NO milestones array and no milestone
 * endpoint anywhere in the spec, so a MULTI_DAY job's per-task dates and times
 * CANNOT be changed through this API. This screen therefore:
 *   • edits a single-day job's day, window and expected hours;
 *   • shows a multi-day job's tasks READ-ONLY (with the reason) and only lets
 *     the description change;
 *   • sends ONLY the fields that actually changed.
 *
 * ── WHAT WAS WRONG BEFORE ─────────────────────────────────────────────────
 *   • the Job Title field is gone (the title stays the service name);
 *   • the description box held the app's own "Preferred time: …" line and
 *     counted it in "20/500 words" — the line is stripped on load, rebuilt on
 *     save, and never counted;
 *   • the date chips ran through 60 days and were cut off — now exactly the
 *     same 7-day window as Post a Job (today + 6), with the job's own date kept
 *     untouched when it lies outside it;
 *   • the time chips were arbitrary 30-minute clock readings — now the five
 *     client windows + Anytime, preselected from the job's own stored window;
 *   • `scheduled_at` is a UTC instant and GET returns it WITHOUT a zone marker
 *     (see lib/jobDetail), so the old `new Date(value)` read it as local time
 *     and showed 5:00 AM for an 8:00 AM booking. Every read here goes through
 *     lib/timeSlots.localStartOf, which applies the shared UTC rule.
 *
 * No React and no axios, so every rule below is unit-testable.
 */

/** Server bounds on JobUpdate.title (kept for the type, not edited here). */
export const TITLE_MIN = 3;
export const TITLE_MAX = 150;
/** The expected-hours floor. The ceiling is per start (11 PM rule). */
export const HOURS_MIN = 1;
/** The largest ceiling the rule can produce (8:00 AM → 15 h). */
export const HOURS_MAX = MAX_DAILY_EXPECTED_HOURS;
/** The Edit screen offers the same week Post a Job does. */
export const DAY_CHOICES = 7;

export type JobEditField = 'title' | 'description' | 'scheduled_at' | 'expected_hours';

/** Translated copy keys the screen maps each failure to. */
export type JobEditErrorKey =
  | 'post_err_title_min'
  | 'editjob_err_title_max'
  | 'post_err_desc'
  | 'post_err_desc_long'
  | 'post_err_hours'
  | 'editjob_err_future'
  | 'post_err_schedule'
  | 'post_err_time_late'
  | 'post_err_time_window';

/** What the form and the stored job looked like when it opened. */
export interface JobEditOriginal {
  /** The stored description WITHOUT its schedule line (the user's words). */
  description: string;
  /** The full stored description, line included. */
  descriptionWithLine: string;
  /** Local `YYYY-MM-DD` of the stored start, or null. */
  dateKey: string | null;
  /** Local minutes of the stored start, or null. */
  minutes: number | null;
  /** The window the job's start belongs to, or null. */
  time: TimeChoice | null;
  expectedHours: number;
  /** The window label read from the stored line, or null. */
  windowLabel: string | null;
  milestones: number;
  isMultiDay: boolean;
}

/** The Edit form's raw state. */
export interface JobEditValues {
  /** Display only — the title is the service's name and is not sent. */
  title: string;
  /** The user's own words (no schedule block). */
  description: string;
  /** The chosen local day, or null = keep the stored date. */
  dateKey: string | null;
  /** The chosen window, or null = nothing chosen yet. */
  time: TimeChoice | null;
  expectedHours: number;
  original: JobEditOriginal;
}

/**
 * A message under one input is EITHER a translated rule key the app owns, or
 * the backend's own free text from a 422 — kept apart so neither is ever passed
 * to t() as if it were a key.
 */
export type JobEditFieldError =
  | { kind: 'key'; key: JobEditErrorKey }
  | { kind: 'server'; message: string };

export interface MappedEditErrors {
  fieldErrors: Partial<Record<JobEditField, JobEditFieldError>>;
  /** Details that could not be attached to an input. */
  formErrors: string[];
}

/* ------------------------------------------------------------------ *
 * Local date helpers (the form works in DEVICE-LOCAL terms)
 * ------------------------------------------------------------------ */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The DEVICE-local calendar day of a Date, as 'YYYY-MM-DD'. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * 'YYYY-MM-DD' -> LOCAL midnight. Returns null for anything malformed and
 * rejects overflowed days (2026-02-31) rather than silently rolling over.
 */
export function parseLocalDateKey(key: string | null | undefined): Date | null {
  if (typeof key !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** `2:30 PM` from local minutes (translated meridiem labels). */
export function minutesToLabel(
  minutes: number,
  meridiem: { am: string; pm: string } = { am: 'AM', pm: 'PM' }
): string {
  if (!Number.isFinite(minutes)) return '';
  return formatTimeLabel(clockOf(minutes), meridiem);
}

/** Today and the six days after it — the only dates Edit Job offers. */
export function editDayChoices(now: Date = new Date()): Date[] {
  const today = localDay(now);
  return Array.from({ length: DAY_CHOICES }, (_, index) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + index)
  );
}

/** Is the job's stored day outside the seven offered ones? */
export function isOutsideEditWindow(dateKey: string | null, now: Date = new Date()): boolean {
  const day = parseLocalDateKey(dateKey);
  if (!day) return false;
  return !editDayChoices(now).some((candidate) => candidate.getTime() === day.getTime());
}

/* ------------------------------------------------------------------ *
 * Pre-filling the form from the loaded job
 * ------------------------------------------------------------------ */

/**
 * Pre-fill from the job as the server returned it.
 *
 * scheduled_at is a UTC string (naive from GET), so it is read back through
 * `localStartOf`; the stored schedule line is PREFERRED for the window, because
 * an Anytime booking only exists as a start instant there. The description is
 * stripped of the line so the counter counts the user's words alone.
 */
export function jobToEditValues(job: JobResponse, now: Date = new Date()): JobEditValues {
  const milestones = [...(job.milestones ?? [])].sort(
    (a, b) => a.sequence - b.sequence || a.id - b.id
  );
  const isMultiDay = job.booking_type === 'MULTI_DAY' || milestones.length > 1;

  const storedDescription = typeof job.description === 'string' ? job.description : '';
  const userDescription = stripScheduleBlock(storedDescription);
  const segments = parseScheduleSegments(storedDescription);

  // Single day: the job's own instant, or the first milestone's.
  const scheduledAt =
    job.scheduled_at ?? (milestones.length > 0 ? milestones[0].scheduled_at : null);
  const local = localStartOf(scheduledAt);
  const paired = segmentsForTasks(segments, Math.max(1, milestones.length));
  const segment = paired.length > 0 ? paired[0] : segments[0] ?? null;
  // DerivedTime is structurally the TimeChoice the form holds (slot | anytime).
  // Anytime is now a FIXED 8:00 AM - 11:00 PM window: a legacy custom window
  // (e.g. the old 2:05 AM - 2:55 AM) is rewritten to the fixed one, which caps
  // expected hours at 15 and can no longer surface values like 20 h.
  let time = deriveSlotOf({ scheduledAt, segment }) as TimeChoice | null;
  if (time?.kind === 'anytime' && (time.start.hour !== 8 || time.start.minute !== 0 || time.end.hour !== 23 || time.end.minute !== 0)) {
    time = { kind: 'anytime', start: { hour: 8, minute: 0 }, end: { hour: 23, minute: 0 } };
  }

  const parsedHours = parseExpectedHours(job.expected_hours);
  const fallbackHours = parsedHours !== null ? parsedHours : 1;
  const cap = time ? maxHoursForStart(minutesOf(selectionWindow(time)?.start ?? null)) : null;

  return {
    title: typeof job.title === 'string' ? job.title : '',
    description: userDescription,
    // A multi-day job has no single day to edit, so nothing is preselected.
    dateKey: isMultiDay ? null : local ? localDateKey(local.day) : null,
    time: isMultiDay ? null : time,
    // The 11 PM rule caps the value for a single day; a multi-day job keeps the
    // stored number untouched (the screen never edits it).
    expectedHours:
      isMultiDay || cap === null
        ? Math.min(Math.max(fallbackHours, HOURS_MIN), HOURS_MAX)
        : clampHours(fallbackHours, cap),
    original: {
      description: userDescription,
      descriptionWithLine: storedDescription,
      dateKey: local ? localDateKey(local.day) : null,
      minutes: local ? local.minutes : null,
      time: isMultiDay ? null : time,
      expectedHours: fallbackHours,
      windowLabel: selectionWindow(time)
        ? formatWindowLabel(
            selectionWindow(time)!.start,
            selectionWindow(time)!.end,
            { am: 'AM', pm: 'PM' }
          )
        : null,
      milestones: milestones.length,
      isMultiDay,
    },
  };
}

/** The 11 PM ceiling for the form's chosen window (null while none is chosen). */
export function editHoursCap(values: JobEditValues): number | null {
  const win = values.time ? selectionWindow(values.time) : null;
  if (!win) return null;
  return maxHoursForStart(minutesOf(win.start));
}

/* ------------------------------------------------------------------ *
 * The stored description: strip, rebuild, never duplicate
 * ------------------------------------------------------------------ */

/**
 * The description the PATCH should carry: the user's own words plus ONE
 * schedule line built from the final window.
 *
 * A MULTI_DAY job keeps the line it already had (its tasks are not editable
 * through this endpoint), so an unrelated description edit can never erase or
 * rewrite the task windows.
 */
export function composeEditDescription(
  values: JobEditValues,
  meridiem: { am: string; pm: string } = { am: 'AM', pm: 'PM' }
): string | null {
  const body = stripScheduleBlock(values.description).trim();
  if (values.original.isMultiDay) {
    return values.original.descriptionWithLine.trim().length > 0
      ? values.original.descriptionWithLine
      : body.length > 0
        ? body
        : null;
  }
  const win = values.time ? selectionWindow(values.time) : null;
  const line =
    win && minutesOf(win.start) !== null && minutesOf(win.end) !== null
      ? buildScheduleLine([
          {
            startMinutes: minutesOf(win.start) as number,
            endMinutes: minutesOf(win.end) as number,
            meridiem,
          },
        ])
      : null;
  if (body.length === 0) return line;
  return line ? `${body}\n${line}` : body;
}

/** Words in the USER's text only — the schedule line is never counted. */
export function userWordCount(description: string | null | undefined): number {
  const trimmed = typeof description === 'string' ? stripScheduleBlock(description).trim() : '';
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** Words the WHOLE description will contain (user text + the line). */
export function composedWordCount(
  values: JobEditValues,
  meridiem: { am: string; pm: string } = { am: 'AM', pm: 'PM' }
): number {
  const composed = composeEditDescription(values, meridiem);
  return composed === null ? 0 : composed.trim().split(/\s+/).filter(Boolean).length;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

const MAX_DESCRIPTION_WORDS = 500;

/**
 * On-device rules, checked before the request:
 *   - description non-empty and the COMBINED text within 500 words;
 *   - expected hours 1 … the 11 PM ceiling of the chosen start;
 *   - a chosen day/window must be (and stay) in the future.
 */
export function validateJobEdit(
  values: JobEditValues,
  now: Date = new Date()
): { ok: boolean; fieldErrors: Partial<Record<JobEditField, JobEditErrorKey>> } {
  const fieldErrors: Partial<Record<JobEditField, JobEditErrorKey>> = {};

  if (values.description.trim().length === 0) fieldErrors.description = 'post_err_desc';
  else if (composedWordCount(values) > MAX_DESCRIPTION_WORDS) {
    fieldErrors.description = 'post_err_desc_long';
  }

  const cap = editHoursCap(values);
  if (values.original.isMultiDay) {
    // Untouched here: no cap applies to a task list this endpoint cannot edit.
  } else if (!Number.isFinite(values.expectedHours) || values.expectedHours < HOURS_MIN) {
    fieldErrors.expected_hours = 'post_err_hours';
  } else if (cap !== null && exceedsHoursCap(values.expectedHours, cap)) {
    fieldErrors.expected_hours = 'post_err_hours';
  }

  if (!values.original.isMultiDay) {
    const win = values.time ? selectionWindow(values.time) : null;
    if (!win) fieldErrors.scheduled_at = 'post_err_schedule';
    else {
      const startMinutes = minutesOf(win.start);
      const endMinutes = minutesOf(win.end);
      if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
        fieldErrors.scheduled_at = 'post_err_time_window';
      } else if (maxHoursForStart(startMinutes) < HOURS_MIN) {
        fieldErrors.scheduled_at = 'post_err_time_late';
      } else {
        const day = parseLocalDateKey(values.dateKey);
        if (day) {
          const at = new Date(
            day.getFullYear(),
            day.getMonth(),
            day.getDate(),
            Math.floor(startMinutes / 60),
            startMinutes % 60,
            0,
            0
          );
          if (at.getTime() <= now.getTime() && minutesOf(win.start) !== null) {
            // Only the day that is actually being changed is judged: an
            // untouched past job may keep its date.
            const changed = localDateKey(day) !== values.original.dateKey;
            if (changed) fieldErrors.scheduled_at = 'editjob_err_future';
          }
        }
      }
    }
  }

  return { ok: Object.keys(fieldErrors).length === 0, fieldErrors };
}

/* ------------------------------------------------------------------ *
 * Request body — ONLY what really changed
 * ------------------------------------------------------------------ */

/** LOCAL day + local minutes -> ISO 8601 UTC ('...Z'), or null. */
export function buildScheduledAtIso(dateKey: string | null, minutes: number): string | null {
  const day = parseLocalDateKey(dateKey);
  if (!day || !Number.isFinite(minutes)) return null;
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const target = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Math.floor(total / 60),
    total % 60,
    0,
    0
  );
  return target.toISOString();
}

/** The local day the schedule will be sent for (the original when untouched). */
export function effectiveDateKey(values: JobEditValues): string | null {
  return values.dateKey ?? values.original.dateKey;
}

/** The window that will be sent (the original when the user changed nothing). */
export function effectiveTime(values: JobEditValues): TimeChoice | null {
  return values.time ?? values.original.time;
}

/**
 * The PATCH body. Only the fields that changed are included, so an untouched
 * form (or a form where only the description was edited) can never rewrite the
 * schedule, and the title is never sent at all.
 */
export function buildUpdateJobRequest(
  values: JobEditValues,
  meridiem: { am: string; pm: string } = { am: 'AM', pm: 'PM' }
): UpdateJobRequest {
  const body: UpdateJobRequest = {};

  const description = composeEditDescription(values, meridiem);
  const originalDescription = values.original.descriptionWithLine.trim();
  if ((description ?? '').trim() !== originalDescription) {
    body.description = description;
  }

  if (!values.original.isMultiDay) {
    const time = effectiveTime(values);
    const win = time ? selectionWindow(time) : null;
    const dateKey = effectiveDateKey(values);
    const startMinutes = win ? minutesOf(win.start) : null;
    const scheduledAt =
      dateKey !== null && startMinutes !== null ? buildScheduledAtIso(dateKey, startMinutes) : null;

    // A window that maps back to the same LOCAL day + start sends nothing: the
    // instant would be identical anyway, and an untouched form must not rewrite
    // a schedule it never touched.
    const unchanged =
      values.original.minutes !== null &&
      values.original.dateKey !== null &&
      startMinutes === values.original.minutes &&
      dateKey === values.original.dateKey;
    if (!unchanged && scheduledAt) body.scheduled_at = scheduledAt;

    if (values.expectedHours !== values.original.expectedHours) {
      body.expected_hours = values.expectedHours;
    }
  }

  return body;
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

const EDIT_FIELDS: JobEditField[] = ['title', 'description', 'scheduled_at', 'expected_hours'];

/**
 * Map a FastAPI 422 body onto the editable inputs. loc is normally
 * ["body", "<field>"], so the prefix is stripped; anything else becomes a form
 * error. The first message per field wins.
 */
export function mapUpdateJobErrors(
  detail: ValidationErrorDetail[] | null | undefined
): MappedEditErrors {
  const fieldErrors: Partial<Record<JobEditField, JobEditFieldError>> = {};
  const formErrors: string[] = [];

  if (!Array.isArray(detail)) return { fieldErrors, formErrors };

  for (const item of detail) {
    const message =
      item && typeof item.msg === 'string' && item.msg.length > 0 ? item.msg : null;
    if (!message) continue;

    const raw = Array.isArray(item.loc) ? item.loc : [];
    const loc = raw.map((part) => String(part));
    if (loc.length > 0 && ['body', 'path', 'query', 'header', 'cookie'].includes(loc[0])) {
      loc.shift();
    }

    const head = loc[0];
    if ((EDIT_FIELDS as string[]).includes(head)) {
      const field = head as JobEditField;
      if (!fieldErrors[field]) fieldErrors[field] = { kind: 'server', message };
    } else {
      formErrors.push(message);
    }
  }

  return { fieldErrors, formErrors };
}

/** Resolve a field error to display text. */
export function fieldErrorText(
  error: JobEditFieldError | undefined,
  fallback: (key: JobEditErrorKey) => string
): string | null {
  if (!error) return null;
  return error.kind === 'server' ? error.message : fallback(error.key);
}

/** The backend's readable text for a failed update, or null (shared reader). */
export const updateJobErrorMessage = (body: unknown): string | null =>
  firstErrorMessage(body);

/** `Thu 22 Oct` for a local day key, with the translated tables. */
export function editDayLabel(
  dateKey: string | null,
  months: string[],
  weekdays: string[]
): string {
  const day = parseLocalDateKey(dateKey);
  return day ? formatDayLabel(day, months, weekdays) : '';
}
