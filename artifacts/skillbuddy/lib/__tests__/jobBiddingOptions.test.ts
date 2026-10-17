/**
 * Unit tests for CHUNK 4.
 *
 *  PART A — the Post-Job wizard rules: the booking-kind → request-type LOCK
 *  (multi-day is Regular only), the title rule (3..150 trimmed) and the
 *  milestone hardening in the payload builder (ONE_TIME exactly one, MULTI_DAY
 *  capped at 7, duplicates dropped, entries beyond one week dropped).
 *
 *  PART B — the client Bids screen's "Bidding options" model: flag-driven button
 *  visibility, the restart counter, the window-ended decision, the API-aware
 *  timestamp parsing (GET sends marker-less UTC stamps) and the idempotence rule
 *  for `job.bidding_extended`.
 *
 * Every expectation below is pinned to something the LIVE backend was observed to
 * do on 2026-10-14 (throwaway jobs 3 and 4; raw records under
 * .freebuff/livetest/chunk4-*.json), or to the live OpenAPI schema.
 *
 * Run through the project's own harness: `pnpm run test`.
 */
import {
  isRequestTypeAllowed,
  resolveRequestTypeForBooking,
} from '../jobBooking';
import {
  JOB_TITLE_MAX,
  JOB_TITLE_MIN,
  buildCreateJobRequest,
  resolveMilestones,
  validateJobTitle,
} from '../jobCreate';
import {
  BIDDING_WINDOW_MINUTES,
  MAX_TIMER_RESTARTS,
  biddingOptionsModel,
  isNewerBiddingDeadline,
  type BiddingOptionsJob,
} from '../jobBiddingOptions';
import { biddingDeadline, parseApiIsoUtc } from '../jobDetail';
import { createRequestSequencer } from '../jobBidsLive';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

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

function throws(label: string, fn: () => unknown): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  check(label, threw);
}

/* ══════════════════════ PART A · booking kind → request type ═══════════════ */

const lockMultiFromUrgent = resolveRequestTypeForBooking('multi_day', 'urgent');
eq('long-term + urgent switches the type', lockMultiFromUrgent.requestType, 'regular');
check('…and reports that it switched', lockMultiFromUrgent.switched);
eq('…keeping the long-term booking kind', lockMultiFromUrgent.kind, 'multi_day');

const lockMultiFromRegular = resolveRequestTypeForBooking('multi_day', 'regular');
eq('long-term + regular is left alone', lockMultiFromRegular.requestType, 'regular');
check('…and reports no switch', !lockMultiFromRegular.switched);

const lockOneTimeUrgent = resolveRequestTypeForBooking('one_time', 'urgent');
eq('one-time + urgent KEEPS urgent', lockOneTimeUrgent.requestType, 'urgent');
check('…and reports no switch', !lockOneTimeUrgent.switched);

eq(
  'the Urgent option is not allowed for multi-day',
  isRequestTypeAllowed('multi_day', 'urgent'),
  false
);
eq(
  'the Regular option is allowed for multi-day',
  isRequestTypeAllowed('multi_day', 'regular'),
  true
);
eq('the Urgent option is allowed for one-time', isRequestTypeAllowed('one_time', 'urgent'), true);
eq(
  'the Regular option is allowed for one-time',
  isRequestTypeAllowed('one_time', 'regular'),
  true
);

/* ══════════════════════════════ PART A · title rule ═══════════════════════ */

const title = (length: number) => 'a'.repeat(length);
eq('a 2-character title is too short', validateJobTitle('ab'), 'post_err_title_min');
eq('a 3-character title is accepted', validateJobTitle('abc'), null);
eq(`a ${JOB_TITLE_MAX}-character title is accepted`, validateJobTitle(title(JOB_TITLE_MAX)), null);
eq(
  `a ${JOB_TITLE_MAX + 1}-character title is too long`,
  validateJobTitle(title(JOB_TITLE_MAX + 1)),
  'post_err_title_max'
);
eq('an empty title is too short', validateJobTitle(''), 'post_err_title_min');
eq('an all-whitespace title is too short', validateJobTitle('   '), 'post_err_title_min');
eq('the rule is applied to the TRIMMED value (short)', validateJobTitle('  ab  '), 'post_err_title_min');
eq('the rule is applied to the TRIMMED value (padding)', validateJobTitle('  abc  '), null);
eq(
  'padding cannot push a legal title over the limit',
  validateJobTitle(`  ${title(JOB_TITLE_MAX)}  `),
  null
);
eq('the live schema bounds are 3 and 150', `${JOB_TITLE_MIN}-${JOB_TITLE_MAX}`, '3-150');

