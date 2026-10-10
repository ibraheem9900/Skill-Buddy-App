/**
 * bid.ts
 *
 * Pure rules behind the Bidding & Request flow (Modules 4B / 4C / 4D):
 *
 *   1. money      — parse/format the wire's NUMERIC STRINGS and validate what
 *                   the provider types into the Submit Bid form.
 *   2. eta        — the 0..1440-minute window BidCreate enforces, and the
 *                   human copy for it.
 *   3. gate       — whether this provider may bid on this job at all.
 *   4. submit     — the BidCreate body, the 422 field mapping and the failure
 *                   buckets.
 *   5. status     — the five BidStatus values → translated labels.
 *
 *   6. client     — the CLIENT's side of the same data: the job's incoming
 *                   offers (GET /jobs/{job_id}/bids), which of them a client
 *                   may see, the display order, and locale-aware money/distance.
 *
 * SCOPE: the PROVIDER SUBMIT path plus the CLIENT READ path (module 4D's
 * "Recommended SkillBuddies" / "View All Offers" list). The score-display
 * helper and the −5/−10/+5/+10 suggestion helper are NOT here and the score
 * fields are never read — they are admin data, so they are neither shown to
 * the provider nor to the client.
 *
 * No React and no axios here, so every rule above is unit-testable.
 *
 * ── WHY MONEY IS PARSED, NOT Number()'d ────────────────────────────────────
 * BidResponse.offered_price is a STRING (the schema types it `string`, unlike
 * the REQUEST's number|string), and distance_km is a nullable numeric string.
 * The OpenAPI pattern `^(?!^[-+.]*$)[+-]?0*\d*\.?\d*$` allows unbounded leading
 * zeros, and the docs' example generator emits 300-digit values, so a raw
 * Number() is both lossy and exploitable. parseBidPrice mirrors the guards
 * lib/servicePrice.parseServicePrice applies to service prices (same 15-char
 * limit, same €1bn sanity bound) — kept local so this module stays free of the
 * '@/hooks/...' import that parseAmountSpent lives behind, which would make it
 * unusable from the dependency-free test runner.
 *
 * ── THE SCORE FIELDS ARE NEVER READ ────────────────────────────────────────
 * BidResponse carries distance_score … total_score and is_recommended, but they
 * are internal ranking data for the client dashboard and admin, so nothing in
 * this module reads them and the provider's screen never renders them.
 */

import {
  isJobActionRefused,
  type JobActionFailure,
  type JobActionFailureKind,
} from '@/lib/jobAction';
import { isProviderRole, type JobActorRole } from '@/lib/jobStart';
import type {
  BidCreateRequest,
  BidResponse,
  BidStatus,
  JobBidsResponse,
  JobResponse,
  ValidationErrorDetail,
} from '@/types';

/** Re-exported so a caller has one import for the whole Submit Bid flow. */
export { isValidJobId } from '@/lib/jobPublish';

/* ───────────────────────────────────────────────────────────────── money ─── */

/** The schema's pattern allows unbounded leading zeros; no real price is long. */
const MAX_PRICE_INPUT_CHARS = 15;
/** Above this, `toFixed()` switches to exponential notation — reject instead. */
const MAX_PRICE_ABS = 1e9;
/** offered_price carries at most 2 decimals (cents). */
export const BID_PRICE_MAX_DECIMALS = 2;
function isUsableNumber(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n) <= MAX_PRICE_ABS;
}

/**
 * A numeric string / number as a real number, or null when absent or unusable.
 * Rejects the docs' absurd generator values and anything non-finite.
 */
export function parseBidPrice(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') return isUsableNumber(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PRICE_INPUT_CHARS) return null;
  const n = Number(trimmed);
  return isUsableNumber(n) ? n : null;
}

/**
 * A price as EUR with exactly 2 decimals — "€12.50". null when there is nothing
 * usable, so a card omits the money row rather than printing "€NaN".
 */
export function formatBidPrice(raw: string | number | null | undefined): string | null {
  const n = parseBidPrice(raw);
  return n === null ? null : `€${n.toFixed(2)}`;
}

/**
 * Cents as an integer, so arithmetic never accumulates float error.
 *
 * ONE tolerant parser serves the whole price path, so the validator can never
 * disagree with itself: a leading dot (".75") and a trailing dot ("12.") are the
 * SAME amount a user means by 75c and €12, and an empty string, a bare dot or
 * more than 2 decimals are all rejected. Splitting this into two rules once made
 * the validator accept ".75" while the cents parser rejected it.
 */
