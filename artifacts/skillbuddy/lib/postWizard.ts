/**
 * postWizard.ts
 *
 * Pure rules behind the REBUILT Post-a-Job wizard's Date & Time step and the
 * new Tasks step:
 *
 *   • ONE active day at a time on the 7-day strip: selecting a day makes it
 *     active, tapping it again removes it, tapping another selected day just
 *     makes it active;
 *   • SEVERAL time choices per selected day (the five client windows and/or
 *     Anytime), edited for the ACTIVE day only. The windows are a multi-select
 *     (up to MAX_SLOTS_PER_DAY distinct starts); Anytime is exclusive for its
 *     day, and choosing any regular window clears that day's Anytime;
 *   • one task per (day, time window) — the API's `milestones` — each with its
 *     OWN expected hours, capped by the 11 PM rule for that task's start
 *     (lib/timeSlots);
 *   • a MULTI_DAY booking needs at least MIN_DAYS_MULTIPLE distinct dates;
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

/**
 * A MULTI_DAY booking is a multiple-day task: ONE selected date is not enough.
 * The boss's report: "It shouldn't allow the user to continue with only one
 * date selected. It's a multiple day task. There needs to be at least 2 or more
 * days." Enforced on the Date & Time step, on the Tasks step and on submit.
 */
export const MIN_DAYS_MULTIPLE = 2;

/**
 * How many distinct time windows ONE day may carry. The five regular windows
 * can be combined; Anytime lives in the same cap (and excludes the others).
 */
export const MAX_SLOTS_PER_DAY = 5;

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
 * A task = ONE (day, time window) pair. Several tasks may share a day, so the
 * identity is the pair, never the day alone.
 * There is no custom name any more: a task is "Task N", numbered by position.
 */
