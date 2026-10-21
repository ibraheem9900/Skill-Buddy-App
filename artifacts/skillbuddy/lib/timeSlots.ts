/**
 * timeSlots.ts
 *
 * THE one place that knows the client's five appointment windows, the pilot's
 * half-hour arrival marks, the "expected hours end at 11 PM" rule, and how a
 * stored `scheduled_at` becomes a device-local day + clock reading.
 *
 * ── WHY THIS MODULE EXISTS ─────────────────────────────────────────────────
 * Before this, the five windows lived in lib/jobBooking.FIXED_SLOTS, the end of
 * a window was formatted ad hoc, the expected-hours ceiling was a flat 24 and
 * every screen formatted `scheduled_at` with `new Date(...).toLocaleString()`.
 * The API stores that instant as NAIVE UTC from GET (see lib/jobDetail), so a
 * job posted for 8:00 AM local rendered as "5:00:00 AM" on the details screen.
 * Slots, pilot marks, the 11 PM ceiling and the local-time read now live here
 * and nowhere else.
 *
 * ── PRODUCT RULES (fixed by the product owner) ─────────────────────────────
 *   Client windows : 8-11 AM · 11 AM-2 PM · 2-5 PM · 5-8 PM · 8-11 PM
 *   Pilot arrival  : HALF-HOUR marks STRICTLY INSIDE the client's window —
 *                    the window's own start and end are never offered
 *                    (8-11 → 8:30, 9:00, 9:30, 10:00, 10:30).
 *   Expected hours : maximum = from the chosen START until 11:00 PM that day,
 *                    in whole hours, rounded down. The END of an Anytime window
 *                    never changes the cap.
 *                        8:00 AM → 15 h   11:00 AM → 12 h   2:00 PM → 9 h
 *                        5:00 PM →  6 h    8:00 PM →  3 h   10:00 PM → 1 h
 *                    A start that cannot leave at least one hour before 11 PM
 *                    (10:30 PM or later) is refused instead of clamped.
 *
 * Pure: no React, no axios, no Intl, so every rule is unit-tested.
 */

import { parseApiIsoUtc } from '@/lib/jobDetail';

/* ── Clock values ────────────────────────────────────────────────────────── */

/** A 12/24-hour clock reading, the shape the whole wizard already uses. */
export interface ClockTime {
  hour: number;
  minute: number;
}

