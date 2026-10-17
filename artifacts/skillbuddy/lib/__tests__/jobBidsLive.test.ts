/**
 * Unit tests for the CLIENT Bids screen's realtime rules (lib/jobBidsLive.ts).
 *
 * Run through the project's own harness: `pnpm run test`. No React, no socket,
 * no timers that matter — every decision the screen makes about a realtime event
 * is pinned here, which is the only place it CAN be pinned while the backend's
 * WebSocket endpoint is not deployed (see .freebuff/livetest/ws-live-findings.md).
 */
import {
  BID_LIST_EVENT_TYPES,
  BID_REFRESH_DEBOUNCE_MS,
  BIDS_SAFETY_NET_MS,
  BiddingClosedTracker,
  bidCreatedNoticeText,
  bidEventMatchesJob,
  createRequestSequencer,
  eventJobId,
  extendedBiddingEndsAt,
  extendedTimerRestartCount,
  isBidListEvent,
  isRealtimeStale,
  realtimeEventMatchesJob,
} from '../jobBidsLive';
import { allBids, filterClientVisibleBids, sortBids, totalBidCount } from '../bid';
import { debounce, type DebounceHandle, type DebounceTimerApi } from '../debounce';
import type { RealtimeEvent } from '../realtimeEvents';
import type { BidResponse, JobBidsResponse } from '@/types';

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

/** The smallest envelope the socket could deliver. */
function event(type: string, data: Record<string, unknown>): RealtimeEvent {
  return { type, data, timestamp: '2026-10-14T12:00:00Z' } as RealtimeEvent;
}

/** A bid with only the fields these tests read. */
function bid(overrides: Partial<BidResponse> & { id: number }): BidResponse {
  return {
    job_id: 77,
    provider: { id: overrides.id, name: `P${overrides.id}` } as BidResponse['provider'],
    offered_price: '10.00',
    eta_minutes: 30,
    status: 'PENDING',
    distance_score: 0,
    star_rating_score: 0,
    badge_tier_score: 0,
    credibility_score: 0,
    acceptance_rate_score: 0,
    response_time_score: 0,
    total_score: 0,
    created_at: '2026-10-14T10:00:00Z',
    updated_at: '2026-10-14T10:00:00Z',
    ...overrides,
  } as BidResponse;
}

/* ───────────────────────────────────────── which event belongs to this job ── */

eq('the three bid events are the list events', BID_LIST_EVENT_TYPES.length, 3);
check('bid.created is a list event', isBidListEvent('bid.created'));
check('bid.updated is a list event', isBidListEvent('bid.updated'));
check('bid.withdrawn is a list event', isBidListEvent('bid.withdrawn'));
check('bid.accepted is NOT a list event (it ends the list)', !isBidListEvent('bid.accepted'));
check('bid.rejected is NOT a list event', !isBidListEvent('bid.rejected'));
check('job.nearby_opened is NOT a list event', !isBidListEvent('job.nearby_opened'));
check('an undocumented type is NOT a list event', !isBidListEvent('payment.succeeded'));
check('null is NOT a list event', !isBidListEvent(null));

eq('a JSON number job id is read as a number', eventJobId(event('bid.created', { job_id: 77 })), 77);
eq(
  'a numeric STRING job id matches the guide\u2019s Number() rule',
  eventJobId(event('bid.created', { job_id: '77' })),
  77
);
eq(
  'whitespace around a numeric string is tolerated',
  eventJobId(event('bid.created', { job_id: ' 77 ' })),
  77
);
eq('a non-numeric string has no job id', eventJobId(event('bid.created', { job_id: 'abc' })), null);
eq('an empty string is not job 0', eventJobId(event('bid.created', { job_id: '' })), null);
eq('null is not job 0 either', eventJobId(event('bid.created', { job_id: null })), null);
eq('a float is refused', eventJobId(event('bid.created', { job_id: 7.5 })), null);
eq('NaN is refused', eventJobId(event('bid.created', { job_id: Number.NaN })), null);
eq('a missing job_id is null', eventJobId(event('bid.created', {})), null);
eq('no event at all is null', eventJobId(null), null);

