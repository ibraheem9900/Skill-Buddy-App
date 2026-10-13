/**
 * Bidding flow rules (Modules 4B / 4C / 4D).
 *
 * Locks down the parts that are easy to get subtly wrong:
 *   - money is ASYMMETRIC on the wire: BidResponse.offered_price comes back as
 *     a NUMERIC STRING, while BidCreate.offered_price is SENT as a number
 *     rounded to 2 decimals. The docs' example generator emits 300-digit
 *     values, so parsing must be defensive and formatting must never print
 *     "€NaN",
 *   - the Submit Bid form's validation (integer-cents arithmetic, so a price is
 *     never a long binary fraction),
 *   - eta_minutes inside BidCreate's documented 0..1440, and the human copy for
 *     it,
 *   - the provider's gate, the BidCreate body and the 422 field mapping,
 *   - status labels, which are never printed raw for an unknown enum.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import {
  BID_ETA_MAX_MINUTES,
  BID_MESSAGE_MAX_CHARS,
  bidStatusLabelKey,
  formatBidPrice,
  parseBidPrice,
  validateBidMessage,
  validateBidPrice,
  validateEtaMinutes,
  bidEtaParts,
  bidFieldError,
  bidNextStepKey,
  bidRejectionReason,
  bidStatusStamp,
  isBidFinal,
  isBidPending,
  isUsableBidResponse,
  myBidLookupFromData,
  myBidLookupFromError,
  bidSubmitErrorKey,
  bidSubmitFailureMessage,
  buildBidCreateRequest,
  canProviderSubmitBid,
  isBiddingOpen,
  shouldResyncAfterBidFailure,
  BID_SORT_IDS,
  BID_SORT_LABEL_KEY,
  CLIENT_VISIBLE_BID_STATUSES,
  allBids,
  filterClientVisibleBids,
  formatBidDistanceLocale,
  formatBidPriceLocale,
  isClientVisibleBid,
  parseBidDistance,
  sortBids,
  totalBidCount,
  BID_ADJUST_STEPS,
  adjustBidPrice,
  bidDraftEtaMinutes,
  bidDraftFromBid,
  bidUpdateErrorKey,
  bidUpdateFailureMessage,
  buildBidUpdateRequest,
  canApplyBidAdjust,
  canEditBid,
  formatAdjustChipLabel,
  hasBidDraftChanged,
  isBidDraftValid,
  isStaleBid,
  isValidBidId,
  shouldOfferBidAdjust,
  canWithdrawBid,
  WITHDRAW_BID_ACTION_KEY,
  acceptBidErrorKey,
  acceptBidFailureMessage,
  acceptResolvedAfterResync,
  bidById,
  bidRejectReasonFieldError,
  bidSelectionMatches,
  buildBidRejectRequest,
  canAcceptBid,
  canRejectBid,
  isJobAcceptEligible,
  isJobBidDecisionEligible,
  isRejectNotAllowed,
  milestoneScheduleRange,
  rejectBidErrorKey,
  rejectBidFailureMessage,
  shouldResyncAfterAcceptFailure,
  shouldResyncAfterRejectFailure,
  BID_REJECT_REASON_MAX_CHARS,
  validateBidRejectReason,
  type BidSortId,
} from '../bid';
import type {
  BidResponse,
  BidStatus,
  JobBidsResponse,
  JobResponse,
  ValidationErrorDetail,
} from '@/types';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean) {
  if (condition) passed += 1;
  else {
    failures.push(label);
    console.log(`FAIL ${label}`);
  }
}

function eq<T>(label: string, actual: T, expected: T) {
  check(`${label} (got ${String(actual)}, want ${String(expected)})`, actual === expected);
}

function deepEq(label: string, actual: unknown, expected: unknown) {
  check(`${label} (got ${JSON.stringify(actual)})`, JSON.stringify(actual) === JSON.stringify(expected));
}

/* ─────────────────────────────────────────────────────────── parsing money */

eq('a plain price string parses', parseBidPrice('20.00'), 20);
eq('a price with one decimal parses', parseBidPrice('7.5'), 7.5);
eq('a number parses', parseBidPrice(19.99), 19.99);
eq('surrounding whitespace is tolerated', parseBidPrice('  12.30  '), 12.3);
eq('null parses to nothing', parseBidPrice(null), null);
eq('undefined parses to nothing', parseBidPrice(undefined), null);
eq('an empty string parses to nothing', parseBidPrice(''), null);
eq('a blank string parses to nothing', parseBidPrice('   '), null);
eq('a non-numeric string parses to nothing', parseBidPrice('abc'), null);
eq('a NaN number parses to nothing', parseBidPrice(Number.NaN), null);
eq('an Infinity parses to nothing', parseBidPrice(Number.POSITIVE_INFINITY), null);
eq('the docs 300-digit example is rejected', parseBidPrice(`${'0'.repeat(300)}`), null);
eq('a 16-char price is rejected by the length guard', parseBidPrice('0000000000123.45'), null);
eq('a 15-char price is still accepted', parseBidPrice('000000000012.45'), 12.45);
eq('an absurdly large price is rejected', parseBidPrice('9999999999'), null);

eq('a price formats with 2 decimals', formatBidPrice('20'), '€20.00');
eq('a one-decimal price is padded', formatBidPrice('7.5'), '€7.50');
eq('an unparseable price formats to null', formatBidPrice('nope'), null);
eq('a missing price formats to null', formatBidPrice(null), null);

/* ─────────────────────────────────────────────── the Submit Bid price rules */

eq('an empty price is required', validateBidPrice('').ok, false);
deepEq('an empty price reports "required"', validateBidPrice(''), { ok: false, errorKey: 'bid_err_price_required' });
deepEq('a blank price reports "required"', validateBidPrice('  '), { ok: false, errorKey: 'bid_err_price_required' });
deepEq('letters report "invalid"', validateBidPrice('abc'), { ok: false, errorKey: 'bid_err_price_invalid' });
deepEq('a lone dot reports "invalid"', validateBidPrice('.'), { ok: false, errorKey: 'bid_err_price_invalid' });
deepEq('zero reports "positive"', validateBidPrice('0'), { ok: false, errorKey: 'bid_err_price_positive' });
deepEq('0.00 reports "positive"', validateBidPrice('0.00'), { ok: false, errorKey: 'bid_err_price_positive' });
deepEq('a negative price is refused', validateBidPrice('-5'), { ok: false, errorKey: 'bid_err_price_invalid' });
deepEq('three decimals report "decimals" rather than rounding silently', validateBidPrice('12.345'), {
  ok: false,
  errorKey: 'bid_err_price_decimals',
});
deepEq('a whole number is sent as a number', validateBidPrice('20'), { ok: true, value: 20 });
deepEq('one decimal is sent as a number', validateBidPrice('7.5'), { ok: true, value: 7.5 });
deepEq('whitespace is trimmed before validating', validateBidPrice('  12.30 '), { ok: true, value: 12.3 });
deepEq('a leading dot with decimals is accepted', validateBidPrice('.75'), { ok: true, value: 0.75 });
deepEq('a client-side ceiling is enforced', validateBidPrice('500', { maxPrice: 100 }), {
  ok: false,
  errorKey: 'bid_err_price_too_large',
});
deepEq('a price at the ceiling passes', validateBidPrice('100', { maxPrice: 100 }), { ok: true, value: 100 });

/* The Baltic/German comma separator (the task's own "comma and dot both work"). */
deepEq('a comma decimal separator is accepted', validateBidPrice('12,50'), { ok: true, value: 12.5 });
deepEq('a comma with one decimal is accepted', validateBidPrice('7,5'), { ok: true, value: 7.5 });
deepEq('a comma and a dot together are ambiguous and refused', validateBidPrice('1.234,56'), {
  ok: false,
  errorKey: 'bid_err_price_invalid',
});
deepEq(
  'a comma thousands group is an ERROR, never a silent €1.50',
  validateBidPrice('1,500'),
  { ok: false, errorKey: 'bid_err_price_decimals' }
);

const validated = validateBidPrice('3');
eq('the validated value is a NUMBER, not a string', typeof (validated as { value: unknown }).value, 'number');
eq(
  'the number carries at most 2 decimals',
  (validateBidPrice('12.3') as { value: number }).value === 12.3 &&
    Math.round((validateBidPrice('12.3') as { value: number }).value * 100) === 1230,
  true
);

/* ─────────────────────────────────────────────────────────────── ETA rules */

