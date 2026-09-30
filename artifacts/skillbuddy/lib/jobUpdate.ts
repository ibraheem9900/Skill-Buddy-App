import { firstErrorMessage, parseExpectedHours } from '@/lib/jobList';
import type { JobResponse, UpdateJobRequest, ValidationErrorDetail } from '@/types';

/**
 * jobUpdate.ts — pure helpers behind the Edit Job screen
 * (PATCH /api/v1/jobs/{job_id}, schema JobUpdate).
 *
 * The endpoint edits EXACTLY four fields (title, description, scheduled_at,
 * expected_hours) and its schema has no required properties, so this module
 * can only ever produce a body containing those four keys. There is no path
 * here to an address, status, request_type, booking_type, category_id or
 * service_id — those are not part of the contract.
 *
 * No React and no axios, so every rule below is unit-testable.
 */

/** Server bounds on JobUpdate.title. */
export const TITLE_MIN = 3;
export const TITLE_MAX = 150;
/** The form's stepper range, mirroring Post a Job. */
export const HOURS_MIN = 1;
export const HOURS_MAX = 24;
/** Picker granularity: 30-minute slots from 06:00 to 22:00 local. */
export const SLOT_START_MINUTES = 6 * 60;
export const SLOT_END_MINUTES = 22 * 60;
export const SLOT_STEP_MINUTES = 30;
/** How many future days the date picker offers. */
export const DAY_CHOICES = 60;

export type JobEditField = 'title' | 'description' | 'scheduled_at' | 'expected_hours';

/** Translated copy keys the screen maps each failure to. */
export type JobEditErrorKey =
  | 'post_err_title_min'
  | 'editjob_err_title_max'
  | 'post_err_desc'
  | 'post_err_desc_long'
  | 'post_err_hours'
  | 'editjob_err_future'
  | 'post_err_schedule';

/** The Edit form's raw state. */
export interface JobEditValues {
  title: string;
  description: string;
  /** Local calendar day as 'YYYY-MM-DD'. */
  dateKey: string;
  /** Minutes since LOCAL midnight — the day/slot the picker selected. */
  minutes: number;
  expectedHours: number;
}