function parseCents(value: string): number | null {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) return null;
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (whole === '' && fraction === '') return null;
  if (fraction.length > BID_PRICE_MAX_DECIMALS) return null;
  const cents = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0') || '0');
  return Number.isSafeInteger(cents) ? cents : null;
}

export type BidFormErrorKey =
  | 'bid_err_price_required'
  | 'bid_err_price_invalid'
  | 'bid_err_price_positive'
  | 'bid_err_price_decimals'
  | 'bid_err_price_too_large'
  | 'bid_err_eta_required'
  | 'bid_err_eta_invalid'
  | 'bid_err_eta_range'
  | 'bid_err_message_too_long';

export type BidValidation<T> = { ok: true; value: T } | { ok: false; errorKey: BidFormErrorKey };

/**
 * Validate the Submit Bid price and return the NUMBER to send on the wire.
 *
 * BidCreate.offered_price accepts `number` (exclusiveMinimum 0) or a numeric
 * string, and the app sends the NUMBER rounded to 2 decimals: a float that has
 * already been rounded to cents is exact, whereas a string leaves the backend
 * to parse untrusted text. The value is derived from integer cents, so it is
 * never a long binary fraction.
 *
 * SEPARATORS. The Baltic/German locales type a comma decimal separator, so one
 * separator or the other is accepted and normalised to a dot. Both at once
 * ("1.234,56") is ambiguous and refused. A comma is ONLY read as a decimal
 * point when the field holds no dot, so "1,500" becomes 1.500 — three decimals,
 * which is an explicit "decimals" ERROR, never a silent €1.50. That matters:
 * guessing there would let a provider underbid by three orders of magnitude.
 *
 * 0 and negatives are refused (BidCreate requires > 0) and more than 2 decimals
 * is an error rather than a silent round — the provider must see what the
 * backend will actually receive. Whitespace is trimmed.
 */
export function validateBidPrice(
  input: string,
  options: { maxPrice?: number } = {}
): BidValidation<number> {
  const trimmed = (input ?? '').trim();
  if (trimmed.length === 0) return { ok: false, errorKey: 'bid_err_price_required' };

  const hasComma = trimmed.includes(',');
  const hasDot = trimmed.includes('.');
  if (hasComma && hasDot) return { ok: false, errorKey: 'bid_err_price_invalid' };
  const normalised = hasComma ? trimmed.replace(',', '.') : trimmed;

  const match = /^(\d*)(?:\.(\d*))?$/.exec(normalised);
  if (!match || (match[1] === '' && (match[2] ?? '') === '')) {
    return { ok: false, errorKey: 'bid_err_price_invalid' };
  }
  if ((match[2] ?? '').length > BID_PRICE_MAX_DECIMALS) {
    return { ok: false, errorKey: 'bid_err_price_decimals' };
  }

  const cents = parseCents(normalised);
  if (cents === null || cents <= 0) return { ok: false, errorKey: 'bid_err_price_positive' };

  const max = options.maxPrice ?? MAX_PRICE_ABS;
  if (cents / 100 > max) return { ok: false, errorKey: 'bid_err_price_too_large' };

  return { ok: true, value: cents / 100 };
}

/** BidCreate.eta_minutes is an integer 0..1440 (24 h). */
export const BID_ETA_MAX_MINUTES = 1440;

export function validateEtaMinutes(input: string): BidValidation<number> {
  const trimmed = (input ?? '').trim();
  if (trimmed.length === 0) return { ok: false, errorKey: 'bid_err_eta_required' };
  if (!/^\d+$/.test(trimmed)) return { ok: false, errorKey: 'bid_err_eta_invalid' };
  const minutes = Number(trimmed);
  if (!Number.isSafeInteger(minutes)) return { ok: false, errorKey: 'bid_err_eta_invalid' };
  if (minutes < 0 || minutes > BID_ETA_MAX_MINUTES) {
    return { ok: false, errorKey: 'bid_err_eta_range' };
  }
  return { ok: true, value: minutes };
}

/**
 * BidCreate.message is capped at 1000 characters — the spec and the LIVE schema
 * agree on this one (`anyOf: [string maxLength 1000, null]`), so the constant is
 * the schema's own limit rather than a product rule the app invented.
 *
 * The field is optional: BidCreate's `required` list is only
 * [offered_price, eta_minutes], and the schema explicitly allows null.
 */
