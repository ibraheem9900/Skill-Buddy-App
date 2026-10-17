/**
 * Unit tests for the provider's live bid results (lib/bidResults.ts).
 *
 * The socket could not be exercised against this backend (the live server has no
 * WebSocket route at all — see the chunk-5 findings), so the two envelopes are
 * covered here with synthetic frames shaped exactly like the integration guide's
 * `bid.accepted { job_id, bid_id }` and
 * `bid.rejected { job_id, bid_id, reason }`.
 *
 * Run through the project's own harness: `pnpm run test`.
 */
import {
  BID_RESULT_DEDUPE_SIZE,
  PROVIDER_BID_POLL_MS,
  applyBidResultToBids,
  applyBidResultToMyBid,
  bidResultBannerContent,
  bidResultBannerMessage,
  bidResultJobTitle,
  bidResultKey,
  bidResultStatus,
  createBidResultDeduper,
  pendingBidCount,
  providerBidResult,
  shouldPollProviderBids,
  type ProviderBidResult,
} from '../bidResults';
import { createJobTitleCache } from '../myBids';
import type { BidResponse, BidStatus } from '../../types';

declare const console: { log: (msg: string) => void };

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

function envelope(type: string, data: unknown): unknown {
  return { type, data, timestamp: '2026-10-16T12:00:00Z' };
}

