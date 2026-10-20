/**
 * jobBooking.ts
 *
 * Pure rules behind the Post-a-Job wizard's Booking Type / Request Type / Date &
 * Time steps. No React, no axios, no Intl — every rule below is unit-testable.
 *
 * ── WHAT THE LIVE OPENAPI ACTUALLY DEFINES (re-read 2026-10-20) ─────────────
 *   BookingType (enum): "ONE_TIME" | "MULTI_DAY"
 *   JobMilestoneCreate: { scheduled_at (required, date-time),
 *                         expected_hours (number | numeric string | null) }
 *   JobCreate: { service_id, category_id, title, description, request_type,
 *                booking_type, milestones, address, is_draft }
 * There is NO field for the END of a time window — `scheduled_at` is a single
 * instant per milestone — so the end of a slot is carried in the description by
 * lib/jobCreate.buildPreferredTimeLine (see the report).
 *
 * ── LIMITS CAPTURED LIVE 2026-10-20 (throwaway DRAFTs 14..27) ──────────────
 *   7 milestones ............................... 201
 *   8 milestones ............................... 422 "cannot have more than 7 milestones"
 *   non-consecutive days ....................... 201  ← the new wizard shape
 *   duplicate scheduled_at ..................... 422 "cannot share the same date and time"
 *   one-milestone MULTI_DAY .................... 201
 *   start..start+6 ............................. 201
 *   start..start+7 ............................. 422 "within one week of the first milestone"
 *   description over 500 words ................. 422 "Description cannot exceed 500 words"
 *   scheduled_at 60 minutes in the past ........ 201 (no lead time is enforced)
 *
 * ── TIME ZONE RULE ─────────────────────────────────────────────────────────
 * Every instant is composed from LOCAL calendar parts
 * (`new Date(y, m, d, h, min, 0, 0)`) and serialised with `toISOString()`, so the
 * API always receives UTC and a booking made at 23:50 for "Tomorrow" lands on
 * tomorrow's local date; DST changes are handled by the platform's own
 * local-time arithmetic.
 */

import type { JobBookingType } from '@/types';

/** The wizard's form-level booking choice (the API value is derived from it). */
export type BookingKind = 'one_time' | 'multi_day';

/** One week, inclusive — the only span the backend accepts. */
export const MAX_MILESTONE_DAYS = 7;

/** Minutes are picked on the dial in these steps. */
export const TIME_MINUTE_STEP = 5;

/** Expected-hours bounds shown by the stepper (product limits, see header). */
export const MIN_EXPECTED_HOURS = 1;
export const MAX_EXPECTED_HOURS = 24;

/** The two one-time day choices. */
export type OneTimeDay = 'today' | 'tomorrow';

/** Error keys the wizard renders (all exist in every locale). */
export type BookingErrorKey =
  | 'post_err_time'
  | 'post_err_time_past'
  | 'post_err_dates_pick'
  | 'post_err_dates_past'
  | 'post_err_dates_max'
  | 'post_err_time_window';

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

/* ── Time choice: one of the five fixed slots, or "Anytime" with its own window */

/** The five fixed slots, with explicit 24-hour bounds (labels are built from it). */
export interface FixedSlot {
  key: string;
  start: ClockTime;
  end: ClockTime;
}

/** 8–11, 11–14, 14–17, 17–20, 20–23 — the same five chips, in order. */
export const FIXED_SLOTS: FixedSlot[] = [
  { key: 'slot_8_11', start: { hour: 8, minute: 0 }, end: { hour: 11, minute: 0 } },
  { key: 'slot_11_14', start: { hour: 11, minute: 0 }, end: { hour: 14, minute: 0 } },
  { key: 'slot_14_17', start: { hour: 14, minute: 0 }, end: { hour: 17, minute: 0 } },
  { key: 'slot_17_20', start: { hour: 17, minute: 0 }, end: { hour: 20, minute: 0 } },
  { key: 'slot_20_23', start: { hour: 20, minute: 0 }, end: { hour: 23, minute: 0 } },
];

/** What the wizard's Time section holds. */
export type TimeChoice =
  | { kind: 'slot'; key: string }
  | { kind: 'anytime'; start: ClockTime; end: ClockTime };

/** A fixed slot by key, or null for an unknown key. */
export function slotByKey(key: string): FixedSlot | null {
  return FIXED_SLOTS.find((slot) => slot.key === key) ?? null;
}

/** The start/end window a choice describes (null when the choice is unusable). */
export function selectionWindow(choice: TimeChoice | null | undefined): { start: ClockTime; end: ClockTime } | null {
  if (!choice) return null;
  if (choice.kind === 'slot') {
    const slot = slotByKey(choice.key);
    return slot ? { start: slot.start, end: slot.end } : null;
  }
  if (minutesOfDay(choice.start.hour, choice.start.minute) === null) return null;
  if (minutesOfDay(choice.end.hour, choice.end.minute) === null) return null;
  return { start: choice.start, end: choice.end };
}

