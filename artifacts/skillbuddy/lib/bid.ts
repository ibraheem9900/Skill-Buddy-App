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
 *   5. status     — the five BidStatus values → translated labels, when a
 *                   status can still change, and "what happens next" for it.
 *
 *   6. my bid     — THIS provider's own bid on ONE job (GET /bids/mine): what a
 *                   404 does (and does not) mean, which server timestamp
 *                   belongs to which status, and which fields may be shown.
 *
 *   7. client     — the CLIENT's side of the same data: the job's incoming
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
  classifyJobActionFailure,
  isJobActionRefused,
  type JobActionFailure,
  type JobActionFailureKind,
} from '@/lib/jobAction';
import { isProviderRole, type JobActorRole } from '@/lib/jobStart';
import { isJobCancelled, isJobCompleted } from '@/lib/jobDetail';
import type {
  BidCreateRequest,
  BidRejectRequest,
  BidResponse,
  BidStatus,
  BidUpdateRequest,
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

/**
 * True only while the client has not decided yet. This is the ONE state worth
 * polling for: every other value is either an outcome (see isBidFinal) or an
 * enum the app does not know, and neither can become PENDING again.
 */
export function isBidPending(status: string | null | undefined): boolean {
  return status === 'PENDING';
}

/**
 * True for the four statuses that cannot change again — the client decided
 * (ACCEPTED/REJECTED), the provider took the offer back (WITHDRAWN) or the
 * window ended without a decision (EXPIRED). Used to stop the polling interval
 * and to stop promising anything else can happen. An UNKNOWN value is not
 * final: the app must not claim a story the enum has not told it.
 */
export function isBidFinal(status: string | null | undefined): boolean {
  return (
    status === 'ACCEPTED' ||
    status === 'REJECTED' ||
    status === 'WITHDRAWN' ||
    status === 'EXPIRED'
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * THIS PROVIDER'S OWN BID — GET /api/v1/jobs/{job_id}/bids/mine
 *
 * The response is ONE BidResponse (schema), but what the operation answers when
 * this provider has NOT bid is not in the schema. It was measured live:
 *
 *   no bid           404  {"detail":"You have not placed a bid on this job."}
 *   unknown job id   404  {"detail":"You have not placed a bid on this job."}
 *   non-integer id   422  detail[0] = int_parsing on ["path", "job_id"]
 *   no token         401  {"detail":"Not authenticated"}
 *
 * TWO CONSEQUENCES, both encoded below:
 *  1. 404 means "no bid" — and it is ALSO what a nonexistent job returns, so
 *     the status code alone cannot tell them apart. The job detail the screen
 *     already loads does (hooks/useJobDetail: 'notfound' vs 'ready'), which is
 *     why this lookup must never be read as "the job is gone".
 *  2. Every other failure (401, 403, 5xx, transport) means the question was NOT
 *     answered, so the answer is 'error' — never 'none'. Reading those as "no
 *     bid yet" is how a provider ends up sending a duplicate bid.
 * ══════════════════════════════════════════════════════════════════════════ */

/** What /bids/mine told us — three states, because "unknown" is not "none". */
export type MyBidLookup =
  | { state: 'exists'; bid: BidResponse }
  | { state: 'none' }
  /** Could not be established (offline / 5xx / 401 / unexpected 4xx). */
  | { state: 'error'; kind: JobActionFailureKind; message: string | null };

/** A bid is only usable if it is the object the schema promises. */
export function isUsableBidResponse(data: unknown): data is BidResponse {
  if (!data || typeof data !== 'object') return false;
  const bid = data as Partial<BidResponse>;
  return typeof bid.id === 'number' && typeof bid.status === 'string';
}

/**
 * A 200 body as a lookup result. A body that is not a usable bid is treated as
 * an ERROR rather than "no bid": the operation promises a BidResponse, so an
 * unusable one means the app cannot tell whether a bid exists, and the form
 * must not be offered on a guess.
 */
export function myBidLookupFromData(data: unknown): MyBidLookup {
  return isUsableBidResponse(data)
    ? { state: 'exists', bid: data }
    : { state: 'error', kind: 'server', message: null };
}

/** A rejected request as a lookup result — 404 is the only "no bid" answer. */
export function myBidLookupFromError(err: unknown): MyBidLookup {
  const failure = classifyJobActionFailure(err);
  if (failure.kind === 'notfound') return { state: 'none' };
  return { state: 'error', kind: failure.kind, message: failure.message };
}

/**
 * The one server timestamp that belongs to the CURRENT status, or null.
 *
 * The docs' own example fills accepted_at, rejected_at AND withdrawn_at on a
 * PENDING bid — proof that "non-null" is not "happened". So a stamp is shown
 * only when the status itself is the matching outcome, and the submitted time
 * (created_at) stays the always-present row instead of any of them.
 */
export type BidStampKind = 'accepted' | 'rejected' | 'withdrawn';

export type BidStampLabelKey =
  | 'jobd_bid_ts_accepted'
  | 'jobd_bid_ts_rejected'
  | 'jobd_bid_ts_withdrawn';

export interface BidStatusStamp {
  kind: BidStampKind;
  labelKey: BidStampLabelKey;
  /** The raw ISO timestamp; formatted by lib/jobDetail.formatDateTime. */
  value: string;
}

/** The three nullable timestamp fields a status can own. */
type BidStampField = 'accepted_at' | 'rejected_at' | 'withdrawn_at';

/** Only the three outcomes carry a stamp — PENDING/EXPIRED carry none. */
const BID_STATUS_STAMP: Partial<
  Record<BidStatus, { kind: BidStampKind; labelKey: BidStampLabelKey; field: BidStampField }>
> = {
  ACCEPTED: { kind: 'accepted', labelKey: 'jobd_bid_ts_accepted', field: 'accepted_at' },
  REJECTED: { kind: 'rejected', labelKey: 'jobd_bid_ts_rejected', field: 'rejected_at' },
  WITHDRAWN: { kind: 'withdrawn', labelKey: 'jobd_bid_ts_withdrawn', field: 'withdrawn_at' },
};

export function bidStatusStamp(
  bid: Pick<BidResponse, 'status' | 'accepted_at' | 'rejected_at' | 'withdrawn_at'> | null | undefined
): BidStatusStamp | null {
  if (!bid || typeof bid.status !== 'string') return null;
  const spec = BID_STATUS_STAMP[bid.status as BidStatus];
  if (!spec) return null;
  const value = bid[spec.field];
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return { kind: spec.kind, labelKey: spec.labelKey, value };
}

/**
 * The client's reason for rejecting this bid — and ONLY for a rejected bid. The
 * schema makes rejection_reason nullable and says nothing about when it is set,
 * so a PENDING bid carrying text (the docs' example does exactly that) shows
 * nothing.
 */
export function bidRejectionReason(
  bid: Pick<BidResponse, 'status' | 'rejection_reason'> | null | undefined
): string | null {
  if (!bid || bid.status !== 'REJECTED') return null;
  const reason = bid.rejection_reason;
  if (typeof reason !== 'string') return null;
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/* ────────────────────────────────────────── what happens next, per status ── */

export type BidNextStepKey =
  | 'jobd_bid_next_pending'
  | 'jobd_bid_next_accepted'
  | 'jobd_bid_next_rejected'
  | 'jobd_bid_next_withdrawn'
  | 'jobd_bid_next_expired';

const BID_NEXT_STEP: Record<BidStatus, BidNextStepKey> = {
  PENDING: 'jobd_bid_next_pending',
  ACCEPTED: 'jobd_bid_next_accepted',
  REJECTED: 'jobd_bid_next_rejected',
  WITHDRAWN: 'jobd_bid_next_withdrawn',
  EXPIRED: 'jobd_bid_next_expired',
};

/** The one exported action for the Withdraw Bid feature, wired through canWithdrawBid. */
export const WITHDRAW_BID_ACTION_KEY: unique symbol = Symbol('withdrawBidAction');


/**
 * The translated "what happens next" line for a status, or null for a value the
 * app does not know (nothing is promised about an unknown enum).
 *
 * Wording rules: each line states only what the module spec says happens in
 * that state — pending waits for the client, accepted means the client chose
 * this provider (payment still pending before the job is assigned), rejected
 * means another provider was picked, withdrawn means the provider took it back.
 * EXPIRED has no spec copy of its own, so it says exactly what the enum means
 * and nothing more.
 */
export function bidNextStepKey(status: string | null | undefined): BidNextStepKey | null {
  if (typeof status !== 'string') return null;
  return BID_NEXT_STEP[status as BidStatus] ?? null;
}

/**
 * Whether the provider may still ask the backend to WITHDRAW this bid (POST
 * /api/v1/jobs/{job_id}/bids/{bid_id}/withdraw). The gate is the same class of
 * decision the rest of the module makes from the schema plus the module spec, never
 * from a status code we have not verified: only THIS provider's own PENDING bid,
 * while the job's bidding window is still open, may be withdrawn. Everything else is a
 * decided outcome or a lapsed window, and no action is offered that the backend would
 * refuse.
 *
 * The bid id that goes into the path always comes from the bid the server sent (e.g.
 * the "Your bid" card), never from user input, so a provider can only ever address
 * their own bid. That id is validated for the path by isValidBidId() at the network
 * layer before the request is built.
 *
 * This is a pure shape/eligibility helper: it says whether the screen MAY OFFER the
 * Withdraw bid action. Whether the action actually succeeded, and what copy to show on
 * each failure, belong in the hooks/screen that call the endpoint once it exists —
 * this module is intentionally NOT the one that invents that wording.
 */
export function canWithdrawBid(
  bid: Pick<BidResponse, 'status'> | null | undefined,
  job: Pick<JobResponse, 'is_bidding_open' | 'status'> | null | undefined,
  role: JobActorRole | null | undefined
): boolean {
  if (!isProviderRole(role)) return false;
  if (!bid || !job) return false;
  if (bid.status !== 'PENDING') return false;
  return isBiddingOpen(job);
}

/* ══════════════════════════════════════════════════════════════════════════
 * PROVIDER SIDE — Modify Bid (PUT /api/v1/jobs/{job_id}/bids/{bid_id})
 *
 * WHAT WAS MEASURED LIVE. The operation documents only 200 and 422, and no bid
 * existed to edit (the backend refuses a bid on your own job, and the only job
 * owned by another client has a closed bidding window), so the cases below are
 * everything that did NOT need a bid:
 *
 *   someone else's / unknown bid id, or an unknown job
 *       404 {"detail":"Bid not found."}   — and the BODY IS VALIDATED FIRST:
 *                                            {"offered_price":0} against that
 *                                            same unknown bid answers 422
 *                                            greater_than on ["body","offered_price"]
 *   non-integer ids     422 with TWO entries (path job_id and path bid_id)
 *   no token            401 {"detail":"Not authenticated"}
 *
 * EDITABILITY comes from the schema plus the module spec, never from a status
 * code: the provider may change their OWN bid while it is still PENDING and the
 * job's window is still open. Everything else is a decided outcome or a lapsed
 * window, and no action is offered that the backend would refuse. That rule
 * could not be exercised live (see above) and is covered by unit tests instead.
 * ══════════════════════════════════════════════════════════════════════════ */

/** A bid id must be a real integer >= 1, the same rule a job id follows. */
export function isValidBidId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * Whether the "Edit bid" action may be OFFERED: the PROVIDER role, a bid that is
 * still PENDING, and a job whose bidding window the backend still reports open.
 * The bid id itself always comes from the bid the server sent, never from user
 * input, so a provider can only ever address their own bid.
 */
export function canEditBid(
  bid: Pick<BidResponse, 'status'> | null | undefined,
  job: Pick<JobResponse, 'is_bidding_open' | 'status'> | null | undefined,
  role: JobActorRole | null | undefined
): boolean {
  if (!isProviderRole(role)) return false;
  if (!bid || !job) return false;
  if (bid.status !== 'PENDING') return false;
  return isBiddingOpen(job);
}

/** The values the edit sheet holds while the provider works on them. */
export interface BidDraft {
  /** The price as typed — the same field and the same validators as Create Bid. */
  price: string;
  etaHours: number;
  etaMinutes: number;
  message: string;
}

/** 'text' → text, '' / null / whitespace → null. One rule for every comparison. */
function trimmedOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Prefill the sheet from the bid the server sent. The price is written in the
 * unambiguous dot form (`26.75`), NOT with the device's locale separator: both
 * are accepted, but a dot means a value the provider never touches is re-parsed
 * as exactly the amount it was. An unparseable price prefills EMPTY, which
 * leaves Save disabled until a real price is typed.
 */
export function bidDraftFromBid(
  bid: Pick<BidResponse, 'offered_price' | 'eta_minutes' | 'message'>
): BidDraft {
  const price = parseBidPrice(bid.offered_price);
  const eta =
    typeof bid.eta_minutes === 'number' && Number.isFinite(bid.eta_minutes)
      ? Math.max(0, Math.min(BID_ETA_MAX_MINUTES, Math.trunc(bid.eta_minutes)))
      : 0;
  return {
    price: price === null ? '' : price.toFixed(2),
    etaHours: Math.floor(eta / 60),
    etaMinutes: eta % 60,
    message: typeof bid.message === 'string' ? bid.message : '',
  };
}

/** The draft's price in INTEGER CENTS, or null when it is not a usable amount. */
export function bidDraftPriceCents(draft: Pick<BidDraft, 'price'>): number | null {
  const trimmed = (draft.price ?? '').trim();
  if (trimmed.length === 0) return null;
  const hasComma = trimmed.includes(',');
  // Both separators at once is ambiguous — the same refusal validateBidPrice makes.
  if (hasComma && trimmed.includes('.')) return null;
  const cents = parseCents(hasComma ? trimmed.replace(',', '.') : trimmed);
  if (cents === null || cents <= 0) return null;
  return cents;
}

/** The draft's total minutes, clamped to the schema's 0..1440. */
export function bidDraftEtaMinutes(
  draft: Pick<BidDraft, 'etaHours' | 'etaMinutes'>
): number {
  const hours = Number.isFinite(draft.etaHours) ? Math.max(0, Math.trunc(draft.etaHours)) : 0;
  const minutes = Number.isFinite(draft.etaMinutes) ? Math.max(0, Math.trunc(draft.etaMinutes)) : 0;
  return Math.min(hours * 60 + minutes, BID_ETA_MAX_MINUTES);
}

/**
 * Whether the draft really differs from the bid on the server, compared at the
 * level the wire uses: money in INTEGER CENTS (so "25.5", "25,50" and a stored
 * "25.50" are the same €25.50), the time in whole minutes, and the message
 * trimmed with '' and null both meaning "no message". A whitespace-only edit is
 * therefore NOT a change and the Save button stays disabled.
 */
export function hasBidDraftChanged(
  bid: Pick<BidResponse, 'offered_price' | 'eta_minutes' | 'message'> | null | undefined,
  draft: BidDraft
): boolean {
  if (!bid) return false;
  const storedPrice = parseBidPrice(bid.offered_price);
  const storedCents =
    storedPrice === null ? null : Math.round(storedPrice * 100);
  if (storedCents !== bidDraftPriceCents(draft)) return true;

  const storedEta =
    typeof bid.eta_minutes === 'number' && Number.isFinite(bid.eta_minutes)
      ? Math.max(0, Math.min(BID_ETA_MAX_MINUTES, Math.trunc(bid.eta_minutes)))
      : 0;
  if (storedEta !== bidDraftEtaMinutes(draft)) return true;

  return trimmedOrNull(bid.message) !== trimmedOrNull(draft.message);
}

/** Whether every field of the draft passes the SAME validators Create Bid runs. */
export function isBidDraftValid(draft: BidDraft): boolean {
  const price = validateBidPrice(draft.price);
  const eta = validateEtaMinutes(String(bidDraftEtaMinutes(draft)));
  const message = validateBidMessage(draft.message);
  return price.ok && eta.ok && message.ok;
}

/* ───────────────────────────────────────────── quick adjust (−10 … +10) ── */

/**
 * The spec's quick-adjust chips. THE UNIT IS CONFIRMED BY THE PRODUCT OWNER:
 * EURO amounts, not percentages — the spec's own wording is "suggest a
 * discounted price", and the price the provider typed is a euro amount. The
 * order is the spec's own (−5, −10, +10, +5 is its listing order; they are
 * rendered −10, −5, +5, +10 so the pair reads left to right).
 */
export const BID_ADJUST_STEPS = [-10, -5, 5, 10] as const;

/** The lowest price a chip may produce — the schema's exclusiveMinimum 0. */
export const BID_MIN_PRICE = 0.01;

/**
 * Move the price by `deltaEuros` (± 5 / ± 10) and return the new field text in
 * the same dot form the field is prefilled with. The result is clamped to the
 * schema's window: never below €0.01 and never above the price ceiling the
 * validators use. A chip pressed on an EMPTY or unparseable field starts from
 * zero rather than refusing, so the button never looks broken — a negative chip
 * then lands on the €0.01 minimum.
 */
export function adjustBidPrice(priceInput: string, deltaEuros: number): string {
  const base = bidDraftPriceCents({ price: priceInput }) ?? 0;
  const next = base + Math.round(deltaEuros * 100);
  const clamped = Math.min(Math.max(next, Math.round(BID_MIN_PRICE * 100)), MAX_PRICE_ABS * 100);
  return (clamped / 100).toFixed(2);
}

/** Whether a chip would change anything: a −10 chip on €0.05 cannot. */
export function canApplyBidAdjust(priceInput: string, deltaEuros: number): boolean {
  const base = bidDraftPriceCents({ price: priceInput }) ?? 0;
  return adjustBidPrice(priceInput, deltaEuros) !== (base / 100).toFixed(2);
}

/**
 * A chip's own label, in the app's locale: "−10 €" where the symbol trails and
 * "-€10" in English. Money is formatted by hand for the same reason
 * formatBidPriceLocale is (identical output under Hermes and under the test
 * runner), and the sign is the ASCII minus/plus so no font can turn it into a
 * hyphen that looks like a dash.
 */
export function formatAdjustChipLabel(deltaEuros: number, locale: BidLocale): string {
  const fmt = LOCALE_NUMBER_FORMAT[locale] ?? LOCALE_NUMBER_FORMAT.en;
  const sign = deltaEuros < 0 ? '-' : '+';
  const amount = String(Math.abs(Math.round(deltaEuros)));
  return fmt.symbolFirst ? `${sign}€${amount}` : `${sign}${amount}${fmt.gap}€`;
}

/**
 * The chips are the spec's answer to ONE situation: the client restarted the
 * bidding timer, so a provider who already bid can sharpen their offer instead
 * of the job simply lapsing. VERIFIED LIVE that JobResponse carries the field —
 * `timer_restart_count` is an integer, 0 on a never-restarted job and 1 on a job
 * restarted once. Anything else (missing, non-numeric, 0) hides the chips.
 */
export function shouldOfferBidAdjust(
  job: Pick<JobResponse, 'timer_restart_count'> | null | undefined
): boolean {
  const count = job?.timer_restart_count;
  return typeof count === 'number' && Number.isFinite(count) && count > 0;
}

/* ─────────────────────────────────────── the PUT body + its failure copy ── */

/**
 * The PUT body (BidUpdate). ALL THREE fields are sent even though the live
 * schema requires none of them and allows a partial update: an unchanged field
 * then simply re-states the server's own value, so the request is valid under
 * any merge rule the backend uses. The price is the NUMBER derived from integer
 * cents (never a long binary fraction), eta is whole minutes in 0..1440, and an
 * empty message is sent as null — exactly the way Create Bid sends it.
 *
 * Only called with a draft that already passed the three validators.
 */
export function buildBidUpdateRequest(draft: BidDraft): BidUpdateRequest {
  const cents = bidDraftPriceCents(draft);
  const message = validateBidMessage(draft.message);
  return {
    offered_price: cents === null ? null : cents / 100,
    eta_minutes: bidDraftEtaMinutes(draft),
    message: message.ok ? message.value : null,
  };
}

export type BidUpdateErrorKey =
  | 'jobd_edit_err_invalid'
  | 'jobd_edit_err_notallowed'
  | 'jobd_edit_err_forbidden'
  | 'jobd_edit_err_notfound'
  | 'jobd_edit_err_server'
  | 'jobd_edit_err_network';

/**
 * Translated copy per bucket for a failed Modify Bid. `unauthorized` is absent
 * for the same reason as in the submit path: it never reaches the screen, the
 * caller sends the provider to login. A 404 covers the measured
 * "Bid not found." (a bid that is not this provider's, or no longer exists), and
 * 400/409 share the "can no longer be changed" copy — but the backend's own
 * `detail` always wins when it sent one, so nothing here guesses WHICH happened.
 */
export function bidUpdateErrorKey(kind: JobActionFailureKind): BidUpdateErrorKey {
  switch (kind) {
    case 'invalid':
      return 'jobd_edit_err_invalid';
    case 'badrequest':
    case 'conflict':
      return 'jobd_edit_err_notallowed';
    case 'forbidden':
      return 'jobd_edit_err_forbidden';
    case 'notfound':
      return 'jobd_edit_err_notfound';
    case 'network':
      return 'jobd_edit_err_network';
    default:
      return 'jobd_edit_err_server';
  }
}

/**
 * The body copy for a failed Modify Bid: the backend's own message when it sent
 * one, otherwise the translated copy for the bucket. The 403 is the ONE
exception, exactly as in the submit path: VERIFIED LIVE that an inactive
 * provider is refused with "Only approved, active providers can bid on jobs.",
 * which states the rule rather than the situation — and activation is never the
 * app's decision — so a 403 always renders the app's own actionable line.
 */
export function bidUpdateFailureMessage(
  failure: Pick<JobActionFailure, 'kind' | 'message'>,
  translate: (key: BidUpdateErrorKey) => string
): string {
  if (failure.kind === 'forbidden') return translate('jobd_edit_err_forbidden');
  return failure.message ?? translate(bidUpdateErrorKey(failure.kind));
}

/**
 * Whether an incoming answer is OLDER than the bid already on screen. A poll
 * that was in flight when the provider saved can land after the save; rendering
 * it would quietly restore the pre-save price. Compared by `updated_at` — the
 * response's own stamp — and only for the SAME bid: a different id is not
 * "stale", it is a different object and the caller decides about it.
 *
 * An unparseable stamp on either side is treated as NOT stale, so a malformed
 * timestamp can never freeze the screen on old data.
 */
export function isStaleBid(
  incoming: Pick<BidResponse, 'id' | 'updated_at'> | null | undefined,
  current: Pick<BidResponse, 'id' | 'updated_at'> | null | undefined
): boolean {
  if (!incoming || !current) return false;
  if (incoming.id !== current.id) return false;
  const next = Date.parse(incoming.updated_at);
  const previous = Date.parse(current.updated_at);
  if (!Number.isFinite(next) || !Number.isFinite(previous)) return false;
  return next < previous;
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

/* ══════════════════════════════════════════════════════════════════════════
 * CLIENT SIDE — Accept Bid
 * POST /api/v1/jobs/{job_id}/bids/{bid_id}/accept
 *
 * WHAT THE LIVE OPENAPI SAYS (read from /openapi.json, not from Swagger's
 * generated example): the operation is PROTECTED, has TWO required integer PATH
 * parameters and **no `requestBody` at all**, and documents only 200 (the full
 * BidResponse, no envelope) and 422.
 *
 * MEASURED LIVE (the part that needs no bid by another provider): no token → 401
 * `{"detail":"Not authenticated"}`; GET on the path → 405; non-integer ids →
 * 422 int_parsing on ["path", "job_id"] / ["path", "bid_id"]; an unknown bid id
 * AND an unknown job id BOTH answer 404 `{"detail":"Bid not found."}` — so a 404
 * here does not distinguish "no such job" from "no such offer".
 *
 * NOT VERIFIED LIVE, and the module says so rather than pretending: the happy
 * path needs TWO accounts — one that owns the job and a DIFFERENT one that bid on
 * it — because the backend refuses a bid on your own job
 * (`{"detail":"You cannot bid on your own job."}`), and this environment has a
 * single test account. So the gate below, the job status an accept produces and
 * the fate of the other bids are derived from the live schemas plus the module
 * spec, and every one of them is reported as UNVERIFIED.
 *
 * WHAT THE GATE IS, AND WHY IT IS NOT `isBiddingOpen`: the flag means the bidding
 * WINDOW is still open (a provider may still submit), and the window closing is
 * precisely when it becomes the client's turn to choose. Gating the accept on it
 * would hide the action exactly then, so this gate uses the job's STATUS (`OPEN`)
 * plus "nobody is assigned yet" and "not cancelled/completed".
 *
 * IRREVERSIBLE WITHOUT THE CANCELLATION MODULE (a separate task, not connected
 * here), which is why the caller must confirm first and why the price-change
 * safeguard below re-reads the offer before the request is sent.
 * ══════════════════════════════════════════════════════════════════════════ */

/** The one job status in which a client may still pick one of the offers. */
export const ACCEPT_BID_JOB_STATUS = 'OPEN' as const;

/**
 * Whether this job is still in the state where the CLIENT may DECIDE about its
 * incoming offers — accept one (below) or decline one (the reject section): the
 * backend reports it OPEN, nobody is assigned yet, and it is neither cancelled
 * nor completed. An unknown/absent job is NOT eligible — the app never offers an
 * action against state it could not read.
 *
 * ONE predicate governs BOTH decisions on purpose: once a provider has been
 * selected the other offers are closed, so declining would be as meaningless as
 * accepting, and two separate gates could drift apart. The accept gate
 * (isJobAcceptEligible) and the decline gate (canRejectBid) both call this.
 */
export function isJobBidDecisionEligible(
  job:
    | Pick<JobResponse, 'status' | 'assigned_provider_id' | 'cancelled_at' | 'completed_at'>
    | null
    | undefined
): boolean {
  if (!job) return false;
  if (job.status !== ACCEPT_BID_JOB_STATUS) return false;
  if (job.assigned_provider_id != null) return false;
  if (isJobCancelled(job)) return false;
  if (isJobCompleted(job)) return false;
  return true;
}

/** The accept path's own name for the same predicate. */
export function isJobAcceptEligible(
  job:
    | Pick<JobResponse, 'status' | 'assigned_provider_id' | 'cancelled_at' | 'completed_at'>
    | null
    | undefined
): boolean {
  return isJobBidDecisionEligible(job);
}

/**
 * Whether the "Accept bid" action may be OFFERED for one offer: the CLIENT side,
 * a bid that is still PENDING, and an eligible job. When both ids are present the
 * bid must also belong to THIS job, so a bid id from another job can never be
 * posted to this path.
 */
export function canAcceptBid(
  bid: Pick<BidResponse, 'id' | 'job_id' | 'status'> | null | undefined,
  job:
    | Pick<JobResponse, 'id' | 'status' | 'assigned_provider_id' | 'cancelled_at' | 'completed_at'>
    | null
    | undefined,
  role: JobActorRole | null | undefined
): boolean {
  if (role !== 'CLIENT') return false;
  if (!bid || !job) return false;
  if (bid.status !== 'PENDING') return false;
  if (typeof bid.job_id === 'number' && typeof job.id === 'number' && bid.job_id !== job.id) {
    return false;
  }
  return isJobAcceptEligible(job);
}

/** The bid with this id in a bids response (either array), or null. */
export function bidById(
  response: JobBidsResponse | null | undefined,
  bidId: number | null | undefined
): BidResponse | null {
  if (typeof bidId !== 'number') return null;
  return allBids(response).find((bid) => bid.id === bidId) ?? null;
}

/** A price as a comparable token: a normalised amount, or the raw text. */
function comparablePrice(raw: string | number | null | undefined): string {
  const parsed = parseBidPrice(raw);
  return parsed === null ? `raw:${String(raw ?? '')}` : `num:${parsed.toFixed(2)}`;
}

/**
 * Whether a freshly re-read bid is still exactly the offer the confirmation is
 * showing: the same id, price, expected time and `updated_at` stamp.
 *
 * This is the PRICE-CHANGE SAFEGUARD. A provider may edit (or withdraw) their bid
 * while the client reads the dialog, so the accept is only sent when the offer
 * under the client's finger is still the offer the server holds. `updated_at` is
 * compared as well as the values on purpose: a provider who edits and changes a
 * value back still edited the bid, and the client must see it again before an
 * irreversible decision is taken on their behalf.
 */
export function bidSelectionMatches(
  shown: Pick<BidResponse, 'id' | 'offered_price' | 'eta_minutes' | 'updated_at'> | null | undefined,
  fresh: Pick<BidResponse, 'id' | 'offered_price' | 'eta_minutes' | 'updated_at'> | null | undefined
): boolean {
  if (!shown || !fresh) return false;
  if (shown.id !== fresh.id) return false;
  if (comparablePrice(shown.offered_price) !== comparablePrice(fresh.offered_price)) return false;
  if (shown.eta_minutes !== fresh.eta_minutes) return false;
  return shown.updated_at === fresh.updated_at;
}

/**
 * Whether a job re-read AFTER a failed accept shows that the pick already went
 * through.
 *
 * A request that produced no response may still have been processed, and this
 * action cannot be taken back, so a blind retry is the wrong move: the caller
 * re-reads the job and, when it is no longer eligible for a pick, reports that
 * outcome instead of offering "Try again". A null `refetched` (the re-read itself
 * failed) claims nothing in either direction.
 */
export function acceptResolvedAfterResync(
  refetched:
    | Pick<JobResponse, 'status' | 'assigned_provider_id' | 'cancelled_at' | 'completed_at'>
    | null
    | undefined
): boolean {
  if (!refetched) return false;
  return !isJobAcceptEligible(refetched);
}

/**
 * The job's scheduled span as ISO instants, from its MILESTONES: `first` is the
 * earliest and `last` the latest (sorted by instant, not by array position). Null
 * when the job has no usable milestone.
 *
 * The accept dialog states the date/time the client is committing to: a ONE_TIME
 * job has a single milestone and shows one date, a MULTI_DAY job spans several and
 * both ends are shown instead of pretending it is one appointment.
 */
export function milestoneScheduleRange(
  job: Pick<JobResponse, 'milestones'> | null | undefined
): { first: string; last: string } | null {
  const stamps = (job?.milestones ?? [])
    .map((milestone) => milestone?.scheduled_at)
    .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  if (stamps.length === 0) return null;
  return { first: stamps[0], last: stamps[stamps.length - 1] };
}

/* ─────────────────────────────────────────── Accept failures → copy ── */

/**
 * The buckets this flow reports: the shared transport/HTTP kinds plus the two the
 * client-side re-read can produce — `stale` (the bid is gone or no longer
 * PENDING) and `changed` (it was edited, so the dialog must be re-confirmed).
 */
export type AcceptBidFailureKind = JobActionFailureKind | 'stale' | 'changed';

export type AcceptBidErrorKey =
  | 'cbids_accept_err_invalid'
  | 'cbids_accept_err_notallowed'
  | 'cbids_accept_err_forbidden'
  | 'cbids_accept_err_notfound'
  | 'cbids_accept_changed'
  | 'cbids_accept_err_server'
  | 'cbids_accept_err_network';

/**
 * True for the buckets that mean "the server refused because of the current
 * state" (the bid is not pending any more, someone was already picked, the job is
 * not open). They share the same copy and force a re-read of the job/bids, unlike
 * a transport failure.
 */
export function isAcceptNotAllowed(kind: AcceptBidFailureKind): boolean {
  return kind === 'badrequest' || kind === 'conflict' || kind === 'stale';
}

/**
 * Translated copy per bucket. `unauthorized` is absent because it never reaches
 * the UI: a 401 that survived the shared client's refresh sends the user to
 * login, the same rule every other job/bid action follows.
 */
export function acceptBidErrorKey(kind: AcceptBidFailureKind): AcceptBidErrorKey {
  switch (kind) {
    case 'invalid':
      return 'cbids_accept_err_invalid';
    case 'badrequest':
    case 'conflict':
    case 'stale':
      return 'cbids_accept_err_notallowed';
    case 'changed':
      return 'cbids_accept_changed';
    case 'forbidden':
      return 'cbids_accept_err_forbidden';
    case 'notfound':
      return 'cbids_accept_err_notfound';
    case 'network':
      return 'cbids_accept_err_network';
    default:
      return 'cbids_accept_err_server';
  }
}

/**
 * The copy for a failure: the backend's own readable text when it sent one (a 422
 * `detail[].msg`, or a plain-string `detail` such as "You cannot bid on your own
 * job."), otherwise the translated line for the bucket.
 */
export function acceptBidFailureMessage(
  failure: { kind: AcceptBidFailureKind; message: string | null },
  translate: (key: AcceptBidErrorKey) => string
): string {
  return failure.message ?? translate(acceptBidErrorKey(failure.kind));
}

/**
 * Whether the screen must re-read the job and the bids after a failure.
 *
 * A refusal means the state the screen gated on is stale — that is WHY the
 * backend said no — and a `changed`/`stale` answer is a fact about the offer, so
 * in all of them the screen re-syncs instead of guessing. A 422 stays out (the
 * path id itself was rejected, so re-reading changes nothing), and so do 5xx and
 * transport failures; the transport case has its own re-read rule
 * (acceptResolvedAfterResync) because there the request may have gone through.
 */
export function shouldResyncAfterAcceptFailure(kind: AcceptBidFailureKind): boolean {
  return (
    isAcceptNotAllowed(kind) ||
    kind === 'changed' ||
    kind === 'forbidden' ||
    kind === 'notfound'
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * CLIENT SIDE — Decline (Reject) Bid
 * POST /api/v1/jobs/{job_id}/bids/{bid_id}/reject
 *
 * WHAT THE LIVE OPENAPI SAYS (read from /openapi.json): the operation is
 * PROTECTED, takes TWO required integer PATH parameters, REQUIRES an
 * `application/json` body (BidRejectRequest — "required" is about the body
 * OBJECT: it declares no `required` array, so `reason` itself is optional and
 * nullable, `string maxLength 255`), and documents only 200 (the full
 * BidResponse, no envelope) and 422.
 *
 * MEASURED LIVE (everything that does NOT need a real bid by another provider —
 * this environment has one account, and the backend refuses a bid on your own
 * job, so no such row exists):
 *
 *   no token            401 {"detail":"Not authenticated"}
 *   GET on the path     405 {"detail":"Method Not Allowed"}
 *   non-integer ids     422 int_parsing on ["path","job_id"] / ["path","bid_id"]
 *   unknown job, job_id 0, or ANOTHER USER's job
 *                       404 {"detail":"Job not found."}
 *   unknown bid, bid_id 0 on a real job
 *                       404 {"detail":"Bid not found."}
 *   NO body at all      422 {"type":"missing","loc":["body"]}
 *   `{}` / reason null / reason ""   accepted (validation falls through to the
 *                       404 row lookup, i.e. the body is legal)
 *   reason 256 chars    422 string_too_long on ["body","reason"]
 *   reason not a string 422 string_type on ["body","reason"]
 *
 * TWO THINGS THIS MEASUREMENT SETTLES, both of which the Swagger UI's generated
 * example gets wrong: `reason` is NOT required, and a wrong USER is reported as
 * `Job not found.` (404) rather than a 403 — this endpoint does distinguish the
 * job row from the bid row, unlike accept, which answers "Bid not found." for
 * both. So the app can tell the user which of the two is gone, and no 403 copy is
 * ever claimed to have been observed.
 *
 * NOT VERIFIED LIVE, and reported as such rather than pretended: the 200 itself,
 * the status the returned bid carries (the enum says REJECTED — the response is
 * adopted and never assumed), and what the backend answers for a bid that is
 * already WITHDRAWN/REJECTED/ACCEPTED or on a job that has moved on. All of those
 * need a real bid row by a second account.
 *
 * NO PRE-FLIGHT RE-READ, UNLIKE ACCEPT. Accepting commits the client to one
 * provider and cannot be taken back, so it re-reads the offer before sending.
 * Declining commits to nothing: the only thing a race can produce is a refusal
 * (the bid was withdrawn, already decided, or the job moved on), and that refusal
 * has its own copy plus a re-read of the list. So the confirm goes straight to the
 * wire — one request, no second round-trip, and nothing to confirm again.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Mirrors `BidRejectRequest.reason`: `maxLength: 255`. There is no minimum. */
export const BID_REJECT_REASON_MAX_CHARS = 255;

export type BidRejectReasonErrorKey = 'cbids_reject_err_reason_long';

export type BidRejectReasonValidation =
  | { ok: true; value: string | null }
  | { ok: false; errorKey: BidRejectReasonErrorKey };

/**
 * Validate the OPTIONAL reason. The contract declares no minLength and no enum,
 * and the deployed backend accepted `{}`, `{"reason":null}` and `{"reason":""}`,
 * so blank is valid (it becomes null) and only the 255-character cap can fail.
 * Padding is trimmed first, so 255 characters of whitespace is not "long".
 */
export function validateBidRejectReason(
  input: string | null | undefined
): BidRejectReasonValidation {
  const trimmed = (input ?? '').trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > BID_REJECT_REASON_MAX_CHARS) {
    return { ok: false, errorKey: 'cbids_reject_err_reason_long' };
  }
  return { ok: true, value: trimmed };
}

/**
 * Build the REQUIRED body. A blank reason is sent as `null` — the schema's own
 * nullable shape — rather than an empty string, and the text is trimmed so
 * padding cannot reach the stored rejection reason.
 *
 * Called only once validateBidRejectReason has passed, so an over-long reason can
 * never be sent.
 */
export function buildBidRejectRequest(reason: string | null | undefined): BidRejectRequest {
  const trimmed = (reason ?? '').trim();
  return { reason: trimmed.length > 0 ? trimmed : null };
}

/**
 * Whether the "Decline" action may be OFFERED for one offer: the CLIENT side, a
 * bid that is still PENDING, an eligible job (isJobBidDecisionEligible — the SAME
 * gate the accept uses), and — when both ids are present — a bid that belongs to
 * THIS job, so a bid id from another job can never be posted to this path.
 *
 * The provider's own screens never call this, so no provider ever sees the
 * action; the check is on the role rather than on "is this the job's client"
 * because the app's active role is what decides which side is looking at the
 * screen.
 */
export function canRejectBid(
  bid: Pick<BidResponse, 'id' | 'job_id' | 'status'> | null | undefined,
  job:
    | Pick<JobResponse, 'id' | 'status' | 'assigned_provider_id' | 'cancelled_at' | 'completed_at'>
    | null
    | undefined,
  role: JobActorRole | null | undefined
): boolean {
  if (role !== 'CLIENT') return false;
  if (!bid || !job) return false;
  if (bid.status !== 'PENDING') return false;
  if (typeof bid.job_id === 'number' && typeof job.id === 'number' && bid.job_id !== job.id) {
    return false;
  }
  return isJobBidDecisionEligible(job);
}

/**
 * The buckets this flow reports: the shared transport/HTTP kinds. There is no
 * `stale`/`changed` bucket here because declining does no pre-flight re-read and
 * never needs re-confirming.
 */
export type RejectBidFailureKind = JobActionFailureKind;

export type RejectBidErrorKey =
  | 'cbids_reject_err_invalid'
  | 'cbids_reject_err_notallowed'
  | 'cbids_reject_err_forbidden'
  | 'cbids_reject_err_notfound'
  | 'cbids_reject_err_server'
  | 'cbids_reject_err_network';

/**
 * True for the buckets that mean "the server refused because of the current
 * state" (the bid is not pending any more, someone was already picked, the job
 * moved on). They share one copy and force a re-read of the list, unlike a
 * transport failure.
 */
export function isRejectNotAllowed(kind: RejectBidFailureKind): boolean {
  return kind === 'badrequest' || kind === 'conflict';
}

/**
 * Translated copy per bucket. `unauthorized` is absent because it never reaches
 * the UI: a 401 that survived the shared client's refresh sends the user to
 * login, the same rule every other job/bid action follows.
 */
export function rejectBidErrorKey(kind: RejectBidFailureKind): RejectBidErrorKey {
  switch (kind) {
    case 'invalid':
      return 'cbids_reject_err_invalid';
    case 'badrequest':
    case 'conflict':
      return 'cbids_reject_err_notallowed';
    case 'forbidden':
      return 'cbids_reject_err_forbidden';
    case 'notfound':
      return 'cbids_reject_err_notfound';
    case 'network':
      return 'cbids_reject_err_network';
    default:
      return 'cbids_reject_err_server';
  }
}

/**
 * The copy for a failure: the backend's own readable text when it sent one (the
 * measured `"Bid not found."` / `"Job not found."`, or a 422 `detail[].msg`),
 * otherwise the translated line for the bucket — so the server's exact reason for
 * refusing reaches the client as worded.
 */
export function rejectBidFailureMessage(
  failure: { kind: RejectBidFailureKind; message: string | null },
  translate: (key: RejectBidErrorKey) => string
): string {
  return failure.message ?? translate(rejectBidErrorKey(failure.kind));
}

/**
 * Whether the screen must re-read the offers after a failure.
 *
 * A refusal means the state the screen gated on is stale — that is WHY the
 * backend said no — so the list is re-synced instead of leaving a card on screen
 * that can no longer be acted on. A 422 stays out (the path id, or the typed
 * reason, was rejected — re-reading changes nothing), and so do 5xx and transport
 * failures: there the request may still have gone through, and the caller keeps
 * the bid visible with a retry (the next refresh then reports the truth, because
 * a REJECTED bid is not client-visible — see filterClientVisibleBids).
 */
export function shouldResyncAfterRejectFailure(kind: RejectBidFailureKind): boolean {
  return isRejectNotAllowed(kind) || isJobActionRefused(kind);
}

/**
 * Pull the server's message for the `reason` field out of a 422 `detail[]`, so a
 * rejected reason is shown ON the reason input instead of as a generic failure.
 *
 * FastAPI reports a body field as `loc: ["body", "reason"]` (measured live for
 * both `string_too_long` and `string_type`). Returns null when the response had
 * no detail array or said nothing about `reason` — the caller then falls back to
 * the bucket copy, so a malformed 422 degrades gracefully.
 */
export function bidRejectReasonFieldError(
  detail: ValidationErrorDetail[] | null | undefined
): string | null {
  if (!Array.isArray(detail)) return null;
  for (const entry of detail) {
    if (!entry || !Array.isArray(entry.loc)) continue;
    if (entry.loc.some((part) => part === 'reason') && entry.msg) return entry.msg;
  }
  return null;
}

