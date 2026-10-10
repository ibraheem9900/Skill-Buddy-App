/**
 * Post-a-Job wizard rules: booking type → the API enum, the 7-day milestone
 * maths (1 day = 1 milestone … 7 days = 7, an 8-day range is impossible), the
 * past-time refusal for "Today", and the profile-address comparison that
 * decides whether a successful post writes the address back.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import {
  MAX_MILESTONE_DAYS,
  bookingTypeFor,
  buildMultiDayMilestones,
  buildOneTimeMilestones,
  clampExpectedHours,
  composeInstant,
  enumerateDays,
  formatDayLabel,
  formatTimeLabel,
  inclusiveDayCount,
  isRangeDaySelectable,
  maxEndDay,
  oneTimeDay,
  rangeExceedsMaxDays,
  to12Hour,
  to24Hour,
  validateMultiDay,
  validateOneTime,
} from '../jobBooking';
import {
  buildProfileAddressPayload,
  profileAddressDiffers,
  type ProfileAddressForm,
} from '../profileAddressSync';
import { buildCreateJobRequest, resolveMilestones } from '../jobCreate';
import type { AddressResponse } from '../../types';

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
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MERIDIEM = { am: 'AM', pm: 'PM' };

// A fixed "now": Thursday 8 October 2026, 14:00 local.
const NOW = new Date(2026, 9, 8, 14, 0, 0, 0);

// ── Booking type → the exact enum the API expects ─────────────────────────
eq('one-time maps to ONE_TIME', bookingTypeFor('one_time'), 'ONE_TIME');
eq('long-term maps to MULTI_DAY', bookingTypeFor('multi_day'), 'MULTI_DAY');
eq('the documented week is 7 days', MAX_MILESTONE_DAYS, 7);

// ── Day counting / enumeration ────────────────────────────────────────────
eq('the same day is 1 day', inclusiveDayCount(oneTimeDay('today', NOW), oneTimeDay('today', NOW)), 1);
eq('tomorrow is 2 days from today', inclusiveDayCount(oneTimeDay('today', NOW), oneTimeDay('tomorrow', NOW)), 2);
eq(
  'a full week is 7 days',
  inclusiveDayCount(oneTimeDay('today', NOW), maxEndDay(oneTimeDay('today', NOW))),
  7
);
eq(
  'an 8-day span is refused',
  rangeExceedsMaxDays(oneTimeDay('today', NOW), new Date(2026, 9, 15)),
  true
);
eq('enumerateDays yields 1 day for a single day', enumerateDays(oneTimeDay('today', NOW), oneTimeDay('today', NOW)).length, 1);
eq(
  'enumerateDays yields 7 days for a week',
  enumerateDays(oneTimeDay('today', NOW), maxEndDay(oneTimeDay('today', NOW))).length,
  7
);
eq(
  'enumerateDays crosses a month boundary',
  enumerateDays(new Date(2026, 9, 30), new Date(2026, 10, 2)).length,
  4
);

// ── Calendar disabling: past days and the 7-day cap ───────────────────────
const today = oneTimeDay('today', NOW);
eq('yesterday is not selectable', isRangeDaySelectable(new Date(2026, 9, 7), today, null), false);
eq('today is selectable', isRangeDaySelectable(today, today, null), true);
eq(
  'day 7 after the start is selectable',
  isRangeDaySelectable(maxEndDay(today), today, today),
  true
);
eq(
  'day 8 after the start is disabled',
  isRangeDaySelectable(new Date(2026, 9, 15), today, today),
  false
);

// ── Clock conversion ──────────────────────────────────────────────────────
eq('midnight is 12 AM', to12Hour(0).hour12, 12);
eq('midnight is not PM', to12Hour(0).isPm, false);
eq('13:00 is 1 PM', to12Hour(13).hour12, 1);
eq('13:00 is PM', to12Hour(13).isPm, true);
eq('12 hour round-trips through 24', to24Hour(to12Hour(23).hour12, to12Hour(23).isPm), 23);
eq('12 AM round-trips to 0', to24Hour(12, false), 0);
eq('9:30 AM renders with the translated meridiem', formatTimeLabel(9, 30, MERIDIEM), '9:30 AM');
eq('21:05 renders as 9:05 PM', formatTimeLabel(21, 5, MERIDIEM), '9:05 PM');
eq(
  'a day label uses the translated tables',
  formatDayLabel(new Date(2026, 9, 12), MONTHS, WEEKDAYS),
  'Mon 12 Oct'
);

// ── Past-time refusal ─────────────────────────────────────────────────────
eq('today with no time is rejected', validateOneTime('today', null, NOW), 'post_err_time');
eq(
  'today with a time already past is rejected',
  validateOneTime('today', { hour: 13, minute: 0 }, NOW),
  'post_err_time_past'
);
eq(
  'today with a later time is accepted',
  validateOneTime('today', { hour: 15, minute: 30 }, NOW),
  null
);
eq(
  'the same early time is fine for tomorrow',
  validateOneTime('tomorrow', { hour: 9, minute: 0 }, NOW),
  null
);
eq(
  'long-term needs dates before anything else',
  validateMultiDay(null, null, { hour: 9, minute: 0 }, NOW),
  'post_err_dates_pick'
);
eq(
  'long-term rejects a past start day',
  validateMultiDay(new Date(2026, 9, 7), new Date(2026, 9, 9), { hour: 9, minute: 0 }, NOW),
  'post_err_dates_past'
);
eq(
  'long-term rejects an over-long range even if it is assembled',
  validateMultiDay(new Date(2026, 9, 10), new Date(2026, 9, 17), { hour: 9, minute: 0 }, NOW),
  'post_err_dates_max'
);
eq(
  'a 7-day long-term range is accepted',
  validateMultiDay(new Date(2026, 9, 10), new Date(2026, 9, 16), { hour: 9, minute: 0 }, NOW),
  null
);
eq(
  'long-term starting today still refuses a past time',
  validateMultiDay(today, today, { hour: 9, minute: 0 }, NOW),
  'post_err_time_past'
);

// ── Milestones ────────────────────────────────────────────────────────────
const oneTime = buildOneTimeMilestones(oneTimeDay('tomorrow', NOW), { hour: 9, minute: 30 }, 3);
eq('one-time sends exactly one milestone', oneTime.length, 1);
eq('one-time carries the expected hours', oneTime[0].expected_hours, 3);
eq(
  'a late-evening booking stays on the chosen local day',
  composeInstant(new Date(2026, 9, 9), 23, 50).getDate(),
  9
);

const sevenDays = enumerateDays(new Date(2026, 9, 10), new Date(2026, 9, 16));
const multi = buildMultiDayMilestones(sevenDays, { hour: 9, minute: 0 }, 4);
eq('seven days produce seven milestones', multi.length, 7);
eq('a single-day long-term booking produces one milestone', buildMultiDayMilestones([today], { hour: 9, minute: 0 }, 2).length, 1);
eq(
  'each milestone lands on its own consecutive day',
  multi
    .map((m) => new Date(m.scheduled_at).getDate())
    .join(','),
  '10,11,12,13,14,15,16'
);
eq(
  'every milestone keeps the chosen clock time',
  multi.every((m) => new Date(m.scheduled_at).getHours() === 9),
  true
);
eq('every milestone carries the per-day hours', multi.every((m) => m.expected_hours === 4), true);
eq(
  'milestones are valid ISO 8601 UTC',
  multi.every((m) => /Z$/.test(m.scheduled_at) && !Number.isNaN(new Date(m.scheduled_at).getTime())),
  true
);

// ── Hour bounds ───────────────────────────────────────────────────────────
eq('hours below the floor are clamped', clampExpectedHours(0), 1);
eq('hours above the ceiling are clamped', clampExpectedHours(99), 24);
eq('hours are rounded to integers', clampExpectedHours(3.6), 4);

// ── The request builder ───────────────────────────────────────────────────
const base = {
  serviceId: 12,
  serviceCategoryId: 3,
  title: 'Deep clean my apartment',
  description: 'Two rooms',
  requestType: 'regular' as const,
  expectedHours: 2,
  countryId: 1,
  countyId: 4,
  cityId: 9,
  houseNumber: '5',
  streetAddress: 'Main street',
  postalCode: '10111',
  landmark: '',
  formattedAddress: '',
  isDraft: false,
};

const oneTimeBody = buildCreateJobRequest({
  ...base,
  bookingType: 'one_time',
  scheduledAtIso: composeInstant(new Date(2026, 9, 9), 9, 0).toISOString(),
});
eq('one-time body uses the ONE_TIME enum', oneTimeBody.booking_type, 'ONE_TIME');
eq('one-time body carries one milestone', oneTimeBody.milestones.length, 1);
eq(
  'one-time milestone carries the hours',
  Number(oneTimeBody.milestones[0].expected_hours),
  2
);

const multiBody = buildCreateJobRequest({
  ...base,
  bookingType: 'multi_day',
  milestones: sevenDays.map((day) => ({
    scheduledAtIso: composeInstant(day, 9, 0).toISOString(),
    expectedHours: 2,
  })),
});
eq('long-term body uses the MULTI_DAY enum', multiBody.booking_type, 'MULTI_DAY');
eq('long-term body carries one milestone per day', multiBody.milestones.length, 7);

const capped = buildCreateJobRequest({
  ...base,
  bookingType: 'multi_day',
  milestones: Array.from({ length: 9 }, (_, i) => ({
    scheduledAtIso: composeInstant(new Date(2026, 9, 10 + i), 9, 0).toISOString(),
    expectedHours: 2,
  })),
});
eq('an over-long milestone list is capped at the documented week', capped.milestones.length, 7);

const empty = resolveMilestones({
  ...base,
  bookingType: 'multi_day',
  milestones: [],
  scheduledAtIso: composeInstant(new Date(2026, 9, 9), 9, 0).toISOString(),
});
eq('an empty multi-day list falls back to the single instant', empty.length, 1);
eq('a draft flag is passed through verbatim', buildCreateJobRequest({ ...base, bookingType: 'one_time', scheduledAtIso: null, isDraft: true }).is_draft, true);

// ── Profile address comparison ────────────────────────────────────────────
const form: ProfileAddressForm = {
  countryId: 1,
  countyId: 4,
  cityId: 9,
  streetAddress: 'Main street',
  houseNumber: '5',
  postalCode: '10111',
  landmark: '',
};

const saved = {
  id: 77,
  is_default: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  country: { id: 1, name: 'Estonia' },
  county: { id: 4, name: 'Harju' },
  city: { id: 9, name: 'Tallinn' },
  street_address: 'Main street',
  house_number: '5',
  postal_code: '10111',
  landmark: null,
} as unknown as AddressResponse;

eq('an identical address is not a change', profileAddressDiffers(form, saved), false);
eq(
  'a different street is a change',
  profileAddressDiffers({ ...form, streetAddress: 'Other street' }, saved),
  true
);
eq(
  'capitalisation alone is not a change',
  profileAddressDiffers({ ...form, streetAddress: 'MAIN street' }, saved),
  false
);
eq(
  'a different city is a change',
  profileAddressDiffers({ ...form, cityId: 11 }, saved),
  true
);
eq('no saved address is always a change', profileAddressDiffers(form, null), true);

const payload = buildProfileAddressPayload(form, '');
eq('the payload carries the cascade ids', payload.city_id, 9);
eq('latitude is never fabricated', 'latitude' in payload, false);
eq('blank text becomes null', payload.landmark, null);
eq(
  'a blank formatted address is composed from the parts',
  payload.formatted_address,
  'Main street, 5, 10111'
);

console.log(`jobBooking: ${passed} checks, ${failures.length} failure(s)`);
if (failures.length > 0) throw new Error(`${failures.length} jobBooking check(s) failed`);