/* ═══════════════════════ PART A · milestone hardening ═════════════════════ */

const formBase = {
  serviceId: 35,
  serviceCategoryId: 34,
  title: 'TEST - ignore builder',
  description: 'TEST - ignore',
  requestType: 'regular' as const,
  expectedHours: 2,
  countryId: 1,
  countyId: 4,
  cityId: 9,
  houseNumber: '1',
  streetAddress: 'TEST street',
  postalCode: '10000',
  landmark: '',
  formattedAddress: '',
  isDraft: false,
};

/** A UTC ISO instant `dayOffset` days from a fixed anchor, at 09:00Z. */
const at = (dayOffset: number, hour = 9) =>
  new Date(Date.UTC(2026, 9, 10 + dayOffset, hour, 0, 0)).toISOString();

const multi = (days: string[]) => ({
  ...formBase,
  bookingType: 'multi_day' as const,
  milestones: days.map((scheduledAtIso) => ({ scheduledAtIso, expectedHours: 2 })),
});

const oneTime = (scheduledAtIso: string | null, extra: string[] = []) => ({
  ...formBase,
  bookingType: 'one_time' as const,
  scheduledAtIso,
  milestones: extra.map((iso) => ({ scheduledAtIso: iso, expectedHours: 2 })),
});

// MULTI_DAY ALWAYS sends REGULAR, whatever the form said.
eq(
  'multi-day + urgent still ships REGULAR (live: 422 otherwise)',
  buildCreateJobRequest({ ...multi([at(0)]), requestType: 'urgent' as const }).request_type,
  'REGULAR'
);
eq(
  'one-time + urgent still ships URGENT',
  buildCreateJobRequest({ ...oneTime(at(0)), requestType: 'urgent' as const }).request_type,
  'URGENT'
);
eq(
  'one-time + regular ships REGULAR',
  buildCreateJobRequest(oneTime(at(0))).request_type,
  'REGULAR'
);

// ONE_TIME is exactly one milestone, even if extra entries are handed in.
eq(
  'a one-time job ships exactly one milestone',
  buildCreateJobRequest(oneTime(at(0), [at(1), at(2)])).milestones.length,
  1
);
eq(
  '…and it is the one-time instant, not a stray entry',
  buildCreateJobRequest(oneTime(at(0), [at(1)])).milestones[0].scheduled_at,
  at(0)
);
eq(
  'a one-time body with no instant carries no milestones',
  buildCreateJobRequest(oneTime(null)).milestones.length,
  0
);

// MULTI_DAY count, duplicates and the one-week span.
eq(
  'an 8-milestone multi-day list is capped at 7 (live: 422 above 7)',
  buildCreateJobRequest(multi([0, 1, 2, 3, 4, 5, 6, 7].map((d) => at(d)))).milestones.length,
  7
);
eq(
  'a 7-day list is untouched',
  buildCreateJobRequest(multi([0, 1, 2, 3, 4, 5, 6].map((d) => at(d)))).milestones.length,
  7
);
eq(
  'duplicate scheduled_at values are dropped (live: no duplicate times)',
  buildCreateJobRequest(multi([at(0), at(0), at(1), at(1), at(1)])).milestones.length,
  2
);
eq(
  'an entry beyond one week of the first is dropped',
  buildCreateJobRequest(multi([at(0), at(7)])).milestones.length,
  1
);
eq(
  'day 6 IS within one week of the first',
  buildCreateJobRequest(multi([at(0), at(6)])).milestones.length,
  2
);
const orderKept = buildCreateJobRequest(multi([at(0), at(2), at(1)]));
check(
  'the wizard order of the surviving milestones is kept',
  orderKept.milestones[0].scheduled_at === at(0) &&
    orderKept.milestones[1].scheduled_at === at(2) &&
    orderKept.milestones[2].scheduled_at === at(1)
);
eq(
  'an empty multi-day list falls back to the single instant',
  resolveMilestones({
    ...formBase,
    bookingType: 'multi_day',
    milestones: [],
    scheduledAtIso: at(0),
  }).length,
  1
);

