/**
 * apiTimeSlots — the single adapter between GET /api/v1/time-slots and the app.
 *
 * Pinned to the live response captured on 2026-11-14: HH:MM times, a
 * `08:00-11:00` window, a server label and half-hour arrival options.
 */
import {
  codesForSelection,
  hasAnytimeSlot,
  normalizeTimeSlots,
  parseClockValue,
  parseTimeSlot,
} from '../apiTimeSlots';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean): void {
  if (ok) passed += 1;
  else {
    failures.push(label);
    console.log(`FAIL ${label}`);
  }
}

function eq<T>(label: string, actual: T, expected: T): void {
  check(`${label} (got ${String(actual)}, want ${String(expected)})`, actual === expected);
}

const raw = {
  id: 2,
  code: 'MIDDAY',
  label: '11:00 AM - 2:00 PM',
  start_time: '11:00',
  end_time: '14:00',
  window: '11:00-14:00',
  arrival_options: ['11:00', '11:30', '12:00', '12:30', '13:00', '13:30'],
  sort_order: 2,
};

const parsed = parseTimeSlot(raw);
check('a live row parses', parsed !== null);
eq('the code is kept', parsed?.code, 'MIDDAY');
eq('the start is minutes since midnight', parsed?.startMinutes, 660);
eq('the end is exclusive', parsed?.endMinutes, 840);
eq('the server label is kept', parsed?.label, '11:00 AM - 2:00 PM');
eq('all six arrival marks parse', parsed?.arrivalMinutes.length, 6);
eq('arrival marks are sorted', parsed?.arrivalMinutes[0], 660);
eq('the last mark is before the end', parsed?.arrivalMinutes[5], 810);

eq('HH:MM parses', parseClockValue('08:30'), 510);
eq('HH:MM:SS parses', parseClockValue('14:00:00'), 840);
eq('an ISO timestamp parses its clock', parseClockValue('2026-11-14T20:15:00Z'), 1215);
eq('a 12-hour label parses', parseClockValue('8:00 AM'), 480);
eq('noon PM parses', parseClockValue('12:30 PM'), 750);
eq('midnight AM parses', parseClockValue('12:00 AM'), 0);
eq('nonsense is null', parseClockValue('later'), null);
eq('an impossible clock is null', parseClockValue('25:00'), null);

const unsorted = normalizeTimeSlots([
  { ...raw, id: 5, code: 'NIGHT', start_time: '20:00', end_time: '23:00', sort_order: 5 },
  raw,
  { ...raw, id: 1, code: 'MORNING', start_time: '08:00', end_time: '11:00', sort_order: 1 },
]);
eq('rows are sorted by sort_order', unsorted.map((slot) => slot.code).join(','), 'MORNING,MIDDAY,NIGHT');
eq('a non-array response is empty', normalizeTimeSlots({ detail: 'nope' }).length, 0);
eq(
  'a row with an end before its start is dropped',
  normalizeTimeSlots([{ ...raw, start_time: '14:00', end_time: '11:00' }]).length,
  0
);
eq(
  'a row without a code is dropped',
  normalizeTimeSlots([{ ...raw, code: '  ' }]).length,
  0
);
eq(
  'arrival marks outside the window are dropped',
  parseTimeSlot({ ...raw, arrival_options: ['10:30', '11:00', '13:30', '14:00'] })?.arrivalMinutes.join(','),
  '660,810'
);
eq(
  'a missing label falls back to the start-end window',
  parseTimeSlot({ ...raw, label: null })?.label,
  '11:00-14:00'
);
eq(
  'Anytime is detected from the server row, never assumed',
  hasAnytimeSlot(normalizeTimeSlots([raw])),
  false
);
eq(
  'an Anytime row is recognised when the server ships one',
  hasAnytimeSlot(normalizeTimeSlots([{ ...raw, code: 'ANYTIME', label: '8:00 AM - 11:00 PM' }])),
  true
);
eq(
  'selection keeps the server order and drops unknown codes',
  codesForSelection(unsorted, ['NIGHT', 'MORNING', 'NOPE']).join(','),
  'MORNING,NIGHT'
);

export const summary = { passed, total: passed + failures.length };
console.log(`apiTimeSlots: ${summary.passed}/${summary.total} assertions passed`);
