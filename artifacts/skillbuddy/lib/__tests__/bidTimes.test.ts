/**
 * lib/bidTimes — the pilot's arrival choices and the ONLY encoder/decoder of the
 * fixed "Proposed time:" line that carries them until the API has a real field.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import {
  appendProposedTimeLine,
  arrivalOptionsFor,
  arrivalsSummary,
  buildProposedTimeLine,
  composeBidMessage,
  etaMinutesForFirstArrival,
  firstMissingArrival,
  hasBidMessageChanged,
  hasEveryArrival,
  jobTaskWindows,
  messageRoomFor,
  parseProposedTimeLine,
  proposedTimesSummary,
  stripProposedTimeLine,
  type BidTaskWindow,
  type ProposedArrival,
} from '../bidTimes';
import { formatTimeLabel, minutesOf } from '../timeSlots';
import type { JobResponse } from '../../types';

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

const MERIDIEM = { am: 'AM', pm: 'PM' };

const task = (overrides: Partial<BidTaskWindow> = {}): BidTaskWindow => ({
  number: 1,
  day: new Date(2026, 9, 22),
  startMinutes: 8 * 60,
  endMinutes: 11 * 60,
  anytime: false,
  ...overrides,
});

const marks = (entry: BidTaskWindow) =>
  arrivalOptionsFor(entry)
    .map((clock) => formatTimeLabel(clock, MERIDIEM))
    .join(', ');

/* ── Arrival options ─────────────────────────────────────────────────────── */

// Six marks per window, starting ON the client's start.
eq(
  'a client window opens on its own start',
  marks(task()),
  '8:00 AM, 8:30 AM, 9:00 AM, 9:30 AM, 10:00 AM, 10:30 AM'
);
eq(
  'the noon-crossing window labels every option correctly',
  marks(task({ startMinutes: 11 * 60, endMinutes: 14 * 60 })),
  '11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM'
);
eq(
  'the last window offers 8:00 to 10:30 PM',
  marks(task({ startMinutes: 20 * 60, endMinutes: 23 * 60 })),
  '8:00 PM, 8:30 PM, 9:00 PM, 9:30 PM, 10:00 PM, 10:30 PM'
);
// Anytime: the same rule on the client's own window.
eq(
  'an Anytime window opens on its own start',
  marks(task({ startMinutes: 9 * 60, endMinutes: 12 * 60, anytime: true })),
  '9:00 AM, 9:30 AM, 10:00 AM, 10:30 AM, 11:00 AM, 11:30 AM'
);
// A start between marks opens at the next mark.
eq(
  'an Anytime start at 9:20 opens at 9:30',
  marks(task({ startMinutes: 9 * 60 + 20, endMinutes: 12 * 60, anytime: true })),
  '9:30 AM, 10:00 AM, 10:30 AM, 11:00 AM, 11:30 AM'
);
// A one-hour window now has both of its marks.
eq(
  'a one-hour Anytime window offers both marks',
  marks(task({ startMinutes: 9 * 60, endMinutes: 10 * 60, anytime: true })),
  '9:00 AM, 9:30 AM'
);
// A window whose end sits between marks stops before it.
eq(
  'an Anytime end at 10:45 keeps 10:00 and 10:30 but never the end',
  marks(task({ startMinutes: 10 * 60, endMinutes: 10 * 60 + 45, anytime: true })),
  '10:00 AM, 10:30 AM'
);
eq(
  'an Anytime end exactly on a mark drops that mark',
  marks(task({ startMinutes: 10 * 60, endMinutes: 11 * 60, anytime: true })),
  '10:00 AM, 10:30 AM'
);
// A window too short for any mark at all offers the client's exact start.
eq(
  'a 15-minute window offers its exact start',
  marks(task({ startMinutes: 9 * 60, endMinutes: 9 * 60 + 15, anytime: true })),
  '9:00 AM'
);
for (const entry of [task(), task({ startMinutes: 14 * 60, endMinutes: 17 * 60 })]) {
  const offered = arrivalOptionsFor(entry).map((clock) => minutesOf(clock));
  check('the window start is offered', offered.includes(entry.startMinutes));
  check('the window end is never offered', !offered.includes(entry.endMinutes));
  eq('six options per client window', offered.length, 6);
}

