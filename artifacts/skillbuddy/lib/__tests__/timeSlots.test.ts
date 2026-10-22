/**
 * lib/timeSlots — the ONE place that owns the client's windows, the pilot's
 * half-hour marks, the 11 PM expected-hours rule and the local-time read of a
 * stored `scheduled_at`.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import {
  CLIENT_SLOTS,
  DAY_END_MINUTES,
  MAX_DAILY_EXPECTED_HOURS,
  buildScheduleLine,
  canStartBeforeDayEnd,
  clampHours,
  deriveSlotOf,
  exceedsHoursCap,
  formatLocalDateTime,
  formatTimeLabel,
  formatWindowLabel,
  localStartOf,
  maxHoursForStart,
  minutesOf,
  parseScheduleSegments,
  pilotTimesForSlot,
  segmentsForTasks,
  slotByKey,
  slotContaining,
  stripScheduleBlock,
} from '../timeSlots';

declare const console: { log: (msg: string) => void };
declare function require(name: string): any;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');

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

const MERIDIEM = { am: 'AM', pm: 'PM' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ── The five client windows ─────────────────────────────────────────────── */

eq('five windows', CLIENT_SLOTS.length, 5);
eq('the first window opens at 8 AM', CLIENT_SLOTS[0].startMinutes, 480);
eq('the first window closes at 11 AM', CLIENT_SLOTS[0].endMinutes, 660);
eq('the last window closes at 11 PM', CLIENT_SLOTS[4].endMinutes, DAY_END_MINUTES);
eq(
  'the labels read as the product states them',
  CLIENT_SLOTS.map((entry) => formatWindowLabel(entry.start, entry.end, MERIDIEM)).join(' | '),
  '8:00 AM - 11:00 AM | 11:00 AM - 2:00 PM | 2:00 PM - 5:00 PM | 5:00 PM - 8:00 PM | 8:00 PM - 11:00 PM'
);
eq('a slot is found by key', slotByKey('slot_14_17')?.startMinutes, 840);
eq('an unknown key is null', slotByKey('slot_9_10'), null);

// Containment: the window's start is inside it, its end is not.
eq('8:00 AM is in the first window', slotContaining(480)?.key, 'slot_8_11');
eq('9:30 AM is in the first window', slotContaining(570)?.key, 'slot_8_11');
eq('11:00 AM is already the second window', slotContaining(660)?.key, 'slot_11_14');
eq('10:30 PM is in the last window', slotContaining(1350)?.key, 'slot_20_23');
eq('11:00 PM belongs to no window', slotContaining(1380), null);

/* ── The pilot's half-hour marks ─────────────────────────────────────────── */const marks = (key: string) =>
  pilotTimesForSlot(key)
    .map((clock) => formatTimeLabel(clock, MERIDIEM))
    .join(', ');
// The product owner's list, slot by slot: every half-hour from the START up to
// the mark before the END, and slot 2 labels each option with its own AM/PM.
eq(
  'slot 1 (8-11 AM) offers 8:00 to 10:30',
  marks('slot_8_11'),
  '8:00 AM, 8:30 AM, 9:00 AM, 9:30 AM, 10:00 AM, 10:30 AM'
);
eq(
  'slot 2 (11 AM-2 PM) offers 11:00 to 1:30 and crosses noon correctly',
  marks('slot_11_14'),
  '11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM'
);
eq(
  'slot 3 (2-5 PM) offers 2:00 to 4:30',
  marks('slot_14_17'),
  '2:00 PM, 2:30 PM, 3:00 PM, 3:30 PM, 4:00 PM, 4:30 PM'
);
eq(
  'slot 4 (5-8 PM) offers 5:00 to 7:30',
  marks('slot_17_20'),
  '5:00 PM, 5:30 PM, 6:00 PM, 6:30 PM, 7:00 PM, 7:30 PM'
);
eq(
  'slot 5 (8-11 PM) offers 8:00 to 10:30',
  marks('slot_20_23'),
  '8:00 PM, 8:30 PM, 9:00 PM, 9:30 PM, 10:00 PM, 10:30 PM'
);