/** Minutes between two readings of the same day (negative when out of order). */
export function windowMinutes(choice: TimeChoice | null | undefined): number {
  const win = selectionWindow(choice);
  if (!win) return 0;
  const start = minutesOfDay(win.start.hour, win.start.minute);
  const end = minutesOfDay(win.end.hour, win.end.minute);
  if (start === null || end === null) return 0;
  return end - start;
}

/** Is the window shorter than the expected hours? A non-blocking hint, never an error. */
export function windowShorterThanHours(choice: TimeChoice | null | undefined, hours: number): boolean {
  const minutes = windowMinutes(choice);
  if (minutes <= 0) return false;
  return minutes < hours * 60;
}

/**
 * The wizard's gate for the Time section.
 *  - a slot must be chosen;
 *  - Anytime's end must be strictly after its start (same day — no overnight);
 *  - a time that has already started cannot be booked for TODAY.
 */
export function validateTimeChoice(
  choice: TimeChoice | null,
  day: Date | null,
  now: Date = new Date()
): BookingErrorKey | null {
  const win = selectionWindow(choice);
  if (!win) return 'post_err_time';
  const startMinutes = minutesOfDay(win.start.hour, win.start.minute);
  const endMinutes = minutesOfDay(win.end.hour, win.end.minute);
  if (startMinutes === null || endMinutes === null) return 'post_err_time';
  if (endMinutes <= startMinutes) return 'post_err_time_window';
  if (isValidDate(day) && isSameLocalDay(day, now)) {
    const at = composeInstant(day, win.start.hour, win.start.minute);
    if (at.getTime() <= now.getTime()) return 'post_err_time_past';
  }
  return null;
}

/** Has this slot already started on `day`? Drives the "Already started" chip state. */
export function hasSlotStarted(
  choice: TimeChoice | null,
  day: Date | null,
  now: Date = new Date()
): boolean {
  const win = selectionWindow(choice);
  if (!win || !isValidDate(day)) return false;
  if (!isSameLocalDay(day, now)) return false;
  const at = composeInstant(day, win.start.hour, win.start.minute);
  return at.getTime() <= now.getTime();
}

/* ── Local-day maths ──────────────────────────────────────────────────────── */

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

/** Inclusive length of a span: the same day is 1, the day after is 2. */
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

/* ── The 7-day window with ANY-day selection ─────────────────────────────── */

/** The seven calendar days a start date opens: start .. start+6. */
export function windowDays(start: Date): Date[] {
  if (!isValidDate(start)) return [];
  return Array.from({ length: MAX_MILESTONE_DAYS }, (_, index) => addLocalDays(localDay(start), index));
}

/** The last day of that window. */
export function windowEndDay(start: Date): Date {
  return addLocalDays(localDay(start), MAX_MILESTONE_DAYS - 1);
}

/** Is this calendar day inside the window opened by `start`? */
export function isDayInWindow(day: Date, start: Date | null): boolean {
  if (!isValidDate(day) || !isValidDate(start)) return false;
  const offset = wholeDaysBetween(start, day);
  return offset >= 0 && offset <= MAX_MILESTONE_DAYS - 1;
}

/** Can this day be picked as a START date? (today or later) */
export function isStartDaySelectable(day: Date, minDay: Date): boolean {
  if (!isValidDate(day) || !isValidDate(minDay)) return false;
  return wholeDaysBetween(minDay, day) >= 0;
}

/**
 * Toggle one day in the selection. The START day is always selected and cannot
 * be removed; every other in-window day is free, so 20, 22 and 25 are a valid
 * (non-consecutive) selection. The result is chronological and de-duplicated.
 */
export function toggleSelectedDay(selected: Date[], start: Date | null, day: Date): Date[] {
  if (!isValidDate(day) || !isValidDate(start)) return selected;
  if (!isDayInWindow(day, start)) return selected;
  if (isSameLocalDay(day, start)) return sortDays([start, ...selected.filter((d) => !isSameLocalDay(d, start))]);

  const exists = selected.some((d) => isSameLocalDay(d, day));
  const next = exists
    ? selected.filter((d) => !isSameLocalDay(d, day))
    : [...selected, localDay(day)];
  // The start day is always part of the selection.
  if (!next.some((d) => isSameLocalDay(d, start))) next.push(localDay(start));
  return sortDays(next);
}

/** Chronological copy of a day list (never mutated). */
export function sortDays(days: Date[]): Date[] {
  return [...days].sort((a, b) => a.getTime() - b.getTime());
}