// The builder refuses to PRODUCE the two title payloads the live backend rejects.
throws('the builder refuses a 2-character title', () =>
  buildCreateJobRequest({ ...oneTime(at(0)), title: 'ab' })
);
throws('the builder refuses a 151-character title', () =>
  buildCreateJobRequest({ ...oneTime(at(0)), title: title(JOB_TITLE_MAX + 1) })
);
eq(
  'the builder trims and ships a legal 3-character title',
  buildCreateJobRequest({ ...oneTime(at(0)), title: '  abc  ' }).title,
  'abc'
);
eq(
  'the builder ships a 150-character title',
  buildCreateJobRequest({ ...oneTime(at(0)), title: title(JOB_TITLE_MAX) }).title.length,
  JOB_TITLE_MAX
);

/* ═════════════════ PART B · the bidding options card model ═════════════════ */

const job = (over: Partial<BiddingOptionsJob> = {}): BiddingOptionsJob => ({
  status: 'OPEN',
  request_type: 'REGULAR',
  is_urgent: false,
  timer_restart_count: 0,
  can_restart_timer: true,
  can_convert_to_regular: false,
  can_convert_to_urgent: true,
  is_bidding_open: true,
  bidding_ends_at: '2026-10-14T21:24:49',
  ...over,
});

const NOW = Date.parse('2026-10-14T18:24:49Z');
const asClient = { isClient: true, nowMs: NOW };

const base = biddingOptionsModel(job(), asClient);
check('the card is visible for the owner on an OPEN job with a flag', base.visible);
check('the restart button follows can_restart_timer', base.restart);
check('Convert to Regular follows can_convert_to_regular', base.toRegular === false);
check('Convert to Urgent follows can_convert_to_urgent', base.toUrgent);
eq('the restart counter reads timer_restart_count', base.restartsUsed, 0);
eq('the counter’s limit is the live-verified 3', base.restartsMax, MAX_TIMER_RESTARTS);
eq('a running REGULAR window is not "ended"', base.windowEnded, false);
eq('a REGULAR job states the verified 180-minute window', base.windowMinutes, 180);

const urgent = biddingOptionsModel(
  job({ request_type: 'URGENT', is_urgent: true, can_convert_to_regular: true, can_convert_to_urgent: false }),
  asClient
);
eq('an URGENT job states the verified 30-minute window', urgent.windowMinutes, 30);
check('an urgent job offers Convert to Regular', urgent.toRegular);
check('an urgent job does not offer Convert to Urgent', !urgent.toUrgent);
eq('the model reports the urgency for the badge', urgent.isUrgent, true);

check(
  'provider mode never shows the card',
  !biddingOptionsModel(job(), { isClient: false, nowMs: NOW }).visible
);
check(
  'a job that is not OPEN never shows the card',
  !biddingOptionsModel(job({ status: 'PROVIDER_ASSIGNED' }), asClient).visible
);
check(
  'an OPEN job with every flag false shows no card',
  !biddingOptionsModel(
    job({ can_restart_timer: false, can_convert_to_regular: false, can_convert_to_urgent: false }),
    asClient
  ).visible
);
check('no job at all means no card', !biddingOptionsModel(null, asClient).visible);
check(
  'each button is independent of the others (restart only)',
  (() => {
    const model = biddingOptionsModel(
      job({ can_restart_timer: true, can_convert_to_regular: false, can_convert_to_urgent: false }),
      asClient
    );
    return model.visible && model.restart && !model.toRegular && !model.toUrgent;
  })()
);

eq('the counter passes a real count through', biddingOptionsModel(job({ timer_restart_count: 2 }), asClient).restartsUsed, 2);
eq(
  'a reached limit still reports the count honestly',
  biddingOptionsModel(job({ timer_restart_count: 3, can_restart_timer: false }), asClient)
    .restartsUsed,
  3
);
eq(
  'a negative or broken count floors at zero',
  biddingOptionsModel(job({ timer_restart_count: -4 }), asClient).restartsUsed,
  0
);

