/**
 * postWizard.ts
 *
 * Pure rules behind the REBUILT Post-a-Job wizard's Date & Time step and the
 * new Tasks step:
 *
 *   • ONE active day at a time on the 7-day strip: selecting a day makes it
 *     active, tapping it again removes it, tapping another selected day just
 *     makes it active;
 *   • ONE time choice per selected day (the five client windows or Anytime),
 *     edited for the ACTIVE day only;
 *   • one task per selected day (the API's `milestones`, max 7), each with its
 *     OWN time and its OWN expected hours, capped by the 11 PM rule for that
 *     task's start (lib/timeSlots);
 *   • renumbering after a delete, and a payload with one milestone per task.
 *
 * Everything here is a plain function over plain values (no React, no Intl), so
 * the screen only renders what these helpers decide and every rule below is
 * covered by lib/__tests__/postWizard.test.ts.
 *
 * ── WHAT THE API STILL SAYS (live OpenAPI, re-read 2026-10-22) ─────────────
 *   JobMilestoneCreate: { scheduled_at (date-time, required), expected_hours }
 *   JobCreate.milestones: max 7 entries, all within one week of the first.
 * There is still NO per-milestone title and NO end-of-window field, so a task's
 * window end never reaches the API as its own field: the start of each task is
 * its `scheduled_at`, and the window rides in the description
 * (lib/timeSlots.buildScheduleLine), exactly as before.
 */

import {
  FIXED_SLOTS,
  MAX_MILESTONE_DAYS,
  type MilestoneDraft,
  type TimeChoice,
  addLocalDays,
  composeInstant,
  isSameLocalDay,
  isValidDate,
  localDay,
  selectionWindow,
  sortDays,
  validateTimeChoice,
  type BookingErrorKey,
} from '@/lib/jobBooking';
import {
  MIN_EXPECTED_HOURS,
  canStartBeforeDayEnd,
  clampHours,
  exceedsHoursCap,
  maxHoursForStart,
  minutesOf,
  type ClockTime,
} from '@/lib/timeSlots';

/** The strip is always one week — the only span MULTI_DAY accepts. */
export const AGENDA_DAYS = MAX_MILESTONE_DAYS;

/* ── The 7-day strip ─────────────────────────────────────────────────────── */

/** Today and the six days after it, as local midnights (never mutated). */
export function agendaWindow(now: Date = new Date()): Date[] {
  const today = localDay(now);
  return Array.from({ length: AGENDA_DAYS }, (_, index) => addLocalDays(today, index));
}

/**
 * Is there still a time to book on `day`? For today that means at least one of
 * the five windows has not started yet; every later day is always open. This is
 * what draws today's "Already started" state on the strip.
 */
export function hasBookableTime(day: Date, now: Date = new Date()): boolean {
  if (!isValidDate(day)) return false;
  const today = localDay(now);
  if (day.getTime() !== today.getTime()) return day.getTime() > today.getTime();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return FIXED_SLOTS.some((slot) => slot.start.hour * 60 + slot.start.minute > nowMinutes);
}

/* ── Month label above the strip ─────────────────────────────────────────── */

/**
 * `Oct 2026`, `Oct - Nov 2026`, or `Dec 2026 - Jan 2027` when the seven days
 * cross a year boundary. Month names come from the translated `post_sched_months`
 * table (index 0 = January), never from Intl.
 */
export function monthSpanLabel(days: Date[], months: string[]): string {
  const valid = days.filter(isValidDate);
  if (valid.length === 0) return '';
  const first = valid[0];
  const last = valid[valid.length - 1];
  const name = (month: number) => months[month] ?? '';
  const sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear();
  if (sameMonth) return `${name(first.getMonth())} ${first.getFullYear()}`.trim();
  const sameYear = first.getFullYear() === last.getFullYear();
  const head = `${name(first.getMonth())}${sameYear ? '' : ` ${first.getFullYear()}`}`;
  return `${head} - ${name(last.getMonth())} ${last.getFullYear()}`.trim();
}

/* ── Tasks (the wire's `milestones`) ─────────────────────────────────────── */

/**
 * A task, remembered by LOCAL DAY so the strip and the list stay in sync.
 * There is no custom name any more: a task is "Task N", numbered by position.
 */
export interface TaskDraft {
  /** `YYYY-MM-DD` in local time — stable identity for one day. */
  key: string;
  /** Local midnight of the task's day. */
  day: Date;
  /** This task's own window — one per day, never shared. */
  time: TimeChoice | null;
  /** This task's own expected hours (default 1). */
  hours: number;
}