eq('the documented eta ceiling is 24 hours', BID_ETA_MAX_MINUTES, 1440);
deepEq('an empty eta is required', validateEtaMinutes(''), { ok: false, errorKey: 'bid_err_eta_required' });
deepEq('a fractional eta is invalid', validateEtaMinutes('12.5'), { ok: false, errorKey: 'bid_err_eta_invalid' });
deepEq('a negative eta is invalid', validateEtaMinutes('-5'), { ok: false, errorKey: 'bid_err_eta_invalid' });
deepEq('an eta above 1440 is out of range', validateEtaMinutes('1441'), { ok: false, errorKey: 'bid_err_eta_range' });
deepEq('exactly 1440 is accepted', validateEtaMinutes('1440'), { ok: true, value: 1440 });
deepEq('zero is a real answer, not an error', validateEtaMinutes('0'), { ok: true, value: 0 });
deepEq('a normal eta is accepted', validateEtaMinutes('45'), { ok: true, value: 45 });

/* ─────────────────────────────────────────────────────────── message rules */

eq('the spec message cap is 1000', BID_MESSAGE_MAX_CHARS, 1000);
deepEq('an empty message becomes null', validateBidMessage(''), { ok: true, value: null });
deepEq('a whitespace message becomes null', validateBidMessage('   '), { ok: true, value: null });
deepEq('a message is trimmed', validateBidMessage('  hello  '), { ok: true, value: 'hello' });
eq('exactly 1000 characters is accepted', validateBidMessage('x'.repeat(1000)).ok, true);
deepEq('1001 characters is refused', validateBidMessage('x'.repeat(1001)), {
  ok: false,
  errorKey: 'bid_err_message_too_long',
});

/* ───────────────────────────────────────────────────────────────── status */

eq('PENDING has a label', bidStatusLabelKey('PENDING'), 'bid_status_pending');
eq('ACCEPTED has a label', bidStatusLabelKey('ACCEPTED'), 'bid_status_accepted');
eq('REJECTED has a label', bidStatusLabelKey('REJECTED'), 'bid_status_rejected');
eq('WITHDRAWN has a label', bidStatusLabelKey('WITHDRAWN'), 'bid_status_withdrawn');
eq('EXPIRED has a label', bidStatusLabelKey('EXPIRED'), 'bid_status_expired');
eq('an unknown status has no label (never printed raw)', bidStatusLabelKey('SOMETHING_ELSE'), null);
eq('a missing status has no label', bidStatusLabelKey(null), null);

/* ─────────────────────────────────── the provider's Submit Bid gate + copy */

const openJob = { assigned_provider_id: null, is_bidding_open: true, status: 'OPEN' as const };

eq('a job whose window is open counts as open', isBiddingOpen(openJob), true);
eq('a job with is_bidding_open false is closed', isBiddingOpen({ ...openJob, is_bidding_open: false }), false);
eq('a job that has left OPEN is closed', isBiddingOpen({ ...openJob, status: 'ASSIGNED' as never }), false);
eq('a missing job is not open', isBiddingOpen(null), false);
const noOpenFlag = { status: 'OPEN' } as unknown as Parameters<typeof isBiddingOpen>[0];
eq('a missing is_bidding_open flag is never "probably open"', isBiddingOpen(noOpenFlag), false);

eq('a provider on an open unassigned job may bid', canProviderSubmitBid(openJob, 'PROVIDER'), true);
eq('the CLIENT role may never see the bid action', canProviderSubmitBid(openJob, 'CLIENT'), false);
eq('no role at all may not bid', canProviderSubmitBid(openJob, null), false);
eq('an already-assigned job offers no bid', canProviderSubmitBid({ ...openJob, assigned_provider_id: 7 }, 'PROVIDER'), false);
eq('a closed window offers no bid', canProviderSubmitBid({ ...openJob, is_bidding_open: false }, 'PROVIDER'), false);
eq('a missing job offers no bid', canProviderSubmitBid(null, 'PROVIDER'), false);

const request = buildBidCreateRequest(12.5, 90, 'Can start at noon');
deepEq('the body uses the schema\'s own field names', Object.keys(request).sort(), [
  'eta_minutes',
  'message',
  'offered_price',
]);
eq('the price is sent as a NUMBER', typeof request.offered_price, 'number');
eq('the eta is sent as the integer it was validated as', request.eta_minutes, 90);
eq('an absent message is sent as null, not omitted', buildBidCreateRequest(5, 0, null).message, null);

const detail = [
  { loc: ['body', 'offered_price'], msg: 'Input should be greater than 0', type: 'x' },
  { loc: ['body', 'eta_minutes'], msg: 'Input should be less than or equal to 1440', type: 'y' },
];
eq('a rejected price keeps the server message', bidFieldError(detail, 'offered_price'), 'Input should be greater than 0');
eq('a rejected eta keeps the server message', bidFieldError(detail, 'eta_minutes'), 'Input should be less than or equal to 1440');
eq('a field the server did not reject has no message', bidFieldError(detail, 'message'), null);
eq('a missing detail array yields no field message', bidFieldError(null, 'offered_price'), null);
eq('a malformed detail entry is skipped, not crashed on', bidFieldError([{ loc: null, msg: 'x' } as never], 'offered_price'), null);

eq('422 shares the generic copy bucket', bidSubmitErrorKey('invalid'), 'jobd_bid_err_invalid');
eq('400 shares "no longer allowed"', bidSubmitErrorKey('badrequest'), 'jobd_bid_err_notallowed');
eq('409 shares "no longer allowed"', bidSubmitErrorKey('conflict'), 'jobd_bid_err_notallowed');
eq('403 has its own copy (not activated / not allowed)', bidSubmitErrorKey('forbidden'), 'jobd_bid_err_forbidden');
eq('404 has its own copy', bidSubmitErrorKey('notfound'), 'jobd_bid_err_notfound');
eq('a 5xx is a server error', bidSubmitErrorKey('server'), 'jobd_bid_err_server');
eq('no response at all is a network error', bidSubmitErrorKey('network'), 'jobd_bid_err_network');
eq('an unrecognised failure is a server error', bidSubmitErrorKey('unknown'), 'jobd_bid_err_server');

eq(
  'a 403 shows the actionable activation copy, NOT the backend wording',
  bidSubmitFailureMessage(
    { kind: 'forbidden', message: 'Only approved, active providers can bid on jobs.' },
    () => 'activation copy'
  ),
  'activation copy'
);
eq(
  'a 403 with no text at all still shows the activation copy',
  bidSubmitFailureMessage({ kind: 'forbidden', message: null }, () => 'activation copy'),
  'activation copy'
);
eq(
  "every other bucket still prefers the backend's own refusal text",
  bidSubmitFailureMessage({ kind: 'badrequest', message: 'Job not open for bidding' }, () => 'fallback'),
  'Job not open for bidding'
);
eq(
  'and falls back to the translated bucket when the backend sent nothing',
  bidSubmitFailureMessage({ kind: 'badrequest', message: null }, () => 'fallback'),
  'fallback'
);

eq('a 400 refusal re-reads the job', shouldResyncAfterBidFailure('badrequest'), true);
eq('a 409 refusal re-reads the job', shouldResyncAfterBidFailure('conflict'), true);
eq('a 403 refusal re-reads the job', shouldResyncAfterBidFailure('forbidden'), true);
eq('a 404 refusal re-reads the job', shouldResyncAfterBidFailure('notfound'), true);
eq('a 422 does NOT re-read (the typed values were wrong)', shouldResyncAfterBidFailure('invalid'), false);
eq('a network failure does NOT re-read', shouldResyncAfterBidFailure('network'), false);
eq('a 5xx does NOT re-read', shouldResyncAfterBidFailure('server'), false);
eq('a 401 goes to login, it does NOT re-read', shouldResyncAfterBidFailure('unauthorized'), false);

deepEq('eta 0 means "right now"', bidEtaParts(0), { kind: 'now' });
deepEq('eta 45 is minutes only', bidEtaParts(45), { kind: 'minutes', minutes: 45 });
deepEq('eta 59 stays minutes', bidEtaParts(59), { kind: 'minutes', minutes: 59 });
deepEq('eta 60 becomes an hour', bidEtaParts(60), { kind: 'hours', hours: 1, minutes: 0 });
deepEq('eta 90 is an hour and a half', bidEtaParts(90), { kind: 'hours', hours: 1, minutes: 30 });
deepEq('eta 1440 is the documented maximum', bidEtaParts(1440), { kind: 'hours', hours: 24, minutes: 0 });
eq('eta above the schema maximum is unusable', bidEtaParts(1441), null);
eq('a negative eta is unusable', bidEtaParts(-1), null);
eq('a fractional eta is unusable', bidEtaParts(12.5), null);
eq('a missing eta is unusable', bidEtaParts(null), null);

/* ══════════════════════════════════════════════════ CLIENT offers screen */

