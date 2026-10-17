/**
 * bidResults.ts
 *
 * Pure logic behind the PROVIDER's live bid results — the two user-targeted
 * events that decide a provider's bid (integration guide, 13 Oct 2026):
 *
 *   bid.accepted { job_id, bid_id }                 you won the job
 *   bid.rejected { job_id, bid_id, reason }         not selected; `reason` may
 *                                                   be null
 *
 * No React, no socket and no storage here: the handler in
 * context/BidResultsContext.tsx subscribes and calls these functions, so the
 * decisions (what a frame means, whether it is new, what copy it produces, what
 * it does to a cached list) are testable without a renderer.
 *
 * ── WHY A BANNER AND NOT A NAVIGATION ─────────────────────────────────────
 * Neither event proves the provider is looking at anything related: they may be
 * typing a bid on another job, filling a form, or on the Home tab. A forced
 * `router.push` would throw that away, so the result is announced in a banner
 * with a View action, and the caches are updated underneath it.
 *
 * ── EVENTS ARE NOT STORED ─────────────────────────────────────────────────
 * The socket delivers a frame once. A missed `bid.accepted` (app closed, socket
 * down) is gone, which is why the handler refetches the list on every (re)open
 * and on app resume, and why the polling fallback below exists while no socket
 * carries the change. A banner is UI, never the record: the record is the REST
 * read.
 *
 * ── IDEMPOTENT BY (type, bid_id) ──────────────────────────────────────────
 * A reconnect replays nothing, but a re-delivery would; `createBidResultDeduper`
 * remembers the keys it has already announced so a repeat cannot stack a second
 * banner or re-touch the caches with the same news.
 */

import type { RealtimeStatus } from '@/lib/realtime';
import type { MyBidLookup } from '@/lib/bid';
import type { BidResponse, BidStatus } from '@/types';

/** The two events this module understands. */
export const BID_RESULT_EVENT_TYPES = ['bid.accepted', 'bid.rejected'] as const;
export type BidResultEventType = (typeof BID_RESULT_EVENT_TYPES)[number];

/** How often the provider's PENDING bids are re-read when no socket is open. */
export const PROVIDER_BID_POLL_MS = 30_000;

/** How long a result banner stays on screen before it dismisses itself. */
export const BID_RESULT_BANNER_MS = 10_000;

/** How many result keys are remembered for de-duplication. */
export const BID_RESULT_DEDUPE_SIZE = 200;

export type ProviderBidResultKind = 'accepted' | 'rejected';

export interface ProviderBidResult {
  kind: ProviderBidResultKind;
  /** The event's own type, kept so the dedupe key can name it exactly. */
  type: BidResultEventType;
  jobId: number;
  bidId: number;
  /** The backend's own reason for a rejection; null when it sent none. */
  reason: string | null;
}

const isIntegerId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

/**
 * Read one realtime envelope as a bid result, or null.
 *
 * A malformed frame is DROPPED rather than guessed at: without integer ids the
 * app cannot say which bid changed, and a banner about the wrong bid — or a
 * cache update to an id nobody sent — is worse than no banner at all. The
 * `reason` is only read for `bid.rejected`, and only as a non-empty trimmed
 * string: a missing/blank/wrong-typed reason means "the backend gave none",
 * which is exactly the case the translated default covers.
 */
export function providerBidResult(event: unknown): ProviderBidResult | null {
  if (!event || typeof event !== 'object') return null;
  const envelope = event as { type?: unknown; data?: unknown };
  const type = envelope.type;
  if (type !== 'bid.accepted' && type !== 'bid.rejected') return null;

  const data = envelope.data;
  if (!data || typeof data !== 'object') return null;
  const payload = data as { job_id?: unknown; bid_id?: unknown; reason?: unknown };
  if (!isIntegerId(payload.job_id) || !isIntegerId(payload.bid_id)) return null;

  let reason: string | null = null;
  if (type === 'bid.rejected' && typeof payload.reason === 'string') {
    const trimmed = payload.reason.trim();
    reason = trimmed.length > 0 ? trimmed : null;
  }

  return {
    kind: type === 'bid.accepted' ? 'accepted' : 'rejected',
    type,
    jobId: payload.job_id,
    bidId: payload.bid_id,
    reason,
  };
}

