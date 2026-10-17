/**
 * Unit tests for the provider's "My Bids" list helpers (lib/myBids.ts) and the
 * live-result helpers (lib/bidResults.ts is covered by bidResults.test.ts).
 *
 * Run through the project's own harness: `pnpm run test`. No React, no axios, no
 * network — only the rules that decide the query, the paging merge, the titles
 * and what a row shows.
 *
 * The live answers these rules encode (measured 2026-10-16, see lib/myBids):
 * a BARE ARRAY of BidResponse, `status` upper case only, `limit` 1..100 default
 * 20, `offset` >= 0, and an offset past the end is an empty page rather than an
 * error.
 */
import {
  MY_BIDS_LIMIT_DEFAULT,
  MY_BIDS_LIMIT_MAX,
  MY_BIDS_PAGE_SIZE,
  MY_BIDS_STATUS_VALUES,
  buildMyBidsQuery,
  createJobTitleCache,
  createRequestLimiter,
  isLastMyBidsPage,
  isMyBidsStatus,
  isValidMyBidsLimit,
  jobIdsNeedingTitle,
  mergeMyBidsPage,
  myBidsCardMeta,
  myBidsEmptyKeys,
  myBidsFilterLabelKey,
  myBidsRelativeTime,
  normalizeMyBidsOffset,
  removeMyBid,
  resetMyBids,
} from '../myBids';
import type { BidResponse, BidStatus } from '../../types';

declare const console: { log: (msg: string) => void };
/** The harness compiles with `lib: es2020` and no node types. */
declare function setTimeout(handler: () => void, timeout?: number): unknown;

let passed = 0;
export const failures: string[] = [];