/**
 * A message under one input is EITHER a translated rule key the app owns, or
 * the backend's own free text from a 422 — they are kept apart so neither is
 * ever passed to t() as if it were a key.
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
 * Local date / time <-> picker values
 * ------------------------------------------------------------------ */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The DEVICE-local calendar day of a Date, as 'YYYY-MM-DD'. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * 'YYYY-MM-DD' -> LOCAL midnight. Returns null for anything malformed, and
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
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Minutes since local midnight -> '2:30 PM' (the app's slot label format). */
export function minutesToLabel(minutes: number): string {
  if (!Number.isFinite(minutes)) return '';
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad2(m)} ${suffix}`;
}

/** '2:30 PM' -> minutes since local midnight. Null when unreadable. */
export function labelToMinutes(label: string | null | undefined): number | null {
  if (typeof label !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(label.trim());
  if (!match) return null;
  const hour12 = Number(match[1]);
  const minutes = Number(match[2]);
  if (hour12 < 1 || hour12 > 12 || minutes > 59) return null;
  let h = hour12 % 12;
  if (/PM/i.test(match[3])) h += 12;
  return h * 60 + minutes;
}

/** The selectable 30-minute slots (local minutes since midnight). */
export function slotMinutes(): number[] {
  const out: number[] = [];
  for (let m = SLOT_START_MINUTES; m <= SLOT_END_MINUTES; m += SLOT_STEP_MINUTES) out.push(m);
  return out;
}

/** Round a local time down to the nearest slot boundary. */
export function roundToSlot(minutes: number): number {
  const clamped = Math.min(Math.max(minutes, SLOT_START_MINUTES), SLOT_END_MINUTES);
  return clamped - (clamped % SLOT_STEP_MINUTES);
}

/**
 * LOCAL day + local minutes -> ISO 8601 UTC ('...Z').
 *
 * The picker works in device-local terms, so the value is assembled as a local
 * Date and only then serialised; toISOString() performs the UTC conversion.
 * Returns null for an unreadable day so the caller never sends a bad string.
 */
export function buildScheduledAtIso(
  dateKey: string,
  minutes: number
): string | null {
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

/**
 * Pre-fill the form from the currently loaded job.
 *
 * scheduled_at is a UTC string, so it is read back in LOCAL terms (day +
 * slot); when it is null — or its time is off the 30-minute grid, e.g. 2:15 PM
 * — the exact time is preserved by returning it as one of the choices, so an
 * untouched form re-sends the value the server already had instead of
 * silently shifting the appointment. expected_hours arrives as a numeric
 * STRING and is parsed to a number for the stepper.
 */
export function jobToEditValues(job: JobResponse, now: Date = new Date()): JobEditValues {
  const parsedHours = parseExpectedHours(job.expected_hours);
  const scheduled = job.scheduled_at ? new Date(job.scheduled_at) : null;

  let dateKey: string;
  let minutes: number;

  if (scheduled && !Number.isNaN(scheduled.getTime())) {
    dateKey = localDateKey(scheduled);
    minutes = scheduled.getHours() * 60 + scheduled.getMinutes();
  } else {
    const fallback = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
    dateKey = localDateKey(fallback);
    minutes = 9 * 60;
  }

  return {
    title: typeof job.title === 'string' ? job.title : '',
    description: typeof job.description === 'string' ? job.description : '',
    dateKey,
    minutes,
    // NOT rounded: the server may hold a fractional value (2.5), and rounding
    // here would silently rewrite the job for a user who never touched the
    // field. The stepper steps by 1 from exactly what the server held.
    expectedHours:
      parsedHours !== null
        ? Math.min(Math.max(parsedHours, HOURS_MIN), HOURS_MAX)
        : 2,
  };
}

/**
 * The date choices offered by the picker: the job's own day (even if it is in
 * the past or beyond the window, so it stays selectable and visible) followed
 * by the next `DAY_CHOICES` days.
 */
export function dayChoices(
  currentDateKey: string,
  now: Date = new Date(),
  count: number = DAY_CHOICES
): string[] {
  const keys: string[] = [];
  const current = parseLocalDateKey(currentDateKey);
  if (current) keys.push(localDateKey(current));
  for (let i = 0; i <= count; i += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const key = localDateKey(day);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

/* ------------------------------------------------------------------ *
 * Validation (client-side, before the request)
 * ------------------------------------------------------------------ */

/**
 * On-device rules. Swagger documents only `title` 3..150; the rest mirror the
 * Post-a-Job form and the endpoint's own semantics:
 *   - title      3..150 (server-documented)
 *   - description non-empty, <= 500 words (same cap as the create form)
 *   - hours      at least 1
 *   - schedule    must be strictly in the FUTURE (a past slot is meaningless)
 */
export function validateJobEdit(
  values: JobEditValues,
  now: Date = new Date()
): { ok: boolean; fieldErrors: Partial<Record<JobEditField, JobEditErrorKey>> } {
  const fieldErrors: Partial<Record<JobEditField, JobEditErrorKey>> = {};

  const title = values.title.trim();
  if (title.length < TITLE_MIN) fieldErrors.title = 'post_err_title_min';
  else if (title.length > TITLE_MAX) fieldErrors.title = 'editjob_err_title_max';

  const description = values.description.trim();
  if (description.length === 0) fieldErrors.description = 'post_err_desc';
  else if (description.split(/\s+/).filter(Boolean).length > 500) {
    fieldErrors.description = 'post_err_desc_long';
  }

  if (!Number.isFinite(values.expectedHours) || values.expectedHours < HOURS_MIN) {
    fieldErrors.expected_hours = 'post_err_hours';
  }

  const iso = buildScheduledAtIso(values.dateKey, values.minutes);
  if (!iso) fieldErrors.scheduled_at = 'post_err_schedule';
  else if (new Date(iso).getTime() <= now.getTime()) {
    fieldErrors.scheduled_at = 'editjob_err_future';
  }

  return { ok: Object.keys(fieldErrors).length === 0, fieldErrors };
}

/* ------------------------------------------------------------------ *
 * Request body
 * ------------------------------------------------------------------ */

/**
 * Build the PATCH body: exactly the four editable fields and nothing else.
 *
 * `expected_hours` goes out as a NUMBER (the API accepts number | numeric
 * string, and the form holds a number), while `scheduled_at` is the ISO UTC
 * string from the local picker. The caller must have validated first.
 */
export function buildUpdateJobRequest(values: JobEditValues): UpdateJobRequest {
  const title = values.title.trim();
  const description = values.description.trim();
  return {
    title,
    description,
    scheduled_at: buildScheduledAtIso(values.dateKey, values.minutes),
    expected_hours: values.expectedHours,
  };
}

const EDIT_FIELDS: JobEditField[] = ['title', 'description', 'scheduled_at', 'expected_hours'];

/**
 * Map a FastAPI 422 body onto the four editable inputs.
 *
 * loc is normally ["body", "<field>"], so the location prefix is stripped.
 * Anything that does not name one of the four fields is surfaced as a form
 * error instead of being dropped. First message per field wins.
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

/**
 * Resolve a field error to display text. `fallback` is the translated copy for
 * the field's current client-side rule (if any).
 */
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