/** The de-duplication key for one result: the event type plus the bid it names. */
export function bidResultKey(result: Pick<ProviderBidResult, 'type' | 'bidId'>): string {
  return `${result.type}:${result.bidId}`;
}

export interface BidResultDeduper {
  /** Remember this result; true when it was ALREADY seen (so it is not news). */
  seen(result: Pick<ProviderBidResult, 'type' | 'bidId'>): boolean;
  /** Forget everything — used when the account changes. */
  clear(): void;
  size(): number;
}

/**
 * A bounded memory of announced results. `seen()` returns true for a repeat, so
 * a caller writes `if (deduper.seen(result)) return;` and a re-delivered frame
 * cannot produce a second banner. The bound is a plain insertion order: the
 * oldest keys are dropped, which is the right eviction for a stream whose
 * repeats arrive close together.
 */
export function createBidResultDeduper(max = BID_RESULT_DEDUPE_SIZE): BidResultDeduper {
  const limit = max > 0 ? max : 1;
  const store = new Set<string>();

  return {
    seen: (result) => {
      const key = bidResultKey(result);
      if (store.has(key)) return true;
      store.add(key);
      while (store.size > limit) {
        const oldest = store.values().next();
        if (oldest.done) break;
        store.delete(oldest.value);
      }
      return false;
    },
    clear: () => store.clear(),
    size: () => store.size,
  };
}

/* ──────────────────────────────────────────────────────── banner copy ── */

export type BidResultTitleKey = 'mybids_result_accepted_title' | 'mybids_result_rejected_title';
export type BidResultReasonKey = 'mybids_result_rejected_default_reason';

/**
 * What the banner says, as keys plus the values they interpolate.
 *
 * accepted → "You were selected for <job title>" (the job title, the cached one
 *            or the "Job #id" fallback — never blank);
 * rejected → "Your bid was not selected" plus the backend's reason, or the
 *            translated default when the backend sent none (`reason: null` is
 *            the documented shape, and "Another provider was selected." is the
 *            guide's own wording for it).
 *
 * The reason is a KEY when the backend sent nothing and literal text when it did:
 * the server's own words are never replaced with app copy, and the app's copy is
 * never invented for a reason the server did supply.
 */
export interface BidResultBannerContent {
  titleKey: BidResultTitleKey;
  titleParams: { title: string };
  /** The backend's reason, verbatim, when it sent one. */
  reason: string | null;
  /** The translated default to use when `reason` is null. */
  reasonKey: BidResultReasonKey | null;
}

export function bidResultBannerContent(
  result: Pick<ProviderBidResult, 'kind' | 'reason'>,
  jobTitle: string | null
): BidResultBannerContent {
  const title = jobTitle && jobTitle.trim().length > 0 ? jobTitle.trim() : '';
  if (result.kind === 'accepted') {
    return {
      titleKey: 'mybids_result_accepted_title',
      titleParams: { title },
      reason: null,
      reasonKey: null,
    };
  }
  return {
    titleKey: 'mybids_result_rejected_title',
    titleParams: { title: '' },
    reason: result.reason,
    reasonKey: result.reason === null ? 'mybids_result_rejected_default_reason' : null,
  };
}

/**
 * The line under the title: the backend's reason when it sent one, otherwise the
 * translated default. Kept separate from the title so a long reason wraps on its
 * own line instead of pushing the job name out of view.
 */
export function bidResultBannerMessage(
  content: BidResultBannerContent,
  translate: (key: BidResultReasonKey) => string
): string | null {
  if (content.reason !== null) return content.reason;
  return content.reasonKey ? translate(content.reasonKey) : null;
}

/* ──────────────────────────────────────────────── cache updates ── */

/** The status an event announces — the only value this module writes. */
export function bidResultStatus(kind: ProviderBidResultKind): BidStatus {
  return kind === 'accepted' ? 'ACCEPTED' : 'REJECTED';
}