function check(label: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(label);
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures.push(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  else passed += 1;
}

/** A bid as the live schema types it, with everything the list reads. */
function bid(overrides: Partial<BidResponse> = {}): BidResponse {
  return {
    id: 1,
    job_id: 10,
    provider: {
      id: 3,
      name: 'Provider',
      star_rating: 4.5,
      badge_count: 1,
      badge_tier: 'BRONZE',
      credibility_score: 70,
      acceptance_rate: 80,
      response_time_avg: 60,
      total_jobs_completed: 5,
    },
    offered_price: '20.50',
    eta_minutes: 30,
    status: 'PENDING',
    distance_km: '3.5',
    distance_score: 10,
    star_rating_score: 10,
    badge_tier_score: 10,
    credibility_score: 10,
    acceptance_rate_score: 10,
    response_time_score: 10,
    total_score: 60,
    created_at: '2026-10-16T09:00:00Z',
    updated_at: '2026-10-16T09:00:00Z',
    ...overrides,
  } as BidResponse;
}

/* ═══════════════════════════════════════════════════ query builder ═══════ */

eq('nothing set means no query string at all (server defaults)', buildMyBidsQuery(), '');
eq('an empty object is the same', buildMyBidsQuery({}), '');

eq('a real status is sent verbatim (upper case)', buildMyBidsQuery({ status: 'PENDING' }), '?status=PENDING');
eq('every enum value is accepted', MY_BIDS_STATUS_VALUES.filter((s) => buildMyBidsQuery({ status: s }) === `?status=${s}`).length, 5);
eq('an unknown status is omitted, never sent as a 422', buildMyBidsQuery({ status: 'BOGUS' as BidStatus }), '');
eq('a lower-case status is omitted too (the live enum is case-sensitive)', buildMyBidsQuery({ status: 'pending' as BidStatus }), '');
eq('null means "all": no status parameter', buildMyBidsQuery({ status: null }), '');
eq(
  'a LIMIT is only sent inside the live window',
  [buildMyBidsQuery({ limit: 1 }), buildMyBidsQuery({ limit: MY_BIDS_LIMIT_MAX })],
  ['?limit=1', `?limit=${MY_BIDS_LIMIT_MAX}`]
);
eq(
  'out-of-range and non-integer limits are omitted (they would be 422s)',
  [
    buildMyBidsQuery({ limit: 0 }),
    buildMyBidsQuery({ limit: 101 }),
    buildMyBidsQuery({ limit: 7.5 }),
    buildMyBidsQuery({ limit: Number.NaN }),
    buildMyBidsQuery({ limit: null }),
  ],
  ['', '', '', '', '']
);
eq('offset 0 is the server default and is not sent', buildMyBidsQuery({ offset: 0 }), '');
eq('a real offset is sent', buildMyBidsQuery({ offset: 40 }), '?offset=40');
eq('a negative offset is omitted rather than sent as a 422', buildMyBidsQuery({ offset: -1 }), '');
eq(
  'all three parameters, in the documented order',
  buildMyBidsQuery({ status: 'REJECTED', limit: 20, offset: 60 }),
  '?status=REJECTED&limit=20&offset=60'
);

eq('the default page size IS the endpoint default', MY_BIDS_PAGE_SIZE, MY_BIDS_LIMIT_DEFAULT);
eq('isValidMyBidsLimit: the boundaries hold', [isValidMyBidsLimit(1), isValidMyBidsLimit(100), isValidMyBidsLimit(0), isValidMyBidsLimit(101), isValidMyBidsLimit('5')], [true, true, false, false, false]);
eq('isMyBidsStatus: only the five enum values', MY_BIDS_STATUS_VALUES.every(isMyBidsStatus) && !isMyBidsStatus('PENDING ') && !isMyBidsStatus(null), true);
eq('normalizeMyBidsOffset: junk becomes 0', [normalizeMyBidsOffset(-3), normalizeMyBidsOffset(2.5), normalizeMyBidsOffset('9'), normalizeMyBidsOffset(12)], [0, 0, 0, 12]);

/* ═══════════════════════════════════════════════════ paging merge ═══════ */

const p1 = [bid({ id: 1 }), bid({ id: 2 })];
const p2 = [bid({ id: 3 })];

eq('a first page lands as it came', mergeMyBidsPage([], p1).map((b) => b.id), [1, 2]);
eq('a later page appends (server order preserved)', mergeMyBidsPage(p1, p2).map((b) => b.id), [1, 2, 3]);
eq(
  'a repeated row appears ONCE, updated by the newer page',
  mergeMyBidsPage(p1, [bid({ id: 2, status: 'ACCEPTED' })]).map((b) => `${b.id}:${b.status}`),
  ['1:PENDING', '2:ACCEPTED']
);
eq('an empty page leaves the list untouched', mergeMyBidsPage(p1, []), p1);
eq('a non-array page leaves the list untouched', mergeMyBidsPage(p1, null), p1);
eq('a row without a numeric id is dropped, not rendered half-built', mergeMyBidsPage(p1, [bid({ id: undefined as unknown as number })] as BidResponse[]).length, 2);
eq('the merge never reorders what is already on screen', mergeMyBidsPage([bid({ id: 9 }), bid({ id: 4 })], [bid({ id: 5 })]).map((b) => b.id), [9, 4, 5]);

eq('a short page ends the list', [isLastMyBidsPage(p2, 20), isLastMyBidsPage(p1, 2), isLastMyBidsPage([], 20)], [true, false, true]);
eq('an unusable limit falls back to the default page size', isLastMyBidsPage(p1, 0), true);

eq('removeMyBid drops exactly one row', removeMyBid(p1, 1).map((b) => b.id), [2]);
eq('removing an unknown id changes nothing', removeMyBid(p1, 99).map((b) => b.id), [1, 2]);
eq('a filter change starts from an EMPTY list', resetMyBids(), []);

/* ═════════════════════════════════════════════════ filter + empty copy ═══ */

eq('"All" is its own chip', myBidsFilterLabelKey(null), 'mybids_filter_all');
eq('a status chip reuses the bid-status label', myBidsFilterLabelKey('WITHDRAWN'), 'bid_status_withdrawn');
eq(
  'each filter has its own empty copy (not one for everything)',
  [
    myBidsEmptyKeys(null).title,
    myBidsEmptyKeys('PENDING').title,
    myBidsEmptyKeys('ACCEPTED').title,
    myBidsEmptyKeys('REJECTED').title,
    myBidsEmptyKeys('WITHDRAWN').title,
    myBidsEmptyKeys('EXPIRED').title,
  ],
  ['mybids_empty_title', 'mybids_empty_pending_title', 'mybids_empty_accepted_title', 'mybids_empty_rejected_title', 'mybids_empty_withdrawn_title', 'mybids_empty_expired_title']
);
eq('and a matching body for each', myBidsEmptyKeys('EXPIRED').sub, 'mybids_empty_expired_sub');

/* ═══════════════════════════════════════════════════════ card values ═══ */

const pending = myBidsCardMeta(bid({ created_at: '2026-10-16T09:00:00Z' }), '20.50 €', null);
eq('the status label key comes from the enum', pending.statusKey, 'bid_status_pending');
eq('a PENDING bid shows no outcome stamp', pending.stamp, null);
eq('a PENDING bid shows no reason, even if the payload carries one', myBidsCardMeta(bid({ rejection_reason: 'should not show' }), null, null).reason, null);
eq('the submission time is always available', pending.submittedAt, '2026-10-16T09:00:00Z');

const rejected = myBidsCardMeta(
  bid({ status: 'REJECTED', rejection_reason: '  Another provider was selected.  ', rejected_at: '2026-10-16T10:00:00Z', accepted_at: '2026-10-16T09:30:00Z' }),
  null,
  null
);
eq('a REJECTED bid shows its reason, trimmed', rejected.reason, 'Another provider was selected.');
eq('and the timestamp that matches its status', rejected.stamp, { kind: 'rejected', labelKey: 'jobd_bid_ts_rejected', value: '2026-10-16T10:00:00Z' });

const accepted = myBidsCardMeta(bid({ status: 'ACCEPTED', accepted_at: '2026-10-16T11:00:00Z', rejected_at: null }), null, null);
eq('ACCEPTED carries its own stamp', accepted.stamp?.labelKey, 'jobd_bid_ts_accepted');
eq('a blank reason renders nothing', myBidsCardMeta(bid({ status: 'REJECTED', rejection_reason: '   ' }), null, null).reason, null);
eq('an unknown status has no label (and nothing is invented)', myBidsCardMeta(bid({ status: 'SOMETHING' as BidStatus }), null, null).statusKey, null);
eq('no score field is read into the card meta', Object.keys(pending).filter((k) => k.includes('score')), []);

/* ══════════════════════════════════════════════════ relative time ═══ */

const now = Date.parse('2026-10-16T12:00:00Z');
eq('seconds read as "just now"', myBidsRelativeTime('2026-10-16T11:59:30Z', now), { key: 'mybids_time_now' });
eq('a future timestamp (clock skew) also reads as "just now"', myBidsRelativeTime('2026-10-16T12:05:00Z', now), { key: 'mybids_time_now' });
eq('minutes', myBidsRelativeTime('2026-10-16T11:55:00Z', now), { key: 'mybids_time_minutes', params: { n: 5 } });
eq('hours', myBidsRelativeTime('2026-10-16T09:00:00Z', now), { key: 'mybids_time_hours', params: { n: 3 } });
eq('days', myBidsRelativeTime('2026-10-14T12:00:00Z', now), { key: 'mybids_time_days', params: { n: 2 } });
eq('older than a week falls back to the absolute date', myBidsRelativeTime('2026-10-01T12:00:00Z', now), null);
eq('unusable values have no relative form', [myBidsRelativeTime('soon', now), myBidsRelativeTime(null, now), myBidsRelativeTime('', now)], [null, null, null]);

/* ════════════════════════════════════════════ title cache + limiter ═══ */

const cache = createJobTitleCache(3);
eq('a miss is null, not an empty string', cache.get(1), null);
cache.set(1, 'Fix a tap');
eq('a title reads back', cache.get(1), 'Fix a tap');
eq('has() agrees', cache.has(1), true);
cache.set(2, 'B');
cache.set(3, 'C');
cache.set(4, 'D');
eq('the cache is bounded', cache.size(), 3);
eq('the oldest insertion is evicted', cache.has(1), false);
eq('re-inserting refreshes an entry instead of evicting it', (() => {
  const lru = createJobTitleCache(2);
  lru.set(1, 'one');
  lru.set(2, 'two');
  lru.set(1, 'one again');
  lru.set(3, 'three');
  return lru.has(1) && !lru.has(2);
})(), true);
cache.clear();
eq('clear() empties it (logout / account switch)', cache.size(), 0);

eq('only VISIBLE jobs still missing a title are requested', jobIdsNeedingTitle(
  [bid({ id: 1, job_id: 10 }), bid({ id: 2, job_id: 11 }), bid({ id: 3, job_id: 10 })],
  (() => {
    const c2 = createJobTitleCache();
    c2.set(10, 'already known');
    return c2;
  })(),
  new Set()
), [11]);
eq('a job already requested is not requested again', jobIdsNeedingTitle(
  [bid({ job_id: 12 })],
  createJobTitleCache(),
  new Set([12])
), []);
eq('a bid with no usable job id asks for nothing', jobIdsNeedingTitle([bid({ job_id: 'x' as unknown as number })], createJobTitleCache(), new Set()), []);

/* the limiter: at most N in flight, the rest queue in order */
(async () => {
  const limiter = createRequestLimiter(3);
  let active = 0;
  let peak = 0;
  const started: number[] = [];
  const task = (id: number, ms: number) =>
    limiter.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      started.push(id);
      await new Promise((resolve) => setTimeout(() => resolve(undefined), ms));
      active -= 1;
      return id;
    });

  const all = await Promise.all([task(1, 20), task(2, 20), task(3, 20), task(4, 5), task(5, 5)]);
  check('every queued task still ran', JSON.stringify(all) === JSON.stringify([1, 2, 3, 4, 5]));
  check('never more than three requests were in flight', peak <= 3);
  check('the first three started immediately, in order', JSON.stringify(started.slice(0, 3)) === JSON.stringify([1, 2, 3]));
  check('nothing is left queued afterwards', limiter.queued() === 0 && limiter.active() === 0);

  const failing = limiter.run(async () => {
    throw new Error('boom');
  });
  let rejected = false;
  await failing.catch(() => {
    rejected = true;
  });
  check('a failed task frees its slot', rejected && limiter.active() === 0 && limiter.queued() === 0);

  /* ----------------------------------------------------------------- report */
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  console.log(`myBids: ${passed}/${passed + failures.length} assertions passed`);
})();
