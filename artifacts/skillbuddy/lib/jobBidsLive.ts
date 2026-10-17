/**
 * The CLIENT Bids screen's realtime rules — pure, framework-free logic.
 *
 * Everything the screen and its data hook decide about a realtime event lives
 * here so it can be pinned by the dependency-free test runner (`pnpm run test`)
 * instead of only being observable on a device. Nothing in this file touches
 * React, the socket, storage or the network.
 *
 * THE RULES (backend Integration Guide, 13 Oct 2026):
 *   - `bid.created` / `bid.updated` / `bid.withdrawn` are user-targeted, so no
 *     watch is needed, and they carry only IDs and numbers — NEVER the provider
 *     card and never the recommended/other_offers split. The list therefore has
 *     to be re-read from REST, debounced (300–500 ms) because a burst of bids
 *     arrives together.
 *   - an event is only acted on when it belongs to the job on screen:
 *     `Number(data.job_id)` must equal that job's id (a numeric string matches,
 *     because that is exactly what Number() does; a missing or non-numeric
 *     job_id never matches).
 *   - `job.bidding_extended` carries a NEW bidding_ends_at — the countdown is
 *     recomputed from that timestamp, never from a client-side guess.
 *   - `job.bidding_closed` REPEATS roughly every 25 s while a job is OPEN with an
 *     expired window, so the one-off work it triggers (re-reading the job) must
 *     happen ONCE per closed window — see {@link BiddingClosedTracker}.
 *   - events are never stored by the server: a missed event is lost, so the
 *     socket's (re)open is what tells the screen to refetch.
 */
import {
  bidEtaParts,
  formatBidPriceLocale,
  type BidEtaParts,
  type BidLocale,
} from '@/lib/bid';
import type { RealtimeStatus } from '@/lib/realtime';
import type { RealtimeEvent } from '@/lib/realtimeEvents';
// Marker-less API timestamps are UTC (live-verified) — see the parser's header.
import { parseApiIsoUtc } from '@/lib/jobDetail';

/** The three events that can change the client's list of offers. */
export const BID_LIST_EVENT_TYPES = ['bid.created', 'bid.updated', 'bid.withdrawn'] as const;

export type BidListEventType = (typeof BID_LIST_EVENT_TYPES)[number];

/** Trailing wait before the list is re-read after a bid event (300–500 ms). */
export const BID_REFRESH_DEBOUNCE_MS = 400;

/**
 * Safety-net refetch interval used ONLY while the socket is not open: the list
 * stays roughly current even when realtime is down, and it stops the moment the
 * socket reports itself open (realtime takes over again).
 */
export const BIDS_SAFETY_NET_MS = 30_000;

/** How long an in-screen notice stays on screen (toast / timer extended). */
export const LIVE_NOTICE_MS = 4_000;

