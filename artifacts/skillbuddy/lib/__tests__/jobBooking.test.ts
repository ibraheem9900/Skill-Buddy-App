/**
 * Post-a-Job wizard rules.
 *
 * Covers the model the restructured wizard uses:
 *   • the five fixed slots + "Anytime" and their validation (including "already
 *     started" and the end-after-start rule);
 *   • ONE start date opening a seven-day window, with any subset of those days
 *     selectable (non-consecutive allowed) across month and DST boundaries;
 *   • selected days → milestones in UTC;
 *   • the two-way Request Type ↔ Booking Type lock;
 *   • the clock's geometry and steppers (the needle never accumulates an angle);
 *   • the stored "Preferred time" description line.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import {
  FIXED_SLOTS,
  MAX_MILESTONE_DAYS,
  applyBookingKind,
  applyRequestType,
  bookingTypeFor,
  buildMultiDayMilestones,
  buildOneTimeMilestones,
  clampExpectedHours,
  composeInstant,
  formatDayButton,
  formatDayLabel,
  formatDaysList,
  formatTimeLabel,
  formatWindowLabel,
  hasSlotStarted,
  isBookingKindAllowed,
  isDayInWindow,
  isRequestTypeAllowed,
  isStartDaySelectable,
  oneTimeDay,
  selectionForStart,
  slotByKey,
  sortDays,
  toggleSelectedDay,
  to12Hour,
  to24Hour,
  validateMultiDay,
  validateOneTime,
  validateTimeChoice,
  windowDays,
  windowMinutes,
  windowShorterThanHours,
  type TimeChoice,
} from '../jobBooking';
import {
  angleForHour,
  angleForMinute,
  angleForPoint,
  angleForValue,
  hourFromAngle,
  isOutsideDeadZone,
  minuteFromAngle,
  normalizeDegrees,
  shortestTurn,
  stepHour12,
  stepMinute,
  valueFromPoint,
} from '../clockMath';
import {
  buildProfileAddressPayload,
  profileAddressDiffers,
  type ProfileAddressForm,
} from '../profileAddressSync';
import {
  buildCreateJobRequest,
  buildPreferredTimeLine,
  countWords,
  descriptionWordCount,
  exceedsDescriptionLimit,
  resolveMilestones,
  stripPreferredTimeLine,
  withPreferredTimeLine,
} from '../jobCreate';
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

// A fixed "now": Tuesday 20 October 2026, 14:00 local.
const NOW = new Date(2026, 9, 20, 14, 0, 0, 0);
const SLOT_8_11: TimeChoice = { kind: 'slot', key: 'slot_8_11' };
const SLOT_14_17: TimeChoice = { kind: 'slot', key: 'slot_14_17' };
const SLOT_17_20: TimeChoice = { kind: 'slot', key: 'slot_17_20' };
const ANYTIME_9_12: TimeChoice = {
  kind: 'anytime',
  start: { hour: 9, minute: 0 },
  end: { hour: 12, minute: 0 },
};

// ── Booking type → the exact enum the API expects ─────────────────────────
eq('single day maps to ONE_TIME', bookingTypeFor('one_time'), 'ONE_TIME');
eq('multiple days map to MULTI_DAY', bookingTypeFor('multi_day'), 'MULTI_DAY');
eq('the documented week is 7 days', MAX_MILESTONE_DAYS, 7);

// ── The five fixed slots ──────────────────────────────────────────────────
eq('there are five fixed slots', FIXED_SLOTS.length, 5);
eq(
  'the first slot is 8:00 AM - 11:00 AM',
  formatWindowLabel(SLOT_8_11, MERIDIEM),
  '8:00 AM - 11:00 AM'
);
eq(
  'the last slot is 8:00 PM - 11:00 PM',
  formatWindowLabel({ kind: 'slot', key: FIXED_SLOTS[4].key }, MERIDIEM),
  '8:00 PM - 11:00 PM'
);
eq(
  'the third slot is 2:00 PM - 5:00 PM',
  formatWindowLabel({ kind: 'slot', key: FIXED_SLOTS[2].key }, MERIDIEM),
  '2:00 PM - 5:00 PM'
);
eq('slotByKey finds a real slot', slotByKey('slot_11_14')?.start.hour, 11);
eq('slotByKey rejects an unknown key', slotByKey('nope'), null);
eq('an unknown slot has no window', formatWindowLabel({ kind: 'slot', key: 'nope' }, MERIDIEM), '');
eq(
  'Anytime renders its own window',
  formatWindowLabel(ANYTIME_9_12, MERIDIEM),
  '9:00 AM - 12:00 PM'
);
eq('a slot window is three hours', windowMinutes(SLOT_8_11), 180);

// ── "Already started" + validation ────────────────────────────────────────
eq(
  'the 8-11 slot has already started at 14:00 today',
  hasSlotStarted(SLOT_8_11, oneTimeDay('today', NOW), NOW),
  true
);
eq(
  'a slot that starts exactly now counts as started',
  hasSlotStarted(SLOT_14_17, oneTimeDay('today', NOW), NOW),
  true
);
eq(
  'the 5-8 slot has not started at 14:00 today',
  hasSlotStarted(SLOT_17_20, oneTimeDay('today', NOW), NOW),
  false
);
eq(
  'tomorrow never counts as started',
  hasSlotStarted(SLOT_8_11, oneTimeDay('tomorrow', NOW), NOW),
  false
);
eq('no time is rejected', validateTimeChoice(null, oneTimeDay('today', NOW), NOW), 'post_err_time');
eq(
  'a slot in the past on today is rejected',
  validateTimeChoice(SLOT_8_11, oneTimeDay('today', NOW), NOW),
  'post_err_time_past'
);
eq(
  'a slot still ahead on today is accepted',
  validateTimeChoice(SLOT_17_20, oneTimeDay('today', NOW), NOW),
  null
);
eq(
  'Anytime with an end before its start is rejected',
  validateTimeChoice(
    { kind: 'anytime', start: { hour: 12, minute: 0 }, end: { hour: 9, minute: 0 } },
    null,
    NOW
  ),
  'post_err_time_window'
);
eq(
  'Anytime with equal start and end is rejected',
  validateTimeChoice(
    { kind: 'anytime', start: { hour: 9, minute: 0 }, end: { hour: 9, minute: 0 } },
    null,
    NOW
  ),
  'post_err_time_window'
);
eq('Anytime with a real window is accepted', validateTimeChoice(ANYTIME_9_12, null, NOW), null);
eq('a three-hour window is shorter than 4 hours', windowShorterThanHours(ANYTIME_9_12, 4), true);
eq('a three-hour window is not shorter than 3 hours', windowShorterThanHours(ANYTIME_9_12, 3), false);
eq('a three-hour window is not shorter than 2 hours', windowShorterThanHours(ANYTIME_9_12, 2), false);
eq('an empty window is never "too short"', windowShorterThanHours(null, 5), false);

// ── One-time gate ─────────────────────────────────────────────────────────
eq('today with no time is rejected', validateOneTime('today', null, NOW), 'post_err_time');
eq(
  'today with a past slot is rejected',
  validateOneTime('today', SLOT_8_11, NOW),
  'post_err_time_past'
);
eq('today with a later slot is accepted', validateOneTime('today', SLOT_17_20, NOW), null);
eq('the same early slot is fine tomorrow', validateOneTime('tomorrow', SLOT_8_11, NOW), null);

// ── The 7-day window from ONE start date ─────────────────────────────────
const start20 = new Date(2026, 9, 20);
const window20 = windowDays(start20);
eq('a start date opens seven days', window20.length, 7);
eq(
  'the window runs start..start+6',
  window20.map((d) => d.getDate()).join(','),
  '20,21,22,23,24,25,26'
);
eq('day +7 is outside the window', isDayInWindow(new Date(2026, 9, 27), start20), false);
eq('day +6 is inside the window', isDayInWindow(new Date(2026, 9, 26), start20), true);
eq('a day before the start is outside', isDayInWindow(new Date(2026, 9, 19), start20), false);

const acrossMonth = windowDays(new Date(2026, 9, 28));
eq(
  'the window crosses a month boundary',
  acrossMonth.map((d) => `${d.getMonth() + 1}/${d.getDate()}`).join(','),
  '10/28,10/29,10/30,10/31,11/1,11/2,11/3'
);

// DST: Estonia leaves summer time on Sunday 25 October 2026. A window that
// straddles it must still contain seven distinct calendar days at local midnight.
const dstWindow = windowDays(new Date(2026, 9, 22));
eq(
  'a DST change inside the window keeps seven days',
  dstWindow.map((d) => d.getDate()).join(','),
  '22,23,24,25,26,27,28'
);
eq(
  'every day in a DST window is local midnight',
  dstWindow.every((d) => d.getHours() === 0 && d.getMinutes() === 0),
  true
);

eq('today is selectable as a start', isStartDaySelectable(NOW, oneTimeDay('today', NOW)), true);
eq('yesterday is not', isStartDaySelectable(new Date(2026, 9, 19), oneTimeDay('today', NOW)), false);

// ── Any-day selection ────────────────────────────────────────────────────
let picked = selectionForStart(start20);
eq('a start date selects just itself', picked.length, 1);
picked = toggleSelectedDay(picked, start20, new Date(2026, 9, 22));
picked = toggleSelectedDay(picked, start20, new Date(2026, 9, 25));
eq(
  'non-consecutive days are allowed',
  picked.map((d) => d.getDate()).join(','),
  '20,22,25'
);
eq('three of seven days selected', picked.length, 3);
picked = toggleSelectedDay(picked, start20, new Date(2026, 9, 22));
eq(
  'toggling a day again removes it',
  picked.map((d) => d.getDate()).join(','),
  '20,25'
);
eq(
  'the start day cannot be removed',
  toggleSelectedDay(picked, start20, start20).map((d) => d.getDate()).join(','),
  '20,25'
);
eq(
  'a day outside the window is ignored',
  toggleSelectedDay(picked, start20, new Date(2026, 9, 27)).length,
  2
);
eq('a null start selects nothing', selectionForStart(null).length, 0);
eq(
  'sortDays orders chronologically',
  sortDays([new Date(2026, 9, 25), new Date(2026, 9, 20)]).map((d) => d.getDate()).join(','),
  '20,25'
);

// ── Multi-day gate ───────────────────────────────────────────────────────
eq('multiple days need a start', validateMultiDay(null, [], null, NOW), 'post_err_dates_pick');
eq(
  'a past start is rejected',
  validateMultiDay(new Date(2026, 9, 19), [new Date(2026, 9, 19)], SLOT_14_17, NOW),
  'post_err_dates_past'
);
eq(
  'an empty selection is rejected',
  validateMultiDay(start20, [], SLOT_8_11, NOW),
  'post_err_dates_pick'
);
eq(
  'a day outside the window is rejected',
  validateMultiDay(start20, [start20, new Date(2026, 9, 27)], SLOT_8_11, NOW),
  'post_err_dates_max'
);
eq(
  'a legal non-consecutive selection passes',
  validateMultiDay(start20, [start20, new Date(2026, 9, 22), new Date(2026, 9, 25)], SLOT_17_20, NOW),
  null
);
eq(
  'a start today with a past slot is rejected',
  validateMultiDay(oneTimeDay('today', NOW), [oneTimeDay('today', NOW)], SLOT_8_11, NOW),
  'post_err_time_past'
);

// ── Milestones ───────────────────────────────────────────────────────────
const single = buildOneTimeMilestones(oneTimeDay('tomorrow', NOW), ANYTIME_9_12, 3);
eq('one-time sends exactly one milestone', single.length, 1);
eq('one-time carries the expected hours', single[0].expected_hours, 3);
eq('one-time starts at the window start', new Date(single[0].scheduled_at).getHours(), 9);

const chosen = [new Date(2026, 9, 20), new Date(2026, 9, 22), new Date(2026, 9, 25)];
const multi = buildMultiDayMilestones(chosen, SLOT_8_11, 4);
eq('three selected days produce three milestones', multi.length, 3);
eq(
  'each milestone lands on its own selected day',
  multi.map((m) => new Date(m.scheduled_at).getDate()).join(','),
  '20,22,25'
);
eq('every milestone keeps the slot start', multi.every((m) => new Date(m.scheduled_at).getHours() === 8), true);
eq('every milestone carries the per-day hours', multi.every((m) => m.expected_hours === 4), true);
eq(
  'milestones are ISO 8601 UTC',
  multi.every((m) => /Z$/.test(m.scheduled_at) && !Number.isNaN(new Date(m.scheduled_at).getTime())),
  true
);
eq(
  'a UTC instant round-trips to the same local day and hour',
  (() => {
    const back = new Date(multi[0].scheduled_at);
    return back.getDate() === 20 && back.getHours() === 8;
  })(),
  true
);
eq(
  'an evening slot keeps the local day',
  new Date(buildMultiDayMilestones([new Date(2026, 9, 20)], { kind: 'slot', key: 'slot_20_23' }, 2)[0].scheduled_at).getDate(),
  20
);
eq(
  'a midnight-crossing UTC date still belongs to the chosen local day',
  new Date(composeInstant(new Date(2026, 9, 20), 8, 0).toISOString()).getDate(),
  20
);
eq('no window means no milestones', buildOneTimeMilestones(start20, { kind: 'slot', key: 'nope' }, 2).length, 0);

// ── Two-way lock ─────────────────────────────────────────────────────────
const defaults = { requestType: 'regular' as const, kind: 'one_time' as const };
eq('defaults are Regular + Single day', `${defaults.requestType}/${defaults.kind}`, 'regular/one_time');

const urgentFirst = applyRequestType({ requestType: 'regular', kind: 'multi_day' }, 'urgent');
eq('Urgent forces Single day', urgentFirst.kind, 'one_time');
eq('Urgent is selected', urgentFirst.requestType, 'urgent');
eq('Urgent reports the correction', urgentFirst.switched, true);
eq('Urgent resets the dates', urgentFirst.datesReset, true);
eq('Multiple days is disabled while Urgent is on', isBookingKindAllowed('multi_day', 'urgent'), false);
eq('Single day stays available while Urgent is on', isBookingKindAllowed('one_time', 'urgent'), true);

const multiFirst = applyBookingKind({ requestType: 'urgent', kind: 'one_time' }, 'multi_day');
eq('Multiple days forces Regular', multiFirst.requestType, 'regular');
eq('Multiple days is selected', multiFirst.kind, 'multi_day');
eq('Multiple days reports the correction', multiFirst.switched, true);
eq('Multiple days resets the dates', multiFirst.datesReset, true);
eq('Urgent is disabled for Multiple days', isRequestTypeAllowed('multi_day', 'urgent'), false);
eq('Regular is always available', isRequestTypeAllowed('multi_day', 'regular'), true);

const backToSingle = applyBookingKind({ requestType: 'regular', kind: 'multi_day' }, 'one_time');
eq('switching back keeps Regular', backToSingle.requestType, 'regular');
eq('switching back re-enables Urgent', isRequestTypeAllowed(backToSingle.kind, 'urgent'), true);
eq('switching back resets the dates', backToSingle.datesReset, true);

const sameKind = applyBookingKind({ requestType: 'regular', kind: 'one_time' }, 'one_time');
eq('re-picking the same kind does not reset the dates', sameKind.datesReset, false);
eq('re-picking the same kind is not a correction', sameKind.switched, false);

const regularTap = applyRequestType({ requestType: 'urgent', kind: 'one_time' }, 'regular');
eq('Regular keeps the booking kind', regularTap.kind, 'one_time');
eq('Regular keeps the dates', regularTap.datesReset, false);

// ── Clock geometry ───────────────────────────────────────────────────────
eq('12 o’clock is 0 degrees', angleForHour(12), 0);
eq('3 o’clock is 90 degrees', angleForHour(3), 90);
eq('55 minutes is 330 degrees', angleForMinute(55), 330);
eq('the angle is derived per mode', angleForValue(9, 'minute'), 54);
eq('a tap at 12 picks 12', hourFromAngle(0), 12);
eq('a tap just before 12 picks 12', hourFromAngle(359), 12);
eq('a tap at 3 picks 3', hourFromAngle(90), 3);
eq('a tap at 6 picks 6', hourFromAngle(180), 6);
eq('minutes snap to 5', minuteFromAngle(28), 5);
eq('minutes snap upwards', minuteFromAngle(34), 5);
eq('a tap near 12 o’clock is 0 minutes, not 60', minuteFromAngle(354), 0);
eq('a point straight up is 0 degrees', angleForPoint(0, -10), 0);
eq('a point to the right is 90 degrees', angleForPoint(10, 0), 90);
eq('a point below is 180 degrees', angleForPoint(0, 10), 180);
eq('a point to the left is 270 degrees', angleForPoint(-10, 0), 270);
eq('a drag across 12 o’clock stays a small angle', angleForPoint(1, -10) < 10, true);
eq('a tiny drag is inside the dead zone', isOutsideDeadZone(3, 3), false);
eq('a real drag is outside the dead zone', isOutsideDeadZone(30, 0), true);
eq('a point picks the nearest hour', valueFromPoint(0, -40, 'hour'), 12);
eq('a point picks the nearest minute', valueFromPoint(0, -40, 'minute'), 0);
eq('normalize keeps 360 at 0', normalizeDegrees(360), 0);
eq('normalize handles negatives', normalizeDegrees(-90), 270);

// A drag across 12 o'clock: the hour must go 11 → 12 → 1 with NO full turn.
const dragAngles = [300, 330, 350, 359, 5, 20, 35];
const dragHours = dragAngles.map((deg) => hourFromAngle(deg));
eq('dragging across 12 picks 10,11,12,12,12,1,1', dragHours.join(','), '10,11,12,12,12,1,1');
eq(
  'no step in that drag turns the hand more than 30 degrees',
  dragHours.every((hour, index) => {
    if (index === 0) return true;
    const from = angleForHour(dragHours[index - 1]);
    const to = angleForHour(hour);
    return Math.abs(shortestTurn(from, to)) <= 30;
  }),
  true
);

// Minutes across 59 → 0 must wrap without a full turn.
const minuteDrag = [58, 59, 0, 1].map((min) => angleForMinute(min));
eq('59 → 0 is the shortest turn', Math.abs(shortestTurn(minuteDrag[1], minuteDrag[2])), 6);
eq('the minute hand never exceeds 354 degrees', angleForMinute(59), 354);
eq('after release the needle is the value’s angle', angleForValue(12, 'hour'), angleForHour(12));

// ── Steppers ─────────────────────────────────────────────────────────────
eq('hour step wraps 12 → 1', stepHour12(12, 1), 1);
eq('hour step wraps 1 → 12', stepHour12(1, -1), 12);
eq('hour step 11 → 12', stepHour12(11, 1), 12);
eq('hour step 12 → 11', stepHour12(12, -1), 11);
eq('minute step wraps 59 → 0', stepMinute(59, 1), 0);
eq('minute step wraps 0 → 59', stepMinute(0, -1), 59);
eq('minute step keeps the hour', stepMinute(5, 1), 6);

// ── Hours bounds ─────────────────────────────────────────────────────────
eq('hours below the floor are clamped', clampExpectedHours(0), 1);
eq('hours above the ceiling are clamped', clampExpectedHours(99), 24);
eq('hours are rounded to integers', clampExpectedHours(3.6), 4);

// ── Clock 12/24-hour conversion + labels ─────────────────────────────────
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
eq(
  'a day button label is short',
  formatDayButton(new Date(2026, 9, 20), WEEKDAYS),
  'Tue 20'
);
eq(
  'the chosen days are summarised in order',
  formatDaysList(chosen, MONTHS, WEEKDAYS),
  'Tue 20 Oct, Thu 22 Oct, Sun 25 Oct'
);

// ── The "Preferred time" line (option B) ─────────────────────────────────
const LINE = buildPreferredTimeLine('8:00 AM - 11:00 AM');
eq('the line has the fixed English prefix', LINE, 'Preferred time: 8:00 AM - 11:00 AM');
eq('no window means no line', buildPreferredTimeLine(''), null);
eq(
  'the line is appended at the very end',
  withPreferredTimeLine('Two rooms to clean', LINE),
  'Two rooms to clean\nPreferred time: 8:00 AM - 11:00 AM'
);
eq(
  'applying it twice does not duplicate it',
  withPreferredTimeLine(
    withPreferredTimeLine('Two rooms to clean', LINE),
    LINE
  ),
  'Two rooms to clean\nPreferred time: 8:00 AM - 11:00 AM'
);
eq(
  'a changed window replaces the old line',
  withPreferredTimeLine(
    withPreferredTimeLine('Two rooms', LINE),
    buildPreferredTimeLine('9:30 AM - 12:00 PM')
  ),
  'Two rooms\nPreferred time: 9:30 AM - 12:00 PM'
);
eq(
  'stripping restores the user’s own text',
  stripPreferredTimeLine('Two rooms to clean\nPreferred time: 8:00 AM - 11:00 AM'),
  'Two rooms to clean'
);
eq(
  'stripping a line-only description leaves nothing',
  stripPreferredTimeLine(LINE),
  ''
);
eq(
  'user prose mentioning “preferred time” mid-text is untouched',
  stripPreferredTimeLine('Ask about the preferred time before arriving'),
  'Ask about the preferred time before arriving'
);
eq(
  'the word counter ignores the line',
  countWords(stripPreferredTimeLine(`Two rooms\n${LINE}`)),
  2
);
eq(
  'the combined word count includes the line',
  descriptionWordCount('Two rooms', LINE),
  2 + 7
);
eq('494 words plus the seven-word line is exactly 501', descriptionWordCount('word '.repeat(494).trim(), LINE), 501);
eq('a 493-word description plus the line fits', exceedsDescriptionLimit('word '.repeat(493).trim(), LINE), false);
eq('a 494-word description plus the line overflows', exceedsDescriptionLimit('word '.repeat(494).trim(), LINE), true);

// ── The request builder ──────────────────────────────────────────────────
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
  scheduledAtIso: composeInstant(new Date(2026, 9, 21), 9, 0).toISOString(),
  preferredTimeLine: LINE,
});
eq('one-time body uses the ONE_TIME enum', oneTimeBody.booking_type, 'ONE_TIME');
eq('one-time body carries one milestone', oneTimeBody.milestones.length, 1);
eq('one-time milestone carries the hours', Number(oneTimeBody.milestones[0].expected_hours), 2);
eq(
  'the built description carries the line once',
  oneTimeBody.description,
  'Two rooms\nPreferred time: 8:00 AM - 11:00 AM'
);

const multiBody = buildCreateJobRequest({
  ...base,
  bookingType: 'multi_day',
  requestType: 'urgent',
  milestones: chosen.map((day) => ({
    scheduledAtIso: composeInstant(day, 8, 0).toISOString(),
    expectedHours: 2,
  })),
  preferredTimeLine: LINE,
});
eq('multiple days use the MULTI_DAY enum', multiBody.booking_type, 'MULTI_DAY');
eq('multiple days carry one milestone per selected day', multiBody.milestones.length, 3);
eq('the builder forces REGULAR for MULTI_DAY even if the form said Urgent', multiBody.request_type, 'REGULAR');

const capped = buildCreateJobRequest({
  ...base,
  bookingType: 'multi_day',
  milestones: Array.from({ length: 9 }, (_, i) => ({
    scheduledAtIso: composeInstant(new Date(2026, 9, 20 + i), 9, 0).toISOString(),
    expectedHours: 2,
  })),
});
eq('an over-long milestone list is capped at the documented week', capped.milestones.length, 7);

const empty = resolveMilestones({
  ...base,
  bookingType: 'multi_day',
  milestones: [],
  scheduledAtIso: composeInstant(new Date(2026, 9, 21), 9, 0).toISOString(),
});
eq('an empty multi-day list falls back to the single instant', empty.length, 1);
eq(
  'a draft flag is passed through verbatim',
  buildCreateJobRequest({ ...base, bookingType: 'one_time', scheduledAtIso: null, isDraft: true }).is_draft,
  true
);

// ── Profile address comparison ───────────────────────────────────────────
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
eq('a different city is a change', profileAddressDiffers({ ...form, cityId: 11 }, saved), true);
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
