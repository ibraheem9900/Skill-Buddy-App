/**
 * myBids.ts
 *
 * Pure logic behind the provider's "My Bids" list
 * (GET /api/v1/bids/mine). No React, no axios, no storage here, so every rule
 * below is unit-testable without a renderer or a token.
 *
 * ── WHAT THE LIVE ENDPOINT ACTUALLY ANSWERS (measured 2026-10-16) ───────────
 *
 *   GET /api/v1/bids/mine?status&limit&offset
 *
 *   200 → a BARE ARRAY of BidResponse. There is no envelope, no total, no
 *   `has_more` — and NO JOB INFO on the item. The list therefore holds bids
 *   only, and the job title is a SECOND request (this module owns the lazy,
 *   capped and cached way to make it).
 *
 *   query params (live OpenAPI + measured):
 *     status  BidStatus | null — MUST be upper case; `status=pending` and
 *             `status=BOGUS` are both 422 enum errors, so the app only ever
 *             sends the five values the enum has (see MY_BIDS_STATUS_VALUES).
 *     limit   integer 1..100, default 20 — `limit=0` is 422 `greater_than_equal
 *             1`, `limit=101` is 422 `less_than_equal 100`, `limit=abc` is 422
 *             `int_parsing`. The builder below never sends a value outside that
 *             window, it simply omits the parameter and lets the server default.
 *     offset  integer >= 0, default 0 — `offset=-1` is 422 `greater_than_equal 0`;
 *             `offset=500` answers 200 with an empty array, so going past the end
 *             is a normal short page, never an error.
 *
 *   no token → 401 {"detail":"Not authenticated"} (the shared axios client
 *   refreshes once; a surviving 401 means the session is over).
 *
 * ── WHY PAGES ARE MERGED, NOT REPLACED ─────────────────────────────────────
 * The endpoint is offset-paginated over a set that CHANGES while the provider
 * scrolls (their own withdraw, another provider's bid, a client's decision), so
 * a later page can repeat a row an earlier page already delivered. Merging by
 * `bid.id` — with the last occurrence winning — is what keeps a repeated row on
 * screen exactly once and lets a changed row (an accepted bid) replace the one
 * that is displayed. The server's own order is preserved: existing rows keep
 * their position, genuinely new ids append.
 *
 * ── NO SCORES ──────────────────────────────────────────────────────────────
 * BidResponse carries `total_score`, `is_recommended` and seven component
 * scores. This module reads NONE of them: they are the backend's ranking data,
 * shown nowhere in the provider's own list.
 */

import {
  bidRejectionReason,
  bidStatusLabelKey,
  bidStatusStamp,
  type BidEtaParts,
  type BidStampLabelKey,
  type BidStatusLabelKey,
  type BidStatusStamp,
} from '@/lib/bid';
import type { BidResponse, BidStatus } from '@/types';

/** The five values of the live BidStatus enum — and nothing else. */
export const MY_BIDS_STATUS_VALUES: BidStatus[] = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
  'EXPIRED',
];

/** Query bounds, from the live schema. */
export const MY_BIDS_LIMIT_MIN = 1;
export const MY_BIDS_LIMIT_MAX = 100;
export const MY_BIDS_LIMIT_DEFAULT = 20;

/** The endpoint's own default page size when `limit` is omitted. */
export const MY_BIDS_PAGE_SIZE = MY_BIDS_LIMIT_DEFAULT;

/** How many job-title requests may be in flight at once. */
export const MY_BIDS_TITLE_CONCURRENCY = 3;

/** How many job titles are remembered (LRU-ish, oldest insert evicted). */
export const MY_BIDS_TITLE_CACHE_SIZE = 120;

/** The filter the list opens on: no `status` parameter at all. */
export type MyBidsFilter = BidStatus | null;

export interface MyBidsQueryInput {
  status?: MyBidsFilter;
  limit?: number | null;
  offset?: number | null;
}