export function isBidListEvent(type: string | null | undefined): type is BidListEventType {
  return typeof type === 'string' && (BID_LIST_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * The job id an envelope is about, as a number — or null when the payload does
 * not carry a usable one.
 *
 * `Number(data.job_id)` semantics, exactly as the guide describes: a JSON number
 * and a numeric string both count, while null/'' (which Number() would turn into
 * 0), a non-numeric string and a missing field do not.
 */
export function eventJobId(event: RealtimeEvent | null | undefined): number | null {
  const data = event?.data as { job_id?: unknown } | undefined;
  const raw = data?.job_id;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && Number.isInteger(raw) ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Does this envelope belong to the job the screen is showing?
 * `type` narrows the check to one event type when given.
 */
export function realtimeEventMatchesJob(
  event: RealtimeEvent | null | undefined,
  jobId: number | null | undefined,
  type?: string
): boolean {
  if (typeof jobId !== 'number' || !Number.isInteger(jobId) || jobId <= 0) return false;
  if (!event) return false;
  if (type !== undefined && event.type !== type) return false;
  const eventId = eventJobId(event);
  return eventId !== null && eventId === jobId;
}

/** A bid.created/updated/withdrawn envelope that belongs to this job. */
export function bidEventMatchesJob(
  event: RealtimeEvent | null | undefined,
  jobId: number | null | undefined
): boolean {
  if (!event || !isBidListEvent(event.type)) return false;
  return realtimeEventMatchesJob(event, jobId);
}

/**
 * The NEW bidding deadline advertised by `job.bidding_extended`, as epoch ms, or
 * null when the envelope is not that event for this job / carries no usable
 * timestamp. A deadline that is not in the future is refused: the countdown must
 * never be "extended" backwards.
 */
export function extendedBiddingEndsAt(
  event: RealtimeEvent | null | undefined,
  jobId: number | null | undefined,
  nowMs: number
): number | null {
  if (!realtimeEventMatchesJob(event, jobId, 'job.bidding_extended')) return null;
  const raw = (event?.data as { bidding_ends_at?: unknown } | undefined)?.bidding_ends_at;
  if (typeof raw !== 'string') return null;
  // parseApiIsoUtc: the backend's datetimes arrive marker-less from GET
  // (live-verified), so a marker-less EVENT stamp is UTC too — never local.
  const parsedDate = parseApiIsoUtc(raw);
  const parsed = parsedDate ? parsedDate.getTime() : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= nowMs) return null;
  return parsed;
}

/**
 * `job.bidding_extended` also reports how many times the timer has been restarted
 * (the window may be restarted at most 3 times). Kept as a number for the report
 * and the unit tests; the screen shows no counter of its own.
 */
export function extendedTimerRestartCount(event: RealtimeEvent | null | undefined): number | null {
  const raw = (event?.data as { timer_restart_count?: unknown } | undefined)?.timer_restart_count;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** What the "new offer" toast renders, built from the event's own data. */
export interface BidCreatedNotice {
  /** The new bid's id, when the envelope carried one. */
  bidId: number | null;
  /** The offered price, already formatted for the app's locale (EUR). */
  price: string;
  /** Arrival time parts, or null when the envelope carried no usable ETA. */
  eta: BidEtaParts | null;
}

/**
 * The toast content for a `bid.created` event — price in the app's locale and
 * the arrival-time parts the screen translates with its own `jobd_bid_eta_*`
 * keys. Returns null when the payload cannot produce a price, in which case the
 * screen shows no toast at all rather than a broken one.
 */
export function bidCreatedNoticeText(data: unknown, locale: BidLocale): BidCreatedNotice | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as { bid_id?: unknown; offered_price?: unknown; eta_minutes?: unknown };

  const price = formatBidPriceLocale(
    typeof record.offered_price === 'string' || typeof record.offered_price === 'number'
      ? record.offered_price
      : null,
    locale
  );
  if (price === null) return null;

  const etaMinutes =
    typeof record.eta_minutes === 'number' && Number.isFinite(record.eta_minutes)
      ? record.eta_minutes
      : null;

  return {
    bidId: typeof record.bid_id === 'number' && Number.isFinite(record.bid_id) ? record.bid_id : null,
    price,
    eta: bidEtaParts(etaMinutes),
  };
}

/**
 * One-shot guard for the jobs whose bidding window has closed.
 *
 * The server repeats `job.bidding_closed` every ~25 s for as long as the job is
 * OPEN with an expired window, so the reaction it triggers (re-reading the job so
 * the screen shows the backend's own closed state) must run once per window:
 * the first close returns true, every repeat returns false. A NEW window — an
 * extension, or a fresh load that shows bidding open again — re-arms it.
 */
export class BiddingClosedTracker {
  private readonly handled = new Set<number>();

  /** True exactly once per closed window; false for every repeat. */
  shouldRefetchOnClosed(jobId: number): boolean {
    if (this.handled.has(jobId)) return false;
    this.handled.add(jobId);
    return true;
  }

  /** A new window started for this job (extension or a still-open window). */
  noteWindowOpen(jobId: number): void {
    this.handled.delete(jobId);
  }

  /** Forget everything — the screen changed job or the account changed. */
  clear(): void {
    this.handled.clear();
  }
}

/** A monotonically increasing request id, so a slow reply cannot win. */
export interface RequestSequencer {
  /** Claim the id for a new request. */
  next(): number;
  /** True while this id is still the newest one claimed. */
  isCurrent(id: number): boolean;
  /** Abandon everything in flight (the job id changed, or the screen went away). */
  invalidate(): void;
}

/**
 * Stale-response protection for the offers list: every load claims an id and only
 * applies its result while that id is still the newest, so an older reply that
 * lands late can never overwrite a newer one, and changing job throws away
 * whatever was still in flight.
 */
export function createRequestSequencer(): RequestSequencer {
  let latest = 0;
  return {
    next(): number {
      latest += 1;
      return latest;
    },
    isCurrent(id: number): boolean {
      return id === latest;
    },
    invalidate(): void {
      latest += 1;
    },
  };
}

/**
 * Is the list behind live data? True whenever the socket is not open — the screen
 * then shows its non-blocking "reconnecting" notice and its safety-net refetch
 * runs. 'idle' counts as stale on purpose: the screen is on, realtime is not.
 */
export function isRealtimeStale(status: RealtimeStatus | null | undefined): boolean {
  return status !== 'open';
}