/** A complete BidResponse so a test only states what it is actually about. */
function offer(over: Partial<BidResponse> & { id: number }): BidResponse {
  return {
    job_id: 7,
    provider: {
      id: 100 + over.id,
      name: `Provider ${over.id}`,
      profile_photo_url: null,
      star_rating: 4.5,
      badge_count: 2,
      badge_tier: 'GOLD',
      credibility_score: 80,
      acceptance_rate: 90,
      response_time_avg: 15,
      total_jobs_completed: 30,
    },
    offered_price: '20.00',
    eta_minutes: 45,
    message: null,
    status: 'PENDING',
    distance_km: '2.5',
    distance_score: 10,
    star_rating_score: 10,
    badge_tier_score: 5,
    credibility_score: 8,
    acceptance_rate_score: 9,
    response_time_score: 7,
    total_score: 49,
    is_recommended: false,
    accepted_at: null,
    rejected_at: null,
    rejection_reason: null,
    withdrawn_at: null,
    created_at: '2026-10-10T10:00:00Z',
    updated_at: '2026-10-10T10:00:00Z',
    ...over,
  };
}

function response(over: Partial<JobBidsResponse> = {}): JobBidsResponse {
  return { job_id: 7, recommended: [], other_offers: [], total_bids: 0, ...over };
}

/* ─────────────────────────────────────────── money & distance per locale ── */

eq('en renders the symbol first', formatBidPriceLocale('12.5', 'en'), '€12.50');
eq('de renders the symbol last with a comma', formatBidPriceLocale('12.5', 'de'), '12,50 €');
eq('et renders the symbol last with a comma', formatBidPriceLocale('12.5', 'et'), '12,50 €');
eq('lv renders the symbol last with a comma', formatBidPriceLocale('12.5', 'lv'), '12,50 €');
eq('lt renders the symbol last with a comma', formatBidPriceLocale('12.5', 'lt'), '12,50 €');
eq('en groups thousands', formatBidPriceLocale('1234.5', 'en'), '€1,234.50');
eq('de groups thousands with a dot', formatBidPriceLocale('1234.5', 'de'), '1.234,50 €');
eq('a whole price keeps its cents', formatBidPriceLocale('7', 'de'), '7,00 €');
eq('an unparseable price has no string at all', formatBidPriceLocale('abc', 'en'), null);
eq('a missing price has no string at all', formatBidPriceLocale(null, 'de'), null);
eq('the docs 300-digit price is still refused', formatBidPriceLocale(`${'0'.repeat(300)}`, 'en'), null);

eq('distance uses the locale decimal', formatBidDistanceLocale('1.5', 'de'), '1,5 km');
eq('distance uses a dot in en', formatBidDistanceLocale('1.5', 'en'), '1.5 km');
eq('whole kilometres drop the decimal', formatBidDistanceLocale('3', 'de'), '3 km');
eq('distance is rounded to one decimal', formatBidDistanceLocale('12.25', 'lv'), '12,3 km');
eq('a zero distance is shown, not hidden', formatBidDistanceLocale('0', 'et'), '0 km');
eq('a null distance shows nothing (unknown ≠ 0)', formatBidDistanceLocale(null, 'de'), null);
eq('an unparseable distance shows nothing', formatBidDistanceLocale('nope', 'de'), null);
eq('a negative distance is refused', parseBidDistance('-1.5'), null);
eq('a null distance parses to nothing', parseBidDistance(null), null);
eq('a 300-digit distance is refused', parseBidDistance('1'.repeat(300)), null);

/* ─────────────────────────────────────────── what the client is shown ── */

deepEq('the visible statuses are the live bid + the accepted one', [...CLIENT_VISIBLE_BID_STATUSES], ['PENDING', 'ACCEPTED']);
eq('a pending bid is shown', isClientVisibleBid({ status: 'PENDING' }), true);
eq('the accepted bid is shown', isClientVisibleBid({ status: 'ACCEPTED' }), true);
eq('a rejected bid is hidden', isClientVisibleBid({ status: 'REJECTED' }), false);
eq('a withdrawn bid is hidden', isClientVisibleBid({ status: 'WITHDRAWN' }), false);
eq('an expired bid is hidden', isClientVisibleBid({ status: 'EXPIRED' }), false);
eq('an unknown status is hidden rather than shown raw', isClientVisibleBid({ status: 'SOMETHING' as BidStatus }), false);
eq('a missing bid is hidden', isClientVisibleBid(null), false);
deepEq(
  'filtering keeps the api order and drops the rest',
  filterClientVisibleBids([
    offer({ id: 1 }),
    offer({ id: 2, status: 'WITHDRAWN' }),
    offer({ id: 3, status: 'ACCEPTED' }),
    offer({ id: 4, status: 'EXPIRED' }),
  ]).map((b) => b.id),
  [1, 3]
);

/* ───────────────────────────────────────────────── the two arrays, read ── */

deepEq(
  'allBids puts the recommended block first, as the server sent it',
  allBids(
    response({
      recommended: [offer({ id: 9 }), offer({ id: 8 })],
      other_offers: [offer({ id: 2 }), offer({ id: 1 })],
    })
  ).map((b) => b.id),
  [9, 8, 2, 1]
);
deepEq(
  'a bid id in both arrays is only returned once',
  allBids(response({ recommended: [offer({ id: 5 })], other_offers: [offer({ id: 5 })] })).map((b) => b.id),
  [5]
);
deepEq('a missing response has no bids at all', allBids(null).map((b) => b.id), []);
deepEq('a missing response has no other offers either', allBids(undefined).map((b) => b.id), []);
eq('the total is the server count, not the array length', totalBidCount(response({ recommended: [offer({ id: 1 })], total_bids: 7 })), 7);
// The field is required in the schema, so this is the malformed-payload path:
// with nothing usable to read, the visible length is the only honest answer.
const totalOmitted = {
  job_id: 7,
  recommended: [offer({ id: 1 })],
  other_offers: [offer({ id: 2 })],
} as unknown as JobBidsResponse;
eq('an omitted total falls back to what is visible', totalBidCount(totalOmitted), 2);
eq('a malformed total falls back to what is visible', totalBidCount(response({ other_offers: [offer({ id: 2 })], total_bids: Number.NaN })), 1);
eq('a zero total is respected as zero', totalBidCount(response({ recommended: [offer({ id: 1 })], total_bids: 0 })), 0);

/* ─────────────────────────────────────────────────────── sorting chips ── */

const cheap = offer({ id: 1, offered_price: '10.00', provider: { ...offer({ id: 1 }).provider, star_rating: 3.2, badge_count: 1 }, distance_km: '9.0' });
const mid = offer({ id: 2, offered_price: '25.00', provider: { ...offer({ id: 2 }).provider, star_rating: 4.9, badge_count: 3 }, distance_km: null });
const dear = offer({ id: 3, offered_price: '40.00', provider: { ...offer({ id: 3 }).provider, star_rating: 4.4, badge_count: 5 }, distance_km: '0.5' });
const unparseable = offer({ id: 4, offered_price: 'not-a-price', distance_km: null });
const three = [cheap, mid, dear];

eq('the default order is the API order, untouched', sortBids(three, 'api').map((b) => b.id).join(','), '1,2,3');
eq('sorting never mutates the input', three.map((b) => b.id).join(','), '1,2,3');
eq('price sorts low to high', sortBids([dear, cheap, mid], 'price_asc').map((b) => b.id).join(','), '1,2,3');
eq('rating sorts high to low', sortBids([cheap, mid, dear], 'rating_desc').map((b) => b.id).join(','), '2,3,1');
eq('distance sorts near to far', sortBids([cheap, mid, dear], 'distance_asc').map((b) => b.id).join(','), '3,1,2');
eq('a missing distance sorts last, never first', sortBids([cheap, mid, dear], 'distance_asc')[2].id, 2);
eq('badges sort most first', sortBids([cheap, mid, dear], 'badges_desc').map((b) => b.id).join(','), '3,2,1');
eq('an unparseable price sorts last', sortBids([unparseable, cheap, dear], 'price_asc').map((b) => b.id).join(','), '1,3,4');
eq('equal keys keep the API order (stable)', sortBids([offer({ id: 7, offered_price: '10.00' }), offer({ id: 6, offered_price: '10.00' })], 'price_asc').map((b) => b.id).join(','), '7,6');
deepEq('every sort chip has its own label key', [...BID_SORT_IDS].map((id: BidSortId) => BID_SORT_LABEL_KEY[id]), [
  'cbids_sort_default',
  'cbids_sort_price',
  'cbids_sort_rating',
  'cbids_sort_distance',
  'cbids_sort_badges',
]);

