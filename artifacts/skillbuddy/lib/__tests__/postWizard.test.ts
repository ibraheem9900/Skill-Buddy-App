/**
 * The rebuilt Date & Time step, as pure rules.
 *
 *   • the inline 7-day strip (today .. today+6) and its month label;
 *   • select / deselect, including "today has no slots left";
 *   • tasks kept in sync with the strip in both directions;
 *   • per-task times, per-task milestones and the Next gate;
 *   • deselecting a preset slot.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import { composeInstant, type TimeChoice } from '../jobBooking';
import {
  agendaWindow,
  buildTask,
  buildTaskMilestones,
  dayKey,
  firstUntimedTask,
  hasBookableTime,
  monthSpanLabel,
  setTaskName,
  setTaskTime,
  syncTasks,
  toggleAgendaDay,
  toggleSlot,
  validateTasks,
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
const ANYTIME_9_12: TimeChoice = {
  kind: 'anytime',
  start: { hour: 9, minute: 0 },
  end: { hour: 12, minute: 0 },
};

const day = (dayOfMonth: number, month = 9, year = 2026) => new Date(year, month, dayOfMonth);

// ── The strip ──────────────────────────────────────────────────────────────
const strip = agendaWindow(NOW);
eq('the strip holds seven days', strip.length, 7);
eq('it starts today', dayKey(strip[0]), '2026-10-20');
eq('it ends today + 6', dayKey(strip[6]), '2026-10-26');
eq('there is no week before today', strip.some((d) => d.getTime() < day(20).getTime()), false);
check(
  'every strip day is a local midnight',
  strip.every((d) => d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0)
);

eq('one month reads as month + year', monthSpanLabel(strip, MONTHS), 'Oct 2026');
eq(
  'a month boundary names both months',
  monthSpanLabel([day(30), day(31), day(1, 10), day(5, 10)], MONTHS),
  'Oct - Nov 2026'
);
eq(
  'a year boundary keeps both years',
  monthSpanLabel([day(29, 11, 2026), day(4, 0, 2027)], MONTHS),
  'Dec 2026 - Jan 2027'
);
eq('an empty strip has no label', monthSpanLabel([], MONTHS), '');

// ── Today runs out of slots ────────────────────────────────────────────────
eq('today at 14:00 still has 17:00 and 20:00', hasBookableTime(day(20), NOW), true);
eq(
  'today at 21:30 has no slot left',
  hasBookableTime(day(20), new Date(2026, 9, 20, 21, 30)),
  false
);
eq('tomorrow is always open', hasBookableTime(day(21), NOW), true);
eq('yesterday is never open', hasBookableTime(day(19), NOW), false);

// ── Select / deselect ──────────────────────────────────────────────────────
let picked: Date[] = [];
picked = toggleAgendaDay(picked, day(20), NOW);
picked = toggleAgendaDay(picked, day(22), NOW);
eq('two days are selected', picked.length, 2);
eq('the selection is chronological', dayKey(picked[0]), '2026-10-20');
eq('any of the seven can be picked', dayKey(picked[1]), '2026-10-22');

picked = toggleAgendaDay(picked, day(22), NOW);
eq('tapping the same day deselects it', picked.length, 1);
eq('the remaining day is 20 Oct', dayKey(picked[0]), '2026-10-20');

const outside = toggleAgendaDay(picked, day(28), NOW);
eq('a day outside the window is ignored', outside.length, 1);
const exhausted = toggleAgendaDay([], day(20), new Date(2026, 9, 20, 21, 30));
eq('today cannot be picked once it has no slots', exhausted.length, 0);
eq(
  'the non-consecutive case (20 + 25) is allowed',
  toggleAgendaDay(toggleAgendaDay([], day(20), NOW), day(25), NOW).length,
  2
);

// ── Tasks follow the strip both ways ──────────────────────────────────────
const initial = syncTasks([], [day(20), day(22)]);
eq('one task per selected day', initial.length, 2);
eq('the task key is its local day', initial[0].key, '2026-10-20');
eq('a new task starts untimed', initial[0].time, null);
eq('a new task has no custom name', initial[0].name, null);

const edited = setTaskName(setTaskTime(initial, '2026-10-20', SLOT_8_11), '2026-10-20', 'Fix the tap');
const grown = syncTasks(edited, [day(20), day(21), day(22)]);
eq('selecting a day adds exactly one task', grown.length, 3);
eq('an existing task keeps its time', grown[0].time, SLOT_8_11);
eq('an existing task keeps its name', grown[0].name, 'Fix the tap');
eq('the new middle task is untimed', grown[1].time, null);

const shrunk = syncTasks(grown, [day(20), day(22)]);
eq('deselecting a day removes its task', shrunk.length, 2);
eq('the surviving task is untouched', shrunk[0].name, 'Fix the tap');
eq('the later task survives', shrunk[1].key, '2026-10-22');

eq('a blank name clears back to the default', setTaskName(edited, '2026-10-20', '   ')[0].name, null);

// ── The Next gate ─────────────────────────────────────────────────────────
const untimed: TaskDraft[] = [buildTask(day(20)), buildTask(day(21))];
eq('the first untimed task is reported', firstUntimedTask(untimed, NOW), 0);
eq('a missing time is a time error', validateTasks(untimed, NOW), 'post_err_time');

const pastTask: TaskDraft[] = [{ ...buildTask(day(20)), time: SLOT_8_11 }];
eq('a slot that already started today is refused', validateTasks(pastTask, NOW), 'post_err_time_past');

const tomorrowTask: TaskDraft[] = [{ ...buildTask(day(21)), time: SLOT_8_11 }];
eq('a valid time tomorrow passes', validateTasks(tomorrowTask, NOW), null);
eq('no task at all is a date error', validateTasks([], NOW), 'post_err_dates_pick');

const mixed: TaskDraft[] = [
  { ...buildTask(day(21)), time: SLOT_8_11 },
  { ...buildTask(day(22)), time: null },
];
eq('one untimed task is enough to block Next', validateTasks(mixed, NOW), 'post_err_time');
eq('that task is the second one', firstUntimedTask(mixed, NOW), 1);
eq('all timed tasks pass', firstUntimedTask([tomorrowTask[0]], NOW), -1);

// ── Per-task milestones ───────────────────────────────────────────────────
const tasks: TaskDraft[] = [
  { key: dayKey(day(21)), day: day(21), name: null, time: SLOT_8_11 },
  { key: dayKey(day(23)), day: day(23), name: 'Second visit', time: ANYTIME_9_12 },
];
const milestones = buildTaskMilestones(tasks, 2);
eq('one milestone per task', milestones.length, 2);
eq(
  'the first task starts at its own slot',
  milestones[0].scheduled_at,
  composeInstant(day(21), 8, 0).toISOString()
);
eq(
  'the second task keeps its OWN custom window',
  milestones[1].scheduled_at,
  composeInstant(day(23), 9, 0).toISOString()
);
eq('expected hours are carried per task', milestones[1].expected_hours, 2);
eq('an untimed task produces no milestone', buildTaskMilestones([buildTask(day(21))], 1).length, 0);

// ── Deselecting a preset slot ─────────────────────────────────────────────
const isSlot = (choice: TimeChoice | null, key: string) =>
  choice !== null && choice.kind === 'slot' && choice.key === key;

check('picking a slot selects it', isSlot(toggleSlot(null, 'slot_8_11'), 'slot_8_11'));
eq('tapping it again clears it', toggleSlot(SLOT_8_11, 'slot_8_11'), null);
check('a different slot replaces it', isSlot(toggleSlot(SLOT_8_11, 'slot_17_20'), 'slot_17_20'));
check('a custom window is replaced by a slot tap', isSlot(toggleSlot(ANYTIME_9_12, 'slot_8_11'), 'slot_8_11'));

console.log(`postWizard: ${passed} checks, ${failures.length} failure(s)`);
if (failures.length > 0) throw new Error(`${failures.length} postWizard check(s) failed`);