/**
 * Apply a result to a cached list: the named bid's status becomes the announced
 * one, and a rejection records the reason the backend sent.
 *
 * NOTHING ELSE IS TOUCHED — no timestamp is invented (the event carries none),
 * `updated_at` is left as the server sent it, and the seven score fields are not
 * read. The refetch that follows settles the rest (the accepted bid's
 * `accepted_at`, the row's new position in its filter).
 */
export function applyBidResultToBids(
  bids: readonly BidResponse[],
  result: ProviderBidResult
): BidResponse[] {
  const status = bidResultStatus(result.kind);
  let changed = false;
  const next = bids.map((bid) => {
    if (!bid || bid.id !== result.bidId) return bid;
    changed = true;
    if (result.kind === 'accepted') {
      return { ...bid, status };
    }
    return {
      ...bid,
      status,
      // Only the server's own words are stored; a null reason leaves whatever
      // the row already had, so a later refetch is the only thing that can
      // change it back.
      rejection_reason: result.reason ?? bid.rejection_reason ?? null,
    };
  });
  return changed ? next : [...bids];
}

/**
 * Apply a result to the ONE-JOB lookup (`GET /jobs/{id}/bids/mine`), which the
 * provider's job/bid screen reads. Only a lookup that is about THIS bid changes:
 * a result for another job, or for an unknown/id-less bid, leaves the state
 * exactly as it was, so the screen can never show another bid's outcome.
 */
export function applyBidResultToMyBid(lookup: MyBidLookup | null, result: ProviderBidResult): MyBidLookup | null {
  if (!lookup || lookup.state !== 'exists') return lookup;
  if (lookup.bid.id !== result.bidId || lookup.bid.job_id !== result.jobId) return lookup;

  const status = bidResultStatus(result.kind);
  if (result.kind === 'accepted') {
    return { state: 'exists', bid: { ...lookup.bid, status } };
  }
  return {
    state: 'exists',
    bid: {
      ...lookup.bid,
      status,
      rejection_reason: result.reason ?? lookup.bid.rejection_reason ?? null,
    },
  };
}

/**
 * Is a job's title already known? The banner asks for a title it may not have:
 * the provider's bids list only carries job ids, so the handler reads the title
 * from the same cache the list fills (lib/myBids.createJobTitleCache) and, when
 * it is missing, from ONE quick job read — never from a guess.
 */
export function bidResultJobTitle(cache: { get(jobId: number): string | null }, jobId: number): string | null {
  const title = cache.get(jobId);
  return typeof title === 'string' && title.trim().length > 0 ? title.trim() : null;
}

/* ────────────────────────────────────────────── polling fallback ── */

export interface ProviderBidPollGate {
  /** The realtime socket state — 'open' means events carry the changes. */
  socketStatus: RealtimeStatus | null | undefined;
  /** How many of the provider's bids are still PENDING. */
  pendingCount: number;
  /** The My Bids list or the provider's job/bid screen is on screen. */
  focused: boolean;
  /** The app is in the foreground. */
  foreground: boolean;
}

/**
 * Should the 30 s fallback poll run?
 *
 * Only when all four hold: no socket is carrying the feed, the provider has at
 * least one bid that can still change (PENDING — every other status is final),
 * and the screen that shows it is focused in the foreground. A backgrounded app
 * or a blurred screen therefore stops the requests by itself, and opening the
 * socket stops them too (the events become the source).
 */
export function shouldPollProviderBids(gate: ProviderBidPollGate): boolean {
  if (gate.socketStatus === 'open') return false;
  if (!gate.focused || !gate.foreground) return false;
  return gate.pendingCount > 0;
}

/** How many of these bids are still PENDING (any list may hold none). */
export function pendingBidCount(bids: readonly BidResponse[] | null | undefined): number {
  if (!Array.isArray(bids)) return 0;
  let count = 0;
  for (const bid of bids) {
    if (bid && bid.status === 'PENDING') count += 1;
  }
  return count;
}