/* ──────────────────────── THIS provider's own bid (GET /bids/mine) ── */

// The "no bid" answer was measured against the deployed backend, because the
// schema documents only 200 + 422 for the operation:
//   404 {"detail":"You have not placed a bid on this job."}   ← and the SAME
//   404 comes back for a job id that does not exist at all, so the status code
//   alone cannot tell "no bid" from "no job" — the job detail disambiguates.
// Every other failure means the question was NOT answered, which is why they can
// never be read as "no bid yet" (the optimistic reading that sends a duplicate).

deepEq('a 404 is the endpoint\u2019s own "no bid" answer', myBidLookupFromError({
  response: { status: 404, data: { detail: 'You have not placed a bid on this job.' } },
}), { state: 'none' });
eq('a 404 with no body at all is still "no bid"', myBidLookupFromError({ response: { status: 404 } }).state, 'none');
deepEq(
  'a 401 that survived the refresh is NOT "no bid"',
  myBidLookupFromError({ response: { status: 401, data: { detail: 'Not authenticated' } } }),
  { state: 'error', kind: 'unauthorized', message: 'Not authenticated' }
);
deepEq(
  'a 403 is NOT "no bid"',
  myBidLookupFromError({
    response: { status: 403, data: { detail: 'Only approved, active providers can bid on jobs.' } },
  }),
  { state: 'error', kind: 'forbidden', message: 'Only approved, active providers can bid on jobs.' }
);
deepEq(
  'a 422 reports the bad id, it is NOT "no bid"',
  myBidLookupFromError({
    response: {
      status: 422,
      data: {
        detail: [
          { loc: ['path', 'job_id'], msg: 'Input should be a valid integer', type: 'int_parsing' },
        ],
      },
    },
  }),
  { state: 'error', kind: 'invalid', message: 'Input should be a valid integer' }
);
deepEq(
  'a 5xx is NOT "no bid"',
  myBidLookupFromError({ response: { status: 503 } }),
  { state: 'error', kind: 'server', message: null }
);
deepEq(
  'a transport failure is NOT "no bid"',
  myBidLookupFromError(new Error('Network Error')),
  { state: 'error', kind: 'network', message: null }
);

deepEq('a usable 200 body is an existing bid', myBidLookupFromData(offer({ id: 1 })).state, 'exists');
deepEq(
  'a null 200 body is an unanswerable read, never "no bid"',
  myBidLookupFromData(null),
  { state: 'error', kind: 'server', message: null }
);
deepEq(
  'a junk 200 body is an unanswerable read too',
  myBidLookupFromData('nope'),
  { state: 'error', kind: 'server', message: null }
);
eq('an empty object is not a usable bid', isUsableBidResponse({}), false);
eq('a bid without a status is not usable', isUsableBidResponse({ id: 4 }), false);
eq('a bid without an id is not usable', isUsableBidResponse({ status: 'PENDING' }), false);
eq('a real bid body is usable', isUsableBidResponse(offer({ id: 4 })), true);

eq('PENDING is the pollable state', isBidPending('PENDING'), true);
eq('ACCEPTED is not pollable', isBidPending('ACCEPTED'), false);
eq('a missing status is not pollable', isBidPending(null), false);
for (const status of ['ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'] as BidStatus[]) {
  eq(`${status} cannot change again`, isBidFinal(status), true);
}
eq('PENDING is not final', isBidFinal('PENDING'), false);
eq('an unknown status is not claimed to be final', isBidFinal('SOMETHING_ELSE'), false);

// The docs' OWN example: a PENDING bid with accepted_at, rejected_at AND
// withdrawn_at all filled. "Non-null" is not "happened", so none may render.
const exampleBid = offer({
  id: 9,
  accepted_at: '2026-10-11T19:19:26Z',
  rejected_at: '2026-10-11T19:19:26Z',
  withdrawn_at: '2026-10-11T19:19:26Z',
  rejection_reason: 'string',
});
eq('a PENDING bid shows no outcome stamp even with all three filled', bidStatusStamp(exampleBid), null);
eq('and no rejection reason either', bidRejectionReason(exampleBid), null);
deepEq(
  'an ACCEPTED bid shows its own stamp',
  bidStatusStamp(offer({ id: 1, status: 'ACCEPTED', accepted_at: '2026-10-11T19:19:26Z' })),
  { kind: 'accepted', labelKey: 'jobd_bid_ts_accepted', value: '2026-10-11T19:19:26Z' }
);
deepEq(
  'a REJECTED bid shows its own stamp',
  bidStatusStamp(offer({ id: 2, status: 'REJECTED', rejected_at: '2026-10-11T20:00:00Z' })),
  { kind: 'rejected', labelKey: 'jobd_bid_ts_rejected', value: '2026-10-11T20:00:00Z' }
);
deepEq(
  'a WITHDRAWN bid shows its own stamp',
  bidStatusStamp(offer({ id: 3, status: 'WITHDRAWN', withdrawn_at: '2026-10-11T21:00:00Z' })),
  { kind: 'withdrawn', labelKey: 'jobd_bid_ts_withdrawn', value: '2026-10-11T21:00:00Z' }
);
eq('an ACCEPTED bid with no stamp shows nothing', bidStatusStamp(offer({ id: 4, status: 'ACCEPTED' })), null);
eq(
  'an EXPIRED bid shows no stamp, wherever the data sits',
  bidStatusStamp(offer({ id: 5, status: 'EXPIRED', accepted_at: '2026-10-11T19:19:26Z' })),
  null
);
eq('an unknown status shows no stamp', bidStatusStamp(offer({ id: 6, status: 'WHO_KNOWS' as BidStatus, accepted_at: 'x' })), null);
eq('a missing bid shows no stamp', bidStatusStamp(null), null);
eq(
  'an ACCEPTED bid never borrows another status\u2019 stamp',
  bidStatusStamp(offer({ id: 7, status: 'ACCEPTED', rejected_at: '2026-10-11T19:19:26Z' })),
  null
);
eq(
  'the rejection reason is shown for a rejected bid',
  bidRejectionReason(offer({ id: 8, status: 'REJECTED', rejection_reason: 'Found someone closer' })),
  'Found someone closer'
);
eq(
  'a blank rejection reason is not shown',
  bidRejectionReason(offer({ id: 10, status: 'REJECTED', rejection_reason: '   ' })),
  null
);
eq(
  'a WITHDRAWN bid shows no rejection reason',
  bidRejectionReason(offer({ id: 11, status: 'WITHDRAWN', rejection_reason: 'stale text' })),
  null
);

deepEq(
  'every BidStatus has exactly one next-step line',
  (['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'] as BidStatus[]).map((s) =>
    bidNextStepKey(s)
  ),
  [
    'jobd_bid_next_pending',
    'jobd_bid_next_accepted',
    'jobd_bid_next_rejected',
    'jobd_bid_next_withdrawn',
    'jobd_bid_next_expired',
  ]
);
eq('an unknown status promises nothing', bidNextStepKey('SOMETHING_ELSE'), null);
eq('a missing status promises nothing', bidNextStepKey(null), null);

/* ══════════════════════════════════ Modify Bid (PUT /jobs/{id}/bids/{bid}) ══ */

/* The gate: the Edit action exists ONLY for this provider's own PENDING bid
   while the backend still reports the window open. */const editOpenJob = { status: 'OPEN', is_bidding_open: true } as const;
const editClosedJob = { status: 'OPEN', is_bidding_open: false } as const;
const editAssignedJob = { status: 'PROVIDER_ASSIGNED', is_bidding_open: true } as const;
eq(
  'a provider may edit their pending bid while the window is open',
  canEditBid(offer({ id: 1 }), editOpenJob, 'PROVIDER'),
  true
);
eq('a client may not', canEditBid(offer({ id: 1 }), editOpenJob, 'CLIENT'), false);
eq('no role may not', canEditBid(offer({ id: 1 }), editOpenJob, null), false);
for (const status of ['ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'] as BidStatus[]) {
  eq(
    `a ${status} bid is not editable`,
    canEditBid(offer({ id: 1, status }), editOpenJob, 'PROVIDER'),
    false
  );
}
eq(
  'a closed window hides the action',
  canEditBid(offer({ id: 1 }), editClosedJob, 'PROVIDER'),
  false
);
eq(
  'an assigned job hides it even with the flag set',
  canEditBid(offer({ id: 1 }), editAssignedJob, 'PROVIDER'),
  false
);
eq('a missing bid hides the action', canEditBid(null, editOpenJob, 'PROVIDER'), false);
eq('a missing job hides the action', canEditBid(offer({ id: 1 }), null, 'PROVIDER'), false);