/* ── Job tasks (from milestones + the stored schedule line) ──────────────── */

const singleJob = {
  scheduled_at: new Date(2026, 9, 22, 8, 0).toISOString(),
  description: 'Pet sitter needed\nPreferred time: 8:00 AM - 11:00 AM',
  milestones: [],
} as unknown as JobResponse;

const singleTasks = jobTaskWindows(singleJob);
eq('a single-day job has one task', singleTasks.length, 1);
eq('with the client window read from the line', singleTasks[0].startMinutes, 8 * 60);
eq('and its end', singleTasks[0].endMinutes, 11 * 60);

const multiJob = {
  scheduled_at: null,
  description:
    'Two rooms\nPreferred time: Task 1 8:00 AM - 11:00 AM; Task 2 5:00 PM - 8:00 PM',
  milestones: [
    { id: 1, sequence: 1, scheduled_at: new Date(2026, 9, 22, 8, 0).toISOString(), expected_hours: 1, status: 'PENDING' },
    { id: 2, sequence: 2, scheduled_at: new Date(2026, 9, 24, 17, 0).toISOString(), expected_hours: 2, status: 'PENDING' },
  ],
} as unknown as JobResponse;

const multiTasks = jobTaskWindows(multiJob);
eq('a two-day job has two tasks', multiTasks.length, 2);
eq('task 1 keeps its own window', multiTasks[0].endMinutes, 11 * 60);
eq('task 2 keeps its own window', multiTasks[1].startMinutes, 17 * 60);
eq('and its own day', multiTasks[1].day?.getDate(), 24);

const anytimeJob = {
  scheduled_at: new Date(2026, 9, 22, 9, 0).toISOString(),
  description: 'Deep clean\nPreferred time: 9:00 AM - 12:00 PM',
  milestones: [],
} as unknown as JobResponse;
const anytimeTasks = jobTaskWindows(anytimeJob);
eq('an Anytime task is marked as such', anytimeTasks[0].anytime, true);
eq('and keeps the custom window', anytimeTasks[0].endMinutes, 12 * 60);

/* ── The proposed-time line ──────────────────────────────────────────────── */

const line = buildProposedTimeLine(
  [
    { taskNumber: 1, minutes: 9 * 60 + 30 },
    { taskNumber: 2, minutes: 15 * 60 },
  ],
  MERIDIEM
);
eq('the line has the fixed format', line, 'Proposed time: Task 1 9:30 AM; Task 2 3:00 PM');

const parsed = parseProposedTimeLine(`Please open the gate\n${line}`);
eq('the user words are recovered', parsed.userMessage, 'Please open the gate');
eq('two arrivals are read back', parsed.arrivals.length, 2);
eq('the first task time', parsed.arrivals[0].minutes, 9 * 60 + 30);
eq('the second task number', parsed.arrivals[1].taskNumber, 2);
eq('the second task time', parsed.arrivals[1].minutes, 15 * 60);

eq('a message without the line is untouched', stripProposedTimeLine('Just words'), 'Just words');
eq('an empty message stays empty', stripProposedTimeLine(null), '');
eq(
  'the line is stripped for the client',
  stripProposedTimeLine(`Gate code 1234\n${line}`),
  'Gate code 1234'
);

const appended = appendProposedTimeLine('Gate code 1234', line);
eq('appending keeps the words first', appended, `Gate code 1234\n${line}`);
eq('appending twice never duplicates', appendProposedTimeLine(appended, line), `Gate code 1234\n${line}`);
eq('no line means just the words', appendProposedTimeLine('Hello', null), 'Hello');
eq('no words means just the line', appendProposedTimeLine('   ', line), line);

/* ── Values saved under the OLD rule still parse ─────────────────────────── */

