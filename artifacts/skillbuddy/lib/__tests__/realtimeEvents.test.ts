/**
 * Unit tests for the realtime protocol types (lib/realtimeEvents.ts): the
 * envelope validator, the documented/unknown split and the small amount of
 * per-event knowledge the protocol carries.
 *
 * Run through the project's own harness: `pnpm run test`. Pure functions only.
 */
import {
  JOB_SCOPED_EVENT_TYPES,
  isKnownRealtimeEvent,
  parseRealtimeEnvelope,
  requiresJobWatch,
  type RealtimeEvent,
} from '../realtimeEvents';

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

function envelope(type: unknown, data: unknown, timestamp: unknown = '2026-10-13T12:00:00Z'): string {
  return JSON.stringify({ type, data, timestamp });
}

/* ------------------------------------------------------------- well-formed */

/** The narrowing pattern consumers should use (see lib/realtimeEvents.ts). */
function asBidCreated(event: RealtimeEvent | null) {
  if (event === null || !isKnownRealtimeEvent(event)) return null;
  return event.type === 'bid.created' ? event : null;
}

function asBidRejected(event: RealtimeEvent | null) {
  if (event === null || !isKnownRealtimeEvent(event)) return null;
  return event.type === 'bid.rejected' ? event : null;
}

const bidRaw = parseRealtimeEnvelope(
  envelope('bid.created', {
    job_id: 12,
    bid_id: 34,
    provider_id: 56,
    offered_price: '25.50',
    eta_minutes: 45,
    total_score: 88.5,
  })
);
const bid = asBidCreated(bidRaw);
check('a documented event parses', bidRaw !== null);
eq('the type is preserved', bid?.type, 'bid.created');
eq('job_id stays a number', bid?.data.job_id, 12);
eq('bid_id stays a number', bid?.data.bid_id, 34);
eq('the timestamp is preserved', bidRaw?.timestamp, '2026-10-13T12:00:00Z');
eq(
  'money-like values stay decimal strings (never parsed to floats)',
  bid?.data.offered_price,
  '25.50'
);
check('a parsed documented event narrows to the known union', bid !== null);
check(
  'the same message does not narrow to a different event',
  asBidRejected(bidRaw) === null
);

/* --------------------------------------------------------- malformed input */

eq('valid JSON that is not an object is rejected', parseRealtimeEnvelope('42'), null);
eq('a JSON string is rejected', parseRealtimeEnvelope('"hello"'), null);
eq('a JSON array is rejected', parseRealtimeEnvelope('[1,2]'), null);
eq('null is rejected', parseRealtimeEnvelope('null'), null);
eq('broken JSON is rejected', parseRealtimeEnvelope('{"type":'), null);
eq('a non-string frame is rejected', parseRealtimeEnvelope({ type: 'bid.created', data: {} }), null);
eq('undefined is rejected', parseRealtimeEnvelope(undefined), null);
eq('an empty type string is rejected', parseRealtimeEnvelope(envelope('', {})), null);
eq('a missing type is rejected', parseRealtimeEnvelope(envelope(undefined, {})), null);
eq('a numeric type is rejected', parseRealtimeEnvelope(envelope(7, {})), null);
eq('a missing data object is rejected', parseRealtimeEnvelope(envelope('bid.created', undefined)), null);
eq('a null data is rejected', parseRealtimeEnvelope(envelope('bid.created', null)), null);
eq('an array data is rejected', parseRealtimeEnvelope(envelope('bid.created', [])), null);
eq('a string data is rejected', parseRealtimeEnvelope(envelope('bid.created', 'x')), null);

const noTimestamp = parseRealtimeEnvelope(JSON.stringify({ type: 'job.bidding_closed', data: { job_id: 3 } }));
check('an event survives a missing timestamp (empty string)', noTimestamp !== null);
eq('the missing timestamp becomes an empty string', noTimestamp?.timestamp, '');

/* --------------------------------------------------- documented vs unknown */

/**
 * `payment.succeeded` used to be the example of an undocumented type here. It is
 * a typed money event now, so the unknown-branch example is a type the guide does
 * NOT name, and the money event is asserted positively instead.
 */