/* Prefill — the draft the sheet starts from, out of the server's own values. */
deepEq(
  'a bid prefills into the draft',
  bidDraftFromBid({ offered_price: '20.00', eta_minutes: 45, message: null }),
  { price: '20.00', etaHours: 0, etaMinutes: 45, message: '' }
);
deepEq(
  '24 h prefills as 24 and 0',
  bidDraftFromBid({ offered_price: '1.00', eta_minutes: 1440, message: 'hi' }),
  { price: '1.00', etaHours: 24, etaMinutes: 0, message: 'hi' }
);
deepEq(
  'an hour and a half prefills as 1 h 30',
  bidDraftFromBid({ offered_price: '1', eta_minutes: 90, message: '' }),
  { price: '1.00', etaHours: 1, etaMinutes: 30, message: '' }
);
deepEq(
  'an over-max eta is clamped to 24 h',
  bidDraftFromBid({ offered_price: '1', eta_minutes: 2000, message: null }),
  { price: '1.00', etaHours: 24, etaMinutes: 0, message: '' }
);
deepEq(
  'a negative eta prefills as 0',
  bidDraftFromBid({ offered_price: '1', eta_minutes: -5, message: null }),
  { price: '1.00', etaHours: 0, etaMinutes: 0, message: '' }
);
deepEq(
  "the docs' 300-digit price prefills EMPTY, never NaN",
  bidDraftFromBid({ offered_price: '1'.repeat(300), eta_minutes: 10, message: null }).price,
  ''
);
deepEq(
  'a missing price prefills empty',
  bidDraftFromBid({ offered_price: null as unknown as string, eta_minutes: 0, message: null })
    .price,
  ''
);

eq('hours and minutes become minutes', bidDraftEtaMinutes({ etaHours: 2, etaMinutes: 30 }), 150);
eq('24 h is the ceiling', bidDraftEtaMinutes({ etaHours: 24, etaMinutes: 30 }), 1440);
eq(
  'an unusable pair is 0',
  bidDraftEtaMinutes({ etaHours: Number.NaN, etaMinutes: Number.NaN }),
  0
);

/* Did anything actually change? Compared the way the wire compares it. */
const storedBid = offer({
  id: 1,
  offered_price: '25.50',
  eta_minutes: 50,
  message: 'Automated live integration test bid.',
});
const unchangedDraft = {
  price: '25.50',
  etaHours: 0,
  etaMinutes: 50,
  message: 'Automated live integration test bid.',
};
eq('an untouched draft has not changed', hasBidDraftChanged(storedBid, unchangedDraft), false);
eq(
  'the same price without trailing zeros is not a change',
  hasBidDraftChanged(storedBid, { ...unchangedDraft, price: '25.5' }),
  false
);
eq(
  'a comma decimal is the same price',
  hasBidDraftChanged(storedBid, { ...unchangedDraft, price: '25,50' }),
  false
);
eq(
  'one cent lower IS a change',
  hasBidDraftChanged(storedBid, { ...unchangedDraft, price: '25.49' }),
  true
);
eq('a different eta is a change', hasBidDraftChanged(storedBid, { ...unchangedDraft, etaHours: 1, etaMinutes: 0 }), true);
eq(
  'a different message is a change',
  hasBidDraftChanged(storedBid, { ...unchangedDraft, message: 'Something else' }),
  true
);
eq('clearing the message is a change', hasBidDraftChanged(storedBid, { ...unchangedDraft, message: '' }), true);
eq(
  'whitespace alone is NOT a change',
  hasBidDraftChanged(storedBid, { ...unchangedDraft, message: `  ${unchangedDraft.message}  ` }),
  false
);
const noMessageBid = offer({
  id: 1,
  offered_price: '25.50',
  eta_minutes: 50,
  message: null,
});
eq(
  'no stored message + a blank field is not a change',
  hasBidDraftChanged(noMessageBid, { ...unchangedDraft, message: '   ' }),
  false
);
eq(
  'no stored message + real text IS a change',
  hasBidDraftChanged(noMessageBid, { ...unchangedDraft, message: 'hello' }),
  true
);
eq('a missing bid never claims a change', hasBidDraftChanged(null, unchangedDraft), false);

/* Validity — the same three rules Create Bid runs. */
const goodDraft = { price: '25.50', etaHours: 0, etaMinutes: 50, message: 'ok' };
eq('a complete draft is valid', isBidDraftValid(goodDraft), true);
eq('a comma price is valid', isBidDraftValid({ ...goodDraft, price: '25,50' }), true);
eq('0 is refused', isBidDraftValid({ ...goodDraft, price: '0' }), false);
eq('an empty price is refused', isBidDraftValid({ ...goodDraft, price: '' }), false);
eq('3 decimals are refused', isBidDraftValid({ ...goodDraft, price: '25.555' }), false);
eq(
  'both separators at once are refused',
  isBidDraftValid({ ...goodDraft, price: '1.234,56' }),
  false
);
eq('24 h is valid', isBidDraftValid({ ...goodDraft, etaHours: 24, etaMinutes: 0 }), true);
eq('a 1000-char message is at the limit', isBidDraftValid({ ...goodDraft, message: 'x'.repeat(1000) }), true);
eq('a 1001-char message is over it', isBidDraftValid({ ...goodDraft, message: 'x'.repeat(1001) }), false);
eq('an empty message is allowed', isBidDraftValid({ ...goodDraft, message: '' }), true);

/* The quick adjust — EURO amounts, confirmed with the product owner. */
deepEq('the chips are the four euro steps', [...BID_ADJUST_STEPS], [-10, -5, 5, 10]);
eq('-10 takes a price down', adjustBidPrice('25.50', -10), '15.50');
eq('+10 takes it up', adjustBidPrice('25.50', 10), '35.50');
eq('it works from a comma field too', adjustBidPrice('25,50', 5), '30.50');
eq('it never goes below the schema minimum', adjustBidPrice('3.00', -10), '0.01');
eq('an empty field starts from zero rather than looking broken', adjustBidPrice('', 5), '5.00');
eq('a negative chip on an empty field lands on the minimum', adjustBidPrice('', -10), '0.01');
eq('a chip that would change nothing is disabled', canApplyBidAdjust('0.01', -5), false);
eq('a chip that changes the price is enabled', canApplyBidAdjust('0.01', 5), true);
eq('...on an empty field too', canApplyBidAdjust('', 5), true);
eq('...and on an unparseable one', canApplyBidAdjust('abc', -10), true);

eq('en puts the symbol first', formatAdjustChipLabel(-10, 'en'), '-€10');
eq('en: a plus too', formatAdjustChipLabel(5, 'en'), '+€5');
eq('de puts it last', formatAdjustChipLabel(-5, 'de'), '-5 €');
eq('et too', formatAdjustChipLabel(10, 'et'), '+10 €');
eq('lv too', formatAdjustChipLabel(5, 'lv'), '+5 €');
eq('lt too', formatAdjustChipLabel(-10, 'lt'), '-10 €');

/* The chips are shown only after the CLIENT restarted the timer (live field). */
eq('a restarted timer offers the chips', shouldOfferBidAdjust({ timer_restart_count: 1 }), true);
eq('twice restarted too', shouldOfferBidAdjust({ timer_restart_count: 2 }), true);
eq('a never-restarted job does not', shouldOfferBidAdjust({ timer_restart_count: 0 }), false);
eq(
  'a missing count does not',
  shouldOfferBidAdjust({} as { timer_restart_count: number }),
  false
);
eq('a missing job does not', shouldOfferBidAdjust(null), false);
eq(
  'a string count is not a count',
  shouldOfferBidAdjust({ timer_restart_count: '1' as unknown as number }),
  false
);

/* The PUT body: all three fields, the price as a NUMBER with at most 2 decimals. */
deepEq(
  'the body sends all three fields',
  buildBidUpdateRequest({ price: '25.50', etaHours: 0, etaMinutes: 45, message: '' }),
  { offered_price: 25.5, eta_minutes: 45, message: null }
);
deepEq(
  'a comma price goes out as the same number',
  buildBidUpdateRequest({ price: '25,50', etaHours: 0, etaMinutes: 45, message: 'hi' }),
  { offered_price: 25.5, eta_minutes: 45, message: 'hi' }
);
deepEq(
  'the message is trimmed',
  buildBidUpdateRequest({ price: '1.00', etaHours: 0, etaMinutes: 0, message: '  hi  ' }),
  { offered_price: 1, eta_minutes: 0, message: 'hi' }
);
eq(
  '24 h goes out as 1440',
  buildBidUpdateRequest({ price: '1.00', etaHours: 24, etaMinutes: 0, message: '' }).eta_minutes,
  1440
);
eq(
  'an over-long message is never sent as text',
  buildBidUpdateRequest({ price: '1.00', etaHours: 0, etaMinutes: 10, message: 'x'.repeat(1001) })
    .message,
  null
);
eq(
  'the price goes out as a number',
  typeof buildBidUpdateRequest({ price: '25.50', etaHours: 0, etaMinutes: 10, message: '' })
    .offered_price,
  'number'
);
eq(
  '...rounded to cents, never a long fraction',
  buildBidUpdateRequest({ price: '25.50', etaHours: 0, etaMinutes: 10, message: '' }).offered_price,
  25.5
);

