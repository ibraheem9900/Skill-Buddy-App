/**
 * jobBooking.ts
 *
 * Pure rules behind the Post-a-Job wizard's Booking Type / Date & Time steps.
 * No React, no axios, no Intl — every rule below is unit-testable.
 *
 * ── WHAT THE LIVE OPENAPI ACTUALLY DEFINES ─────────────────────────────────
 *   BookingType (enum): "ONE_TIME" | "MULTI_DAY"
 *     "ONE_TIME  -> a single occurrence (one milestone).
 *      MULTI_DAY -> up to JobRequest.MAX_MILESTONES occurrences within
 *                   one week, each tracked as its own JobMilestone."
 *   JobMilestoneCreate: { scheduled_at (required, date-time),
 *                         expected_hours (number | numeric string | null) }
 *   JobCreate: { service_id, category_id, title, description, request_type,
 *                booking_type, milestones, address, is_draft }
 *
 * MAX_MILESTONE_DAYS is therefore 7: "within one week" is the only ceiling the
 * schema publishes. No maximum exists for milestones[] length or for
 * expected_hours anywhere in the document, so the hour bounds below are the
 * app's existing product limits (the stepper already stopped at 24).
 *
 * ── TIME ZONE RULE ─────────────────────────────────────────────────────────
 * Every instant is composed from LOCAL calendar parts
 * (`new Date(y, m, d, h, min, 0, 0)`) and serialised with `toISOString()`, so
 * the API always receives UTC ("...Z") and a booking made at 23:50 for
 * "Tomorrow" lands on tomorrow's local date — never off by a day — while DST
 * transitions are handled by the platform's own local-time arithmetic.
 */

import type { JobBookingType } from '@/types';

/** The wizard's form-level booking choice (the API value is derived from it). */
export type BookingKind = 'one_time' | 'multi_day';

/** One week, inclusive — the only span the BookingType schema documents. */
export const MAX_MILESTONE_DAYS = 7;

/** Minutes are picked on the dial in these steps. */
export const TIME_MINUTE_STEP = 5;

/** Expected-hours bounds shown by the stepper (product limits, see header). */
export const MIN_EXPECTED_HOURS = 1;
export const MAX_EXPECTED_HOURS = 24;

/** The two one-time day choices; the weekend option is gone for good. */
export type OneTimeDay = 'today' | 'tomorrow';

/** Error keys the wizard renders (all exist in every locale). */
export type BookingErrorKey =
  | 'post_err_time'
  | 'post_err_time_past'
  | 'post_err_dates_pick'
  | 'post_err_dates_past'
  | 'post_err_dates_max';

/** A 12-hour clock reading, as the dial produces it. */
export interface ClockTime {
  /** 0–23. */
  hour: number;
  /** 0–59, aligned to TIME_MINUTE_STEP. */
  minute: number;
}

/** One milestone exactly as JobMilestoneCreate expects it. */
export interface MilestoneDraft {
  scheduled_at: string;
  expected_hours: number;
}

/** True for a real Date with a real timestamp (rejects Invalid Date). */
export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Local midnight of a day — the calendar works in whole local days. */
export function localDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

/** Local day `days` later (day granularity, DST-safe: no ms arithmetic). */
export function addLocalDays(at: Date, days: number): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + days);
}

/** Same calendar day in the device's local time zone. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/**
 * Whole days between two local days. Both are normalised through UTC so a DST
 * change inside the range cannot round the count the wrong way.
 */