export const BID_MESSAGE_MAX_CHARS = 1000;

export function validateBidMessage(input: string): BidValidation<string | null> {
  const trimmed = (input ?? '').trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > BID_MESSAGE_MAX_CHARS) {
    return { ok: false, errorKey: 'bid_err_message_too_long' };
  }
  return { ok: true, value: trimmed };
}

/* ──────────────────────────────────────────────────────────────── status ─── */

export type BidStatusLabelKey =
  | 'bid_status_pending'
  | 'bid_status_accepted'
  | 'bid_status_rejected'
  | 'bid_status_withdrawn'
  | 'bid_status_expired';

const BID_STATUS_LABEL: Record<BidStatus, BidStatusLabelKey> = {
  PENDING: 'bid_status_pending',
  ACCEPTED: 'bid_status_accepted',
  REJECTED: 'bid_status_rejected',
  WITHDRAWN: 'bid_status_withdrawn',
  EXPIRED: 'bid_status_expired',
};

/**
 * The translated label for a bid status, or null for an unrecognised value.
 * An unknown enum is OMITTED rather than printed raw, the same rule the job
 * status chip follows.
 */
export function bidStatusLabelKey(status: string | null | undefined): BidStatusLabelKey | null {
  if (typeof status !== 'string') return null;
  return BID_STATUS_LABEL[status as BidStatus] ?? null;
}

/* ─────────────────────────────────────── the provider's Submit Bid gate ── */

/**
 * Whether the job's bidding window is open, judged ONLY from the backend's own
 * fields: `is_bidding_open` must be true AND the status must still be OPEN.
 *
 * Neither test is redundant. `is_bidding_open` is a derived flag the backend owns
 * (it can be false while a job is OPEN, e.g. once a provider is assigned), and a
 * status of OPEN alone would ignore a window the backend has already closed. A
 * missing/undefined flag is treated as CLOSED, never as "probably open".
 */
export function isBiddingOpen(
  job: Pick<JobResponse, 'is_bidding_open' | 'status'> | null | undefined
): boolean {
  if (!job) return false;
  return job.is_bidding_open === true && job.status === 'OPEN';
}

/**
 * Whether the "Place a Bid" action may be OFFERED: the PROVIDER role AND a job
 * whose bidding window is open AND that no provider is assigned to yet.
 *
 * The assignment check is not decoration: once the client has picked someone the
 * job's window is over for everyone else, and the spec says the job then
 * disappears for the other providers — the nearest the app can get to that
 * without a provider feed is to stop offering the form and say why.
 */
export function canProviderSubmitBid(
  job:
    | Pick<JobResponse, 'assigned_provider_id' | 'is_bidding_open' | 'status'>
    | null
    | undefined,
  role: JobActorRole | null | undefined
): boolean {
  if (!isProviderRole(role)) return false;
  if (!job) return false;
  if (job.assigned_provider_id != null) return false;
  return isBiddingOpen(job);
}

/**
 * The POST body (BidCreate). `message` is sent as null rather than omitted when
 * the provider wrote nothing: the schema types it `string | null`, so null is an
 * explicit "no message" while a missing key relies on the backend's default.
 *
 * Only called with values that have already passed the three validators above.
 */
export function buildBidCreateRequest(
  offeredPrice: number,
  etaMinutes: number,
  message: string | null
): BidCreateRequest {
  return { offered_price: offeredPrice, eta_minutes: etaMinutes, message };
}

/* ───────────────────────────────────────── 422 detail → the right input ── */

/** Exactly the three BidCreate property names. */
export type BidFieldName = 'offered_price' | 'eta_minutes' | 'message';

/**
 * The server's own message for one request field out of a 422 `detail[]`, so a
 * rejected price/time/message is shown ON that input instead of as a generic
 * failure.
 *
 * FastAPI reports a BODY field as loc ["body", "<field>"], so the match is a
 * `some` over the loc parts rather than an index — the app must not depend on a
 * position the schema does not promise.
 */
export function bidFieldError(
  detail: ValidationErrorDetail[] | null | undefined,
  field: BidFieldName
): string | null {
  if (!Array.isArray(detail)) return null;
  for (const entry of detail) {
    if (!entry || !Array.isArray(entry.loc)) continue;
    if (entry.loc.some((part) => String(part) === field) && entry.msg) return entry.msg;
  }
  return null;
}