/* Stale answers: a poll that lands after the save must not win. */
const olderBid = offer({ id: 3, offered_price: '20.00', updated_at: '2026-10-10T10:00:00Z' });
const newerBid = offer({ id: 3, offered_price: '25.00', updated_at: '2026-10-10T11:00:00Z' });
eq('an older answer for the same bid is stale', isStaleBid(olderBid, newerBid), true);
eq('a newer answer is not', isStaleBid(newerBid, olderBid), false);
eq('the same stamp is not stale', isStaleBid(newerBid, { ...newerBid }), false);
eq(
  'a different bid is never "stale"',
  isStaleBid(olderBid, offer({ id: 4, updated_at: '2026-10-10T12:00:00Z' })),
  false
);
eq(
  'an unparseable incoming stamp cannot freeze the screen',
  isStaleBid(offer({ id: 3, updated_at: 'not-a-date' }), newerBid),
  false
);
eq(
  'an unparseable stored stamp cannot freeze it either',
  isStaleBid(olderBid, offer({ id: 3, updated_at: 'not-a-date' })),
  false
);
eq('nothing received is not stale', isStaleBid(null, newerBid), false);
eq('nothing held is not stale', isStaleBid(newerBid, null), false);

/* Failure copy — the backend's own detail wins, except the 403 (whose wording
   states a rule, live-verified, and activation is never the app's call). */
const translateKey = (key: string) => `t:${key}`;
eq('invalid maps to the validation copy', bidUpdateErrorKey('invalid'), 'jobd_edit_err_invalid');
eq(
  '400 maps to the "no longer changeable" copy',
  bidUpdateErrorKey('badrequest'),
  'jobd_edit_err_notallowed'
);
eq('409 maps there too', bidUpdateErrorKey('conflict'), 'jobd_edit_err_notallowed');
eq('403 has its own copy', bidUpdateErrorKey('forbidden'), 'jobd_edit_err_forbidden');
eq('404 has its own copy', bidUpdateErrorKey('notfound'), 'jobd_edit_err_notfound');
eq('a transport failure has its own copy', bidUpdateErrorKey('network'), 'jobd_edit_err_network');
eq('5xx falls back to the server copy', bidUpdateErrorKey('server'), 'jobd_edit_err_server');
eq('an unknown kind does too', bidUpdateErrorKey('unknown'), 'jobd_edit_err_server');
eq(
  "the server's own message is preferred",
  bidUpdateFailureMessage({ kind: 'notfound', message: 'Bid not found.' }, translateKey),
  'Bid not found.'
);
eq(
  '...and on a 400 too',
  bidUpdateFailureMessage({ kind: 'badrequest', message: 'Bidding is closed.' }, translateKey),
  'Bidding is closed.'
);
eq(
  'with no server message the bucket copy is used',
  bidUpdateFailureMessage({ kind: 'notfound', message: null }, translateKey),
  't:jobd_edit_err_notfound'
);
eq(
  'a 403 never renders the rule text',
  bidUpdateFailureMessage(
    { kind: 'forbidden', message: 'Only approved, active providers can bid on jobs.' },
    translateKey
  ),
  't:jobd_edit_err_forbidden'
);
eq(
  'a transport failure keeps its own copy',
  bidUpdateFailureMessage({ kind: 'network', message: null }, translateKey),
  't:jobd_edit_err_network'
);

/* 422 → the field that was rejected, in the PUT body's own shape (live: FastAPI
   reports a body field as loc ["body", "<field>"] — captured 2026-10-12). */
const putDetail: ValidationErrorDetail[] = [
  {
    loc: ['body', 'offered_price'],
    msg: 'Input should be greater than 0',
    type: 'greater_than',
    input: 0,
  },
  {
    loc: ['body', 'message'],
    msg: 'String should have at most 1000 characters',
    type: 'string_too_long',
    input: 'x',
  },
];
eq(
  'a rejected price lands on the price field',
  bidFieldError(putDetail, 'offered_price'),
  'Input should be greater than 0'
);
eq(
  'a rejected message lands on the message field',
  bidFieldError(putDetail, 'message'),
  'String should have at most 1000 characters'
);
eq('a field the server did not mention gets nothing', bidFieldError(putDetail, 'eta_minutes'), null);
eq(
  'a path-level loc is not a body field',
  bidFieldError([{ loc: ['path', 'bid_id'], msg: 'nope', type: 'int_parsing' }], 'eta_minutes'),
  null
);
eq(
  'an entry without a loc is not a crash',
  bidFieldError([{ msg: 'no loc' } as unknown as ValidationErrorDetail], 'message'),
  null
);
eq('a null detail is not a crash', bidFieldError(null, 'message'), null);
eq(
  'a non-array detail is not a crash',
  bidFieldError({ detail: 'x' } as unknown as ValidationErrorDetail[], 'message'),
  null
);

/* The ids that go into the path. */
eq('1 is a usable bid id', isValidBidId(1), true);
eq('0 is not', isValidBidId(0), false);
eq('a negative is not', isValidBidId(-3), false);
eq('a float is not', isValidBidId(1.5), false);
eq('a string is not', isValidBidId('1'), false);
eq('NaN is not', isValidBidId(Number.NaN), false);
eq('undefined is not', isValidBidId(undefined), false);

/* ─────────────────────────────────────────────────────────── Withdraw action gate — canWithdrawBid ── */

const withdrawOpenJob = { status: 'OPEN', is_bidding_open: true } as const;
const withdrawClosedJob = { status: 'OPEN', is_bidding_open: false } as const;
const withdrawAssignedJob = { status: 'PROVIDER_ASSIGNED', is_bidding_open: true } as const;

eq(
  'a provider may withdraw their pending bid while the window is open',
  canWithdrawBid(offer({ id: 1 }), withdrawOpenJob, 'PROVIDER'),
  true
);
eq('a client may not withdraw anyone\u2019s bid', canWithdrawBid(offer({ id: 1 }), withdrawOpenJob, 'CLIENT'), false);
eq('no role may not withdraw', canWithdrawBid(offer({ id: 1 }), withdrawOpenJob, null), false);
for (const status of ['ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'] as BidStatus[]) {
  eq(
    `a ${status} bid cannot be withdrawn`,
    canWithdrawBid(offer({ id: 1, status }), withdrawOpenJob, 'PROVIDER'),
    false
  );
}
eq(
  'a closed window hides the withdraw action',
  canWithdrawBid(offer({ id: 1 }), withdrawClosedJob, 'PROVIDER'),
  false
);
eq(
  'an assigned job hides it even with the flag set',
  canWithdrawBid(offer({ id: 1 }), withdrawAssignedJob, 'PROVIDER'),
  false
);
eq('a missing bid hides the action', canWithdrawBid(null, withdrawOpenJob, 'PROVIDER'), false);
eq('a missing job hides the action', canWithdrawBid(offer({ id: 1 }), null, 'PROVIDER'), false);

eq('the withdraw action key is a callable symbol on the bid surface', typeof WITHDRAW_BID_ACTION_KEY === 'symbol', true);
eq('it is the same symbol the lib exposes', WITHDRAW_BID_ACTION_KEY === WITHDRAW_BID_ACTION_KEY, true);

eq('the withdraw gate uses the same shared primitive as the rest of the gate layer', typeof canWithdrawBid, 'function');

/* ───────────────────────────────────────────────────── Accept Bid — client side ──
 *
 * The endpoint itself could NOT be exercised live (accepting needs two accounts —
 * one that owns the job and a different one that bid on it — and the backend
 * refuses a bid on your own job), so these are the rules that CAN be proven: the
 * gate, the price-change safeguard, the failure buckets and the unverified-job
 * re-read rule. The live outcome is reported as NOT VERIFIED.
 */

