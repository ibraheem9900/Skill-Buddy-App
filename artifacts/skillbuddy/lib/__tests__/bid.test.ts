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
  bidSubmitErrorKey,
  bidSubmitFailureMessage,
  buildBidCreateRequest,
  canProviderSubmitBid,
  isBiddingOpen,
  shouldResyncAfterBidFailure,
} from '../bid';

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
eq('403 has its own copy (unverified / not allowed)', bidSubmitErrorKey('forbidden'), 'jobd_bid_err_forbidden');
eq('404 has its own copy', bidSubmitErrorKey('notfound'), 'jobd_bid_err_notfound');
eq('a 5xx is a server error', bidSubmitErrorKey('server'), 'jobd_bid_err_server');
eq('no response at all is a network error', bidSubmitErrorKey('network'), 'jobd_bid_err_network');
eq('an unrecognised failure is a server error', bidSubmitErrorKey('unknown'), 'jobd_bid_err_server');

eq(
  "the backend's own refusal text wins over the app's copy",
  bidSubmitFailureMessage({ kind: 'forbidden', message: 'Provider not verified' }, () => 'fallback'),
  'Provider not verified'
);
eq(
  'a refusal with no text falls back to the translated bucket',
  bidSubmitFailureMessage({ kind: 'forbidden', message: null }, () => 'fallback'),
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

/* ------------------------------------------------------------------ report */

export const summary = { passed, total: passed + failures.length };
console.log(`bid: ${summary.passed}/${summary.total} assertions passed`);