// The start IS offered (it sits on a mark in all five windows); the end is not.
for (const entry of CLIENT_SLOTS) {
  const offered = pilotTimesForSlot(entry.key).map((clock) => minutesOf(clock));
  check(`${entry.key} offers its start`, offered.includes(entry.startMinutes));
  check(`${entry.key} never offers its end`, !offered.includes(entry.endMinutes));
  eq(`${entry.key} offers six marks`, offered.length, 6);
  eq(`${entry.key} steps by a half hour`, offered.every((m, i) => i === 0 || m === (offered[i - 1] ?? 0) + 30), true);
}
// A window that opens between marks starts at the NEXT mark (9:20 → 9:30).
const offMark = pilotTimesForSlot({
  key: 'anytime',
  startMinutes: 9 * 60 + 20,
  endMinutes: 11 * 60,
  start: { hour: 9, minute: 20 },
  end: { hour: 11, minute: 0 },
});
eq(
  'a 9:20 start opens at 9:30',
  offMark.map((clock) => formatTimeLabel(clock, MERIDIEM)).join(', '),
  '9:30 AM, 10:00 AM, 10:30 AM'
);
// The end stays excluded even when the window ends between marks: 10:30 is
// still before an end of 10:45, and 11:00 is never reached.
eq(
  'an end of 10:45 keeps 10:00 and 10:30 and never reaches 11:00',
  pilotTimesForSlot({
    key: 'anytime',
    startMinutes: 10 * 60,
    endMinutes: 10 * 60 + 45,
    start: { hour: 10, minute: 0 },
    end: { hour: 10, minute: 45 },
  }).map((clock) => minutesOf(clock)).join(','),
  '600,630'
);
eq('an unknown slot offers nothing', pilotTimesForSlot('slot_1_2').length, 0);

/* ── The 11 PM expected-hours rule ───────────────────────────────────────── */

eq('8:00 AM allows 15 h', maxHoursForStart(8 * 60), 15);
eq('11:00 AM allows 12 h — the boss’s example', maxHoursForStart(11 * 60), 12);
eq('2:00 PM allows 9 h', maxHoursForStart(14 * 60), 9);
eq('5:00 PM allows 6 h', maxHoursForStart(17 * 60), 6);
eq('8:00 PM allows 3 h', maxHoursForStart(20 * 60), 3);
eq('9:00 PM allows 2 h', maxHoursForStart(21 * 60), 2);
eq('10:00 PM allows 1 h', maxHoursForStart(22 * 60), 1);
eq('10:30 PM leaves no whole hour', maxHoursForStart(22 * 60 + 30), 0);
eq('11:00 PM leaves nothing', maxHoursForStart(23 * 60), 0);
eq('the largest possible cap is the earliest window', MAX_DAILY_EXPECTED_HOURS, 15);

check('10:00 PM can still start', canStartBeforeDayEnd(22 * 60));
check('10:30 PM cannot', !canStartBeforeDayEnd(22 * 60 + 30));

eq('clamping up to the cap', clampHours(9, 6), 6);
eq('clamping never goes below one', clampHours(0, 6), 1);
eq('a value under the cap survives', clampHours(2, 6), 2);
check('9 h exceeds a 6 h cap', exceedsHoursCap(9, 6));
check('6 h does not', !exceedsHoursCap(6, 6));

/* ── Stored instant → device-local day and clock ─────────────────────────── */

// A local instant serialised to UTC and read back must be the same wall clock.
const local = new Date(2026, 9, 22, 8, 0, 0, 0);
const iso = local.toISOString();
const read = localStartOf(iso);
eq('the local day survives the round trip', read?.day.getDate(), 22);
eq('the local clock survives', read?.minutes, 8 * 60);

