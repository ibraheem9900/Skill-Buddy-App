/**
 * The rebuilt Date & Time step and the new Tasks step, as pure rules.
 *
 *   • the inline 7-day strip (today .. today+6) and its month label;
 *   • ONE active day: select + activate, activate only, deselect;
 *   • one time per selected day, kept in sync with the task list;
 *   • per-task hours with the 11 PM ceiling, re-clamped when the time changes;
 *   • delete → renumbering and the empty state's gate;
 *   • per-task milestones and the Next gate.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import type { TimeChoice } from '../jobBooking';
import {
  activeAfterDelete,
  activeDayOf,
  agendaWindow,
  applyDayTap,
  applyTaskTime,
  buildTask,
  buildTaskMilestones,
  dayKey,
  firstUntimedTask,
  hasBookableTime,
  monthSpanLabel,
  setTaskHours,
  setTaskTime,
  syncTasks,
  taskHoursCap,
  toggleSlot,
  validateTasks,
  type DaySelection,
  type TaskDraft,
} from '../postWizard';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean) {
  if (ok) {
    passed += 1;
  } else {
    failures.push(label);
    console.log(`FAIL ${label}`);
  }
}

function eq<T>(label: string, actual: T, expected: T) {
  check(`${label} (got ${String(actual)}, want ${String(expected)})`, actual === expected);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Tuesday 20 October 2026, 14:00 local (matching the other wizard tests).
const NOW = new Date(2026, 9, 20, 14, 0, 0, 0);
const SLOT_8_11: TimeChoice = { kind: 'slot', key: 'slot_8_11' };
const SLOT_17_20: TimeChoice = { kind: 'slot', key: 'slot_17_20' };
const SLOT_20_23: TimeChoice = { kind: 'slot', key: 'slot_20_23' };
const ANYTIME_9_12: TimeChoice = {
  kind: 'anytime',
  start: { hour: 9, minute: 0 },
  end: { hour: 12, minute: 0 },
};

const day = (dayOfMonth: number, month = 9, year = 2026) => new Date(year, month, dayOfMonth);

/* ── The window ──────────────────────────────────────────────────────────── */

const window = agendaWindow(NOW);
eq('the strip is seven days', window.length, 7);
eq('the strip starts today', dayKey(window[0]), '2026-10-20');
eq('the strip ends on day seven', dayKey(window[6]), '2026-10-26');
eq('month label', monthSpanLabel(window, MONTHS), 'Oct 2026');
check('today still has a window at 2 PM', hasBookableTime(window[0], NOW));
check(
  'today has no window at 11:30 PM',
  !hasBookableTime(window[0], new Date(2026, 9, 20, 23, 30))
);

/* ── The selection state machine ─────────────────────────────────────────── */

const empty: DaySelection = { days: [], activeKey: null };

// Unselected day → selected AND active, with its task created by the caller.
const firstTap = applyDayTap(empty, day(22), [], NOW);
eq('selecting a day activates it', firstTap.selection.activeKey, '2026-10-22');
eq('one day selected', firstTap.selection.days.length, 1);
eq('nothing removed when selecting', firstTap.removedKey, null);

// A second, different day becomes active while the first stays selected.
let tasks: TaskDraft[] = syncTasks([], firstTap.selection.days).map((task) =>
  setTaskTime([task], task.key, SLOT_8_11)[0]
);
const secondTap = applyDayTap(firstTap.selection, day(25), tasks, NOW);
eq('second day becomes active', secondTap.selection.activeKey, '2026-10-25');
eq('both days stay selected', secondTap.selection.days.length, 2);
tasks = syncTasks(tasks, secondTap.selection.days);

// Tapping a selected-but-inactive day only activates it.
const activateOnly = applyDayTap(secondTap.selection, day(22), tasks, NOW);
eq('tapping a selected day activates it', activateOnly.selection.activeKey, '2026-10-22');
eq('activating removes nothing', activateOnly.removedKey, null);
eq('activating keeps both days', activateOnly.selection.days.length, 2);

// Tapping the ACTIVE day deselects it and hands back the key to drop.
const deselect = applyDayTap(activateOnly.selection, day(22), tasks, NOW);
eq('the active day is removed', deselect.selection.days.length, 1);
eq('the removed key is reported', deselect.removedKey, '2026-10-22');
eq('another selected day becomes active', deselect.selection.activeKey, '2026-10-25');
const afterDeselect = deselect.selection.days;
tasks = tasks.filter((task) => task.key !== deselect.removedKey);

// Removing the last selected day leaves no active day.
const last = applyDayTap(deselect.selection, day(25), tasks, NOW);
eq('removing the last day leaves none', last.selection.days.length, 0);
eq('and no active day', last.selection.activeKey, null);

// Today with no windows left cannot be added.
const lateNow = new Date(2026, 9, 20, 23, 30);
const refused = applyDayTap(empty, day(20), [], lateNow);
eq('a spent today cannot be selected', refused.selection.days.length, 0);

/* ── One time per day, tasks kept in sync ────────────────────────────────── */

let list = syncTasks([], [day(20), day(22)]);
eq('one task per selected day', list.length, 2);
eq('tasks are chronological', dayKey(list[0].day), '2026-10-20');
eq('a new task starts untimed', list[0].time, null);
eq('a new task starts at one hour', list[0].hours, 1);
check('untimed tasks block Next', firstUntimedTask(list, NOW) >= 0);