/** `2026-10-21` for a local day (date parts only, never `toISOString`). */
export function dayKey(day: Date): string {
  if (!isValidDate(day)) return '';
  const month = day.getMonth() + 1;
  const date = day.getDate();
  return `${day.getFullYear()}-${month < 10 ? `0${month}` : month}-${date < 10 ? `0${date}` : date}`;
}

/** A fresh, untimed task for a day. */
export function buildTask(day: Date, hours: number = MIN_EXPECTED_HOURS): TaskDraft {
  return { key: dayKey(day), day: localDay(day), time: null, hours };
}

/**
 * Reconcile the task list with the selected days, in BOTH directions:
 *   • a newly selected day gets a new task card;
 *   • a deselected day's task is dropped;
 *   • every surviving task keeps its own time and hours and its position is the
 *     chronological one of its day.
 */
export function syncTasks(tasks: TaskDraft[], days: Date[]): TaskDraft[] {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  return sortDays(days.filter(isValidDate)).map((day) => {
    const key = dayKey(day);
    const existing = byKey.get(key);
    return existing ? { ...existing, day: localDay(day) } : buildTask(day);
  });
}

/** Replace one task's time (identity by day key). */
export function setTaskTime(tasks: TaskDraft[], key: string, time: TimeChoice | null): TaskDraft[] {
  return tasks.map((task) => (task.key === key ? { ...task, time } : task));
}

/** The 11 PM ceiling for one task, or null while it has no time yet. */
export function taskHoursCap(task: TaskDraft | null | undefined): number | null {
  if (!task) return null;
  const win = selectionWindow(task.time);
  if (!win) return null;
  return maxHoursForStart(minutesOf(win.start));
}

/** Set one task's hours, clamped to its own 11 PM ceiling. */
export function setTaskHours(tasks: TaskDraft[], key: string, hours: number): TaskDraft[] {
  return tasks.map((task) => {
    if (task.key !== key) return task;
    const cap = taskHoursCap(task);
    return { ...task, hours: clampHours(hours, cap ?? MIN_EXPECTED_HOURS) };
  });
}

/**
 * Apply a new time to one task AND re-clamp its hours to the new ceiling.
 * Returns the clamped-away value (null when nothing had to change) so the
 * screen can show its short "hours adjusted" notice.
 */
export function applyTaskTime(
  tasks: TaskDraft[],
  key: string,
  time: TimeChoice | null
): { tasks: TaskDraft[]; loweredFrom: number | null } {
  return tasks.reduce<{ tasks: TaskDraft[]; loweredFrom: number | null }>(
    (acc, task) => {
      if (task.key !== key) {
        acc.tasks.push(task);
        return acc;
      }
      const withTime: TaskDraft = { ...task, time };
      const cap = taskHoursCap(withTime);
      if (cap === null) {
        acc.tasks.push({ ...withTime, hours: Math.max(MIN_EXPECTED_HOURS, task.hours) });
        return acc;
      }
      if (exceedsHoursCap(task.hours, cap)) {
        acc.loweredFrom = task.hours;
        acc.tasks.push({ ...withTime, hours: clampHours(task.hours, cap) });
        return acc;
      }
      acc.tasks.push({ ...withTime, hours: Math.max(MIN_EXPECTED_HOURS, task.hours) });
      return acc;
    },
    { tasks: [], loweredFrom: null }
  );
}

/* ── The strip's selection state machine ─────────────────────────────────── */

/** What the Date & Time step remembers about the strip. */
export interface DaySelection {
  /** Selected local days, chronological and de-duplicated. */
  days: Date[];
  /** The day whose time grid is on screen (`YYYY-MM-DD`), or null. */
  activeKey: string | null;
}

/** The task key of the active day, or null. */
export function activeDayOf(selection: DaySelection, tasks: TaskDraft[]): TaskDraft | null {
  if (!selection.activeKey) return null;
  return tasks.find((task) => task.key === selection.activeKey) ?? null;
}

/**
 * One tap on the strip:
 *   • an unselected, bookable day → SELECTED and ACTIVE;
 *   • a selected but inactive day → just ACTIVE (its time stays);
 *   • the ACTIVE selected day → DESELECTED (its time goes with it) and the
 *     next selected day becomes active, or none.
 * Today is refused once every window has started.
 *
 * `removedKey` tells the caller which task to drop, so the task list and the
 * strip can never disagree.
 */