// GET /jobs/{id} returns the same digits WITHOUT a zone marker; they are UTC.
const naive = iso.replace(/\.\d{3}Z$/, '').replace(/Z$/, '');
const fromNaive = localStartOf(naive);
eq('a marker-less stamp is read as UTC', fromNaive?.minutes, 8 * 60);
eq('and its day too', fromNaive?.day.getDate(), 22);

eq('a missing stamp has no local start', localStartOf(null), null);
eq('a broken stamp has no local start', localStartOf('not-a-date'), null);

eq(
  'the details label shows the local clock',
  formatLocalDateTime(naive, MONTHS, WEEKDAYS, MERIDIEM),
  'Thu 22 Oct · 8:00 AM'
);

/* ── The stored schedule line ────────────────────────────────────────────── */

const single = buildScheduleLine([
  { startMinutes: 8 * 60, endMinutes: 11 * 60, meridiem: MERIDIEM },
]);
eq('a single day writes the fixed format', single, 'Preferred time: 8:00 AM - 11:00 AM');

const multi = buildScheduleLine([
  { taskNumber: 1, startMinutes: 8 * 60, endMinutes: 11 * 60, meridiem: MERIDIEM },
  { taskNumber: 2, startMinutes: 17 * 60, endMinutes: 20 * 60, meridiem: MERIDIEM },
]);
eq(
  'several days name each task',
  multi,
  'Preferred time: Task 1 8:00 AM - 11:00 AM; Task 2 5:00 PM - 8:00 PM'
);

const description = `Two rooms to clean\n${multi}`;
const segments = parseScheduleSegments(description);
eq('two segments are read', segments.length, 2);
eq('the first task number', segments[0].taskNumber, 1);
eq('the first start', segments[0].startMinutes, 8 * 60);
eq('the first end', segments[0].endMinutes, 11 * 60);
eq('the second start', segments[1].startMinutes, 17 * 60);

const singleSegments = parseScheduleSegments(`Pet sitter needed\n${single}`);
eq('a single-day line has one segment', singleSegments.length, 1);
eq('with no task number', singleSegments[0].taskNumber, null);

eq('no line means no segments', parseScheduleSegments('Just some text').length, 0);
eq('null means no segments', parseScheduleSegments(null).length, 0);

eq('the line is stripped from the description', stripScheduleBlock(description), 'Two rooms to clean');
eq(
  'the user text is untouched when there is no line',
  stripScheduleBlock('Just some text'),
  'Just some text'
);
eq('a null description strips to empty', stripScheduleBlock(null), '');
eq(
  'the words "preferred time" inside a sentence are kept',
  stripScheduleBlock('My preferred time is the morning'),
  'My preferred time is the morning'
);

/* ── Which window a stored task belongs to ───────────────────────────────── */

// An exact match with a client window is that slot.
const asSlot = deriveSlotOf({ scheduledAt: iso, segment: segments[0] });
eq('the stored segment wins', asSlot?.kind, 'slot');
eq('and names the right window', asSlot?.kind === 'slot' ? asSlot.key : null, 'slot_8_11');

// A custom Anytime window stays custom instead of being rewritten.
const custom = deriveSlotOf({
  scheduledAt: iso,
  segment: { taskNumber: 1, startMinutes: 9 * 60, endMinutes: 12 * 60 },
});
eq('a custom window is Anytime', custom?.kind, 'anytime');
eq(
  'and keeps its own start and end',
  custom?.kind === 'anytime'
    ? `${formatTimeLabel(custom.start, MERIDIEM)} - ${formatTimeLabel(custom.end, MERIDIEM)}`
    : '',
  '9:00 AM - 12:00 PM'
);