/** Is this a limit the server would accept (and the app should therefore send)? */
export function isValidMyBidsLimit(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MY_BIDS_LIMIT_MIN &&
    value <= MY_BIDS_LIMIT_MAX
  );
}

/** Is this one of the five statuses the enum has? */
export function isMyBidsStatus(value: unknown): value is BidStatus {
  return typeof value === 'string' && (MY_BIDS_STATUS_VALUES as string[]).includes(value);
}

/** A usable offset: a non-negative integer, otherwise 0 (the server default). */
export function normalizeMyBidsOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return 0;
  return value;
}

/**
 * Build the query string for GET /api/v1/bids/mine.
 *
 * ONLY set parameters are sent, so the server's own defaults decide anything the
 * caller left out — and an out-of-range limit is omitted rather than sent as a
 * 422. An unrecognised status is omitted too: sending one could only make the
 * server refuse the whole request, and "all statuses" is already the right
 * meaning for a value the app does not know. Returns '' when nothing is set.
 */
export function buildMyBidsQuery(input: MyBidsQueryInput = {}): string {
  const parts: string[] = [];

  if (isMyBidsStatus(input.status)) parts.push(`status=${input.status}`);
  if (isValidMyBidsLimit(input.limit)) parts.push(`limit=${input.limit}`);
  const offset = normalizeMyBidsOffset(input.offset);
  if (offset > 0) parts.push(`offset=${offset}`);

  return parts.length ? `?${parts.join('&')}` : '';
}

/** Is this the last page? A page shorter than the limit ends the list. */
export function isLastMyBidsPage(page: readonly BidResponse[] | null | undefined, limit: number): boolean {
  const size = Array.isArray(page) ? page.length : 0;
  const effective = isValidMyBidsLimit(limit) ? limit : MY_BIDS_LIMIT_DEFAULT;
  return size < effective;
}

/**
 * Merge one page into the list: de-duplicate by `bid.id` (the page wins, so a
 * row that changed arrives updated exactly once) and keep the server's order.
 * A row is never dropped by a merge — a filter change is what resets the list,
 * and that is the caller's `resetMyBids`, not this function's guess.
 */
export function mergeMyBidsPage(
  current: readonly BidResponse[],
  page: readonly BidResponse[] | null | undefined
): BidResponse[] {
  const incoming = Array.isArray(page) ? page : [];
  if (incoming.length === 0) return [...current];

  const byId = new Map<number, BidResponse>();
  const order: number[] = [];
  for (const bid of current) {
    if (!bid || typeof bid.id !== 'number') continue;
    if (!byId.has(bid.id)) order.push(bid.id);
    byId.set(bid.id, bid);
  }
  for (const bid of incoming) {
    if (!bid || typeof bid.id !== 'number') continue;
    if (!byId.has(bid.id)) order.push(bid.id);
    byId.set(bid.id, bid);
  }
  return order.map((id) => byId.get(id)!).filter(Boolean);
}

/** Drop one bid locally (a withdraw, or a row the server no longer returns). */
export function removeMyBid(bids: readonly BidResponse[], bidId: number): BidResponse[] {
  return bids.filter((bid) => bid.id !== bidId);
}

/**
 * The list a fresh filter starts from: EMPTY, deliberately.
 *
 * A filter change re-reads page 0 of a different query, so keeping the previous
 * filter's rows would show bids the chip on screen says are excluded. Clearing
 * makes the skeleton honest and lets a short first page end the list correctly.
 */
export function resetMyBids(): BidResponse[] {
  return [];
}

/* ─────────────────────────────────────────────────────── filter labels ── */

export type MyBidsFilterKey =
  | 'mybids_filter_all'
  | 'bid_status_pending'
  | 'bid_status_accepted'
  | 'bid_status_rejected'
  | 'bid_status_withdrawn'
  | 'bid_status_expired';