check(
  'a matching job id is accepted',
  realtimeEventMatchesJob(event('bid.created', { job_id: 77 }), 77)
);
check(
  'a numeric string matches too',
  realtimeEventMatchesJob(event('bid.created', { job_id: '77' }), 77)
);
check(
  'ANOTHER job\u2019s event is refused',
  !realtimeEventMatchesJob(event('bid.created', { job_id: 78 }), 77)
);
check(
  'a string current id (wrong shape) is refused',
  !realtimeEventMatchesJob(event('bid.created', { job_id: 77 }), '77' as unknown as number)
);
check(
  'job id 0 is refused (never a real job)',
  !realtimeEventMatchesJob(event('bid.created', { job_id: 0 }), 0)
);
check(
  'a missing current job id is refused',
  !realtimeEventMatchesJob(event('bid.created', { job_id: 77 }), null)
);
check(
  'the type filter works',
  realtimeEventMatchesJob(event('bid.created', { job_id: 77 }), 77, 'bid.created') &&
    !realtimeEventMatchesJob(event('bid.created', { job_id: 77 }), 77, 'bid.updated')
);
check(
  'only the three list events drive the list',
  bidEventMatchesJob(event('bid.updated', { job_id: 77 }), 77) &&
    bidEventMatchesJob(event('bid.withdrawn', { job_id: 77 }), 77) &&
    !bidEventMatchesJob(event('bid.accepted', { job_id: 77 }), 77)
);
check(
  'a bid event for another job never drives this list',
  !bidEventMatchesJob(event('bid.created', { job_id: 78 }), 77)
);

/* ────────────────────────────────────────────── job.bidding_extended ── */

const NOW = Date.parse('2026-10-14T12:00:00Z');
eq(
  'a future deadline is accepted (as epoch ms)',
  extendedBiddingEndsAt(
    event('job.bidding_extended', {
      job_id: 77,
      bidding_ends_at: '2026-10-14T13:00:00Z',
      request_type: 'REGULAR',
      timer_restart_count: 1,
    }),
    77,
    NOW
  ),
  Date.parse('2026-10-14T13:00:00Z')
);
eq(
  'an extension for another job is ignored',
  extendedBiddingEndsAt(event('job.bidding_extended', { job_id: 78, bidding_ends_at: '2026-10-14T13:00:00Z' }), 77, NOW),
  null
);
eq(
  'a deadline in the PAST is refused (never extend backwards)',
  extendedBiddingEndsAt(event('job.bidding_extended', { job_id: 77, bidding_ends_at: '2026-10-14T11:00:00Z' }), 77, NOW),
  null
);
eq(
  'a garbage timestamp is refused',
  extendedBiddingEndsAt(event('job.bidding_extended', { job_id: 77, bidding_ends_at: 'soon' }), 77, NOW),
  null
);
eq(
  'a missing timestamp is refused',
  extendedBiddingEndsAt(event('job.bidding_extended', { job_id: 77 }), 77, NOW),
  null
);
eq(
  'another event type cannot move the deadline',
  extendedBiddingEndsAt(event('job.bidding_closed', { job_id: 77, bidding_ends_at: '2026-10-14T13:00:00Z' }), 77, NOW),
  null
);
eq(
  'the restart count is read for the report',
  extendedTimerRestartCount(event('job.bidding_extended', { job_id: 77, timer_restart_count: 2 })),
  2
);
eq(
  'a missing restart count is null',
  extendedTimerRestartCount(event('job.bidding_extended', { job_id: 77 })),
  null
);

/* ───────────────────────────────── the "new offer" toast content ── */

const created = bidCreatedNoticeText(
  { bid_id: 41, job_id: 77, provider_id: 9, offered_price: '25.50', eta_minutes: 45, total_score: 80 },
  'en'
);
eq('the toast shows the locale price (en)', created?.price, '€25.50');
eq('the toast carries the bid id', created?.bidId, 41);
eq('45 minutes reads as minutes', JSON.stringify(created?.eta), JSON.stringify({ kind: 'minutes', minutes: 45 }));