/**
 * The selection a start date implies on its own: just the start day.
 * Used when the start date changes — the chosen days are reset (the task's
 * "reset the chosen dates") while the time choice is kept.
 */
export function selectionForStart(start: Date | null): Date[] {
  return isValidDate(start) ? [localDay(start)] : [];
}

/** Combine a local day with an hour/minute clock into a local instant. */
export function composeInstant(day: Date, hour: number, minute: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
}

/** The local day for a one-time choice, relative to `now`. */
export function oneTimeDay(kind: OneTimeDay, now: Date = new Date()): Date {
  return kind === 'tomorrow' ? addLocalDays(localDay(now), 1) : localDay(now);
}

/* ── Clock formatting ────────────────────────────────────────────────────── */

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

/** `09:30`-style readout. */
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

/** `8:00 AM - 11:00 AM` for a clock window, with translated meridiem labels. */
export function formatWindowLabel(
  choice: TimeChoice | null,
  meridiem: { am: string; pm: string }
): string {
  const win = selectionWindow(choice);
  if (!win) return '';
  return `${formatTimeLabel(win.start.hour, win.start.minute, meridiem)} - ${formatTimeLabel(
    win.end.hour,
    win.end.minute,
    meridiem
  )}`;
}

/** `Mon 12 Oct` from the translated month/weekday tables. */
export function formatDayLabel(day: Date, months: string[], weekdays: string[]): string {
  if (!isValidDate(day)) return '';
  const weekday = weekdays[(day.getDay() + 6) % 7] ?? '';
  const month = months[day.getMonth()] ?? '';
  return `${weekday} ${day.getDate()} ${month}`.trim();
}

/** `Tue 20 Oct, Thu 22 Oct, Sat 25 Oct` — the chosen days, in order. */
export function formatDaysList(days: Date[], months: string[], weekdays: string[]): string {
  return sortDays(days)
    .map((day) => formatDayLabel(day, months, weekdays))
    .filter((label) => label.length > 0)
    .join(', ');
}

/** `Mon 12 Oct → Wed 14 Oct` (kept for a one-day collapse). */
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

/** `Tue 20` — a short day button label. */
export function formatDayButton(day: Date, weekdays: string[]): string {
  if (!isValidDate(day)) return '';
  const weekday = weekdays[(day.getDay() + 6) % 7] ?? '';
  return `${weekday} ${day.getDate()}`.trim();
}