function wholeDaysBetween(start: Date, end: Date): number {
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** Inclusive length of a range: the same day is 1, the day after is 2. */
export function inclusiveDayCount(start: Date, end: Date): number {
  if (!isValidDate(start) || !isValidDate(end)) return 0;
  return wholeDaysBetween(start, end) + 1;
}

/** Every local day from `start` to `end`, inclusive (empty on a bad range). */
export function enumerateDays(start: Date, end: Date): Date[] {
  if (!isValidDate(start) || !isValidDate(end)) return [];
  const span = wholeDaysBetween(start, end);
  if (span < 0) return [];
  const days: Date[] = [];
  for (let i = 0; i <= span; i += 1) days.push(addLocalDays(start, i));
  return days;
}

/** The furthest day a range may end on when it starts on `start`. */
export function maxEndDay(start: Date): Date {
  return addLocalDays(start, MAX_MILESTONE_DAYS - 1);
}

/** Does the range span more days than the API's one-week ceiling allows? */
export function rangeExceedsMaxDays(start: Date, end: Date): boolean {
  return inclusiveDayCount(start, end) > MAX_MILESTONE_DAYS;
}

/**
 * Can this day be tapped in the range calendar?
 *  - days before `minDay` (today) are never selectable
 *  - once a start day is chosen, days past start + 6 are disabled, so the
 *    7-day cap is enforced by the CALENDAR itself, not only on submit
 */
export function isRangeDaySelectable(day: Date, minDay: Date, start: Date | null): boolean {
  if (!isValidDate(day) || !isValidDate(minDay)) return false;
  if (wholeDaysBetween(minDay, day) < 0) return false;
  if (start && isValidDate(start)) {
    const offset = wholeDaysBetween(start, day);
    if (offset > MAX_MILESTONE_DAYS - 1) return false;
  }
  return true;
}

/** Combine a local day with an hour/minute clock into a local instant. */
export function composeInstant(day: Date, hour: number, minute: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
}

/** The local day for a one-time choice, relative to `now`. */
export function oneTimeDay(kind: OneTimeDay, now: Date = new Date()): Date {
  return kind === 'tomorrow' ? addLocalDays(localDay(now), 1) : localDay(now);
}

/** 12-hour reading of a 24-hour clock value: 0 → 12 (AM), 13 → 1 (PM). */
export function to12Hour(hour24: number): { hour12: number; isPm: boolean } {
  const isPm = hour24 >= 12;
  return { hour12: hour24 % 12 === 0 ? 12 : hour24 % 12, isPm };
}

/** 12-hour reading + meridiem → the 24-hour value the API and dial share. */
export function to24Hour(hour12: number, isPm: boolean): number {
  const base = hour12 % 12;
  return isPm ? base + 12 : base;
}

/** Zero-padded two-digit value. */
export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * `09:30`-style readout for the dial and the field. The AM/PM labels come from
 * the caller's translations, so no English is ever hardcoded.
 */
export function formatClock24(hour24: number, minute: number): string {
  return `${pad2(hour24)}:${pad2(minute)}`;
}

/** `9:30 AM` — the field label, with translated meridiem. */
export function formatTimeLabel(
  hour24: number,
  minute: number,
  meridiem: { am: string; pm: string }
): string {
  const { hour12, isPm } = to12Hour(hour24);
  return `${hour12}:${pad2(minute)} ${isPm ? meridiem.pm : meridiem.am}`;
}

/**
 * `Mon 12 Oct` from the translated month/weekday tables (`post_sched_months`,
 * `post_sched_weekdays`), so the calendar and the milestone list agree.
 */
export function formatDayLabel(day: Date, months: string[], weekdays: string[]): string {
  if (!isValidDate(day)) return '';
  const weekday = weekdays[(day.getDay() + 6) % 7] ?? '';
  const month = months[day.getMonth()] ?? '';
  return `${weekday} ${day.getDate()} ${month}`.trim();
}

/** `Mon 12 Oct → Wed 14 Oct` (one day collapses to a single label). */
export function formatRangeLabel(
  start: Date,
  end: Date,
  months: string[],
  weekdays: string[]
): string {
  const from = formatDayLabel(start, months, weekdays);
  if (!isValidDate(end) || isSameLocalDay(start, end)) return from;
  return `${from} → ${formatDayLabel(end, months, weekdays)}`;
}

/**
 * Minutes-of-day for a clock reading, or null when the reading is impossible.
 * Kept as the single conversion the milestone builder uses.
 */
export function minutesOfDay(hour24: number, minute: number): number | null {
  if (!Number.isInteger(hour24) || hour24 < 0 || hour24 > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return hour24 * 60 + minute;
}

/**
 * The wizard's client-side gate for the ONE-TIME step.
 * A time is mandatory, and "Today" never accepts a moment that has passed.
 */
export function validateOneTime(
  kind: OneTimeDay,
  clock: ClockTime | null,
  now: Date = new Date()
): BookingErrorKey | null {
  if (!clock || minutesOfDay(clock.hour, clock.minute) === null) return 'post_err_time';
  if (kind === 'today') {
    const at = composeInstant(oneTimeDay('today', now), clock.hour, clock.minute);
    if (at.getTime() <= now.getTime()) return 'post_err_time_past';
  }
  return null;
}

/**
 * The wizard's client-side gate for the LONG-TERM step.
 * Dates first, then the time; past dates and spans over a week are rejected
 * here as well as in the calendar, so a range cannot slip through on submit.
 */
export function validateMultiDay(
  start: Date | null,
  end: Date | null,
  clock: ClockTime | null,
  now: Date = new Date()
): BookingErrorKey | null {
  if (!isValidDate(start) || !isValidDate(end)) return 'post_err_dates_pick';
  const today = localDay(now);
  if (wholeDaysBetween(today, start) < 0) return 'post_err_dates_past';
  if (wholeDaysBetween(start, end) < 0) return 'post_err_dates_pick';
  if (rangeExceedsMaxDays(start, end)) return 'post_err_dates_max';
  if (!clock || minutesOfDay(clock.hour, clock.minute) === null) return 'post_err_time';
  if (isSameLocalDay(start, today)) {
    const at = composeInstant(start, clock.hour, clock.minute);
    if (at.getTime() <= now.getTime()) return 'post_err_time_past';
  }
  return null;
}

/**
 * ONE_TIME milestones: exactly one, as the task and the schema require.
 * `expected_hours` is a number on the wire.
 */
export function buildOneTimeMilestones(
  day: Date,
  clock: ClockTime,
  expectedHours: number
): MilestoneDraft[] {
  const at = composeInstant(day, clock.hour, clock.minute);
  return [{ scheduled_at: at.toISOString(), expected_hours: expectedHours }];
}

/**
 * MULTI_DAY milestones: one per day, each day at the same clock time, each
 * carrying the same per-day expected_hours. Milestone N is day N, so a 1-day
 * long-term booking produces exactly one milestone and a 7-day booking seven.
 */
export function buildMultiDayMilestones(
  days: Date[],
  clock: ClockTime,
  expectedHours: number
): MilestoneDraft[] {
  return days.map((day) => ({
    scheduled_at: composeInstant(day, clock.hour, clock.minute).toISOString(),
    expected_hours: expectedHours,
  }));
}

/** BookingKind → the exact BookingType enum value the API expects. */
export function bookingTypeFor(kind: BookingKind): JobBookingType {
  return kind === 'multi_day' ? 'MULTI_DAY' : 'ONE_TIME';
}

/** Keep the stepper inside the product bounds (and integers, as sent). */
export function clampExpectedHours(hours: number): number {
  if (!Number.isFinite(hours)) return MIN_EXPECTED_HOURS;
  return Math.min(MAX_EXPECTED_HOURS, Math.max(MIN_EXPECTED_HOURS, Math.round(hours)));
}