export function applyDayTap(
  selection: DaySelection,
  day: Date,
  tasks: TaskDraft[],
  now: Date = new Date()
): { selection: DaySelection; removedKey: string | null } {
  if (!isValidDate(day)) return { selection, removedKey: null };
  const window = agendaWindow(now);
  const inWindow = window.some((candidate) => candidate.getTime() === localDay(day).getTime());
  if (!inWindow) return { selection, removedKey: null };

  const key = dayKey(day);
  const selected = selection.days.some((picked) => isSameLocalDay(picked, day));

  if (!selected) {
    if (!hasBookableTime(day, now)) return { selection, removedKey: null };
    return {
      selection: { days: sortDays([...selection.days, localDay(day)]), activeKey: key },
      removedKey: null,
    };
  }

  if (selection.activeKey !== key) {
    return { selection: { ...selection, activeKey: key }, removedKey: null };
  }

  const remaining = selection.days.filter((picked) => !isSameLocalDay(picked, day));
  return {
    selection: { days: remaining, activeKey: remaining.length > 0 ? dayKey(remaining[0]) : null },
    removedKey: key,
  };
}

/**
 * Make a day active WITHOUT touching its selected state — the caller uses it
 * after a delete, where the day is already gone from the list.
 */
export function activeAfterDelete(days: Date[], removedKey: string): DaySelection {
  const first = sortDays(days.filter(isValidDate))[0];
  return { days: sortDays(days.filter(isValidDate)), activeKey: first ? dayKey(first) : null };
}

/* ── Validation ──────────────────────────────────────────────────────────── */

/** Index of the first task that still has no valid time, or -1 when all have one. */
export function firstUntimedTask(tasks: TaskDraft[], now: Date = new Date()): number {
  return tasks.findIndex((task) => validateTimeChoice(task.time, task.day, now) !== null);
}

/**
 * The MULTI_DAY gate for the DATE & TIME step: at least one day, and EVERY
 * selected day must carry a time that is valid for its own day.
 */
export function validateTasks(
  tasks: TaskDraft[],
  now: Date = new Date()
): BookingErrorKey | null {
  if (tasks.length === 0) return 'post_err_dates_pick';
  if (tasks.length > MAX_MILESTONE_DAYS) return 'post_err_dates_max';
  const index = firstUntimedTask(tasks, now);
  if (index < 0) return null;
  return validateTimeChoice(tasks[index].time, tasks[index].day, now) ?? 'post_err_day_time';
}

/** An Anytime start that leaves no hour before 11 PM cannot be booked. */
export function anytimeLeavesNoHour(task: TaskDraft): boolean {
  const win = selectionWindow(task.time);
  if (!win) return false;
  return !canStartBeforeDayEnd(minutesOf(win.start));
}

/* ── Payload ─────────────────────────────────────────────────────────────── */

/**
 * One milestone per task, at that task's OWN window start, carrying that
 * task's OWN expected hours. This is what makes "each task has its own specific
 * date, time and hours" real on the wire.
 */
export function buildTaskMilestones(tasks: TaskDraft[]): MilestoneDraft[] {
  return tasks
    .slice(0, MAX_MILESTONE_DAYS)
    .map((task) => {
      const win = selectionWindow(task.time);
      if (!win) return null;
      const cap = maxHoursForStart(minutesOf(win.start));
      return {
        scheduled_at: composeInstant(task.day, win.start.hour, win.start.minute).toISOString(),
        expected_hours: clampHours(task.hours, cap),
      };
    })
    .filter((entry): entry is MilestoneDraft => entry !== null);
}

/* ── Deselecting a time ──────────────────────────────────────────────────── */

/**
 * Toggle a preset slot: the same slot pressed twice clears the choice, which
 * re-arms "Please choose a time" and disables Next again.
 */
export function toggleSlot(choice: TimeChoice | null, key: string): TimeChoice | null {
  if (choice?.kind === 'slot' && choice.key === key) return null;
  return { kind: 'slot', key };
}

/**
 * The FIXED Anytime window: 8:00 AM - 11:00 PM, everywhere in the app. The old
 * custom start/end pickers are gone; "Anytime" is just another slot button, so
 * a second tap clears the choice, and the window it produces is always
 * 08:00 - 23:00 in the same payload shape as before.
 */
export const ANYTIME_START: ClockTime = { hour: 8, minute: 0 };
export const ANYTIME_END: ClockTime = { hour: 23, minute: 0 };

export function toggleAnytime(choice: TimeChoice | null): TimeChoice | null {
  if (choice?.kind === 'anytime') return null;
  return { kind: 'anytime', start: { ...ANYTIME_START }, end: { ...ANYTIME_END } };
}
