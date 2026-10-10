/**
 * Unit tests for the Post-a-Job booking window and calendar helpers
 * (lib/jobSchedule.ts) plus the milestone rule in lib/jobCreate.ts.
 *
 * Run through the project's own harness: `pnpm run test`. No React, no axios,
 * no network — only the rules that decide which days and times may be booked.
 */
import {
  BOOKING_MAX_LEAD_DAYS,
  BOOKING_MIN_LEAD_MINUTES,
  addDays,
  bookingWindow,
  canPageMonth,
  composeDateTime,
  endOfDay,
  formatClockLabel,
  formatScheduleLabel,
  isDayWithinWindow,
  isSameDay,
  isWithinBookingWindow,
  isValidDate,
  monthMatrix,
  shiftMonth,
  splitTable,
  startOfDay,
  toIsoDateTime,
} from '../jobSchedule';
import { resolveMilestones, type JobFormValues } from '../jobCreate';

declare const console: { log: (msg: string) => void };

let passed = 0;
export const failures: string[] = [];

function check(label: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(label);
}

function eq(label: string, actual: unknown, expected: unknown): void {
  check(
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    actual === expected
  );
}

/** Fixed clock: 12 September 2026, 10:00 local. */
const NOW = new Date(2026, 8, 12, 10, 0, 0, 0);

/* ------------------------------------------------------------- window maths */

const win = bookingWindow(NOW);
eq(
  'the minimum lead time is honoured exactly',
  win.min.getTime(),
  NOW.getTime() + BOOKING_MIN_LEAD_MINUTES * 60_000
);
eq(
  'the maximum horizon is the same clock time N days ahead',
  win.max.getTime(),
  addDays(NOW, BOOKING_MAX_LEAD_DAYS).getTime()
);
check('the window constants are the documented ones', BOOKING_MIN_LEAD_MINUTES === 60 && BOOKING_MAX_LEAD_DAYS === 90);

check('a slot before the lead time is rejected', isWithinBookingWindow(new Date(2026, 8, 12, 10, 59), NOW) === false);
check('a slot exactly at the lead time is allowed', isWithinBookingWindow(new Date(2026, 8, 12, 11, 0), NOW) === true);
check('a slot deep inside the window is allowed', isWithinBookingWindow(new Date(2026, 9, 1, 15, 30), NOW) === true);
check('a slot exactly at the horizon is allowed', isWithinBookingWindow(win.max, NOW) === true);
check('a slot one millisecond past the horizon is rejected', isWithinBookingWindow(new Date(win.max.getTime() + 1), NOW) === false);
check('an Invalid Date is rejected rather than throwing', isWithinBookingWindow(new Date('nope'), NOW) === false);
check('isValidDate accepts a real date', isValidDate(new Date(0)) === true);
check('isValidDate rejects a broken date', isValidDate(new Date('nope')) === false);
check('isValidDate rejects non-dates', isValidDate('2026-09-12') === false);

/* ------------------------------------------------------ day-level gating */

check('today is still selectable (the window reaches into it)', isDayWithinWindow(new Date(2026, 8, 12), NOW) === true);
check('yesterday is greyed out', isDayWithinWindow(new Date(2026, 8, 11), NOW) === false);
check('the last window day is selectable', isDayWithinWindow(addDays(NOW, BOOKING_MAX_LEAD_DAYS), NOW) === true);
check('the day after the horizon is greyed out', isDayWithinWindow(addDays(NOW, BOOKING_MAX_LEAD_DAYS + 1), NOW) === false);

/* -------------------------------------------------------------- calendar */

const sep = monthMatrix(2026, 8);
eq('September 2026 renders 5 weeks', sep.length, 5);
eq('the first cell is a leading blank (the 1st is a Tuesday)', sep[0][0], null);
eq('Tuesday the 1st sits in the second column', sep[0][1]?.getDate(), 1);
eq('the last real day is the 30th', sep[4][2]?.getDate(), 30);
check(
  'every week has exactly 7 cells',
  sep.every((week) => week.length === 7)
);
check(
  'the grid is Monday-first (a filled Sunday is the last column)',
  sep[1].every((cell, index) => (cell == null ? true : index < 7))
);

const febLeap = monthMatrix(2024, 1);
eq('February 2024 renders its 29 days', febLeap.flat().filter((d) => d != null).length, 29);
const feb = monthMatrix(2026, 1);
eq('February 2026 renders its 28 days', feb.flat().filter((d) => d != null).length, 28);

/* -------------------------------------------------------------- paging */

eq('paging back a month normalises the year', JSON.stringify(shiftMonth(2026, 0, -1)), JSON.stringify({ year: 2025, month: 11 }));
eq('paging forward a month normalises the year', JSON.stringify(shiftMonth(2026, 11, 1)), JSON.stringify({ year: 2027, month: 0 }));
eq('paging by zero months is a no-op', JSON.stringify(shiftMonth(2026, 5, 0)), JSON.stringify({ year: 2026, month: 5 }));

check('the current month cannot page backwards (earlier days are all invalid)', canPageMonth(2026, 8, NOW).prev === false);
check('the current month can page forwards', canPageMonth(2026, 8, NOW).next === true);
check('a later month can page backwards', canPageMonth(2026, 9, NOW).prev === true);
check('a later-but-partly-invalid month can still page backwards', canPageMonth(2026, 11, NOW).prev === true);
check('the horizon month cannot page forwards', canPageMonth(2026, 11, NOW).next === false);

/* --------------------------------------------------------------- clock */