/* ─────────────────────────────────────────────── failure copy buckets ── */

export type BidSubmitErrorKey =
  | 'jobd_bid_err_invalid'
  | 'jobd_bid_err_notallowed'
  | 'jobd_bid_err_forbidden'
  | 'jobd_bid_err_notfound'
  | 'jobd_bid_err_server'
  | 'jobd_bid_err_network';

/**
 * Translated copy per bucket. `unauthorized` is absent on purpose: it never
 * reaches the screen (the caller sends the provider to login, the same rule the
 * other job actions follow). 400 and 409 share the "no longer allowed" copy,
 * which is what a duplicate bid or a closed window tends to be — but the
 * backend's own `detail` always wins when it sent one, so nothing here guesses
 * at WHICH of those it was.
 *
 * `forbidden` is the bucket that is NOT left to the backend's wording — see
 * bidSubmitFailureMessage below.
 */
export function bidSubmitErrorKey(kind: JobActionFailureKind): BidSubmitErrorKey {
  switch (kind) {
    case 'invalid':
      return 'jobd_bid_err_invalid';
    case 'badrequest':
    case 'conflict':
      return 'jobd_bid_err_notallowed';
    case 'forbidden':
      return 'jobd_bid_err_forbidden';
    case 'notfound':
      return 'jobd_bid_err_notfound';
    case 'network':
      return 'jobd_bid_err_network';
    default:
      return 'jobd_bid_err_server';
  }
}

/**
 * The body copy for a failed submit: the backend's own message when it sent one
 * (a 422 `detail[].msg`, or a plain-string `detail`), otherwise the translated
 * copy for the bucket.
 *
 * ONE DELIBERATE EXCEPTION — the 403 `forbidden` bucket. VERIFIED LIVE against
 * the deployed backend: POST /jobs/{job_id}/bids answers a provider whose
 * profile has is_active=false with
 * `403 {"detail":"Only approved, active providers can bid on jobs."}`.
 * That sentence states the rule but not the situation, and activation is a
 * backend/admin decision this app must never make on the provider's behalf — so
 * the 403 always renders our own actionable copy ("your account is not activated
 * yet") instead of the backend's line. Every other bucket still prefers the
 * backend's wording verbatim, so a message we did not anticipate still reaches
 * the provider unchanged.
 */
export function bidSubmitFailureMessage(
  failure: Pick<JobActionFailure, 'kind' | 'message'>,
  translate: (key: BidSubmitErrorKey) => string
): string {
  if (failure.kind === 'forbidden') return translate('jobd_bid_err_forbidden');
  return failure.message ?? translate(bidSubmitErrorKey(failure.kind));
}

/**
 * True for the buckets that mean "the backend refused" — 400/403/409 plus any
 * other refusal. These are the cases where the screen's own gating may be stale
 * (the window closed, someone else was picked, a bid already exists), so the
 * caller re-reads the job and its bid afterwards. A 422 stays out: it means the
 * TYPED values were rejected, which re-reading cannot fix.
 */
export function shouldResyncAfterBidFailure(kind: JobActionFailureKind): boolean {
  // 400 joins the shared refusal buckets here because "you already have a bid" /
  // "bidding is closed" are exactly the stale-state refusals this screen gates on.
  if (kind === 'badrequest') return true;
  return isJobActionRefused(kind);
}

/* ────────────────────────────────────────────────── ETA → human copy ── */

export type BidEtaParts =
  /** eta 0 — "right now", a real answer rather than a missing value. */
  | { kind: 'now' }
  /** Under an hour: minutes only. */
  | { kind: 'minutes'; minutes: number }
  /** An hour or more: hours and the remaining minutes. */
  | { kind: 'hours'; hours: number; minutes: number };

/**
 * Split eta_minutes for translation. The schema documents ETA as "Estimated
 * time of arrival, in minutes" (0..1440), i.e. how long until the provider can
 * arrive — NOT the duration of the job, which is what the spec's own provider
 * column calls it. The schema wins; see the report's spec-gap note.
 *
 * Returns null for anything unusable (absent, negative, non-integer, over 24 h)
 * so the caller omits the row rather than printing a wrong time.
 */
