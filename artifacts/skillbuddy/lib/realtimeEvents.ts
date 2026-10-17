/**
 * Realtime protocol types — the server -> client half of the shared WebSocket
 * layer (see the backend team's "Frontend Integration Guide: Real-time Bidding
 * and Nearby Bookings", 13 Oct 2026).
 *
 * Nothing here touches React, the network or storage: it is the envelope shape,
 * the discriminated event union and the validator, so every rule below can be
 * pinned by the project's dependency-free test harness (`pnpm run test`).
 *
 * THE ENVELOPE (every server -> client message):
 *   { "type": string, "data": object, "timestamp": UTC ISO-8601 string }
 *
 * The bidding/nearby events below carry documented payloads. The MONEY events
 * (`payment.*`, `invoice.*`, `escrow.*`, `wallet.credit_earned`) are named by the
 * guide but their payloads are NOT documented, so they are typed with an open
 * data object and every field is read through a safe accessor in
 * lib/moneyEvents.ts. Anything the guide does not name at all still lands in the
 * `unknown` branch and is ignored by consumers until a shape is published.
 *
 * MONEY: every money-like value in this protocol is a decimal STRING
 * (`offered_price`). It is typed as `string` on purpose — no float maths here.
 */

import { isMoneyEventType, type MoneyEventType } from './moneyEvents';

export type { MoneyEventType };

/** Data of a money event: undocumented, so an open object read through accessors. */
export type MoneyEventData = Record<string, unknown>;

/**
 * The events that only arrive for jobs sent with `watch_job`. Every other
 * documented event is user-targeted: it is delivered to the signed-in user's
 * socket whether or not anything is watched.
 */
export const JOB_SCOPED_EVENT_TYPES = ['job.bidding_extended', 'job.bidding_closed'] as const;

/** True when the event is only delivered for a job this socket watched. */
export function requiresJobWatch(type: string): boolean {
  return (JOB_SCOPED_EVENT_TYPES as readonly string[]).includes(type);
}

/* ------------------------------------------------------------------ payloads */

/** `bid.created`, `bid.updated` — `offered_price` is a decimal STRING. */
export interface BidOfferData {
  job_id: number;
  bid_id: number;
  provider_id: number;
  /** Decimal string — never parsed into a float for storage or maths. */
  offered_price: string;
  eta_minutes: number | null;
  total_score: number | null;
}

/** `bid.withdrawn`. */
export interface BidWithdrawnData {
  job_id: number;
  bid_id: number;
  provider_id: number;
}

/** `bid.accepted`. */
export interface BidAcceptedData {
  job_id: number;
  bid_id: number;
}

/** `bid.rejected` — `reason` may be null. */
export interface BidRejectedData {
  job_id: number;
  bid_id: number;
  reason: string | null;
}

/** `job.bidding_extended`. */
export interface JobBiddingExtendedData {
  job_id: number;
  bidding_ends_at: string;
  request_type: string;
  timer_restart_count: number;
}

/** `job.bidding_closed`. */
export interface JobBiddingClosedData {
  job_id: number;
}

/** `job.nearby_opened`. */
export interface JobNearbyOpenedData {
  job_id: number;
  service_id: number;
  category_id: number;
  title: string;
  request_type: string;
  bidding_ends_at: string;
  distance_km: number;
  matches_skill: boolean;
}

/** `job.nearby_closed`. */
export interface JobNearbyClosedData {
  job_id: number;
}

/* -------------------------------------------------------------------- events */

/** type string -> documented data shape (money events carry the open shape). */
export interface BidAndJobRealtimeEventData {
  'bid.created': BidOfferData;
  'bid.updated': BidOfferData;
  'bid.withdrawn': BidWithdrawnData;
  'bid.accepted': BidAcceptedData;
  'bid.rejected': BidRejectedData;
  'job.bidding_extended': JobBiddingExtendedData;
  'job.bidding_closed': JobBiddingClosedData;
  'job.nearby_opened': JobNearbyOpenedData;
  'job.nearby_closed': JobNearbyClosedData;
}

/** The nine bidding/nearby events (everything except the money events). */
export type BidAndJobRealtimeEventType = keyof BidAndJobRealtimeEventData;

/** Every event type the guide documents, bidding and money together. */
export type KnownRealtimeEventType = BidAndJobRealtimeEventType | MoneyEventType;

export type KnownRealtimeEventData = BidAndJobRealtimeEventData & {
  [Type in MoneyEventType]: MoneyEventData;
};

/**
 * The documented events as a discriminated union on `type`: narrowing on
 * `event.type` types `event.data` for that exact event.
 */
export type KnownRealtimeEvent = {
  [Type in KnownRealtimeEventType]: {
    type: Type;
    data: KnownRealtimeEventData[Type];
    timestamp: string;
  };
}[KnownRealtimeEventType];

/**
 * The fallback branch: a well-formed envelope whose `type` is not one of the
 * documented strings (mentions of `payment.*`, `invoice.*`, `escrow.*`,
 * `wallet.credit_earned`, or anything the backend adds later).
 */
export interface UnknownRealtimeEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

/**
 * Every event a consumer can receive. The envelope is only validated for
 * `type`/`data`/`timestamp` shape — an event is never dropped just because its
 * type string is undocumented, it lands in the unknown branch.
 *
 * Because the union carries an open `type`, prefer narrowing through
 * {@link isKnownRealtimeEvent}, which keeps `data` precisely typed per event.
 */
export type RealtimeEvent = KnownRealtimeEvent | UnknownRealtimeEvent;

/** Narrow an event to the documented union (drops the unknown branch). */
export function isKnownRealtimeEvent(event: RealtimeEvent): event is KnownRealtimeEvent {
  return isMoneyEventType(event.type) || Object.prototype.hasOwnProperty.call(BID_JOB_EVENT_TYPES, event.type);
}

/** Runtime mirror of {@link BidAndJobRealtimeEventType}. */
const BID_JOB_EVENT_TYPES: Record<BidAndJobRealtimeEventType, true> = {
  'bid.created': true,
  'bid.updated': true,
  'bid.withdrawn': true,
  'bid.accepted': true,
  'bid.rejected': true,
  'job.bidding_extended': true,
  'job.bidding_closed': true,
  'job.nearby_opened': true,
  'job.nearby_closed': true,
};

/**
 * Validate one raw socket message into a {@link RealtimeEvent}.
 *
 * Returns null (the caller ignores the message silently) when:
 *   - the payload is not a string (binary frames, `Blob`, undefined…),
 *   - it is not valid JSON,
 *   - it is not a JSON object,
 *   - `type` is missing or not a non-empty string,
 *   - `data` is missing or not a plain object.
 *
 * `timestamp` is passed through as an empty string when the server omits it:
 * a missing timestamp is not enough reason to throw away a real event.
 */
export function parseRealtimeEnvelope(raw: unknown): RealtimeEvent | null {
  if (typeof raw !== 'string') return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return null;

  const envelope = decoded as { type?: unknown; data?: unknown; timestamp?: unknown };
  if (typeof envelope.type !== 'string' || envelope.type.length === 0) return null;
  if (typeof envelope.data !== 'object' || envelope.data === null || Array.isArray(envelope.data)) {
    return null;
  }

  return {
    type: envelope.type,
    data: envelope.data as Record<string, unknown>,
    timestamp: typeof envelope.timestamp === 'string' ? envelope.timestamp : '',
  } as RealtimeEvent;
}