/** Minutes since local midnight for a reading, or null when it is impossible. */
export function minutesOf(clock: ClockTime | null | undefined): number | null {
  if (!clock) return null;
  const { hour, minute } = clock;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Minutes since midnight → a clock reading (wraps inside the day). */
export function clockOf(minutes: number): ClockTime {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

/* ── The five client windows ─────────────────────────────────────────────── */

export interface ClientSlot {
  /** Stable identity, also used by lib/jobBooking's legacy `key`s. */
  key: string;
  /** Local minutes since midnight at which the window opens. */
  startMinutes: number;
  /** Local minutes since midnight at which the window closes (exclusive). */
  endMinutes: number;
  start: ClockTime;
  end: ClockTime;
}

function slot(key: string, startHour: number, endHour: number): ClientSlot {
  return {
    key,
    startMinutes: startHour * 60,
    endMinutes: endHour * 60,
    start: { hour: startHour, minute: 0 },
    end: { hour: endHour, minute: 0 },
  };
}

/** The five windows, in the order they appear in the wizard. */
export const CLIENT_SLOTS: ClientSlot[] = [
  slot('slot_8_11', 8, 11),
  slot('slot_11_14', 11, 14),
  slot('slot_14_17', 14, 17),
  slot('slot_17_20', 17, 20),
  slot('slot_20_23', 20, 23),
];

/** 11:00 PM — the end of the working day for expected-hours arithmetic. */
export const DAY_END_MINUTES = 23 * 60;

/** The smallest bookable expected-hours value. */
export const MIN_EXPECTED_HOURS = 1;

/**
 * The largest cap any start can give — the earliest window's own ceiling. It is
 * only an upper bound for the API/README; the real cap is always computed from
 * the task's start with `maxHoursForStart`.
 */
export const MAX_DAILY_EXPECTED_HOURS = Math.floor(
  (DAY_END_MINUTES - CLIENT_SLOTS[0].startMinutes) / 60
);

/** A slot by its stable key, or null. */
export function slotByKey(key: string | null | undefined): ClientSlot | null {
  if (typeof key !== 'string') return null;
  return CLIENT_SLOTS.find((entry) => entry.key === key) ?? null;
}

/** The window containing this clock reading (start ≤ m < end), or null. */
export function slotContaining(minutes: number | null): ClientSlot | null {
  if (minutes === null) return null;
  return (
    CLIENT_SLOTS.find((entry) => minutes >= entry.startMinutes && minutes < entry.endMinutes) ?? null
  );
}

/** The window whose start is closest to this reading, or null. */
export function nearestSlot(minutes: number | null): ClientSlot | null {
  if (minutes === null) return null;
  let best: ClientSlot | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of CLIENT_SLOTS) {
    const distance = Math.abs(entry.startMinutes - minutes);
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The start/end a time choice describes — the shape the wizard, the task sheet
 * and the edit screen all hold. Null when the choice is unusable.
 */
export function selectionWindowOf(
  choice:
    | { kind: 'slot'; key: string }
    | { kind: 'anytime'; start: ClockTime; end: ClockTime }
    | null
    | undefined
): { start: ClockTime; end: ClockTime } | null {
  if (!choice) return null;
  if (choice.kind === 'slot') {
    const entry = slotByKey(choice.key);
    return entry ? { start: entry.start, end: entry.end } : null;
  }
  if (minutesOf(choice.start) === null || minutesOf(choice.end) === null) return null;
  return { start: choice.start, end: choice.end };
}

/* ── Pilot arrival marks ─────────────────────────────────────────────────── */

/** How far apart the pilot's choices are. */
export const PILOT_STEP_MINUTES = 30;

/**
 * The half-hour marks a pilot may propose for one CLIENT window: strictly
 * inside it, so neither the window's start nor its end is ever offered.
 *
 *   8:00 AM - 11:00 AM → 8:30, 9:00, 9:30, 10:00, 10:30
 *   8:00 PM - 11:00 PM → 8:30, 9:00, 9:30, 10:00, 10:30
 */
export function pilotTimesForSlot(
  target: string | ClientSlot | null | undefined
): ClockTime[] {
  const entry = typeof target === 'string' ? slotByKey(target) : target ?? null;
  if (!entry) return [];
  const marks: ClockTime[] = [];
  for (
    let minutes = entry.startMinutes + PILOT_STEP_MINUTES;
    minutes < entry.endMinutes;
    minutes += PILOT_STEP_MINUTES
  ) {
    marks.push(clockOf(minutes));
  }
  return marks;
}

/* ── Expected hours: "until 11 PM of that day" ───────────────────────────── */

/**
 * The largest expected-hours value a start allows: whole hours from that start
 * until 11:00 PM of the same day, rounded DOWN. 0 means the start leaves no
 * usable hour at all (10:30 PM or later) and must be refused.
 */
export function maxHoursForStart(startMinutes: number | null): number {
  if (startMinutes === null || !Number.isFinite(startMinutes)) return 0;
  if (startMinutes < 0 || startMinutes >= DAY_END_MINUTES) return 0;
  return Math.floor((DAY_END_MINUTES - startMinutes) / 60);
}

/** Is there at least one bookable hour before 11:00 PM from this start? */
export function canStartBeforeDayEnd(startMinutes: number | null): boolean {
  return maxHoursForStart(startMinutes) >= MIN_EXPECTED_HOURS;
}

/** Clamp a chosen hours value into [1, cap]. */
export function clampHours(hours: number, cap: number): number {
  const max = Math.max(MIN_EXPECTED_HOURS, Math.floor(cap));
  if (!Number.isFinite(hours)) return MIN_EXPECTED_HOURS;
  return Math.min(max, Math.max(MIN_EXPECTED_HOURS, Math.round(hours)));
}

/**
 * Does a chosen hours value exceed what its start allows? Used to decide
 * whether a time change must lower the value (and show the notice).
 */
export function exceedsHoursCap(hours: number, cap: number): boolean {
  return Number.isFinite(hours) && hours > Math.max(MIN_EXPECTED_HOURS, Math.floor(cap));
}

/* ── Formatting (translated tables are always passed in) ─────────────────── */

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `9:30 AM` from a clock reading and the translated meridiem labels. */
export function formatTimeLabel(
  clock: ClockTime | null | undefined,
  meridiem: { am: string; pm: string }
): string {
  const minutes = minutesOf(clock);
  if (minutes === null) return '';
  const hour24 = Math.floor(minutes / 60);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${pad2(minutes % 60)} ${hour24 >= 12 ? meridiem.pm : meridiem.am}`;
}

/** `8:00 AM - 11:00 AM` from two clock readings. */
export function formatWindowLabel(
  start: ClockTime | null | undefined,
  end: ClockTime | null | undefined,
  meridiem: { am: string; pm: string }
): string {
  const from = formatTimeLabel(start, meridiem);
  const to = formatTimeLabel(end, meridiem);
  if (from.length === 0) return '';
  return to.length > 0 ? `${from} - ${to}` : from;
}

/** `Thu 22 Oct` from the translated month/weekday tables. */
export function formatDayLabel(day: Date | null, months: string[], weekdays: string[]): string {
  if (!day || Number.isNaN(day.getTime())) return '';
  const weekday = weekdays[(day.getDay() + 6) % 7] ?? '';
  const month = months[day.getMonth()] ?? '';
  return `${weekday} ${day.getDate()} ${month}`.trim();
}

/* ── Stored instant → device-local day + clock ───────────────────────────── */

export interface LocalStart {
  /** Local midnight of the day the instant falls on, in the DEVICE's zone. */
  day: Date;
  /** Local minutes since midnight. */
  minutes: number;
  clock: ClockTime;
}

/**
 * The ONE conversion from a stored `scheduled_at` to the device's local day and
 * clock. The server stores UTC and GET returns it without a zone marker, so the
 * shared `parseApiIsoUtc` rule decides how the string is read — never
 * `toISOString()` and never a raw `getUTCHours()`.
 */
export function localStartOf(value: string | null | undefined): LocalStart | null {
  const instant = parseApiIsoUtc(value);
  if (!instant) return null;
  const day = new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());
  const minutes = instant.getHours() * 60 + instant.getMinutes();
  return { day, minutes, clock: clockOf(minutes) };
}

/** `Thu 22 Oct · 8:00 AM` (local) for a stored instant, or ''. */
export function formatLocalDateTime(
  value: string | null | undefined,
  months: string[],
  weekdays: string[],
  meridiem: { am: string; pm: string }
): string {
  const local = localStartOf(value);
  if (!local) return '';
  const day = formatDayLabel(local.day, months, weekdays);
  const clock = formatTimeLabel(local.clock, meridiem);
  return [day, clock].filter((part) => part.length > 0).join(' · ');
}

/* ── The stored "Preferred time:" line ───────────────────────────────────── */

/** Exact prefix of the stored schedule line (fixed English, never translated). */
export const SCHEDULE_PREFIX = 'Preferred time:';

/** One parsed window of the stored line. */
export interface ScheduleSegment {
  /** `Task 2` → 2; null for a single-day line. */
  taskNumber: number | null;
  startMinutes: number;
  /** Null when the line only carried a start (never written by this app). */
  endMinutes: number | null;
}

const SEGMENT_RE =
  /(?:task\s*(\d+)\s*:?\s*)?(\d{1,2}):(\d{2})\s*(am|pm)?\s*[-–]\s*(\d{1,2}):(\d{2})\s*(am|pm)?/gi;

function to24(hour: number, minute: number, meridiem: string | undefined): number | null {
  if (!Number.isInteger(hour) || hour > 23 || minute > 59) return null;
  if (!meridiem) return hour * 60 + minute;
  if (hour > 12 || hour === 0) return null;
  const base = hour % 12;
  return (meridiem.toLowerCase() === 'pm' ? base + 12 : base) * 60 + minute;
}

/**
 * Read every `Task N 8:00 AM - 11:00 AM` window out of a stored description.
 * Returns [] when the description has no line, so callers fall back to the
 * instant itself. The line is data written by earlier versions, so the parser
 * accepts an optional `Task N`, an en dash and a 24-hour reading.
 */
export function parseScheduleSegments(description: string | null | undefined): ScheduleSegment[] {
  const text = typeof description === 'string' ? description : '';
  const marker = text.lastIndexOf(SCHEDULE_PREFIX);
  if (marker < 0) return [];
  const tail = text.slice(marker + SCHEDULE_PREFIX.length).split('\n')[0];

  const segments: ScheduleSegment[] = [];
  SEGMENT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SEGMENT_RE.exec(tail)) !== null) {
    const start = to24(Number(match[2]), Number(match[3]), match[4]);
    const end = to24(Number(match[5]), Number(match[6]), match[7]);
    if (start === null) continue;
    segments.push({
      taskNumber: match[1] ? Number(match[1]) : null,
      startMinutes: start,
      endMinutes: end,
    });
  }
  return segments;
}

/** The stored description WITHOUT its `Preferred time:` line. */
export function stripScheduleBlock(description: string | null | undefined): string {
  const text = typeof description === 'string' ? description : '';
  const trimmed = text.replace(/\s+$/, '');
  const marker = trimmed.lastIndexOf(SCHEDULE_PREFIX);
  if (marker < 0) return trimmed;
  const before = trimmed.slice(0, marker);
  // Only the line itself is removed: anything the user wrote before it stays,
  // including a line that merely mentions "preferred time".
  const lineStart = before.lastIndexOf('\n');
  const sameLinePrefix = lineStart >= 0 ? before.slice(lineStart + 1) : before;
  if (sameLinePrefix.trim().length > 0) return trimmed;
  return (lineStart >= 0 ? before.slice(0, lineStart) : '').replace(/\s+$/, '');
}

/** One window to write into the stored line. */
export interface ScheduleLinePart {
  /** 1-based task number, or null for a single-day line. */
  taskNumber?: number | null;
  startMinutes: number;
  endMinutes: number;
  meridiem: { am: string; pm: string };
}

/**
 * Build the stored line from the FINAL list of tasks — the fixed English format
 * earlier versions wrote, so already-posted jobs stay readable and nothing is
 * ever duplicated (the caller always rebuilds from scratch).
 *
 *   Single day : Preferred time: 8:00 AM - 11:00 AM
 *   Several    : Preferred time: Task 1 8:00 AM - 11:00 AM; Task 2 5:00 PM - 8:00 PM
 */
export function buildScheduleLine(parts: ScheduleLinePart[]): string | null {
  const segments = parts
    .filter((part) => Number.isFinite(part.startMinutes) && Number.isFinite(part.endMinutes))
    .map((part) => {
      const window = formatWindowLabel(
        clockOf(part.startMinutes),
        clockOf(part.endMinutes),
        part.meridiem
      );
      if (window.length === 0) return '';
      return part.taskNumber != null ? `Task ${part.taskNumber} ${window}` : window;
    })
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  return `${SCHEDULE_PREFIX} ${segments.join('; ')}`;
}

/* ── Which window a job's own task belongs to ────────────────────────────── */

/** A stored task as the API returns it. */
export interface DeriveSlotInput {
  scheduledAt: string | null | undefined;
  /**
   * The matching segment of the stored schedule line (the N-th task, matched
   * by date by the caller). Preferred over the instant, because an Anytime
   * booking is stored as its start and only the line knows the real window.
   */
  segment?: ScheduleSegment | null;
}

/** What a task's time choice should be shown as. */
export type DerivedTime =
  | { kind: 'slot'; key: string }
  | { kind: 'anytime'; start: ClockTime; end: ClockTime };

/**
 * The window a job's task was booked in:
 *   1. the stored schedule segment, when the caller found one — an exact
 *      match with one of the five windows becomes that slot, anything else is
 *      an Anytime window (so a custom 9:00 AM - 12:00 PM is not silently
 *      rewritten into 8-11 AM);
 *   2. otherwise the LOCAL start time: a start exactly on a window's start is
 *      that slot, a start inside a window belongs to it (a pilot's 9:30 mark
 *      is still an 8-11 AM booking);
 *   3. otherwise the NEAREST window start (a 7:00 AM instant belongs to the
 *      8-11 AM booking it opened);
 *   4. no readable instant at all → null (nothing can be preselected).
 *
 * Anytime therefore only ever comes from step 1: the stored window is the only
 * place a custom start/end was ever written down.
 */
export function deriveSlotOf(input: DeriveSlotInput): DerivedTime | null {
  const segment = input.segment ?? null;
  if (segment && Number.isFinite(segment.startMinutes)) {
    const containing = slotContaining(segment.startMinutes);
    if (
      containing &&
      containing.startMinutes === segment.startMinutes &&
      (segment.endMinutes === null || segment.endMinutes === containing.endMinutes)
    ) {
      return { kind: 'slot', key: containing.key };
    }
    const end =
      segment.endMinutes !== null && segment.endMinutes > segment.startMinutes
        ? segment.endMinutes
        : Math.min(segment.startMinutes + 60, DAY_END_MINUTES);
    return {
      kind: 'anytime',
      start: clockOf(segment.startMinutes),
      end: clockOf(end),
    };
  }

  const local = localStartOf(input.scheduledAt);
  if (!local) return null;

  const containing = slotContaining(local.minutes);
  if (containing) return { kind: 'slot', key: containing.key };

  const nearest = nearestSlot(local.minutes);
  return nearest ? { kind: 'slot', key: nearest.key } : null;
}

/**
 * Pair a job's stored tasks with the segments of its schedule line.
 *
 * The line names its tasks explicitly when the booking had several days, so
 * the number is used; a single-day line (no number) belongs to the only task.
 * Anything unmatched stays null and `deriveSlotOf` falls back to the instant.
 */
export function segmentsForTasks(
  segments: ScheduleSegment[],
  count: number
): Array<ScheduleSegment | null> {
  if (count <= 0) return [];
  const byNumber = new Map<number, ScheduleSegment>();
  for (const segment of segments) {
    if (segment.taskNumber != null && !byNumber.has(segment.taskNumber)) {
      byNumber.set(segment.taskNumber, segment);
    }
  }
  const numbered = segments.some((segment) => segment.taskNumber != null);
  return Array.from({ length: count }, (_, index) => {
    if (numbered) return byNumber.get(index + 1) ?? null;
    return count === 1 ? segments[0] ?? null : segments[index] ?? null;
  });
}