eq('noon AM is midnight', composeDateTime(new Date(2026, 8, 12), 12, 0, false)?.getHours(), 0);
eq('noon PM is 12:00', composeDateTime(new Date(2026, 8, 12), 12, 0, true)?.getHours(), 12);
eq('1 PM is 13:00', composeDateTime(new Date(2026, 8, 12), 1, 0, true)?.getHours(), 13);
eq('9 AM keeps its minutes', composeDateTime(new Date(2026, 8, 12), 9, 45, false)?.getMinutes(), 45);
eq('the composed value keeps the chosen day', composeDateTime(new Date(2026, 8, 12), 9, 0, false)?.getDate(), 12);
eq('an out-of-range hour yields null', composeDateTime(new Date(2026, 8, 12), 13, 0, true), null);
eq('an out-of-range minute yields null', composeDateTime(new Date(2026, 8, 12), 9, 75, false), null);
eq('a missing day yields null', composeDateTime(null, 9, 0, false), null);

eq('11 AM renders as 11:00', formatClockLabel(11, 0, false), '11:00');
eq('2:05 PM renders as 14:05', formatClockLabel(2, 5, true), '14:05');
eq('noon renders as 12:00', formatClockLabel(12, 0, true), '12:00');
eq('midnight renders as 00:00', formatClockLabel(12, 0, false), '00:00');

/* -------------------------------------------------------------- labels */

const MONTHS = splitTable('January,February,March,April,May,June,July,August,September,October,November,December');
const WEEKDAYS = splitTable('Mon,Tue,Wed,Thu,Fri,Sat,Sun');

eq('the month table has 12 entries', MONTHS.length, 12);
eq('the weekday table has 7 entries', WEEKDAYS.length, 7);
eq('the month table is trimmed', splitTable(' a , b ,c ').join('|'), 'a|b|c');
eq('an empty table is an empty array', splitTable(undefined).length, 0);
eq('a null table is an empty array', splitTable(null).length, 0);

const saturday = new Date(2026, 8, 12, 14, 30);
check('the fixture really is a Saturday', saturday.getDay() === 6);
eq(
  'the summary reads weekday, day, month, year and 24-hour clock',
  formatScheduleLabel(saturday, MONTHS, WEEKDAYS),
  'Sat, 12 September 2026 · 14:30'
);
eq('an invalid date renders as an empty label', formatScheduleLabel(new Date('nope'), MONTHS, WEEKDAYS), '');
eq('February maps to the second month name', formatScheduleLabel(new Date(2026, 1, 3, 9, 5), MONTHS, WEEKDAYS).includes('February'), true);

/* ------------------------------------------------------------------ misc */

eq('startOfDay zeroes the clock', startOfDay(new Date(2026, 8, 12, 17, 3, 9)).getHours(), 0);
eq('endOfDay lands on the last millisecond', endOfDay(new Date(2026, 8, 12)).getMilliseconds(), 999);
eq('addDays crosses a month boundary', addDays(new Date(2026, 8, 30), 3).getMonth(), 9);
check('isSameDay compares the calendar day only', isSameDay(new Date(2026, 8, 12, 1, 0), new Date(2026, 8, 12, 23, 0)) === true);
check('isSameDay rejects a different month', isSameDay(new Date(2026, 8, 12), new Date(2026, 9, 12)) === false);
eq('a local date serialises to ISO 8601 UTC', toIsoDateTime(new Date(Date.UTC(2026, 8, 12, 12, 0, 0))), '2026-09-12T12:00:00.000Z');
eq('an ISO string always ends in Z', String(toIsoDateTime(saturday)).endsWith('Z'), true);
eq('toIsoDateTime rejects null', toIsoDateTime(null), null);
eq('toIsoDateTime rejects an Invalid Date', toIsoDateTime(new Date('nope')), null);

/* --------------------------- what scheduled_at carries in jobCreate */

const CUSTOM_ISO = new Date(2026, 10, 20, 16, 30, 0, 0).toISOString();

/** The wizard's form values, with only the schedule fields filled in. */
const formValues = (overrides: Partial<JobFormValues>): JobFormValues => ({
  serviceId: 1,
  serviceCategoryId: null,
  title: 'A title',
  description: 'A description',
  requestType: 'regular',
  bookingType: 'one_time',
  expectedHours: 2,
  countryId: 1,
  countyId: 1,
  cityId: 1,
  houseNumber: '',
  streetAddress: '',
  postalCode: '',
  landmark: '',
  formattedAddress: '',
  isDraft: false,
  ...overrides,
});

eq(
  'the clock picker\'s instant is what scheduled_at carries',
  resolveMilestones(formValues({ scheduledAtIso: CUSTOM_ISO }))[0].scheduled_at,
  CUSTOM_ISO
);
eq(
  'an offset instant is normalised to UTC',
  resolveMilestones(formValues({ scheduledAtIso: '2026-11-20T16:30:00+02:00' }))[0].scheduled_at,
  new Date('2026-11-20T16:30:00+02:00').toISOString()
);
check(
  'the resolved instant never loses its Z suffix',
  String(resolveMilestones(formValues({ scheduledAtIso: CUSTOM_ISO }))[0].scheduled_at).endsWith('Z')
);
eq(
  'an unparseable instant never becomes a null scheduled_at',
  resolveMilestones(formValues({ scheduledAtIso: 'not-a-date' })).length,
  0
);
eq(
  'a missing instant never becomes a null scheduled_at',
  resolveMilestones(formValues({ scheduledAtIso: null })).length,
  0
);
eq(
  'the expected hours ride along as a number',
  resolveMilestones(formValues({ scheduledAtIso: CUSTOM_ISO, expectedHours: 5 }))[0].expected_hours,
  5
);

/* ------------------------------------------------------------------ report */

export const summary = { passed, total: passed + failures.length };
console.log(`jobSchedule: ${summary.passed}/${summary.total} assertions passed`);
