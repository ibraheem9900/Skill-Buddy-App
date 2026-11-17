/**
 * Job reviews — pure helpers behind the ONE review form.
 *
 * DOCUMENTED CONTRACT (POST /api/v1/jobs/{job_id}/reviews, verified against the
 * live OpenAPI schema on 2026-11-15):
 *
 *   JobReviewCreate  { rating: int 1..5 (REQUIRED),
 *                      option_ids?: int[] (max 20),
 *                      comment?: string | null (max 2000),
 *                      show_publicly?: bool (default false) }
 *   JobReviewResponse (201) { id, job_id, author_side, provider_profile_id,
 *                      client_profile_id, rating, selected_options,
 *                      comment, show_publicly, status, published_at,
 *                      attachments, created_at }
 *
 * Measured live:
 *   rating 0  → 422 {loc:["body","rating"], type:"greater_than_equal", ctx:{ge:1}}
 *   rating 6  → 422 {loc:["body","rating"], type:"less_than_equal", ctx:{le:5}}
 *   job OPEN  → 400 {"detail":"A job can be reviewed once it is closed."}
 *   job 99999 → 404 {"detail":"Job not found."}
 *   no token  → 401
 *
 * UNKNOWN (never invented here): 409 for a second review, the exact wording for
 * "the 7-day window is over", and whether the pending/reviews list endpoints
 * need query params. Those stay stubs in services/feedback.ts.
 */
import type { FeedbackContext, FeedbackOption, FeedbackRole } from '@/lib/feedback';

export type ReviewRole = FeedbackRole;

/** Option context per author side. Verified against the API description. */
export type ReviewContextByRole = Record<ReviewRole, FeedbackContext>;

/**
 * THE one mapping between who is writing and which option list is loaded.
 * The API documents CLIENT_REVIEW for the client and PROVIDER_REVIEW for the
 * provider, so the constant mirrors that — flip a value here if the admin
 * labels ever turn out to be addressed to the wrong side.
 */
export const reviewContextForRole: ReviewContextByRole = {
  CLIENT: 'CLIENT_REVIEW',
  PROVIDER: 'PROVIDER_REVIEW',
};

export function reviewContext(role: ReviewRole): FeedbackContext {
  return reviewContextForRole[role];
}

/** Star bounds, taken from the live schema (minimum 1, maximum 5). */
export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const RATING_VALUES: readonly number[] = [1, 2, 3, 4, 5];

/** Schema limit for the comment (2000). The UI's own soft cap is lower. */
export const REVIEW_COMMENT_LIMIT = 2000;
/** Counter/typing cap for the comment box — the server allows more than this. */
export const REVIEW_COMMENT_MAX = 500;
/** Schema limit for option_ids (maxItems 20). */
export const REVIEW_OPTION_LIMIT = 20;

/** The request body, exactly as documented. */
export interface ReviewPayload {
  rating: number;
  option_ids: number[];
  comment: string;
  show_publicly: boolean;
}

/** Everything the form holds while the user fills the review in. */
export interface ReviewDraft {
  rating: number;
  optionIds: number[];
  comment: string;
  otherText: string;
  showPublicly: boolean;
}

export type ReviewProblem = 'rating' | 'other' | 'comment';

/* ── Selection ───────────────────────────────────────────────────────────── */

/** Multi-select toggle, capped at the schema's maxItems. */
export function toggleReviewOption(optionIds: readonly number[], id: number): number[] {
  if (optionIds.includes(id)) return optionIds.filter((value) => value !== id);
  if (optionIds.length >= REVIEW_OPTION_LIMIT) return [...optionIds];
  return [...optionIds, id];
}

/**
 * The selected `is_other` option, if any. Only ONE "other" text box is shown
 * even when several selected options are flagged, because the API has no
 * per-option free-text field: the text becomes part of the comment.
 */
export function selectedOtherOption(
  options: readonly FeedbackOption[],
  optionIds: readonly number[]
): FeedbackOption | null {
  return options.find((option) => option.is_other && optionIds.includes(option.id)) ?? null;
}

/* ── Comment ─────────────────────────────────────────────────────────────── */

/**
 * The comment that is actually sent. The "tell us more" text for an `is_other`
 * option is prepended because the API has no field for it — one comment string
 * carries both, "other" text first (it explains the tick), the free comment
 * after it. Trimmed, capped at the documented 2000 characters.
 */