export function bidEtaParts(minutes: number | null | undefined): BidEtaParts | null {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return null;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > BID_ETA_MAX_MINUTES) return null;
  if (minutes === 0) return { kind: 'now' };
  if (minutes < 60) return { kind: 'minutes', minutes };
  return { kind: 'hours', hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

/* ══════════════════════════════════════════════════════════════════════════
 * CLIENT SIDE — one job's incoming offers
 * (GET /api/v1/jobs/{job_id}/bids → JobBidsResponse)
 *
 * DISPLAY ONLY. Nothing here re-scores or re-ranks: the backend already splits
 * and orders the list (schema JobBidsResponse — "the top 3 scores as Recommended
 * SkillBuddies, the rest behind View All Offers"), and the seven score fields
 * are never read, so no score can leak onto the client's screen.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The app's five languages (context/LanguageContext). Declared as a plain union
 * rather than imported: pulling the React context in here would make this module
 * unusable from the dependency-free test runner it is compiled by.
 */
export type BidLocale = 'en' | 'de' | 'et' | 'lv' | 'lt';

/**
 * Per-locale number layout, written out instead of delegated to Intl so the
 * exact same characters are produced by Node in the unit tests and by Hermes on
 * the device — a locale-aware Intl build is not guaranteed to agree, and money
 * is not the place to find out at runtime.
 *
 *   en          "€12.50"        (symbol first, dot decimal)
 *   de/et/lv/lt "12,50 €"       (symbol last, comma decimal)
 */
const LOCALE_NUMBER_FORMAT: Record<
  BidLocale,
  { decimal: string; group: string; symbolFirst: boolean; gap: string }
> = {
  en: { decimal: '.', group: ',', symbolFirst: true, gap: '' },
  de: { decimal: ',', group: '.', symbolFirst: false, gap: ' ' },
  et: { decimal: ',', group: ' ', symbolFirst: false, gap: ' ' },
  lv: { decimal: ',', group: ' ', symbolFirst: false, gap: ' ' },
  lt: { decimal: ',', group: ' ', symbolFirst: false, gap: ' ' },
};

/** Thousands separators, applied left of the decimal point. */
function groupThousands(intPart: string, separator: string): string {
  if (intPart.length <= 3) return intPart;
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/**
 * A price as EUR in the app's own locale, or null when there is nothing usable
 * (a card then omits the money rather than printing "€NaN"). Precision comes
 * from parseBidPrice, so the docs' absurd generator values are rejected here
 * exactly as they are everywhere else in this module.
 */
export function formatBidPriceLocale(
  raw: string | number | null | undefined,
  locale: BidLocale
): string | null {
  const n = parseBidPrice(raw);
  if (n === null) return null;
  const fmt = LOCALE_NUMBER_FORMAT[locale] ?? LOCALE_NUMBER_FORMAT.en;
  const [whole, fraction] = Math.abs(n).toFixed(2).split('.');
  const amount = `${groupThousands(whole, fmt.group)}${fmt.decimal}${fraction}`;
  const sign = n < 0 ? '-' : '';
  return fmt.symbolFirst ? `${sign}€${amount}` : `${sign}${amount}${fmt.gap}€`;
}

/**
 * distance_km as a non-negative number, or null. It is a NULLABLE numeric
 * STRING in the schema (same unconstrained pattern as offered_price, and null
 * means "unknown", not zero), so it gets the same length/absurdity guards.
 */
export function parseBidDistance(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PRICE_INPUT_CHARS) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE_ABS) return null;
  return n;
}

/**
 * A distance in kilometres, one decimal at most, in the app's locale
 * ("1,5" in de/et/lv/lt, "1.5" in en). Whole kilometres lose the .0 so a card
 * reads "3 km" rather than "3,0 km". Null when the value is absent/unusable.
 */
export function formatBidDistanceLocale(
  raw: string | null | undefined,
  locale: BidLocale
): string | null {
  const n = parseBidDistance(raw);
  if (n === null) return null;
  const fmt = LOCALE_NUMBER_FORMAT[locale] ?? LOCALE_NUMBER_FORMAT.en;
  const rounded = Math.round(n * 10) / 10;
  const fixed = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  const [whole, fraction] = fixed.split('.');
  const amount = fraction
    ? `${groupThousands(whole, fmt.group)}${fmt.decimal}${fraction}`
    : groupThousands(whole, fmt.group);
  return `${amount} km`;
}

/* ────────────────────────────────────────────────── what the client sees ── */

/**
 * The BidStatus values a client is shown on this screen: the live bids and the
 * one that was accepted. REJECTED, WITHDRAWN and EXPIRED are hidden — the
 * provider took the offer back, or it lapsed, and neither is an offer the client
 * can still act on. The five values are the full BidStatus enum (live schema).
 */