list = setTaskTime(list, '2026-10-22', SLOT_17_20);
eq('the chosen day gets its time', list[1].time?.kind, 'slot');
eq('the other day stays untimed', list[0].time, null);
eq('firstUntimedTask names the untimed one', firstUntimedTask(list, NOW), 0);

// TODAY at 2 PM can no longer book 8-11 (it has started), so its own evening
// window is used — the per-day validity rule, not a shared time.
list = setTaskTime(list, '2026-10-20', SLOT_17_20);
eq('every task can be timed independently', firstUntimedTask(list, NOW), -1);
eq('the Next gate opens', validateTasks(list, NOW), null);

// Deselecting a day drops its task; selecting it again starts untimed.
const kept = syncTasks(list, [day(20)]);
eq('deselecting drops the task', kept.length, 1);
eq('and its time', kept[0].key, '2026-10-20');

// A newly selected day gets a fresh card.
const regrown = syncTasks(kept, [day(20), day(24)]);
eq('a re-selected day gets a new card', regrown.length, 2);
eq('without the old time', regrown[1].time, null);

/* ── Per-task hours and the 11 PM ceiling ────────────────────────────────── */

let hours: TaskDraft[] = [buildTask(day(22))];
eq('no time means no ceiling', taskHoursCap(hours[0]), null);
hours = setTaskTime(hours, '2026-10-22', SLOT_8_11);
eq('an 8-11 window allows 15 h', taskHoursCap(hours[0]), 15);
hours = setTaskTime(hours, '2026-10-22', SLOT_20_23);
eq('an 8-11 PM window allows 3 h', taskHoursCap(hours[0]), 3);

hours = setTaskHours(hours, '2026-10-22', 12);
eq('hours are clamped to the ceiling', hours[0].hours, 3);
hours = setTaskHours(hours, '2026-10-22', 0);
eq('hours never fall below one', hours[0].hours, 1);

// Moving the time later lowers the hours and reports it.
const atEight = [{ key: '2026-10-22', day: day(22), time: SLOT_8_11, hours: 12 }];
const moved = applyTaskTime(atEight, '2026-10-22', SLOT_17_20);
eq('the new ceiling is applied', moved.tasks[0].hours, 6);
eq('the lowering is reported', moved.loweredFrom, 12);

// Moving earlier keeps the value and reports nothing.
const earlier = applyTaskTime(moved.tasks, '2026-10-22', SLOT_8_11);
eq('hours survive an earlier start', earlier.tasks[0].hours, 6);
eq('nothing is reported', earlier.loweredFrom, null);

/* ── Deselecting a time and the Anytime window ───────────────────────────── */

eq('a second tap clears the slot', toggleSlot(SLOT_8_11, 'slot_8_11'), null);
eq('another slot replaces it', toggleSlot(SLOT_8_11, 'slot_17_20')?.kind, 'slot');
eq(
  'an Anytime window becomes the choice',
  toggleSlot(ANYTIME_9_12, 'slot_8_11')?.kind,
  'slot'
);

/* ── Payload: one milestone per task, with its own hours ─────────────────── */

const payloadTasks: TaskDraft[] = [
  { key: '2026-10-20', day: day(20), time: SLOT_8_11, hours: 2 },
  { key: '2026-10-22', day: day(22), time: SLOT_17_20, hours: 3 },
  { key: '2026-10-24', day: day(24), time: null, hours: 1 },
];
const milestones = buildTaskMilestones(payloadTasks);
eq('a task without a time is not sent', milestones.length, 2);
eq(
  'each task uses its own window start',
  milestones[0].scheduled_at,
  new Date(2026, 9, 20, 8, 0, 0, 0).toISOString()
);
eq(
  'the second task keeps its own start',
  milestones[1].scheduled_at,
  new Date(2026, 9, 22, 17, 0, 0, 0).toISOString()
);
eq('each task carries its own hours', milestones[0].expected_hours, 2);
eq('the second task its own too', milestones[1].expected_hours, 3);

/* ── Delete → renumbering and the empty state ───────────────────────────── */

const three: TaskDraft[] = syncTasks([], [day(20), day(22), day(24)]);
const afterDelete = syncTasks(
  three,
  three.filter((task) => task.key !== dayKey(day(22))).map((task) => task.day)
);
eq('deleting a task drops it from the list', afterDelete.length, 2);
eq('and the strip closes up', dayKey(afterDelete[0].day), '2026-10-20');
eq('numbering follows the new order', dayKey(afterDelete[1].day), '2026-10-24');

const emptyState = activeAfterDelete([], '2026-10-22');
eq('deleting the last task leaves no active day', emptyState.activeKey, null);
eq('and no days', emptyState.days.length, 0);
eq('no task means Next stays blocked', validateTasks([], NOW), 'post_err_dates_pick');
eq('empty tasks have no active task', activeDayOf(emptyState, []), null);

console.log(`postWizard: ${passed} checks, ${failures.length} failure(s)`);
if (failures.length > 0) {
  throw new Error(`${failures.length} postWizard checks failed`);
}