/** The chip label for a filter — 'All' for null, the bid status' own label else. */
export function myBidsFilterLabelKey(filter: MyBidsFilter): MyBidsFilterKey {
  if (filter === null) return 'mybids_filter_all';
  return (bidStatusLabelKey(filter) ?? 'mybids_filter_all') as MyBidsFilterKey;
}

/** Per-filter empty copy: "No bids yet" is not "No accepted bids". */
export type MyBidsEmptyKey =
  | 'mybids_empty_title'
  | 'mybids_empty_sub'
  | 'mybids_empty_pending_title'
  | 'mybids_empty_pending_sub'
  | 'mybids_empty_accepted_title'
  | 'mybids_empty_accepted_sub'
  | 'mybids_empty_rejected_title'
  | 'mybids_empty_rejected_sub'
  | 'mybids_empty_withdrawn_title'
  | 'mybids_empty_withdrawn_sub'
  | 'mybids_empty_expired_title'
  | 'mybids_empty_expired_sub';

export function myBidsEmptyKeys(filter: MyBidsFilter): { title: MyBidsEmptyKey; sub: MyBidsEmptyKey } {
  switch (filter) {
    case 'PENDING':
      return { title: 'mybids_empty_pending_title', sub: 'mybids_empty_pending_sub' };
    case 'ACCEPTED':
      return { title: 'mybids_empty_accepted_title', sub: 'mybids_empty_accepted_sub' };
    case 'REJECTED':
      return { title: 'mybids_empty_rejected_title', sub: 'mybids_empty_rejected_sub' };
    case 'WITHDRAWN':
      return { title: 'mybids_empty_withdrawn_title', sub: 'mybids_empty_withdrawn_sub' };
    case 'EXPIRED':
      return { title: 'mybids_empty_expired_title', sub: 'mybids_empty_expired_sub' };
    default:
      return { title: 'mybids_empty_title', sub: 'mybids_empty_sub' };
  }
}

/* ────────────────────────────────────────────────────────── card values ── */

export interface MyBidsCardMeta {
  /** Locale-formatted EUR price, or null when the value is unusable. */
  price: string | null;
  /** ETA parts, translated by the card with the same keys the bid screens use. */
  eta: BidEtaParts | null;
  /** The five-value enum, or null for a status the app does not know. */
  statusKey: BidStatusLabelKey | null;
  /** The CLIENT's reason — present only on a REJECTED bid that carries one. */
  reason: string | null;
  /** The outcome timestamp, and ONLY while the status matches it. */
  stamp: (BidStatusStamp & { labelKey: BidStampLabelKey }) | null;
  /** Always present: when the provider submitted the bid. */
  submittedAt: string | null;
}

/**
 * Every value one row renders, decided from the server's own fields.
 *
 * The two rules that matter:
 *   - a timestamp is shown ONLY when the status is the outcome it belongs to
 *     (`bidStatusStamp`), because the docs' own example fills accepted_at,
 *     rejected_at AND withdrawn_at on a PENDING bid;
 *   - a rejection reason is shown ONLY on a REJECTED bid (`bidRejectionReason`).
 */
export function myBidsCardMeta(bid: BidResponse, price: string | null, eta: MyBidsCardMeta['eta']): MyBidsCardMeta {
  return {
    price,
    eta,
    statusKey: bidStatusLabelKey(bid.status),
    reason: bidRejectionReason(bid),
    stamp: bidStatusStamp(bid),
    submittedAt: typeof bid.created_at === 'string' && bid.created_at.length > 0 ? bid.created_at : null,
  };
}

export type MyBidsTimeKey =
  | 'mybids_time_now'
  | 'mybids_time_minutes'
  | 'mybids_time_hours'
  | 'mybids_time_days';

export interface MyBidsRelativeTime {
  key: MyBidsTimeKey;
  params?: Record<string, number>;
}