export const CLIENT_VISIBLE_BID_STATUSES = ['PENDING', 'ACCEPTED'] as const;

export function isClientVisibleBid(
  bid: Pick<BidResponse, 'status'> | null | undefined
): boolean {
  if (!bid) return false;
  return (CLIENT_VISIBLE_BID_STATUSES as readonly string[]).includes(bid.status);
}

/** Keep only the bids this screen may render, preserving the server's order. */
export function filterClientVisibleBids(
  bids: ReadonlyArray<BidResponse | null | undefined>
): BidResponse[] {
  return bids.filter((bid): bid is BidResponse => !!bid && isClientVisibleBid(bid));
}

/**
 * Every bid in the response with the recommended block first — the order the
 * backend established. A bid id appearing in both arrays is kept once; the split
 * is made server-side, so de-duplicating here is defence rather than expectation.
 */
export function allBids(response: JobBidsResponse | null | undefined): BidResponse[] {
  if (!response) return [];
  const seen = new Set<number>();
  const out: BidResponse[] = [];
  const both = [...(response.recommended ?? []), ...(response.other_offers ?? [])];
  for (const bid of both) {
    if (!bid || typeof bid.id !== 'number' || seen.has(bid.id)) continue;
    seen.add(bid.id);
    out.push(bid);
  }
  return out;
}

/**
 * The server's own count. It is authoritative — the arrays can legitimately be
 * shorter than total_bids (hidden statuses, or a page the response did not
 * include) — and only falls back to the visible length when the field is
 * missing or malformed.
 */
export function totalBidCount(response: JobBidsResponse | null | undefined): number {
  const total = response?.total_bids;
  if (typeof total === 'number' && Number.isFinite(total) && total >= 0) {
    return Math.trunc(total);
  }
  return allBids(response).length;
}

/* ─────────────────────────────────────────────────── sorting the full list ── */

/**
 * The full list's sort chips. `api` is the default and means "leave the
 * backend's order alone" (highest total score first) — the app never exposes a
 * score-sorted option the client could misread as a score UI.
 */
export const BID_SORT_IDS = [
  'api',
  'price_asc',
  'rating_desc',
  'distance_asc',
  'badges_desc',
] as const;

export type BidSortId = (typeof BID_SORT_IDS)[number];

export type BidSortLabelKey =
  | 'cbids_sort_default'
  | 'cbids_sort_price'
  | 'cbids_sort_rating'
  | 'cbids_sort_distance'
  | 'cbids_sort_badges';

export const BID_SORT_LABEL_KEY: Record<BidSortId, BidSortLabelKey> = {
  api: 'cbids_sort_default',
  price_asc: 'cbids_sort_price',
  rating_desc: 'cbids_sort_rating',
  distance_asc: 'cbids_sort_distance',
  badges_desc: 'cbids_sort_badges',
};

/** A comparable number for a sort key, or null when the value is unusable. */
function sortValue(bid: BidResponse, sort: BidSortId): number | null {
  switch (sort) {
    case 'price_asc':
      return parseBidPrice(bid.offered_price);
    case 'rating_desc': {
      const rating = bid.provider?.star_rating;
      return typeof rating === 'number' && Number.isFinite(rating) ? rating : null;
    }
    case 'distance_asc':
      return parseBidDistance(bid.distance_km);
    case 'badges_desc': {
      const badges = bid.provider?.badge_count;
      return typeof badges === 'number' && Number.isFinite(badges) ? badges : null;
    }
    default:
      return null;
  }
}

/**
 * Sort a copy of the list by one of the chips. Local sorting of what the API
 * returned — no re-fetch, no re-scoring.
 *
 * A bid whose key value is unusable (an unparseable price, a null distance)
 * always sorts LAST, and equal values keep the backend's order: Array.prototype
 * sort is stable, so the server's ranking is never disturbed by a tie.
 */
export function sortBids(bids: ReadonlyArray<BidResponse>, sort: BidSortId): BidResponse[] {
  const copy = [...bids];
  if (sort === 'api') return copy;
  const descending = sort === 'rating_desc' || sort === 'badges_desc';
  return copy.sort((a, b) => {
    const left = sortValue(a, sort);
    const right = sortValue(b, sort);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    if (left === right) return 0;
    if (descending) return right - left;
    return left - right;
  });
}