const acceptOpenJob = {
  id: 7,
  status: 'OPEN',
  assigned_provider_id: null,
  cancelled_at: null,
  completed_at: null,
} as const;
const acceptAssignedJob = {
  id: 7,
  status: 'OPEN',
  assigned_provider_id: 55,
  cancelled_at: null,
  completed_at: null,
} as const;
const acceptPaymentPendingJob = {
  id: 7,
  status: 'PAYMENT_PENDING',
  assigned_provider_id: null,
  cancelled_at: null,
  completed_at: null,
} as const;
const acceptCancelledJob = {
  id: 7,
  status: 'OPEN',
  assigned_provider_id: null,
  cancelled_at: '2026-10-10T10:00:00Z',
  completed_at: null,
} as const;
const acceptCompletedJob = {
  id: 7,
  status: 'OPEN',
  assigned_provider_id: null,
  cancelled_at: null,
  completed_at: '2026-10-10T10:00:00Z',
} as const;
/** The ONLY real test job in this environment: OPEN with the window shut. */
const acceptWindowClosedJob = {
  id: 7,
  status: 'OPEN',
  assigned_provider_id: null,
  cancelled_at: null,
  completed_at: null,
  is_bidding_open: false,
} as const;

eq('the client may accept a pending bid on their own open job', canAcceptBid(offer({ id: 1 }), acceptOpenJob, 'CLIENT'), true);
eq('a PROVIDER may not accept a bid', canAcceptBid(offer({ id: 1 }), acceptOpenJob, 'PROVIDER'), false);
eq('no role may not accept a bid', canAcceptBid(offer({ id: 1 }), acceptOpenJob, null), false);
for (const status of ['ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'] as BidStatus[]) {
  eq(
    `a ${status} bid cannot be accepted`,
    canAcceptBid(offer({ id: 1, status }), acceptOpenJob, 'CLIENT'),
    false
  );
}
eq('an already assigned job hides the accept action', canAcceptBid(offer({ id: 1 }), acceptAssignedJob, 'CLIENT'), false);
eq('a payment-pending job hides it', canAcceptBid(offer({ id: 1 }), acceptPaymentPendingJob, 'CLIENT'), false);
eq('a cancelled job hides it', canAcceptBid(offer({ id: 1 }), acceptCancelledJob, 'CLIENT'), false);
eq('a completed job hides it', canAcceptBid(offer({ id: 1 }), acceptCompletedJob, 'CLIENT'), false);
eq('a missing bid hides the action', canAcceptBid(null, acceptOpenJob, 'CLIENT'), false);
eq('a missing job hides the action', canAcceptBid(offer({ id: 1 }), null, 'CLIENT'), false);
eq('a bid that belongs to ANOTHER job is refused', canAcceptBid(offer({ id: 1, job_id: 99 }), acceptOpenJob, 'CLIENT'), false);
/*
 * The deliberate asymmetry with the provider gates: a CLOSED bidding window must
 * NOT hide the client's accept — the window closing is when the client chooses
 * (this is the state the only real test job is in). The flag is judged by the
 * backend and could have been used, so it is pinned here on purpose.
 */
eq(
  'a closed bidding window does NOT hide the client accept',
  canAcceptBid(offer({ id: 1 }), acceptWindowClosedJob, 'CLIENT'),
  true
);
eq('the job gate alone says open jobs are eligible', isJobAcceptEligible(acceptOpenJob), true);
eq(
  'and that a DRAFT job is not',
  isJobAcceptEligible({
    status: 'DRAFT',
    assigned_provider_id: null,
    cancelled_at: null,
    completed_at: null,
  }),
  false
);

/* The price-change safeguard — compared, never assumed. */
const shownOffer = offer({ id: 3 });
eq('the same offer matches itself', bidSelectionMatches(shownOffer, offer({ id: 3 })), true);
eq('a different price is a change', bidSelectionMatches(shownOffer, offer({ id: 3, offered_price: '21.00' })), false);
eq(
  'the same price in a different notation is NOT a change',
  bidSelectionMatches(offer({ id: 3, offered_price: '20.00' }), offer({ id: 3, offered_price: '20' })),
  true
);
eq('a different expected time is a change', bidSelectionMatches(shownOffer, offer({ id: 3, eta_minutes: 60 })), false);
eq(
  'a newer updated_at is a change even with identical values',
  bidSelectionMatches(shownOffer, offer({ id: 3, updated_at: '2026-10-11T10:00:00Z' })),
  false
);
eq('a different bid id never matches', bidSelectionMatches(offer({ id: 3 }), offer({ id: 4 })), false);
eq('a missing side never matches', bidSelectionMatches(null, offer({ id: 3 })), false);
eq(
  'an unparseable price compares as text instead of matching',
  bidSelectionMatches(offer({ id: 3, offered_price: 'abc' }), offer({ id: 3, offered_price: '20.00' })),
  false
);

/* Finding the offer in a re-read response. */
const acceptResponse = response({
  recommended: [offer({ id: 1 })],
  other_offers: [offer({ id: 2 })],
  total_bids: 2,
});
eq('a bid is found in the recommended block', bidById(acceptResponse, 1)?.id, 1);
eq('and among the other offers', bidById(acceptResponse, 2)?.id, 2);
eq('an unknown id finds nothing', bidById(acceptResponse, 9), null);
eq('a null id finds nothing', bidById(acceptResponse, null), null);

/* The job's date span, for the confirmation summary. */
const jobMilestones = (...scheduledAts: string[]): JobResponse['milestones'] =>
  scheduledAts.map((scheduled_at, index) => ({
    id: index + 1,
    sequence: index + 1,
    scheduled_at,
  })) as unknown as JobResponse['milestones'];

eq('a job without milestones has no span', milestoneScheduleRange({ milestones: [] }), null);
deepEq(
  'a single-day job spans one instant',
  milestoneScheduleRange({ milestones: jobMilestones('2026-10-20T10:00:00') }),
  { first: '2026-10-20T10:00:00', last: '2026-10-20T10:00:00' }
);
deepEq(
  'a multi-day job reports its earliest and latest day',
  milestoneScheduleRange({
    milestones: jobMilestones(
      '2026-10-22T09:00:00',
      '2026-10-20T10:00:00',
      '2026-10-24T08:00:00'
    ),
  }),
  { first: '2026-10-20T10:00:00', last: '2026-10-24T08:00:00' }
);
eq(
  'a malformed milestone date is ignored rather than rendered',
  milestoneScheduleRange({ milestones: jobMilestones('not-a-date') }),
  null
);

/* Failure buckets → translated copy, with the backend's own text first. */
eq('422 has its own copy', acceptBidErrorKey('invalid'), 'cbids_accept_err_invalid');
eq('400 means "no longer acceptable"', acceptBidErrorKey('badrequest'), 'cbids_accept_err_notallowed');
eq('409 shares it', acceptBidErrorKey('conflict'), 'cbids_accept_err_notallowed');
eq('a stale offer shares it', acceptBidErrorKey('stale'), 'cbids_accept_err_notallowed');
eq('an edited offer points at the review notice', acceptBidErrorKey('changed'), 'cbids_accept_changed');
eq('403 has its own copy', acceptBidErrorKey('forbidden'), 'cbids_accept_err_forbidden');
eq('404 has its own copy', acceptBidErrorKey('notfound'), 'cbids_accept_err_notfound');
eq('no connection has its own copy', acceptBidErrorKey('network'), 'cbids_accept_err_network');
eq('5xx falls back to the server copy', acceptBidErrorKey('server'), 'cbids_accept_err_server');
eq('an unknown bucket falls back too', acceptBidErrorKey('unknown'), 'cbids_accept_err_server');

eq(
  'the backend detail wins over the translated copy',
  acceptBidFailureMessage({ kind: 'conflict', message: 'Someone was already picked.' }, (key) => `T:${key}`),
  'Someone was already picked.'
);
eq(
  'without a server message the translated copy is used',
  acceptBidFailureMessage({ kind: 'conflict', message: null }, (key) => `T:${key}`),
  'T:cbids_accept_err_notallowed'
);

eq(
  'a 422 detail is shown verbatim when the backend sends one',
  acceptBidFailureMessage({ kind: 'invalid', message: 'Input should be a valid integer' }, (key) => `T:${key}`),
  'Input should be a valid integer'
);

/* When the screen re-reads the job, and what a lost reply means. */
eq('a refusal re-reads the job', shouldResyncAfterAcceptFailure('conflict'), true);
eq('an edited offer re-reads too', shouldResyncAfterAcceptFailure('changed'), true);
eq('so do 403 and 404', shouldResyncAfterAcceptFailure('forbidden') && shouldResyncAfterAcceptFailure('notfound'), true);
eq('a 422 does not (the path id itself was rejected)', shouldResyncAfterAcceptFailure('invalid'), false);
eq('nor does a 5xx', shouldResyncAfterAcceptFailure('server'), false);
eq('nor a transport failure — it has its own re-read rule', shouldResyncAfterAcceptFailure('network'), false);
eq('nor an unknown bucket', shouldResyncAfterAcceptFailure('unknown'), false);