// No line: the local start decides.
const fromStart = deriveSlotOf({ scheduledAt: iso });
eq('an 8:00 AM start is the first window', fromStart?.kind === 'slot' ? fromStart.key : null, 'slot_8_11');
const pilotMark = deriveSlotOf({ scheduledAt: new Date(2026, 9, 22, 9, 30).toISOString() });
eq('a pilot’s 9:30 mark is still 8-11 AM', pilotMark?.kind === 'slot' ? pilotMark.key : null, 'slot_8_11');
// A start INSIDE a window belongs to that window (it is the same booking).
const insideWindow = deriveSlotOf({ scheduledAt: new Date(2026, 9, 22, 12, 15).toISOString() });
eq(
  'a start inside 11-2 belongs to it',
  insideWindow?.kind === 'slot' ? insideWindow.key : null,
  'slot_11_14'
);
// A start before every window falls forward to the nearest one.
const beforeAll = deriveSlotOf({ scheduledAt: new Date(2026, 9, 22, 7, 0).toISOString() });
eq(
  'a 7:00 AM start maps to 8-11',
  beforeAll?.kind === 'slot' ? beforeAll.key : null,
  'slot_8_11'
);
const missing = deriveSlotOf({ scheduledAt: null });
eq('no instant means nothing to preselect', missing, null);

/* ── Pairing a job's tasks with its segments ─────────────────────────────── */

const numbered = segmentsForTasks(segments, 2);
eq('task 1 gets segment 1', numbered[0]?.startMinutes, 8 * 60);
eq('task 2 gets segment 2', numbered[1]?.startMinutes, 17 * 60);
eq('an unmatched task gets none', segmentsForTasks(segments, 3)[2], null);
eq('a single-day line belongs to the only task', segmentsForTasks(singleSegments, 1)[0]?.startMinutes, 8 * 60);

/* ── The rule lives in ONE module ───────────────────────────────────────── */

// These checks are the point of the whole exercise: the pilot's marks must be
// derived from one constant in lib/timeSlots, never re-typed in a screen, a
// component or another lib module. A grep is the only way to prove absence.
function projectRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.join(dir, '..');
  }
  throw new Error(`could not find the project root above ${from}`);
}
const root = projectRoot(__dirname);
const SKIP_DIRS = new Set(['node_modules', '.git', '.expo', 'dist', '__tests__']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = sourceFiles(root).filter(
  (file) => !file.includes(`${path.sep}lib${path.sep}__tests__${path.sep}`)
);
const relative = (file: string) => path.relative(root, file).split(path.sep).join('/');
const DEFINES = /(?:^|\s)(?:export\s+)?(?:const|function)\s+(CLIENT_SLOTS|PILOT_STEP_MINUTES|pilotTimesForSlot)\b/m;
const definers = files.filter((file) => DEFINES.test(fs.readFileSync(file, 'utf8'))).map(relative);

eq(
  'the client windows, the half-hour step and the pilot marks are defined only in lib/timeSlots',
  definers.sort().join(', '),
  'lib/timeSlots.ts'
);

// No screen may carry its own copy of the offsets the old rule used to add.
const OFFSET_LIST = /\[\s*30\s*,\s*60\s*,\s*90\s*,\s*120\s*,\s*150\s*\]/;
const copiedOffsets = files
  .filter((file) => OFFSET_LIST.test(fs.readFileSync(file, 'utf8')))
  .map(relative);
eq('no module re-types the half-hour offsets', copiedOffsets.join(', '), '');

// Every consumer must go through the shared function.
const consumers = files
  .filter((file) => /pilotTimesForSlot\s*\(/.test(fs.readFileSync(file, 'utf8')))
  .map(relative)
  .sort();
eq(
  'the marks are asked for through the shared function',
  consumers.join(', '),
  'lib/bidTimes.ts, lib/timeSlots.ts'
);

eq('the scan actually looked at the app', files.length > 50, true);

console.log(`timeSlots: ${passed} checks, ${failures.length} failure(s)`);
if (failures.length > 0) {
  throw new Error(`${failures.length} timeSlots checks failed`);
}