/** Minutes-of-day for a clock reading, or null when the reading is impossible. */
export function minutesOfDay(hour24: number, minute: number): number | null {
  if (!Number.isInteger(hour24) || hour24 < 0 || hour24 > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return hour24 * 60 + minute;
}

/* ── Validation ──────────────────────────────────────────────────────────── */

/**
 * The wizard's client-side gate for the SINGLE-DAY step: a time is mandatory,
 * and "Today" never accepts a moment that has passed.
 */
export function validateOneTime(
  kind: OneTimeDay,
  choice: TimeChoice | null,
  now: Date = new Date()
): BookingErrorKey | null {
  const day = oneTimeDay(kind, now);
  const timeError = validateTimeChoice(choice, day, now);
  if (timeError) return timeError;
  if (kind === 'today') {
    const win = selectionWindow(choice);
    if (!win) return 'post_err_time';
    const at = composeInstant(day, win.start.hour, win.start.minute);
    if (at.getTime() <= now.getTime()) return 'post_err_time_past';
  }
  return null;
}

/**
 * The wizard's client-side gate for the MULTI-DAY step: a start date, at least
 * one selected day (the start is always selected), every day inside the 7-day
 * window, and a valid time.
 */
export function validateMultiDay(
  start: Date | null,
  days: Date[],
  choice: TimeChoice | null,
  now: Date = new Date()
): BookingErrorKey | null {
  if (!isValidDate(start)) return 'post_err_dates_pick';
  const today = localDay(now);
  if (wholeDaysBetween(today, start) < 0) return 'post_err_dates_past';
  if (days.length === 0) return 'post_err_dates_pick';
  if (days.length > MAX_MILESTONE_DAYS) return 'post_err_dates_max';
  if (days.some((day) => !isDayInWindow(day, start))) return 'post_err_dates_max';
  return validateTimeChoice(choice, start, now);
}

/* ── Milestones ──────────────────────────────────────────────────────────── */

/**
 * ONE_TIME milestones: exactly one, at the START of the chosen window.
 * `expected_hours` is a number on the wire.
 */
export function buildOneTimeMilestones(
  day: Date,
  choice: TimeChoice,
  expectedHours: number
): MilestoneDraft[] {
  const win = selectionWindow(choice);
  if (!win) return [];
  const at = composeInstant(day, win.start.hour, win.start.minute);
  return [{ scheduled_at: at.toISOString(), expected_hours: expectedHours }];
}

/**
 * MULTI_DAY milestones: one per SELECTED day (they need not be consecutive),
 * each at the same window start, each carrying the same per-day expected hours.
 */
export function buildMultiDayMilestones(
  days: Date[],
  choice: TimeChoice,
  expectedHours: number
): MilestoneDraft[] {
  const win = selectionWindow(choice);
  if (!win) return [];
  return sortDays(days).map((day) => ({
    scheduled_at: composeInstant(day, win.start.hour, win.start.minute).toISOString(),
    expected_hours: expectedHours,
  }));
}

/** BookingKind → the exact BookingType enum value the API expects. */
export function bookingTypeFor(kind: BookingKind): JobBookingType {
  return kind === 'multi_day' ? 'MULTI_DAY' : 'ONE_TIME';
}

/* ── The two-way Request Type ↔ Booking Type lock ─────────────────────────── */

/** The wizard's form-level request type (the API value is derived from it). */
export type FormRequestType = 'urgent' | 'regular';

export interface LockedBookingChoice {
  kind: BookingKind;
  requestType: FormRequestType;
  /** true when the incoming choice was corrected by the lock. */
  switched: boolean;
}

/**
 * Multi-day bookings are REGULAR only. The LIVE backend enforces this at create
 * time (HTTP 422 "Multiple-day bookings only support Regular bidding, not
 * Urgent", captured 2026-10-14). The lock is TWO-WAY on the screen:
 *   • picking Urgent for a multi-day booking answers `switched: true` and hands
 *     back 'regular';
 *   • picking Multi-day while Urgent is selected answers `switched: true` and
 *     hands back 'regular' too.
 * So the caller can always render the corrected, legal combination.
 */
export function resolveRequestTypeForBooking(
  kind: BookingKind,
  requestType: FormRequestType
): LockedBookingChoice {
  if (kind === 'multi_day' && requestType === 'urgent') {
    return { kind, requestType: 'regular', switched: true };
  }
  return { kind, requestType, switched: false };
}

/** May this request type be OFFERED for this booking kind? */
export function isRequestTypeAllowed(kind: BookingKind, requestType: FormRequestType): boolean {
  return !(kind === 'multi_day' && requestType === 'urgent');
}

/**
 * The screen-level state machine for the two card pairs, in one testable place.
 *
 *   requestType     what the Request Type cards show
 *   kind            what the Booking Type cards show
 *
 * Rules
 *  - default: regular + one_time;
 *  - choosing Urgent forces one_time (Multiple days is then disabled);
 *  - choosing Multiple days forces regular (Urgent is then disabled);
 *  - choosing Single day leaves the request type alone.
 *
 * `datesReset` tells the screen to clear the chosen days (the time slot is
 * kept), which the task requires whenever the booking type changes.
 */
export interface BookingChoice {
  requestType: FormRequestType;
  kind: BookingKind;
}

export interface BookingChoiceTransition extends BookingChoice {
  /** true when the other pair was corrected by the lock. */
  switched: boolean;
  /** true when the booking type changed, so the chosen dates must be cleared. */
  datesReset: boolean;
}

/** Apply a Request Type tap. */
export function applyRequestType(current: BookingChoice, requestType: FormRequestType): BookingChoiceTransition {
  if (requestType === 'urgent') {
    const switched = current.kind !== 'one_time';
    return {
      requestType: 'urgent',
      kind: 'one_time',
      switched,
      datesReset: switched,
    };
  }
  return { requestType: 'regular', kind: current.kind, switched: false, datesReset: false };
}

/** Apply a Booking Type tap. */
export function applyBookingKind(current: BookingChoice, kind: BookingKind): BookingChoiceTransition {
  const datesReset = kind !== current.kind;
  if (kind === 'multi_day') {
    const switched = current.requestType !== 'regular';
    return { requestType: 'regular', kind, switched, datesReset };
  }
  return { requestType: current.requestType, kind, switched: false, datesReset };
}

/** Is this booking kind offerable while `requestType` is selected? */
export function isBookingKindAllowed(kind: BookingKind, requestType: FormRequestType): boolean {
  return !(kind === 'multi_day' && requestType === 'urgent');
}

/** Keep the stepper inside the product bounds (and integers, as sent). */
export function clampExpectedHours(hours: number): number {
  if (!Number.isFinite(hours)) return MIN_EXPECTED_HOURS;
  return Math.min(MAX_EXPECTED_HOURS, Math.max(MIN_EXPECTED_HOURS, Math.round(hours)));
}