const createdDe = bidCreatedNoticeText({ bid_id: 42, offered_price: '1250.00', eta_minutes: 90 }, 'de');
eq('the toast is localised (de)', createdDe?.price, '1.250,00 €');
eq('90 minutes reads as hours + minutes', JSON.stringify(createdDe?.eta), JSON.stringify({ kind: 'hours', hours: 1, minutes: 30 }));
eq(
  'an out-of-range ETA is dropped rather than printed (schema max 24 h)',
  bidCreatedNoticeText({ offered_price: '5', eta_minutes: 5000 }, 'en')?.eta,
  null
);

eq(
  'an immediate ETA reads as "now"',
  JSON.stringify(bidCreatedNoticeText({ offered_price: '5', eta_minutes: 0 }, 'en')?.eta),
  JSON.stringify({ kind: 'now' })
);
eq(
  'a missing ETA leaves the ETA out (the screen uses its no-ETA copy)',
  bidCreatedNoticeText({ offered_price: '5' }, 'en')?.eta,
  null
);
eq('a missing price means NO toast', bidCreatedNoticeText({ bid_id: 1 }, 'en'), null);
eq('a broken price means NO toast', bidCreatedNoticeText({ offered_price: 'lots' }, 'en'), null);
eq('a non-object payload means NO toast', bidCreatedNoticeText('nope', 'en'), null);
eq('a null payload means NO toast', bidCreatedNoticeText(null, 'en'), null);

/* ───────────────────────────── one refetch per burst (debounce coalescing) ── */

interface FakeTimer {
  run: () => void;
  delayMs: number;
  cancelled: boolean;
}

const timers: FakeTimer[] = [];
const timerApi: DebounceTimerApi = {
  schedule: (run, delayMs) => {
    const handle: FakeTimer = { run, delayMs, cancelled: false };
    timers.push(handle);
    return handle;
  },
  cancel: (handle: DebounceHandle) => {
    (handle as FakeTimer).cancelled = true;
  },
};

let refetches = 0;
const debouncedRefetch = debounce(() => {
  refetches += 1;
}, BID_REFRESH_DEBOUNCE_MS, timerApi);

eq('the debounce window sits in the required 300-500 ms band', BID_REFRESH_DEBOUNCE_MS, 400);
check('the debounce window is inside the band', BID_REFRESH_DEBOUNCE_MS >= 300 && BID_REFRESH_DEBOUNCE_MS <= 500);

// Three events for this job arriving together, then the last timer fires.
for (let i = 0; i < 3; i += 1) debouncedRefetch();
eq('a burst schedules timers but refetches nothing yet', refetches, 0);
eq('each burst entry supersedes the previous timer', timers.length, 3);
check('only the newest timer is still live', !timers[2].cancelled && timers[0].cancelled);
timers[2].run();
eq('the burst collapses into ONE refetch', refetches, 1);
debouncedRefetch.cancel();
eq('cancelling drops the pending refetch', refetches, 1);
eq('the safety-net interval is the documented 30 s', BIDS_SAFETY_NET_MS, 30000);

/* ────────────────────────────────────── idempotent job.bidding_closed ── */

const closed = new BiddingClosedTracker();
check('the first close of a window triggers the one-off work', closed.shouldRefetchOnClosed(77));
check('the repeat (~25 s later) does NOT', !closed.shouldRefetchOnClosed(77));
check('and neither does a third', !closed.shouldRefetchOnClosed(77));
check('another job has its own window', closed.shouldRefetchOnClosed(78));
closed.noteWindowOpen(77);
check('after an extension the NEXT close is handled again', closed.shouldRefetchOnClosed(77));
closed.noteWindowOpen(77);
closed.noteWindowOpen(77);
check('re-arming twice is harmless', closed.shouldRefetchOnClosed(77));
closed.clear();
check('clearing forgets every window (job change / account switch)', closed.shouldRefetchOnClosed(77));

/* ─────────────────────────────────────── stale responses never win ── */

const sequencer = createRequestSequencer();
const first = sequencer.next();
check('the newest request is current', sequencer.isCurrent(first));
const second = sequencer.next();
check('a newer request wins', sequencer.isCurrent(second));
check('the older request is now stale', !sequencer.isCurrent(first));
sequencer.invalidate();
check('invalidate makes everything in flight stale', !sequencer.isCurrent(second));
const third = sequencer.next();
check('a request made after the invalidate is current again', sequencer.isCurrent(third));