function bid(overrides: Partial<BidResponse> = {}): BidResponse {
  return {
    id: 5,
    job_id: 20,
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
    distance_km: null,
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

/* ═════════════════════════════════════════════ reading an envelope ═══ */

eq('bid.accepted is read as an accepted result', providerBidResult(envelope('bid.accepted', { job_id: 20, bid_id: 5 })), {
  kind: 'accepted',
  type: 'bid.accepted',
  jobId: 20,
  bidId: 5,
  reason: null,
});
eq('bid.rejected keeps the backend reason', providerBidResult(envelope('bid.rejected', { job_id: 20, bid_id: 5, reason: 'Another provider was selected.' }))?.reason, 'Another provider was selected.');
eq('a null reason stays null (the documented shape)', providerBidResult(envelope('bid.rejected', { job_id: 20, bid_id: 5, reason: null }))?.reason, null);
eq('a blank reason is "no reason"', providerBidResult(envelope('bid.rejected', { job_id: 20, bid_id: 5, reason: '   ' }))?.reason, null);
eq('a reason is trimmed', providerBidResult(envelope('bid.rejected', { job_id: 20, bid_id: 5, reason: '  nope  ' }))?.reason, 'nope');
eq('an accepted frame never carries a reason', providerBidResult(envelope('bid.accepted', { job_id: 20, bid_id: 5, reason: 'ignored' }))?.reason, null);

eq('another event type is not a result', providerBidResult(envelope('bid.created', { job_id: 20, bid_id: 5 })), null);
eq('a missing/non-numeric job id is dropped', [providerBidResult(envelope('bid.accepted', { bid_id: 5 })), providerBidResult(envelope('bid.accepted', { job_id: '20', bid_id: 5 })), providerBidResult(envelope('bid.accepted', { job_id: 0, bid_id: 5 }))], [null, null, null]);
eq('a missing/non-integer bid id is dropped', [providerBidResult(envelope('bid.rejected', { job_id: 20 })), providerBidResult(envelope('bid.rejected', { job_id: 20, bid_id: 2.5 }))], [null, null]);
eq('a malformed frame is dropped rather than guessed', [providerBidResult(null), providerBidResult('bid.accepted'), providerBidResult({ type: 'bid.accepted' }), providerBidResult({ type: 'bid.accepted', data: null })], [null, null, null, null]);

/* ═══════════════════════════════════════════════ de-duplication ═══ */

const acceptedFrame = providerBidResult(envelope('bid.accepted', { job_id: 20, bid_id: 5 }))!;
const rejectedFrame = providerBidResult(envelope('bid.rejected', { job_id: 20, bid_id: 5, reason: null }))!;
eq('the key is (type, bid id)', bidResultKey(acceptedFrame), 'bid.accepted:5');
eq('the same bid decided differently is a DIFFERENT key', bidResultKey(rejectedFrame), 'bid.rejected:5');

const deduper = createBidResultDeduper();
eq('the first delivery is news', deduper.seen(acceptedFrame), false);
eq('a re-delivery is not', deduper.seen(acceptedFrame), true);
eq('still not, however many times it repeats', [deduper.seen(acceptedFrame), deduper.seen(acceptedFrame)], [true, true]);
eq('a different bid is news again', deduper.seen(rejectedFrame), false);
eq('size reflects the remembered keys', deduper.size(), 2);

const bounded = createBidResultDeduper(2);
const frames = [1, 2, 3, 4].map((id) => providerBidResult(envelope('bid.accepted', { job_id: 20, bid_id: id }))!);
frames.forEach((frame) => bounded.seen(frame));
eq('the memory is bounded', bounded.size() <= 2, true);
eq('an evicted key would be news again (bounded, documented)', bounded.seen(frames[0]), false);
eq('BID_RESULT_DEDUPE_SIZE is a usable bound', BID_RESULT_DEDUPE_SIZE > 0, true);
bounded.clear();
eq('clear() empties it', bounded.size(), 0);

/* ═════════════════════════════════════════════════ banner copy ═══ */

const acceptedContent = bidResultBannerContent(acceptedFrame, 'Fix a leaking tap');
eq('accepted names the job', acceptedContent.titleKey, 'mybids_result_accepted_title');
eq('with the job title as a parameter', acceptedContent.titleParams, { title: 'Fix a leaking tap' });
eq('and no reason line', [acceptedContent.reason, acceptedContent.reasonKey], [null, null]);

const rejectedWithReason = bidResultBannerContent({ kind: 'rejected', reason: 'Another provider was selected.' }, 'Fix a leaking tap');
eq('rejected has its own title', rejectedWithReason.titleKey, 'mybids_result_rejected_title');
eq('the backend reason is kept verbatim', rejectedWithReason.reason, 'Another provider was selected.');
eq('and no default is substituted', rejectedWithReason.reasonKey, null);

const rejectedNoReason = bidResultBannerContent({ kind: 'rejected', reason: null }, null);
eq('a null reason points at the translated default', rejectedNoReason.reasonKey, 'mybids_result_rejected_default_reason');
eq('no backend text is then shown', rejectedNoReason.reason, null);
eq(
  'the default is the guide\u2019s own wording',
  bidResultBannerMessage(rejectedNoReason, (key) => `T:${key}`),
  'T:mybids_result_rejected_default_reason'
);
eq(
  'a real reason wins over the default',
  bidResultBannerMessage(rejectedWithReason, (key) => `T:${key}`),
  'Another provider was selected.'
);
eq('an accepted banner has no message line', bidResultBannerMessage(acceptedContent, (key) => `T:${key}`), null);

const titleCache = createJobTitleCache();
eq('an unknown job has no cached title', bidResultJobTitle(titleCache, 20), null);
titleCache.set(20, '  Fix a leaking tap  ');
eq('a cached title is trimmed', bidResultJobTitle(titleCache, 20), 'Fix a leaking tap');
titleCache.set(21, '   ');
eq('a blank cached title counts as unknown', bidResultJobTitle(titleCache, 21), null);

/* ═════════════════════════════════════════ cache updates (list) ═══ */

const list = [bid({ id: 5, status: 'PENDING' }), bid({ id: 6, job_id: 21, status: 'PENDING' })];
const afterAccept = applyBidResultToBids(list, acceptedFrame);
eq('the named bid becomes ACCEPTED', afterAccept[0].status, 'ACCEPTED');
eq('the other row is untouched', afterAccept[1].status, 'PENDING');
eq('no timestamp is invented', [afterAccept[0].accepted_at, afterAccept[0].updated_at], [undefined, '2026-10-16T09:00:00Z']);

const afterReject = applyBidResultToBids(list, rejectedFrame);
eq('a rejection sets the status', afterReject[0].status, 'REJECTED');
eq('and stores the reason when the backend sent one', applyBidResultToBids(list, providerBidResult(envelope('bid.rejected', { job_id: 20, bid_id: 5, reason: 'no thanks' }))!)[0].rejection_reason, 'no thanks');
eq('a null reason leaves the stored one alone', applyBidResultToBids([bid({ id: 5, rejection_reason: null })] as BidResponse[], rejectedFrame)[0].rejection_reason, null);
eq('a result for a bid that is not on screen changes nothing', applyBidResultToBids(list, providerBidResult(envelope('bid.accepted', { job_id: 20, bid_id: 999 }))!), list);
eq('an empty list stays empty', applyBidResultToBids([], acceptedFrame), []);

/* ═════════════════════════════════════ cache updates (one job) ═══ */

const lookup = { state: 'exists' as const, bid: bid({ id: 5, status: 'PENDING' }) };
eq('the one-job answer follows the same bid', (applyBidResultToMyBid(lookup, acceptedFrame) as { bid: BidResponse }).bid.status, 'ACCEPTED');
eq('a result for ANOTHER bid is ignored', applyBidResultToMyBid(lookup, providerBidResult(envelope('bid.rejected', { job_id: 20, bid_id: 77, reason: null }))!), lookup);
eq('a result for the same bid id on another JOB is ignored', applyBidResultToMyBid(lookup, providerBidResult(envelope('bid.accepted', { job_id: 99, bid_id: 5 }))!), lookup);
eq('"no bid" is not turned into a bid by an event', applyBidResultToMyBid({ state: 'none' }, acceptedFrame), { state: 'none' });
eq('an error state is left alone too', applyBidResultToMyBid({ state: 'error', kind: 'network', message: null }, acceptedFrame), { state: 'error', kind: 'network', message: null });
eq('null stays null', applyBidResultToMyBid(null, acceptedFrame), null);
eq('the announced status is the enum value, per kind', [bidResultStatus('accepted'), bidResultStatus('rejected')], ['ACCEPTED', 'REJECTED']);

/* ══════════════════════════════════════════════ polling gate ═══ */

const gate = (overrides: Partial<Parameters<typeof shouldPollProviderBids>[0]> = {}) => ({
  // 'idle' is the real "configured but not carrying anything" state.
  socketStatus: 'idle' as const,
  pendingCount: 1,
  focused: true,
  foreground: true,
  ...overrides,
});
eq('a pending bid with no socket, on screen and in front: poll', shouldPollProviderBids(gate()), true);
eq('an open socket carries the changes: never poll', shouldPollProviderBids(gate({ socketStatus: 'open' })), false);
eq('nothing pending: nothing to poll for', shouldPollProviderBids(gate({ pendingCount: 0 })), false);
eq('a blurred screen: no polling', shouldPollProviderBids(gate({ focused: false })), false);
eq('a backgrounded app: no polling', shouldPollProviderBids(gate({ foreground: false })), false);
eq('an unknown/absent status still polls (it is not "open")', [shouldPollProviderBids(gate({ socketStatus: null })), shouldPollProviderBids(gate({ socketStatus: 'connecting' }))], [true, true]);
eq('a connecting socket counts as not carrying the feed', shouldPollProviderBids(gate({ socketStatus: 'connecting', pendingCount: 2 })), true);

eq('pendingBidCount counts only PENDING', pendingBidCount([bid({ status: 'PENDING' }), bid({ id: 6, status: 'ACCEPTED' }), bid({ id: 7, status: 'PENDING' })]), 2);
eq('an empty or absent list counts none', [pendingBidCount([]), pendingBidCount(null), pendingBidCount(undefined)], [0, 0, 0]);
eq('an unknown status is not pending', pendingBidCount([bid({ status: 'SOMETHING' as BidStatus })]), 0);
eq('the fallback interval is 30 s', PROVIDER_BID_POLL_MS, 30_000);

const statuses: BidStatus[] = ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'];
eq('only PENDING is pollable, from the whole enum', statuses.filter((s) => pendingBidCount([bid({ status: s })]) > 0), ['PENDING']);

/* ----------------------------------------------------------------- report */
for (const failure of failures) console.log(`  ✗ ${failure}`);
console.log(`bidResults: ${passed}/${passed + failures.length} assertions passed`);
