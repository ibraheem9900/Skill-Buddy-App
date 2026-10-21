/**
 * postWizard.ts
 *
 * Pure rules behind the REBUILT Post-a-Job wizard's Date & Time step:
 *
 *   • the inline 7-day date strip (today .. today+6) — no calendar sheet;
 *   • one TASK per selected day (the API's `milestones`, max 7), each with its
 *     OWN time, kept in sync with the strip in both directions;
 *   • deselecting a preset slot or a custom window.
 *
 * Everything here is a plain function over plain values (no React, no Intl), so
 * the screen only renders what these helpers decide and every rule below is
 * covered by lib/__tests__/postWizard.test.ts.
 *
 * ── WHAT THE API STILL SAYS (live OpenAPI, re-read 2026-10-21) ─────────────
 *   JobMilestoneCreate: { scheduled_at (date-time, required), expected_hours }
 *   JobCreate.milestones: max 7 entries, all within one week of the first.
 * There is still NO per-milestone title and NO end-of-window field, so a task's
 * custom NAME and its END time never reach the API as their own fields: the
 * start of each task is its `scheduled_at`, and the window end rides in the
 * description (lib/jobCreate.buildPreferredTimeLine), exactly as before.
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
 * the five presets has not started yet; every later day is always open. This is
 * what disables today's column on the strip.
 */
export function hasBookableTime(day: Date, now: Date = new Date()): boolean {
  if (!isValidDate(day)) return false;
  const today = localDay(now);
  if (day.getTime() !== today.getTime()) return day.getTime() > today.getTime();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return FIXED_SLOTS.some((slot) => slot.start.hour * 60 + slot.start.minute > nowMinutes);
}

/**
 * Toggle one strip day. Any of the seven can be picked, in any order, and a
 * second tap removes it — no start-date lock, no minimum. Today is refused once
 * it has no remaining slots.
 */
export function toggleAgendaDay(selected: Date[], day: Date, now: Date = new Date()): Date[] {
  if (!isValidDate(day)) return selected;
  const window = agendaWindow(now);
  const inWindow = window.some((candidate) => candidate.getTime() === localDay(day).getTime());
  if (!inWindow) return selected;
  if (!hasBookableTime(day, now)) return selected;

  const exists = selected.some((picked) => isSameLocalDay(picked, day));
  const next = exists
    ? selected.filter((picked) => !isSameLocalDay(picked, day))
    : [...selected, localDay(day)];
  return sortDays(next);
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

/** A task, remembered by LOCAL DAY so the strip and the list stay in sync. */
export interface TaskDraft {
  /** `YYYY-MM-DD` in local time — stable identity for one day. */
  key: string;
  /** Local midnight of the task's day. */
  day: Date;
  /** Custom name; null means the numbered default ("Task N"). */
  name: string | null;
  /** This task's own window — one per day, never shared. */
  time: TimeChoice | null;
}

/** `2026-10-21` for a local day (date parts only, never `toISOString`). */
export function dayKey(day: Date): string {
  if (!isValidDate(day)) return '';
  const month = day.getMonth() + 1;
  const date = day.getDate();
  return `${day.getFullYear()}-${month < 10 ? `0${month}` : month}-${date < 10 ? `0${date}` : date}`;
}

/** A fresh, untimed task for a day. */
export function buildTask(day: Date): TaskDraft {
  return { key: dayKey(day), day: localDay(day), name: null, time: null };
}

/**
 * Reconcile the task list with the selected days, in BOTH directions:
 *   • a newly selected day gets a new task card;
 *   • a deselected day's task is dropped;
 *   • every surviving task keeps its own name and time and its position is the
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

/** Replace one task's custom name ('' clears it back to the numbered default). */
export function setTaskName(tasks: TaskDraft[], key: string, name: string | null): TaskDraft[] {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return tasks.map((task) =>
    task.key === key ? { ...task, name: trimmed.length > 0 ? trimmed : null } : task
  );
}

/** Index of the first task that still has no valid time, or -1 when all have one. */
export function firstUntimedTask(tasks: TaskDraft[], now: Date = new Date()): number {
  return tasks.findIndex((task) => validateTimeChoice(task.time, task.day, now) !== null);
}

/**
 * The MULTI_DAY gate: at least one task, and EVERY task must carry a time that
 * is valid for its own day (so a task whose slot has already started today is
 * caught here, not by the backend).
 */
export function validateTasks(
  tasks: TaskDraft[],
  now: Date = new Date()
): BookingErrorKey | null {
  if (tasks.length === 0) return 'post_err_dates_pick';
  if (tasks.length > MAX_MILESTONE_DAYS) return 'post_err_dates_max';
  const index = firstUntimedTask(tasks, now);
  if (index < 0) return null;
  return validateTimeChoice(tasks[index].time, tasks[index].day, now) ?? 'post_err_time';
}

/**
 * One milestone per task, at that task's OWN window start. This is what makes
 * "each task has its own specific date and time" real on the wire; the days are
 * already inside the 7-day window by construction.
 */
export function buildTaskMilestones(tasks: TaskDraft[], expectedHours: number): MilestoneDraft[] {
  const hours = Number.isFinite(expectedHours) ? expectedHours : 1;
  return tasks
    .slice(0, MAX_MILESTONE_DAYS)
    .map((task) => {
      const win = selectionWindow(task.time);
      if (!win) return null;
      return {
        scheduled_at: composeInstant(task.day, win.start.hour, win.start.minute).toISOString(),
        expected_hours: hours,
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