export function reviewComment(draft: Pick<ReviewDraft, 'comment' | 'otherText'>): string {
  const other = draft.otherText.trim();
  const comment = draft.comment.trim();
  const merged = other.length === 0 ? comment : comment.length === 0 ? other : `${other}\n\n${comment}`;
  return merged.slice(0, REVIEW_COMMENT_LIMIT);
}

/** What blocks Submit, in the order the user meets the fields. */
export function reviewProblem(
  draft: ReviewDraft,
  options: readonly FeedbackOption[]
): ReviewProblem | null {
  if (!(draft.rating >= RATING_MIN && draft.rating <= RATING_MAX)) return 'rating';
  const other = selectedOtherOption(options, draft.optionIds);
  if (other && draft.otherText.trim().length === 0) return 'other';
  if (reviewComment(draft).length > REVIEW_COMMENT_LIMIT) return 'comment';
  return null;
}

export function reviewCanSubmit(draft: ReviewDraft, options: readonly FeedbackOption[]): boolean {
  return reviewProblem(draft, options) === null;
}

/** The exact body to POST (option ids de-duplicated and capped). */
export function buildReviewPayload(draft: ReviewDraft): ReviewPayload {
  return {
    rating: Math.round(draft.rating),
    option_ids: [...new Set(draft.optionIds)].slice(0, REVIEW_OPTION_LIMIT),
    comment: reviewComment(draft),
    show_publicly: draft.showPublicly,
  };
}

/** A review someone already wrote still has to be readable by the UI. */
export function isReviewDraftEmpty(draft: ReviewDraft): boolean {
  return (
    draft.rating === 0 &&
    draft.optionIds.length === 0 &&
    draft.comment.trim().length === 0 &&
    draft.otherText.trim().length === 0 &&
    draft.showPublicly === false
  );
}

/* ── Failures ────────────────────────────────────────────────────────────── */

/**
 * `notclosed` and `window` come from the server's own rejection (the docs do
 * not publish those codes), `already` from a second review. Everything is
 * mapped to one friendly sentence by the form — no status code or raw body is
 * ever rendered.
 */
export type ReviewFailureKind =
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'notfound'
  | 'notclosed'
  | 'window'
  | 'already'
  | 'validation'
  | 'server'
  | 'rejected'
  | 'unknown';

/** Reads a readable `detail` string out of an error body (never rendered raw). */
export function reviewErrorMessage(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string' && detail.trim().length > 0) return detail.trim();
  return null;
}

/**
 * Status → state. A 400 carries the server's business-rule text
 * ("A job can be reviewed once it is closed.", measured live), so its message
 * decides between not-closed / window-over / already-reviewed instead of
 * guessing from the code alone. An unrecognised 400 maps to `rejected`, which
 * shows the server's readable sentence when there is one.
 */
export function classifyReviewFailure(
  status: number,
  message?: string | null
): ReviewFailureKind {
  if (status === 0) return 'network';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notfound';
  if (status === 409) return 'already';
  if (status === 422) return 'validation';
  if (status >= 500) return 'server';
  if (status === 400 || status === 410) {
    const text = (message ?? '').toLowerCase();
    // "reviewed" alone is NOT the signal — the measured not-closed message is
    // "A job can be reviewed once it is closed.", so only an explicit
    // "already"/"second review" means a duplicate submit.
    if (/already|second review/.test(text)) return 'already';
    if (/closed/.test(text)) return 'notclosed';
    if (/window|deadline|expired|ended|past|days/.test(text)) return 'window';
    // 410 Gone with no readable detail is the one code that always means the
    // review window has ended.
    return status === 410 ? 'window' : 'rejected';
  }
  return 'unknown';
}

/* ── 422 field errors ────────────────────────────────────────────────────── */

/** The four body fields of JobReviewCreate, as the form labels them. */
export type ReviewField = 'rating' | 'option_ids' | 'comment' | 'show_publicly';

const REVIEW_FIELDS: readonly ReviewField[] = ['rating', 'option_ids', 'comment', 'show_publicly'];

function asField(value: unknown): ReviewField | null {
  return typeof value === 'string' && (REVIEW_FIELDS as readonly string[]).includes(value)
    ? (value as ReviewField)
    : null;
}