/**
 * "just now / 5 min ago / 3 h ago / 2 days ago" for a submitted bid, or null
 * once the value is older than a week or unparseable — the card then falls back
 * to the absolute date, which is the app's existing formatter, instead of
 * inventing a "long ago" bucket. A FUTURE timestamp (a clock skew between the
 * device and the server) reads as "just now" rather than a negative age.
 */
export function myBidsRelativeTime(value: string | null | undefined, nowMs: number): MyBidsRelativeTime | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const seconds = Math.floor((nowMs - parsed) / 1000);
  if (seconds <= 60) return { key: 'mybids_time_now' };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { key: 'mybids_time_minutes', params: { n: minutes } };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: 'mybids_time_hours', params: { n: hours } };
  const days = Math.floor(hours / 24);
  if (days <= 7) return { key: 'mybids_time_days', params: { n: days } };
  return null;
}

/* ────────────────────────────────────────────────── lazy job titles ── */

/**
 * An in-memory job-title cache keyed by job id.
 *
 * The list endpoint carries no job info, so a title is a second request — and
 * the same job can appear in several bids (a provider bids once per job, but a
 * re-read of the list repeats rows), so the cache is what keeps scrolling from
 * re-asking for titles already known. It is bounded and evicts the oldest
 * insertion, and `clear()` is called on logout / account switch so one account's
 * titles can never be shown to another.
 */
export interface JobTitleCache {
  get(jobId: number): string | null;
  has(jobId: number): boolean;
  set(jobId: number, title: string): void;
  clear(): void;
  size(): number;
}

export function createJobTitleCache(max = MY_BIDS_TITLE_CACHE_SIZE): JobTitleCache {
  const store = new Map<number, string>();
  const limit = max > 0 ? max : 1;

  return {
    get: (jobId) => store.get(jobId) ?? null,
    has: (jobId) => store.has(jobId),
    set: (jobId, title) => {
      // Re-inserting refreshes the entry's position so a title still on screen
      // is not evicted by a newer one the provider scrolled past.
      if (store.has(jobId)) store.delete(jobId);
      store.set(jobId, title);
      while (store.size > limit) {
        const oldest = store.keys().next();
        if (oldest.done) break;
        store.delete(oldest.value);
      }
    },
    clear: () => store.clear(),
    size: () => store.size,
  };
}

/**
 * A tiny concurrency limiter: at most `max` tasks run at once, the rest wait in
 * a queue in arrival order. This is what keeps the "load a title per visible
 * card" step from turning into an N+1 storm — the list can hold 100 bids, and
 * only three job requests may ever be in flight.
 */
export interface RequestLimiter {
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Requests currently in flight (never above the configured maximum). */
  active(): number;
  /** Requests queued behind them. */
  queued(): number;
}

export function createRequestLimiter(max = MY_BIDS_TITLE_CONCURRENCY): RequestLimiter {
  const limit = max > 0 ? max : 1;
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active -= 1;
    const resume = queue.shift();
    if (resume) resume();
  };

  return {
    run: <T,>(task: () => Promise<T>): Promise<T> => {
      const start = () =>
        Promise.resolve()
          .then(task)
          .finally(() => next());
      if (active < limit) {
        active += 1;
        return start();
      }
      return new Promise<T>((resolve, reject) => {
        queue.push(() => {
          active += 1;
          start().then(resolve, reject);
        });
      });
    },
    active: () => active,
    queued: () => queue.length,
  };
}

/**
 * Which job ids a render still needs a title for: the visible bids whose job is
 * neither cached nor already requested. The order is the list's own, so the
 * cards the provider is looking at are fetched first.
 */
export function jobIdsNeedingTitle(
  bids: readonly BidResponse[],
  cache: JobTitleCache,
  requested: ReadonlySet<number>
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const bid of bids) {
    const jobId = bid?.job_id;
    if (typeof jobId !== 'number' || !Number.isInteger(jobId)) continue;
    if (seen.has(jobId)) continue;
    seen.add(jobId);
    if (cache.has(jobId) || requested.has(jobId)) continue;
    out.push(jobId);
  }
  return out;
}