// The window-ended decision: the backend's flag first, then the REAL deadline.
check(
  'is_bidding_open false means the window ended',
  biddingOptionsModel(job({ is_bidding_open: false }), asClient).windowEnded
);
check(
  'a marker-less (GET) deadline in the past means the window ended',
  biddingOptionsModel(job({ bidding_ends_at: '2026-10-14T18:00:00' }), asClient).windowEnded
);
check(
  'a marker-less (GET) deadline in the future is still running',
  biddingOptionsModel(job({ bidding_ends_at: '2026-10-14T19:00:00' }), asClient).windowEnded === false
);
check(
  'a Z-suffixed (POST) deadline in the past means the window ended',
  biddingOptionsModel(job({ bidding_ends_at: '2026-10-14T18:00:00Z' }), asClient).windowEnded
);
check(
  'an unreadable deadline leaves the decision to the flag',
  biddingOptionsModel(job({ bidding_ends_at: null }), asClient).windowEnded === false
);

/* ═══════════ PART B · API timestamps (GET strips the timezone) ════════════ */

const naiveMs = Date.UTC(2026, 9, 14, 21, 24, 49);
eq(
  'a marker-less GET stamp is read as UTC, not device-local',
  parseApiIsoUtc('2026-10-14T21:24:49')?.getTime(),
  naiveMs
);
eq(
  'the same stamp with Z reads identically',
  parseApiIsoUtc('2026-10-14T21:24:49Z')?.getTime(),
  naiveMs
);
eq(
  'the POST form (microseconds + Z) reads to the same second',
  parseApiIsoUtc('2026-10-14T21:24:49.138925Z')?.getTime(),
  Date.UTC(2026, 9, 14, 21, 24, 49, 138)
);
eq('an offset-carrying stamp is left to the platform', parseApiIsoUtc('2026-10-14T21:24:49+02:00')?.getTime(), Date.UTC(2026, 9, 14, 19, 24, 49));
eq('an empty stamp is null', parseApiIsoUtc(''), null);
eq('garbage is null', parseApiIsoUtc('not-a-date'), null);

eq(
  'the countdown deadline uses the UTC reading of a GET stamp',
  biddingDeadline(
    { is_bidding_open: true, bidding_ends_at: '2026-10-14T21:24:49', remaining_bidding_seconds: null },
    NOW
  ),
  naiveMs
);
eq(
  'remaining_bidding_seconds is the fallback when the deadline is absent',
  biddingDeadline({ is_bidding_open: true, bidding_ends_at: null, remaining_bidding_seconds: 180 }, NOW),
  NOW + 180_000
);
eq(
  'a closed window has no deadline',
  biddingDeadline({ is_bidding_open: false, bidding_ends_at: '2026-10-14T21:24:49', remaining_bidding_seconds: 10 }, NOW),
  null
);

/* ═════════ PART B · idempotent job.bidding_extended handling ══════════════ */

check(
  'an event carrying the deadline the job already has is NOT new (no second notice)',
  !isNewerBiddingDeadline(naiveMs, '2026-10-14T21:24:49')
);
check(
  'the Z form of that same deadline is still not new',
  !isNewerBiddingDeadline(naiveMs, '2026-10-14T21:24:49Z')
);
check(
  'a genuinely newer deadline IS new',
  isNewerBiddingDeadline(Date.UTC(2026, 9, 14, 22, 0, 0), '2026-10-14T21:24:49')
);
check(
  'an older deadline is never "new"',
  !isNewerBiddingDeadline(Date.UTC(2026, 9, 14, 20, 0, 0), '2026-10-14T21:24:49')
);
check(
  'a job with no readable deadline accepts the event',
  isNewerBiddingDeadline(naiveMs, null)
);
check('an event with no deadline is never new', !isNewerBiddingDeadline(null, '2026-10-14T21:24:49'));

/* ═══════════════ PART B · stale responses are ignored ════════════════════ */

// The options refetch goes through the SAME sequenced loader the live bids use:
// an older response can never overwrite a newer one, and a job change invalidates
// everything still in flight.
const sequencer = createRequestSequencer();
const firstPrefetch = sequencer.next();
const optionRefetch = sequencer.next();
check('the refetch triggered by the action is the current one', sequencer.isCurrent(optionRefetch));
check('the earlier in-flight list response is now stale', !sequencer.isCurrent(firstPrefetch));
sequencer.invalidate();
check('switching job makes every in-flight response stale', !sequencer.isCurrent(optionRefetch));

/* ───────────────────────────────────────────────────────────────── report ── */

export const summary = { passed, total: passed + failures.length };
console.log(`jobBiddingOptions: ${summary.passed}/${summary.total} assertions passed`);
for (const failure of failures) console.log(`FAIL ${failure}`);