/**
 * Which inputs a FastAPI 422 refers to, in the order the `detail` items arrive
 * (loc is ["body","rating"] etc.). Duplicates collapse; an unknown loc is
 * ignored so the form keeps its general message.
 */
export function reviewFieldErrors(body: unknown): ReviewField[] {
  if (body === null || typeof body !== 'object') return [];
  const detail = (body as { detail?: unknown }).detail;
  if (!Array.isArray(detail)) return [];
  const fields: ReviewField[] = [];
  for (const item of detail) {
    if (!item || typeof item !== 'object') continue;
    const loc = (item as { loc?: unknown }).loc;
    if (!Array.isArray(loc)) continue;
    for (const step of loc) {
      const field = asField(step);
      if (field && !fields.includes(field)) fields.push(field);
    }
  }
  return fields;
}

/** 1..5 → a stable 0-based index for the label table (0 when nothing picked). */
export function ratingLabelIndex(rating: number): number {
  if (!Number.isInteger(rating) || rating < RATING_MIN || rating > RATING_MAX) return -1;
  return rating - 1;
}

/* ── GET /api/v1/jobs/{job_id}/reviews ────────────────────────────────────── */

/**
 * "CLIENT" | "PROVIDER" are the documented values; the generic `string` arm
 * keeps an unknown value type-safe instead of crashing on a cast.
 */
export type ReviewAuthorSide = 'CLIENT' | 'PROVIDER' | (string & {});
/** Seen: "SUBMITTED". PUBLISHED / HIDDEN come from the live enum. Any other
 * value is carried as a string and simply rendered without a special state. */
export type ReviewStatus = 'SUBMITTED' | 'PUBLISHED' | 'HIDDEN' | (string & {});

/**
 * One review object, exactly as the documented 200 and 201 bodies carry it.
 *
 * MEASURED LIVE (2026-11-15): for a job that is not closed the endpoint answers
 * `{job_id, can_review:false, review_deadline:null, my_review:null,
 * their_review:null}` — the keys are PRESENT and null, never missing. Both
 * review fields are typed nullable and are normalised to null for
 * null/undefined/{} so every caller sees one shape.
 *
 * The live OpenAPI documents `selected_options` as `SelectedOption[]`
 * ({id, label, is_other}) and `attachments` as `MediaItemResponse[]` (numeric
 * `id`, nullable `url`). Both stay `unknown[]` because every renderer resolves
 * them defensively (lib/taskFeedback resolveOptionLabels / lib/imageAttachments
 * attachmentImageItems).
 */
export interface Review {
  id: number | null;
  job_id: number | null;
  author_side: ReviewAuthorSide;
  provider_profile_id: number | null;
  client_profile_id: number | null;
  rating: number;
  selected_options: unknown[];
  comment: string;
  show_publicly: boolean;
  status: ReviewStatus;
  /** Null when the review is not published yet (not confirmed by the API). */
  published_at: string | null;
  attachments: unknown[];
  created_at: string;
}