// 8:30 AM was the first option before this round. A bid that stored it must
// still prefill and re-save unchanged, and the new 8:00 must parse too.
const legacy = parseProposedTimeLine('Please open the gate\nProposed time: Task 1 8:30 AM');
eq('the old first option still parses', legacy.arrivals[0]?.minutes, 8 * 60 + 30);
eq('and the pilot\u2019s words survive', legacy.userMessage, 'Please open the gate');
eq(
  'it round-trips unchanged',
  composeBidMessage(legacy.userMessage, legacy.arrivals, MERIDIEM),
  'Please open the gate\nProposed time: Task 1 8:30 AM'
);
const opening = parseProposedTimeLine('Proposed time: Task 1 8:00 AM; Task 2 12:00 PM');
eq('the new start-of-window value parses', opening.arrivals[0]?.minutes, 8 * 60);
eq('noon decodes as 12:00, not midnight', opening.arrivals[1]?.minutes, 12 * 60);

// Every option the new rule offers must survive the encode/decode round trip.
let roundTrips = 0;
for (const window of [
  { startMinutes: 8 * 60, endMinutes: 11 * 60 },
  { startMinutes: 11 * 60, endMinutes: 14 * 60 },
  { startMinutes: 14 * 60, endMinutes: 17 * 60 },
  { startMinutes: 17 * 60, endMinutes: 20 * 60 },
  { startMinutes: 20 * 60, endMinutes: 23 * 60 },
]) {
  for (const clock of arrivalOptionsFor(task({ ...window }))) {
    const minutes = minutesOf(clock) ?? -1;
    const encoded = composeBidMessage(null, [{ taskNumber: 1, minutes }], MERIDIEM) ?? '';
    const decoded = parseProposedTimeLine(encoded).arrivals[0]?.minutes;
    eq(`round trip for ${formatTimeLabel(clock, MERIDIEM)}`, decoded, minutes);
    roundTrips += 1;
  }
}
eq('all thirty options round-trip', roundTrips, 30);

// The COMBINED text must fit the schema's 1000 characters.
const longBody = 'x'.repeat(1200);
const clamped = appendProposedTimeLine(longBody, line) ?? '';
check('the combined message fits 1000 characters', clamped.length <= 1000);
check('the time line survives intact', clamped.endsWith(line ?? ''));

/* ── eta_minutes derived from the first arrival ──────────────────────────── */

const now = new Date(2026, 9, 22, 8, 0, 0, 0);
eq(
  'an instant arrival is 0 minutes',
  etaMinutesForFirstArrival([{ taskNumber: 1, minutes: 8 * 60 }], [task()], now),
  0
);
eq(
  'a later start is its distance in minutes',
  etaMinutesForFirstArrival([{ taskNumber: 1, minutes: 10 * 60 + 30 }], [task()], now),
  150
);
eq(
  'a day away hits the 1440 ceiling',
  etaMinutesForFirstArrival(
    [{ taskNumber: 1, minutes: 8 * 60 }],
    [task({ day: new Date(2026, 9, 25) })],
    now
  ),
  1440
);
eq(
  'the FIRST task decides, not the last',
  etaMinutesForFirstArrival(
    [
      { taskNumber: 1, minutes: 9 * 60 },
      { taskNumber: 2, minutes: 15 * 60 },
    ],
    [task(), task({ number: 2, day: new Date(2026, 9, 24) })],
    now
  ),
  60
);
eq('no arrival means 0', etaMinutesForFirstArrival([], [task()], now), 0);

/* ── One choice per task ─────────────────────────────────────────────────── */

const twoTasks = [task(), task({ number: 2, day: new Date(2026, 9, 24), startMinutes: 17 * 60, endMinutes: 20 * 60 })];
eq(
  'both tasks need a choice',
  hasEveryArrival(
    [
      { taskNumber: 1, minutes: 9 * 60 },
      { taskNumber: 2, minutes: 18 * 60 },
    ],
    twoTasks
  ),
  true
);
eq('one missing choice fails', hasEveryArrival([{ taskNumber: 1, minutes: 9 * 60 }], twoTasks), false);
eq(
  'the missing task number is reported',
  firstMissingArrival([{ taskNumber: 1, minutes: 9 * 60 }], twoTasks),
  2
);
eq(
  'nothing is missing when all are chosen',
  firstMissingArrival(
    [
      { taskNumber: 1, minutes: 9 * 60 },
      { taskNumber: 2, minutes: 18 * 60 },
    ],
    twoTasks
  ),
  null
);

