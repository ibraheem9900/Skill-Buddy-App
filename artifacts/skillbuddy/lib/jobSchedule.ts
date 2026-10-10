/**
 * jobSchedule.ts
 *
 * Pure helpers behind the Post-Job calendar (the separate DATE picker). No
 * React, no axios, no Intl — every rule here is unit-testable without a
 * renderer.
 *
 * ── BOOKING WINDOW ─────────────────────────────────────────────────────────
 * The live OpenAPI (GET /openapi.json) was checked for a per-service or
 * per-category lead-time field: `JobCreate` is
 * `service_id, category_id, title, description, request_type, booking_type,
 * milestones, address, is_draft` — there is NO min_advance_hours /
 * max_advance_days / notice field anywhere in the schema, and no service or
 * category field carries one either. So the backend does not publish a
 * booking window and cannot enforce one that the client can read.
 *
 * The window below is therefore an APP-LEVEL policy for how far ahead a
 * calendar may be paged. It is declared in exactly one place so that, once
 * Zeyshan confirms the real server-side limits, only these two constants
 * change. (`JobRequest.MAX_MILESTONES` documents the OTHER limit — a
 * MULTI_DAY booking may span at most one week; that cap lives in
 * lib/jobBooking.ts.)
 *
 *   MIN_LEAD_MINUTES  you cannot book a slot that has already started; the
 *                     job needs to be live with a little notice.
 *   MAX_LEAD_DAYS     how far into the future a booking may be scheduled.
 */
export const BOOKING_MIN_LEAD_MINUTES = 60;
export const BOOKING_MAX_LEAD_DAYS = 90;

export interface BookingWindow {
  /** Earliest instant that may be scheduled. */
  min: Date;
  /** Latest instant that may be scheduled. */
  max: Date;
}

/** True for a real Date with a real timestamp (rejects Invalid Date). */
export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Midnight (local) of the given day. */
export function startOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

/** End of the given day (local, last millisecond). */
export function endOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), 23, 59, 59, 999);
}

/** A new Date `days` later (local, day granularity, DST-safe). */
export function addDays(at: Date, days: number): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + days);
}

/** Same calendar day in the device's local time zone. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** The allowed scheduling window around `now`. */
export function bookingWindow(now: Date = new Date()): BookingWindow {
  return {
    min: new Date(now.getTime() + BOOKING_MIN_LEAD_MINUTES * 60_000),
    max: new Date(addDays(now, BOOKING_MAX_LEAD_DAYS).getTime()),
  };
}

/**
 * Is `candidate` inside the app-level booking window?
 * Anything before the lead time or beyond the horizon is rejected.
 */
export function isWithinBookingWindow(candidate: Date, now: Date = new Date()): boolean {
  if (!isValidDate(candidate)) return false;
  const { min, max } = bookingWindow(now);
  return candidate.getTime() >= min.getTime() && candidate.getTime() <= max.getTime();
}

/**
 * Is an ENTIRE calendar day outside the window (so it should be greyed out)?
 * A day is selectable when it still intersects the window — the boundary days
 * (the earliest and the furthest) stay selectable, and the time control is
 * what rejects the few times that fall outside on those days.
 */
export function isDayWithinWindow(day: Date, now: Date = new Date()): boolean {
  const { min, max } = bookingWindow(now);
  return endOfDay(day).getTime() >= min.getTime() && startOfDay(day).getTime() <= max.getTime();
}

/**
 * The month grid for `year`/`month` (0-based month), **Monday first**.
 * Leading/trailing blanks are `null` so a 7-column renderer can pad directly.
 */
export function monthMatrix(year: number, month: number): Array<Array<Date | null>> {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // JS getDay(): 0=Sunday..6=Saturday → Monday-first offset.
  const lead = (first.getDay() + 6) % 7;

  const cells: Array<Date | null> = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: Array<Array<Date | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Move a (year, month) pair by `delta` months, normalising the year. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const shifted = new Date(year, month + delta, 1);
  return { year: shifted.getFullYear(), month: shifted.getMonth() };
}

/**
 * Can the calendar page to the previous / next month, given the window?
 * Paging to a whole month that lies entirely outside the window is pointless
 * (every day would be greyed out), so it is disabled in the header.
 */
export function canPageMonth(
  year: number,
  month: number,
  now: Date = new Date()
): { prev: boolean; next: boolean } {
  const { min, max } = bookingWindow(now);
  const monthStart = new Date(year, month, 1);
  const monthEnd = endOfDay(new Date(year, month + 1, 0));
  return {
    // There is an earlier month if this month starts after the earliest day.
    prev: monthStart.getTime() > startOfDay(min).getTime(),
    // There is a later month if this month ends before the last usable day.
    next: monthEnd.getTime() < endOfDay(max).getTime(),
  };
}

/** 1..12 → 0-based index of the previous/next selectable month, or null. */
export function firstSelectableMonth(now: Date = new Date()): { year: number; month: number } {
  const { min } = bookingWindow(now);
  return { year: min.getFullYear(), month: min.getMonth() };
}

/** The last month the window reaches. */
export function lastSelectableMonth(now: Date = new Date()): { year: number; month: number } {
  const { max } = bookingWindow(now);
  return { year: max.getFullYear(), month: max.getMonth() };
}

/**
 * Combine a calendar day with a 12-hour clock selection into a local Date.
 * Returns null when the day is missing or the clock parts are out of range.
 */
export function composeDateTime(
  day: Date | null,
  hour12: number,
  minute: number,
  isPm: boolean
): Date | null {
  if (!isValidDate(day)) return null;
  if (!Number.isInteger(hour12) || hour12 < 1 || hour12 > 12) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  let hours = hour12 % 12;
  if (isPm) hours += 12;

  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minute, 0, 0);
}

/** Local Date → ISO 8601 UTC (`...Z`) for the API's `scheduled_at`. */
export function toIsoDateTime(at: Date | null): string | null {
  if (!isValidDate(at)) return null;
  return at.toISOString();
}

/** Two-digit zero padding. */
function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `14:30`-style 24-hour clock label for a 12-hour selection. */
export function formatClockLabel(hour12: number, minute: number, isPm: boolean): string {
  let hours = hour12 % 12;
  if (isPm) hours += 12;
  return `${pad(hours)}:${pad(minute)}`;
}

/**
 * `Sat, 12 Sep 2026 · 14:30` using the caller's translated month/weekday
 * tables, so no English is ever hardcoded and no Intl/ICU dependency is
 * required on device.
 */
export function formatScheduleLabel(
  at: Date,
  months: string[],
  weekdays: string[]
): string {
  if (!isValidDate(at)) return '';
  const weekday = weekdays[(at.getDay() + 6) % 7] ?? '';
  const month = months[at.getMonth()] ?? '';
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return `${weekday}, ${at.getDate()} ${month} ${at.getFullYear()} · ${clock}`;
}

/**
 * Split a translated comma-separated table (`post_sched_months`,
 * `post_sched_weekdays`) into a trimmed array.
 */
export function splitTable(value: string | undefined | null): string[] {
  const raw = String(value ?? '').trim();
  // An absent/blank table must be an EMPTY list — never [''], which would
  // otherwise render as a blank month name in the calendar header.
  if (raw.length === 0) return [];
  return raw.split(',').map((part) => part.trim());
}