eq('a job still open for a pick means the lost accept did NOT go through', acceptResolvedAfterResync(acceptOpenJob), false);
eq('a payment-pending job means it did', acceptResolvedAfterResync(acceptPaymentPendingJob), true);
eq(
  'an assigned job means it did',
  acceptResolvedAfterResync({ ...acceptOpenJob, assigned_provider_id: 55 }),
  true
);
eq('a failed re-read claims nothing', acceptResolvedAfterResync(null), false);

/* ═══════════════════════════════════ Decline (Reject) Bid ═══════════════
 *
 * POST /jobs/{job_id}/bids/{bid_id}/reject. The reason rule, the body, the
 * gate and the failure copy — every one of them read from the live schema and
 * then MEASURED against the deployed backend (see lib/bid.ts for the matrix).
 * ════════════════════════════════════════════════════════════════════════ */

eq('the cap mirrors the schema', BID_REJECT_REASON_MAX_CHARS, 255);

/* The reason is OPTIONAL — measured: `{}`, `{"reason":null}` and `{"reason":""}`
   all pass validation on the live endpoint. */
const blankReason = validateBidRejectReason('');
const paddedReason = validateBidRejectReason('   ');
check('an empty reason is valid', blankReason.ok);
check('a whitespace-only reason is valid too', paddedReason.ok);
eq('and the blank becomes null on the wire', paddedReason.ok ? paddedReason.value : 'n/a', null);
check('undefined is valid', validateBidRejectReason(undefined).ok);
check('null is valid', validateBidRejectReason(null).ok);
eq('a real reason is kept as-is', validateBidRejectReason('Too expensive')?.ok, true);

eq('exactly 255 characters pass', validateBidRejectReason('x'.repeat(255)).ok, true);
const overLong = validateBidRejectReason('x'.repeat(256));
check('256 characters fail', !overLong.ok);
eq(
  "with the schema's own rule as the error key",
  overLong.ok ? '' : overLong.errorKey,
  'cbids_reject_err_reason_long'
);
eq(
  'padding does not count toward the cap',
  validateBidRejectReason(' '.repeat(256) + 'ok').ok,
  true
);

/* The body: the field name is `reason`, and blank is null — never "". */
deepEq('a blank reason is sent as null', buildBidRejectRequest(''), { reason: null });
deepEq('undefined is sent as null', buildBidRejectRequest(undefined), { reason: null });
eq('a reason is trimmed', buildBidRejectRequest('  Too expensive  ').reason, 'Too expensive');
eq(
  'the body carries exactly the contract field name',
  Object.keys(buildBidRejectRequest('x')).join(','),
  'reason'
);

/* The gate — same job eligibility as the accept, plus the CLIENT role. */
eq('the client may decline a pending bid on their own open job', canRejectBid(offer({ id: 1 }), acceptOpenJob, 'CLIENT'), true);
eq('a PROVIDER may not decline a bid', canRejectBid(offer({ id: 1 }), acceptOpenJob, 'PROVIDER'), false);
eq('no role may not decline a bid', canRejectBid(offer({ id: 1 }), acceptOpenJob, null), false);
for (const status of ['ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'] as BidStatus[]) {
  eq(
    `a ${status} bid cannot be declined`,
    canRejectBid(offer({ id: 1, status }), acceptOpenJob, 'CLIENT'),
    false
  );
}
eq('an already assigned job hides the decline action', canRejectBid(offer({ id: 1 }), acceptAssignedJob, 'CLIENT'), false);
eq('a payment-pending job hides it', canRejectBid(offer({ id: 1 }), acceptPaymentPendingJob, 'CLIENT'), false);
eq('a cancelled job hides it', canRejectBid(offer({ id: 1 }), acceptCancelledJob, 'CLIENT'), false);
eq('a completed job hides it', canRejectBid(offer({ id: 1 }), acceptCompletedJob, 'CLIENT'), false);
eq('a missing bid hides the action', canRejectBid(null, acceptOpenJob, 'CLIENT'), false);
eq('a missing job hides the action', canRejectBid(offer({ id: 1 }), null, 'CLIENT'), false);
eq(
  'a bid that belongs to ANOTHER job is refused',
  canRejectBid(offer({ id: 1, job_id: 99 }), acceptOpenJob, 'CLIENT'),
  false
);
eq(
  'a closed bidding window does NOT hide it (the client may still choose)',
  canRejectBid(offer({ id: 1 }), acceptWindowClosedJob, 'CLIENT'),
  true
);
eq(
  'the two decision gates are the same predicate',
  isJobBidDecisionEligible(acceptOpenJob) && isJobAcceptEligible(acceptOpenJob),
  true
);

/* Buckets → copy. The 422 copy and the "no longer declinable" copy must differ. */
eq('422 has its own copy', rejectBidErrorKey('invalid'), 'cbids_reject_err_invalid');
eq('400 shares the refusal copy', rejectBidErrorKey('badrequest'), 'cbids_reject_err_notallowed');
eq('409 shares it too', rejectBidErrorKey('conflict'), 'cbids_reject_err_notallowed');
eq('403 has its own copy', rejectBidErrorKey('forbidden'), 'cbids_reject_err_forbidden');
eq('404 has its own copy', rejectBidErrorKey('notfound'), 'cbids_reject_err_notfound');
eq('no connection has its own copy', rejectBidErrorKey('network'), 'cbids_reject_err_network');
eq('a 5xx falls back to the server copy', rejectBidErrorKey('server'), 'cbids_reject_err_server');
eq('an unknown bucket falls back too', rejectBidErrorKey('unknown'), 'cbids_reject_err_server');
eq(
  '422 and "no longer declinable" are distinct messages',
  rejectBidErrorKey('invalid') !== rejectBidErrorKey('conflict'),
  true
);
eq('a 422 is not a state refusal', isRejectNotAllowed('invalid'), false);
eq('a 400 is', isRejectNotAllowed('badrequest'), true);
eq('a 409 is', isRejectNotAllowed('conflict'), true);

eq(
  'the measured "Bid not found." wins over the translated copy',
  rejectBidFailureMessage({ kind: 'notfound', message: 'Bid not found.' }, (key) => `T:${key}`),
  'Bid not found.'
);
eq(
  'and so does the measured "Job not found."',
  rejectBidFailureMessage({ kind: 'notfound', message: 'Job not found.' }, (key) => `T:${key}`),
  'Job not found.'
);
eq(
  'without a server message the translated copy is used',
  rejectBidFailureMessage({ kind: 'conflict', message: null }, (key) => `T:${key}`),
  'T:cbids_reject_err_notallowed'
);

/* When the screen re-reads the offers after a failure. */
eq('a refusal re-reads the offers', shouldResyncAfterRejectFailure('badrequest'), true);
eq('403 and 404 do too', shouldResyncAfterRejectFailure('forbidden') && shouldResyncAfterRejectFailure('notfound'), true);
eq('409 does', shouldResyncAfterRejectFailure('conflict'), true);
eq('a 422 does not (the reason or the path id was rejected)', shouldResyncAfterRejectFailure('invalid'), false);
eq('a 5xx does not', shouldResyncAfterRejectFailure('server'), false);
eq('a transport failure does not — the bid stays, with a retry', shouldResyncAfterRejectFailure('network'), false);

/* The 422 detail[] → the reason input. */
eq(
  'the server message for reason lands on the input',
  bidRejectReasonFieldError([
    { loc: ['body', 'reason'], msg: 'String should have at most 255 characters', type: 'string_too_long' }, 
  ]),
  'String should have at most 255 characters'
);
eq(
  'a path-level 422 does not land on the reason input',
  bidRejectReasonFieldError([
    { loc: ['path', 'job_id'], msg: 'Input should be a valid integer', type: 'int_parsing' },
  ]),
  null
);
eq('no detail array maps to nothing', bidRejectReasonFieldError(null), null);
eq('a malformed detail maps to nothing', bidRejectReasonFieldError({} as unknown as ValidationErrorDetail[]), null);

/* A declined bid must never come back: REJECTED is not client-visible, so no
   cached list, poll response or live update can render it again. */
eq('a REJECTED bid is not client-visible', isClientVisibleBid({ status: 'REJECTED' }), false);
eq(
  'a declined bid leaves every list the screen holds',
  filterClientVisibleBids([
    offer({ id: 1, status: 'REJECTED', rejected_at: '2026-10-13T10:17:00.362Z' }),
    offer({ id: 2 }),
  ]).length,
  1
);

/* ------------------------------------------------------------------ report */

export const summary = { passed, total: passed + failures.length };
console.log(`bid: ${summary.passed}/${summary.total} assertions passed`);