const namedMoneyEvent = parseRealtimeEnvelope(envelope('payment.succeeded', { amount: '9.99' }));
check('a named money event parses as an event', namedMoneyEvent !== null);
eq('a named money event keeps its type', namedMoneyEvent?.type, 'payment.succeeded');
check(
  'a named money event IS part of the known union',
  namedMoneyEvent !== null && isKnownRealtimeEvent(namedMoneyEvent)
);

const unknownEvent = parseRealtimeEnvelope(envelope('payment.received', { amount: '9.99' }));
check('an undocumented type still parses as an event', unknownEvent !== null);
eq('the undocumented type is not dropped', unknownEvent?.type, 'payment.received');
check(
  'an undocumented type is not part of the known union',
  unknownEvent ? !isKnownRealtimeEvent(unknownEvent) : false
);

const DOCUMENTED: string[] = [
  'bid.created',
  'bid.updated',
  'bid.withdrawn',
  'bid.accepted',
  'bid.rejected',
  'job.bidding_extended',
  'job.bidding_closed',
  'job.nearby_opened',
  'job.nearby_closed',
];
for (const type of DOCUMENTED) {
  const parsed = parseRealtimeEnvelope(envelope(type, { job_id: 1 }));
  check(`${type} is recognised as documented`, parsed !== null && isKnownRealtimeEvent(parsed));
}
eq('exactly the nine documented types are known', DOCUMENTED.length, 9);

/**
 * Types the guide has NOT named. `wallet.credit_earned` used to live here; it is
 * a documented money event now, so it was moved to the typed list below rather
 * than deleted (the expectation changed because the protocol did).
 */
const UNDOCUMENTED: string[] = [
  'payment.created',
  'payment.completed',
  'invoice.sent',
  'escrow.held',
  'something.brand_new',
];
for (const type of UNDOCUMENTED) {
  const parsed = parseRealtimeEnvelope(envelope(type, {}));
  check(`${type} lands in the unknown branch`, parsed !== null && !isKnownRealtimeEvent(parsed));
}

/* ------------------------------------------------------ documented money events */

/** The ten money events the guide names (section 5, 13 Oct 2026). */
const MONEY_TYPES: string[] = [
  'payment.pending',
  'payment.succeeded',
  'payment.failed',
  'payment.disputed',
  'payment.refunded',
  'invoice.created',
  'invoice.overdue',
  'escrow.release_scheduled',
  'escrow.released',
  'wallet.credit_earned',
];
for (const type of MONEY_TYPES) {
  const parsed = parseRealtimeEnvelope(envelope(type, { job_id: 1 }));
  check(`${type} is a TYPED event now`, parsed !== null && isKnownRealtimeEvent(parsed));
  check(`${type} needs no watch_job`, requiresJobWatch(type) === false);
}

/* ------------------------------------------------------- watch requirement */

eq('the job-scoped list is exactly the two bidding events', JOB_SCOPED_EVENT_TYPES.length, 2);
check('job.bidding_closed needs a watch', requiresJobWatch('job.bidding_closed') === true);
check('job.bidding_extended needs a watch', requiresJobWatch('job.bidding_extended') === true);
check('bid.created needs no watch', requiresJobWatch('bid.created') === false);
check('bid.updated needs no watch', requiresJobWatch('bid.updated') === false);
check('bid.accepted needs no watch', requiresJobWatch('bid.accepted') === false);
check('bid.rejected needs no watch', requiresJobWatch('bid.rejected') === false);
check('job.nearby_opened needs no watch', requiresJobWatch('job.nearby_opened') === false);
check('an unknown type never needs a watch', requiresJobWatch('payment.succeeded') === false);

/* ------------------------------------------------------- nullable rejection */

const rejected = asBidRejected(
  parseRealtimeEnvelope(envelope('bid.rejected', { job_id: 1, bid_id: 2, reason: null }))
);
check('a rejection with a null reason parses', rejected !== null);
eq('a null reason stays null (not coerced to a string)', rejected?.data.reason, null);
check('the rejection keeps its own type', rejected?.type === 'bid.rejected');

/* ------------------------------------------------------------------ report */

for (const failure of failures) console.log(`  x ${failure}`);
console.log(`realtimeEvents: ${passed}/${passed + failures.length} assertions passed`);