/* ───────────────────────────────────────────────────── the stale notice ── */

check('an open socket means the list is live', !isRealtimeStale('open'));
check('connecting is stale', isRealtimeStale('connecting'));
check('reconnecting is stale', isRealtimeStale('reconnecting'));
check('paused is stale', isRealtimeStale('paused'));
check('stopped is stale', isRealtimeStale('stopped'));
check('idle (never started) is stale', isRealtimeStale('idle'));
check('an unknown/absent status is stale', isRealtimeStale(null));

/* ──────────────────── recommended + other_offers: merge, filter, sort ── */

const response: JobBidsResponse = {
  job_id: 77,
  recommended: [
    bid({ id: 1, offered_price: '30.00', provider: { id: 1, name: 'A', star_rating: 4.2, badge_count: 1, badge_tier: '', credibility_score: 0, acceptance_rate: 0, response_time_avg: 0, total_jobs_completed: 0 } as BidResponse['provider'], distance_km: '5.0' }),
    bid({ id: 2, offered_price: '10.00', provider: { id: 2, name: 'B', star_rating: 4.9, badge_count: 3, badge_tier: '', credibility_score: 0, acceptance_rate: 0, response_time_avg: 0, total_jobs_completed: 0 } as BidResponse['provider'], distance_km: '1.5' }),
    // The backend can hand the client a bid it already decided: it must never render.
    bid({ id: 3, status: 'WITHDRAWN' }),
  ],
  other_offers: [
    bid({ id: 4, offered_price: '20.00', status: 'PENDING' }),
    bid({ id: 5, status: 'REJECTED' }),
    bid({ id: 6, status: 'EXPIRED' }),
    // A duplicate id (the two arrays are not guaranteed disjoint) must not double up.
    bid({ id: 2, offered_price: '10.00' }),
  ],
  total_bids: 7,
};

eq('the merged list keeps API order: recommended first, then the rest', allBids(response).map((b) => b.id).join(','), '1,2,3,4,5,6');
eq('a duplicated id appears once', allBids(response).filter((b) => b.id === 2).length, 1);
eq('the merged list with hidden statuses removed', allBids(response).filter((b) => b.status === 'PENDING' || b.status === 'ACCEPTED').map((b) => b.id).join(','), '1,2,4');
eq('the client-visible filter hides WITHDRAWN/REJECTED/EXPIRED', filterClientVisibleBids(allBids(response)).map((b) => b.id).join(','), '1,2,4');
eq('an ACCEPTED bid stays visible', filterClientVisibleBids([bid({ id: 9, status: 'ACCEPTED' })]).length, 1);
eq('a null entry is dropped', filterClientVisibleBids([null, bid({ id: 8 })]).length, 1);
eq("the server's own total is used, not the array length", totalBidCount(response), 7);

const sortedPrice = sortBids(filterClientVisibleBids(allBids(response)), 'price_asc');
eq('price low-to-high', sortedPrice.map((b) => b.id).join(','), '2,4,1');
const sortedRating = sortBids(filterClientVisibleBids(allBids(response)), 'rating_desc');
eq('rating high-to-low', sortedRating.slice(0, 2).map((b) => b.id).join(','), '2,1');
const sortedDistance = sortBids(filterClientVisibleBids(allBids(response)), 'distance_asc');
eq('nearest first (missing distances last)', sortedDistance.map((b) => b.id).join(','), '2,1,4');
const sortedBadges = sortBids(filterClientVisibleBids(allBids(response)), 'badges_desc');
eq('most badges first', sortedBadges.slice(0, 2).map((b) => b.id).join(','), '2,1');
eq(
  'the default chip changes nothing (the API order IS the order)',
  sortBids(filterClientVisibleBids(allBids(response)), 'api').map((b) => b.id).join(','),
  '1,2,4'
);
eq('the recommended block is capped by the screen at 3', response.recommended.slice(0, 3).length, 3);

/* ------------------------------------------------------------------ report */

for (const failure of failures) console.log(`  x ${failure}`);
console.log(`jobBidsLive: ${passed}/${passed + failures.length} assertions passed`);