/* ── Client-facing summary ───────────────────────────────────────────────── */

const arrivals: ProposedArrival[] = [
  { taskNumber: 1, minutes: 9 * 60 + 30 },
  { taskNumber: 2, minutes: 15 * 60 },
];
eq(
  'a single task shows just the time',
  arrivalsSummary([arrivals[0]], [task()], MERIDIEM),
  '9:30 AM'
);
eq(
  'several tasks name each one',
  arrivalsSummary(arrivals, twoTasks, MERIDIEM),
  'Task 1 9:30 AM · Task 2 3:00 PM'
);

/* ── The wire message: composed, compared, and its room ──────────────────── */

const wireLine = buildProposedTimeLine(arrivals, MERIDIEM);
const wire = composeBidMessage('I can walk Spot', arrivals, MERIDIEM);
eq('the composed message is words then the line', wire, `I can walk Spot\n${wireLine}`);
eq(
  'the stored line is not duplicated when it is still in the field',
  composeBidMessage(`I can walk Spot\n${wireLine}`, arrivals, MERIDIEM),
  `I can walk Spot\n${wireLine}`
);
eq('no words means just the line', composeBidMessage('', arrivals, MERIDIEM), wireLine);
eq('no arrivals means just the words', composeBidMessage('Hi', [], MERIDIEM), 'Hi');

eq('nothing at all is null', composeBidMessage('', [], MERIDIEM), null);

/* An untouched bid is not offered a pointless Save… */
eq(
  'an unchanged bid is unchanged',
  hasBidMessageChanged(`I can walk Spot\n${wireLine}`, 'I can walk Spot', arrivals, MERIDIEM),
  false
);
/* …but a different price-only edit is not a message change either. */
eq(
  'trailing whitespace is not a change',
  hasBidMessageChanged(`I can walk Spot\n${wireLine}`, 'I can walk Spot  ', arrivals, MERIDIEM),
  false
);
/* A bid saved BEFORE this feature has no line → choosing a time changes it. */
eq(
  'a legacy bid becomes changed once a time is chosen',
  hasBidMessageChanged('I can walk Spot', 'I can walk Spot', arrivals, MERIDIEM),
  true
);
eq(
  'a different arrival is a change',
  hasBidMessageChanged(
    `I can walk Spot\n${wireLine}`,
    'I can walk Spot',
    [arrivals[0], { taskNumber: 2, minutes: 16 * 60 }],
    MERIDIEM
  ),
  true
);

/* The field's own room leaves space for the line it will carry. */
eq('no arrivals leaves the whole 1000', messageRoomFor([], MERIDIEM), 1000);
eq(
  'chosen times shrink the message field by the line plus a newline',
  messageRoomFor(arrivals, MERIDIEM),
  1000 - (wireLine?.length ?? 0) - 1
);

/* ── The card summary without a loaded job ──────────────────────────────── */

eq(
  'one time is bare for the caller to prefix',
  proposedTimesSummary([arrivals[0]], MERIDIEM)?.text,
  '9:30 AM'
);
eq('one time is flagged single', proposedTimesSummary([arrivals[0]], MERIDIEM)?.single, true);
eq(
  'several times name each task',
  proposedTimesSummary(arrivals, MERIDIEM)?.text,
  'Task 1 9:30 AM · Task 2 3:00 PM'
);
eq('nothing chosen is null', proposedTimesSummary([], MERIDIEM), null);

console.log(`bidTimes: ${passed} checks, ${failures.length} failure(s)`);
if (failures.length > 0) {
  throw new Error(`${failures.length} bidTimes checks failed`);
}