export interface TaskDraft {
  /** `${dayKey}#${slotKey}` — unique per day + window. */
  key: string;
  /** `YYYY-MM-DD` in local time — the day this task belongs to. */
  dayKey: string;
  /** Local midnight of the task's day. */
  day: Date;
  /** This task's own window — shared by nothing. */
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

/** `none`, `anytime`, or the regular window key (e.g. `slot_8_11`). */
export function slotKeyOf(time: TimeChoice | null): string {
  if (!time) return 'none';
  return time.kind === 'anytime' ? 'anytime' : time.key;
}

/** The stable identity of one (day, window) task. */
export function taskKeyOf(dayKeyValue: string, time: TimeChoice | null): string {
  return `${dayKeyValue}#${slotKeyOf(time)}`;
}

/** A fresh, untimed task for a day. */
export function buildTask(day: Date, hours: number = MIN_EXPECTED_HOURS): TaskDraft {
  const local = localDay(day);
  const key = dayKey(local);
  return { key: taskKeyOf(key, null), dayKey: key, day: local, time: null, hours };
}

/** A fresh task for a day + window. */
export function buildTaskAt(day: Date, time: TimeChoice, hours: number = MIN_EXPECTED_HOURS): TaskDraft {
  const local = localDay(day);
  const key = dayKey(local);
  return { key: taskKeyOf(key, time), dayKey: key, day: local, time, hours };
}

/** Minutes since midnight of a window's start (null when the task has no time). */
function taskStartMinutes(task: TaskDraft): number {
  const win = selectionWindow(task.time);
  if (!win) return -1;
  return win.start.hour * 60 + win.start.minute;
}

/** Chronological: day first, then the window's start (untimed first). */
export function sortTasks(tasks: TaskDraft[]): TaskDraft[] {
  return tasks.slice().sort((a, b) => {
    if (a.dayKey !== b.dayKey) return a.dayKey < b.dayKey ? -1 : 1;
    return taskStartMinutes(a) - taskStartMinutes(b);
  });
}

/** Every task of one local day, chronological. */
export function tasksForDay(tasks: TaskDraft[], key: string): TaskDraft[] {
  return sortTasks(tasks.filter((task) => task.dayKey === key));
}

/** Distinct selected dates, chronologically ("2026-10-21", …). */
export function distinctDayKeys(tasks: TaskDraft[]): string[] {
  const seen = new Set<string>();
  for (const task of tasks) if (task.dayKey) seen.add(task.dayKey);
  return Array.from(seen).sort();
}

/** How many distinct dates the task list covers. */
export function distinctDayCount(tasks: TaskDraft[]): number {
  return distinctDayKeys(tasks).length;
}

/** Does this MULTI_DAY selection meet the two-date minimum? */
export function meetsMultipleDayMinimum(tasks: TaskDraft[]): boolean {
  return distinctDayCount(tasks) >= MIN_DAYS_MULTIPLE;
}

/**
 * Reconcile the task list with the selected days, in BOTH directions:
 *   • a newly selected day gets ONE untimed task card;
 *   • a deselected day's tasks (all of them) are dropped;
 *   • every surviving task keeps its own window and hours, and the list stays
 *     chronological — several tasks may share a day.
 */
export function syncTasks(tasks: TaskDraft[], days: Date[]): TaskDraft[] {
  const byDay = new Map<string, TaskDraft[]>();
  for (const task of tasks) {
    const key = task.dayKey || dayKey(task.day);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(task);
    else byDay.set(key, [task]);
  }
  const next: TaskDraft[] = [];
  for (const day of sortDays(days.filter(isValidDate))) {
    const key = dayKey(day);
    const existing = byDay.get(key);
    if (existing && existing.length > 0) {
      for (const task of existing) next.push({ ...task, dayKey: key, day: localDay(day) });
    } else {
      next.push(buildTask(day));
    }
  }
  return sortTasks(next);
}

/** Replace one task's time, keeping its identity in sync with the new window. */
export function setTaskTime(tasks: TaskDraft[], key: string, time: TimeChoice | null): TaskDraft[] {
  return sortTasks(
    tasks.map((task) =>
      task.key === key
        ? { ...task, time, key: taskKeyOf(task.dayKey, time) }
        : task
    )
  );
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
  const target = tasks.find((task) => task.key === key);
  if (!target) return { tasks, loweredFrom: null };
  const newKey = taskKeyOf(target.dayKey, time);
  // Editing a card onto a window that day already has would create a duplicate
  // (date, slot) pair; the grid is the place to toggle those, so ignore it here.
  if (tasks.some((task) => task.key === newKey && task.key !== key)) {
    return { tasks, loweredFrom: null };
  }
  const result = tasks.reduce<{ tasks: TaskDraft[]; loweredFrom: number | null }>(
    (acc, task) => {
      if (task.key !== key) {
        acc.tasks.push(task);
        return acc;
      }
      const withTime: TaskDraft = { ...task, time, key: newKey };
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
  return { tasks: sortTasks(result.tasks), loweredFrom: result.loweredFrom };
}

/* ── The strip's selection state machine ─────────────────────────────────── */

/** What the Date & Time step remembers about the strip. */
export interface DaySelection {
  /** Selected local days, chronological and de-duplicated. */
  days: Date[];
  /** The day whose time grid is on screen (`YYYY-MM-DD`), or null. */
  activeKey: string | null;
}

/** The first task of the active day (the day's own windows live beside it). */
export function activeDayOf(selection: DaySelection, tasks: TaskDraft[]): TaskDraft | null {
  if (!selection.activeKey) return null;
  return tasks.find((task) => task.dayKey === selection.activeKey) ?? null;
}

/**
 * One tap on the strip:
 *   • an unselected, bookable day → SELECTED and ACTIVE;
 *   • a selected but inactive day → just ACTIVE (its time stays);
 *   • the ACTIVE selected day → DESELECTED (its time goes with it) and the
 *     next selected day becomes active, or none.
 * Today is refused once every window has started.
 *
 * `removedKeys` tells the caller which tasks to drop (ALL of the deselected
 * day's windows, several of which may exist), so the task list and the strip
 * can never disagree.
 */
export function applyDayTap(
  selection: DaySelection,
  day: Date,
  tasks: TaskDraft[],
  now: Date = new Date()
): { selection: DaySelection; removedKeys: string[] } {
  if (!isValidDate(day)) return { selection, removedKeys: [] };
  const window = agendaWindow(now);
  const inWindow = window.some((candidate) => candidate.getTime() === localDay(day).getTime());
  if (!inWindow) return { selection, removedKeys: [] };

  const key = dayKey(day);
  const selected = selection.days.some((picked) => isSameLocalDay(picked, day));

  if (!selected) {
    if (!hasBookableTime(day, now)) return { selection, removedKeys: [] };
    return {
      selection: { days: sortDays([...selection.days, localDay(day)]), activeKey: key },
      removedKeys: [],
    };
  }

  if (selection.activeKey !== key) {
    return { selection: { ...selection, activeKey: key }, removedKeys: [] };
  }

  const remaining = selection.days.filter((picked) => !isSameLocalDay(picked, day));
  return {
    selection: { days: remaining, activeKey: remaining.length > 0 ? dayKey(remaining[0]) : null },
    removedKeys: tasks.filter((task) => task.dayKey === key).map((task) => task.key),
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

/* ── Several windows on one day ──────────────────────────────────────────── */

/** The window a day already carries (null while it still has its prompt). */
export function hasSlot(tasks: TaskDraft[], dayKeyValue: string, time: TimeChoice): boolean {
  const wanted = taskKeyOf(dayKeyValue, time);
  return tasks.some((task) => task.key === wanted);
}

/**
 * One tap on a window of the ACTIVE day:
 *   • a window the day already has → REMOVED;
 *   • Anytime → the day's ONLY window (the other windows are cleared first);
 *   • any regular window → added, and the day's Anytime is cleared;
 *   • the untimed prompt card is replaced by the first real window;
 *   • MAX_SLOTS_PER_DAY per day and MAX_MILESTONE_DAYS in total are enforced.
 * If the day loses its last window, its untimed prompt returns, so the day stays
 * selected and Next stays blocked with "choose a time" rather than silently
 * dropping a date.
 */
export function toggleTaskSlot(
  tasks: TaskDraft[],
  day: Date,
  time: TimeChoice
): { tasks: TaskDraft[]; action: 'added' | 'removed' | 'max-slots' | 'max-tasks' } {
  const local = localDay(day);
  const key = dayKey(local);
  const wanted = taskKeyOf(key, time);

  if (tasks.some((task) => task.key === wanted)) {
    const remaining = tasks.filter((task) => task.key !== wanted);
    if (!remaining.some((task) => task.dayKey === key)) {
      return { tasks: sortTasks([...remaining, buildTask(local)]), action: 'removed' };
    }
    return { tasks: sortTasks(remaining), action: 'removed' };
  }

  const others =
    time.kind === 'anytime'
      ? tasks.filter((task) => task.dayKey !== key)
      : tasks.filter(
          (task) =>
            task.dayKey !== key || (task.time?.kind !== 'anytime' && task.time !== null)
        );

  const onDay = tasks.filter((task) => task.dayKey === key && task.time !== null).length;
  if (onDay >= MAX_SLOTS_PER_DAY) return { tasks, action: 'max-slots' };
  if (others.length >= MAX_MILESTONE_DAYS) return { tasks, action: 'max-tasks' };

  return { tasks: sortTasks([...others, buildTaskAt(local, time)]), action: 'added' };
}

/** Drop ONE task (its day survives while it still has another window). */
export function removeTaskDraft(tasks: TaskDraft[], key: string): TaskDraft[] {
  return sortTasks(tasks.filter((task) => task.key !== key));
}

/* ── Validation ──────────────────────────────────────────────────────────── */

/** Index of the first task that still has no valid time, or -1 when all have one. */
export function firstUntimedTask(tasks: TaskDraft[], now: Date = new Date()): number {
  return tasks.findIndex((task) => validateTimeChoice(task.time, task.day, now) !== null);
}

/**
 * The MULTI_DAY gate for the DATE & TIME and TASKS steps: at least one task,
 * no more than the week's cap, at least two DISTINCT dates for a multiple-day
 * booking, and EVERY task must carry a time valid for its own day.
 */
export function validateTasks(
  tasks: TaskDraft[],
  now: Date = new Date(),
  options: { bookingType?: 'one_time' | 'multi_day' } = {}
): BookingErrorKey | null {
  if (tasks.length === 0) return 'post_err_dates_pick';
  if (tasks.length > MAX_MILESTONE_DAYS) return 'post_err_dates_max';
  if (options.bookingType === 'multi_day' && !meetsMultipleDayMinimum(tasks)) {
    return 'post_err_dates_min';
  }
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