/** The documented 200 body: one object per job, never an array. */
export interface JobReviews {
  job_id: number;
  can_review: boolean;
  /** Null while the job is not closed (measured live). */
  review_deadline: string | null;
  my_review: Review | null;
  their_review: Review | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asIsoString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * One review, defensively. Returns null for null/undefined/an empty object or
 * anything without a numeric rating — a review without a rating does not exist,
 * and inventing one would put 0 stars on screen.
 */
export function normalizeReview(raw: unknown): Review | null {
  const row = asRecord(raw);
  if (!row) return null;
  const rating = asInt(row.rating);
  if (rating === null) return null;
  const author = typeof row.author_side === 'string' ? row.author_side.toUpperCase() : '';
  const status = typeof row.status === 'string' ? row.status.toUpperCase() : '';
  return {
    id: asInt(row.id),
    job_id: asInt(row.job_id),
    author_side: author,
    provider_profile_id: asInt(row.provider_profile_id),
    client_profile_id: asInt(row.client_profile_id),
    rating,
    selected_options: Array.isArray(row.selected_options) ? row.selected_options : [],
    comment: typeof row.comment === 'string' ? row.comment : '',
    show_publicly: row.show_publicly === true,
    status,
    published_at: asIsoString(row.published_at),
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

/**
 * The 200 body, defensively. An unreadable body becomes the neutral shape the
 * API itself returns for a job without reviews, so the UI shows "not available
 * yet" instead of crashing or claiming a review exists.
 */
export function normalizeJobReviews(raw: unknown, jobId: number): JobReviews {
  const row = asRecord(raw);
  if (!row) {
    return {
      job_id: jobId,
      can_review: false,
      review_deadline: null,
      my_review: null,
      their_review: null,
    };
  }
  return {
    job_id: asInt(row.job_id) ?? jobId,
    can_review: row.can_review === true,
    review_deadline: asIsoString(row.review_deadline),
    my_review: normalizeReview(row.my_review),
    their_review: normalizeReview(row.their_review),
  };
}

/* ── Derived state ───────────────────────────────────────────────────────── */

export type ReviewState = 'CAN_REVIEW' | 'REVIEWED' | 'EXPIRED' | 'UNAVAILABLE';

export interface ReviewTimeLeft {
  /** Milliseconds until the deadline (0 when unknown). */
  ms: number;
  expired: boolean;
  /** Whole days left (0 when under a day). */
  days: number;
  /** Whole hours left. */
  hours: number;
  /** Whole minutes left (used by the pending-reviews chips). */
  minutes: number;
  /** True when more than 0 and at most 24 hours remain. */
  underDay: boolean;
  /** False when no usable deadline was supplied — never treated as expired. */
  known: boolean;
}

/** Parses an ISO datetime; a value without a zone is read as UTC (the API's). */
export function parseReviewDeadline(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const text = value.trim();
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

/** Days/hours left, in the device's time zone. Unknown deadline ≠ expired. */
export function timeLeft(
  deadline: string | null | undefined,
  now: number = Date.now()
): ReviewTimeLeft {
  const at = parseReviewDeadline(deadline);
  if (at === null) {
    return {
      ms: 0,
      expired: false,
      days: 0,
      hours: 0,
      minutes: 0,
      underDay: false,
      known: false,
    };
  }
  const ms = at - now;
  const expired = ms <= 0;
  const positive = Math.max(0, ms);
  return {
    ms,
    expired,
    days: Math.floor(positive / 86_400_000),
    hours: Math.floor(positive / 3_600_000),
    minutes: Math.floor(positive / 60_000),
    underDay: !expired && ms <= 86_400_000,
    known: true,
  };
}

/**
 * The one state machine the whole feature uses.
 *
 * The API does not say WHY can_review is false, so nothing beyond the data is
 * claimed: a review of mine means REVIEWED; otherwise a deadline in the past
 * means EXPIRED; otherwise can_review alone decides CAN_REVIEW vs UNAVAILABLE.
 */
export function reviewState(
  data: Pick<JobReviews, 'can_review' | 'review_deadline' | 'my_review'> | null | undefined,
  now: number = Date.now()
): ReviewState {
  if (!data) return 'UNAVAILABLE';
  if (data.my_review) return 'REVIEWED';
  const left = timeLeft(data.review_deadline, now);
  if (left.expired) return 'EXPIRED';
  return data.can_review ? 'CAN_REVIEW' : 'UNAVAILABLE';
}

/** The other side's review is only ever rendered when it really exists. */
export function theirReviewVisible(
  data: Pick<JobReviews, 'their_review'> | null | undefined
): boolean {
  return !!(data && data.their_review);
}

/** True when their review is already PUBLISHED (status is a hint, not a rule). */
export function reviewIsPublished(review: Review | null | undefined): boolean {
  return !!review && String(review.status).toUpperCase() === 'PUBLISHED';
}

const REVIEW_LOCALES: Record<string, string> = {
  en: 'en-GB',
  et: 'et-EE',
  lv: 'lv-LV',
  lt: 'lt-LT',
  de: 'de-DE',
};

/* ── GET /api/v1/providers/{provider_id}/reviews ────────────────────────── */

/**
 * The provider rating summary. `review_average` is NULL when nothing is
 * published yet (measured live: `{star_rating: 4, review_average: null,
 * review_count: 0}` for a provider whose profile carries a stored
 * `star_rating: 4`) — so it is typed nullable and the UI never renders a
 * rating out of the stored value when there are no reviews.
 */
export interface ReviewsSummary {
  star_rating: number;
  review_average: number | null;
  review_count: number;
}

export interface ReviewsPage {
  summary: ReviewsSummary;
  reviews: Review[];
}

/** Both "List … Reviews" endpoints return this exact shape. */
export type ProviderReviewsSummary = ReviewsSummary;
export type ProviderReviewsPage = ReviewsPage;
export type ClientReviewsPage = ReviewsPage;

/** Documented default page size (limit min 1, max 100). */
export const PROVIDER_REVIEWS_PAGE_SIZE = 20;
export const PROVIDER_REVIEWS_MAX_LIMIT = 100;

function asScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asCount(value: unknown): number {
  const n = asScore(value);
  return n === null || n < 0 ? 0 : Math.trunc(n);
}

/** Missing/invalid summary becomes zeros — never NaN, never a fake rating. */
export function normalizeReviewsSummary(raw: unknown): ReviewsSummary {
  const row = asRecord(raw);
  if (!row) return { star_rating: 0, review_average: null, review_count: 0 };
  return {
    star_rating: asScore(row.star_rating) ?? 0,
    review_average: asScore(row.review_average),
    review_count: asCount(row.review_count),
  };
}

/** The 200 body: one object with `summary` + `reviews` (never an array). */
export function normalizeReviewsPage(raw: unknown): ReviewsPage {
  const row = asRecord(raw);
  if (!row) {
    return { summary: normalizeProviderReviewsSummary(null), reviews: [] };
  }
  const reviews: Review[] = [];
  if (Array.isArray(row.reviews)) {
    for (const entry of row.reviews) {
      const review = normalizeReview(entry);
      if (review) reviews.push(review);
    }
  }
  return { summary: normalizeProviderReviewsSummary(row.summary), reviews };
}

/* Aliases kept for the provider screens/tests written before the client list. */
export const normalizeProviderReviewsSummary = normalizeReviewsSummary;
export const normalizeProviderReviewsPage = normalizeReviewsPage;

/**
 * The number shown next to the stars. `review_average` is the documented mean
 * and the real display value; it is null when nothing is published (so the
 * stored `star_rating` is only used as a fallback when a count exists but the
 * average is missing). Null means "No reviews yet".
 */
export function reviewAverageForDisplay(
  summary: ProviderReviewsSummary | null | undefined
): number | null {
  if (!summary || summary.review_count <= 0) return null;
  if (summary.review_average !== null && summary.review_average > 0) {
    return summary.review_average;
  }
  return summary.star_rating > 0 ? summary.star_rating : null;
}

export function hasProviderReviews(
  summary: ProviderReviewsSummary | null | undefined
): boolean {
  return !!summary && summary.review_count > 0;
}

/** One decimal, in the active language (Intl falls back to the default tag). */
export function formatReviewAverage(value: number | null, language: string): string {
  if (value === null || !Number.isFinite(value)) return '';
  const tag = REVIEW_LOCALES[language] ?? 'en-GB';
  try {
    return new Intl.NumberFormat(tag, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return value.toFixed(1);
  }
}

/**
 * "1 review" / "N reviews" with each shipped language's plural rule (the same
 * one the pending card uses: lv 11-exception, lt 11–19 exception).
 */
export function reviewCountKey(
  count: number,
  language: string
): 'fb_prov_count_one' | 'fb_prov_count_other' {
  const key = pendingCountKey(count, language);
  return key === 'fb_pending_count_one' ? 'fb_prov_count_one' : 'fb_prov_count_other';
}

/** Alias: the review count reads the same for both subjects ("N reviews"). */
export const providerReviewCountKey = reviewCountKey;

/* ── GET /api/v1/reviews/pending ──────────────────────────────────────────── */

/**
 * One "closed job you can still review", exactly as documented:
 * {job_id, title, closed_at, review_deadline}. No other party, no role — those
 * have to come from data the app already holds.
 */
export interface PendingReview {
  job_id: number;
  title: string;
  closed_at: string;
  review_deadline: string;
}

/**
 * NOT blocking: reviewing is optional until the product decides otherwise.
 * A single flag so that decision has exactly one place to change; nothing in
 * this feature forces the user anywhere (no auto-opened modal, no disabled
 * navigation).
 */
export const PENDING_REVIEW_IS_BLOCKING = false;

/** True only for a deadline that has really passed; an unreadable one is not. */
export function isExpired(deadline: string | null | undefined, now: number = Date.now()): boolean {
  return timeLeft(deadline, now).expired;
}

export type PendingUrgency = 'NORMAL' | 'SOON' | 'EXPIRED';

/**
 * Chip/accent level: expired when the deadline passed, SOON inside 24 hours,
 * NORMAL otherwise. A missing/bad deadline is NORMAL (never SOON, never
 * expired) so a broken value cannot hide an actionable item.
 */
export function urgencyLevel(
  deadline: string | null | undefined,
  now: number = Date.now()
): PendingUrgency {
  const left = timeLeft(deadline, now);
  if (left.expired) return 'EXPIRED';
  return left.underDay ? 'SOON' : 'NORMAL';
}

/**
 * Parses one pending item; null when it has no usable job id (nothing to open)
 * or no title and no job id to show.
 */
export function normalizePendingReview(raw: unknown): PendingReview | null {
  const row = asRecord(raw);
  if (!row) return null;
  const jobId = asInt(row.job_id);
  if (jobId === null || jobId <= 0) return null;
  return {
    job_id: jobId,
    title: typeof row.title === 'string' ? row.title : '',
    closed_at: typeof row.closed_at === 'string' ? row.closed_at : '',
    review_deadline: typeof row.review_deadline === 'string' ? row.review_deadline : '',
  };
}

/**
 * The 200 body → display list.
 *
 * Always an array (a null/undefined/garbage body is []), expired items are
 * dropped (never shown as actionable), and the result is sorted by
 * `review_deadline` ascending — soonest first — with unusable deadlines last
 * and `job_id` breaking ties so the order is stable between two fetches.
 */
export function normalizePendingReviews(raw: unknown, now: number = Date.now()): PendingReview[] {
  if (!Array.isArray(raw)) return [];
  const items: PendingReview[] = [];
  for (const entry of raw) {
    const item = normalizePendingReview(entry);
    if (item) items.push(item);
  }
  return [...items]
    .filter((item) => !isExpired(item.review_deadline, now))
    .sort((a, b) => {
      const aAt = parseReviewDeadline(a.review_deadline);
      const bAt = parseReviewDeadline(b.review_deadline);
      if (aAt === null && bAt === null) return a.job_id - b.job_id;
      if (aAt === null) return 1;
      if (bAt === null) return -1;
      return aAt - bAt || a.job_id - b.job_id;
    });
}

/**
 * Which side of the job the viewer is on, from a job the app already holds
 * (JobResponse.client_id is the client's USER id). Null when it cannot be told,
 * in which case the UI uses the neutral "Rate this job" label instead of
 * guessing.
 */
export function pendingReviewRole(
  job: { client_id?: unknown } | null | undefined,
  userId: number | null
): ReviewRole | null {
  if (!job || userId === null) return null;
  const clientId = asInt(job.client_id);
  if (clientId === null) return null;
  return clientId === userId ? 'CLIENT' : 'PROVIDER';
}

/**
 * The card/list count message, with the plural rule of each shipped language:
 * English/German/Estonian singular only for exactly 1, Latvian adds the 11
 * exception, Lithuanian the 11–19 one.
 */
export function pendingCountKey(
  count: number,
  language: string
): 'fb_pending_count_one' | 'fb_pending_count_other' {
  const n = Math.abs(Math.trunc(count));
  if (n === 1) return 'fb_pending_count_one';
  if (language === 'lv') return n % 10 === 1 && n % 100 !== 11 ? 'fb_pending_count_one' : 'fb_pending_count_other';
  if (language === 'lt') {
    const mod100 = n % 100;
    const one = n % 10 === 1 && (mod100 < 11 || mod100 > 19);
    return one ? 'fb_pending_count_one' : 'fb_pending_count_other';
  }
  return 'fb_pending_count_other';
}

/**
 * The deadline in the device's time zone and the active app language, or ''
 * when there is no usable deadline (the card then omits the date entirely).
 */
export function formatReviewDeadline(
  deadline: string | null | undefined,
  language: string
): string {
  const at = parseReviewDeadline(deadline);
  if (at === null) return '';
  const date = new Date(at);
  const tag = REVIEW_LOCALES[language] ?? 'en-GB';
  try {
    return date.toLocaleString(tag, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date.toLocaleString();
  }
}
