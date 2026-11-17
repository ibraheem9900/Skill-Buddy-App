/**
 * Feedback — pure helpers behind the one reusable feedback screen.
 *
 * The ONLY documented endpoint is GET /api/v1/feedback/options?context=…, so
 * everything here is about that contract: the seven context values, the
 * FeedbackOption shape ({id, context, label, is_other, sort_order}), the
 * sort_order ASC ordering the screen must show, and which fields each context
 * needs before Submit may be pressed. Nothing here invents request bodies or
 * response fields for the endpoints that are not documented yet.
 *
 * Wording rule for the whole feature: user-facing copy says "Task", never
 * "milestone" — the keys live in context/translations/*.ts, not here.
 */

export type FeedbackContext =
  | 'CLIENT_REVIEW'
  | 'PROVIDER_REVIEW'
  | 'MILESTONE_DENIAL'
  | 'DISPUTE_BY_CLIENT'
  | 'DISPUTE_BY_PROVIDER'
  | 'CLIENT_CANCELLATION'
  | 'PROVIDER_CANCELLATION';

/** Every allowed `context` query value, in the backend's documented order. */
export const FEEDBACK_CONTEXTS: readonly FeedbackContext[] = [
  'CLIENT_REVIEW',
  'PROVIDER_REVIEW',
  'MILESTONE_DENIAL',
  'DISPUTE_BY_CLIENT',
  'DISPUTE_BY_PROVIDER',
  'CLIENT_CANCELLATION',
  'PROVIDER_CANCELLATION',
];

/**
 * DISPUTE / DENIAL / CANCELLATION CREATION IS NOT AVAILABLE YET.
 *
 * `POST /api/v1/feedback` and the milestone-denial / dispute create endpoints
 * are still undocumented stubs in services/feedback.ts, so a form for those
 * contexts could be filled in but never submitted. Every entry point that would
 * open such a form is hidden behind this ONE flag, so a released build never
 * offers a dead end. Read-only surfaces that DO work — the Task feedback
 * history, reviews, pending reviews and review photos — stay visible.
 *
 * Flip it to true only once the create endpoints exist and their submit paths
 * are wired.
 */
export const FEEDBACK_DISPUTE_CREATE_ENABLED = false;

export type FeedbackRole = 'CLIENT' | 'PROVIDER';

/** One predefined option as `GET /feedback/options` returns it. */
export interface FeedbackOption {
  id: number;
  context: string;
  label: string;
  is_other: boolean;
  sort_order: number;
}

/** The four form shapes the single screen renders. */
export type FeedbackKind = 'review' | 'denial' | 'dispute' | 'cancellation';

/**
 * Photos a dispute report may attach — the API documents "max 5" for
 * POST /milestone-feedback/{feedback_id}/attachments. The exact meaning is not
 * spelled out, but five IMAGES PER FEEDBACK is the only reading the endpoint
 * supports, so the client enforces it across server-side attachments plus the
 * local queue (see lib/disputeImages).
 */
export const MAX_DISPUTE_IMAGES = 5;

export function isFeedbackContext(value: unknown): value is FeedbackContext {
  return typeof value === 'string' && (FEEDBACK_CONTEXTS as readonly string[]).includes(value);
}

/**
 * Which side of the marketplace a context belongs to. A client must never be
 * able to open a provider context (and the other way round): the screen uses
 * this against the active role before it renders anything.
 */
export function feedbackRole(context: FeedbackContext): FeedbackRole {
  switch (context) {
    case 'CLIENT_REVIEW':
    case 'MILESTONE_DENIAL':
    case 'DISPUTE_BY_CLIENT':
    case 'CLIENT_CANCELLATION':
      return 'CLIENT';
    case 'PROVIDER_REVIEW':
    case 'DISPUTE_BY_PROVIDER':
    case 'PROVIDER_CANCELLATION':
      return 'PROVIDER';
  }
}

export function feedbackKind(context: FeedbackContext): FeedbackKind {
  switch (context) {
    case 'CLIENT_REVIEW':
    case 'PROVIDER_REVIEW':
      return 'review';
    case 'MILESTONE_DENIAL':
      return 'denial';
    case 'DISPUTE_BY_CLIENT':
    case 'DISPUTE_BY_PROVIDER':
      return 'dispute';
    case 'CLIENT_CANCELLATION':
    case 'PROVIDER_CANCELLATION':
      return 'cancellation';
  }
}

/** Only the two review contexts show the 1–5 star rating. */
export function feedbackShowsRating(context: FeedbackContext): boolean {
  return feedbackKind(context) === 'review';
}

/**
 * Only the dispute contexts show the local-only photo picker in the form.
 * Reviews have their own photo editor, whose queue uploads after Submit.
 */
export function feedbackShowsImages(context: FeedbackContext): boolean {
  return feedbackKind(context) === 'dispute';
}

/** Reviews render their options as chips; every other context as rows. */
export function feedbackOptionsAsChips(context: FeedbackContext): boolean {
  return feedbackKind(context) === 'review';
}

/* ── Options ─────────────────────────────────────────────────────────────── */

function asOption(raw: unknown): FeedbackOption | null {
  if (raw === null || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'number' || !Number.isFinite(row.id)) return null;
  if (typeof row.label !== 'string') return null;
  return {
    id: row.id,
    context: typeof row.context === 'string' ? row.context : '',
    label: row.label,
    is_other: row.is_other === true,
    sort_order:
      typeof row.sort_order === 'number' && Number.isFinite(row.sort_order) ? row.sort_order : 0,
  };
}

/**
 * Turns the untrusted 200 body into options in DISPLAY order: sort_order
 * ascending, `id` breaking ties so the list never reshuffles between two
 * fetches that happen to share an order value. Malformed rows are dropped
 * instead of being rendered as half-empty chips.
 */
export function normalizeFeedbackOptions(raw: unknown): FeedbackOption[] {
  if (!Array.isArray(raw)) return [];
  const options: FeedbackOption[] = [];
  for (const row of raw) {
    const option = asOption(row);
    if (option) options.push(option);
  }
  return sortFeedbackOptions(options);
}

export function sortFeedbackOptions(options: readonly FeedbackOption[]): FeedbackOption[] {
  return [...options].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
}

/* ── Form requirements ───────────────────────────────────────────────────── */

export type FeedbackProblem = 'rating' | 'option' | 'other';

export interface FeedbackDraft {
  context: FeedbackContext;
  /** Chosen option id, or null while nothing is selected. */
  optionId: number | null;
  /** Star rating (review contexts only). */
  rating: number;
  /** Text typed into the "Please tell us more" field for an `is_other` option. */
  otherText: string;
}

/**
 * What still blocks Submit, in the order the user meets the fields. Returns
 * null when the form may be sent. The comment/description fields are optional
 * (the API documentation for submitting feedback does not exist yet, so no
 * extra requirement is invented): only the documented pieces are required.
 */
export function feedbackProblem(
  draft: FeedbackDraft,
  options: readonly FeedbackOption[]
): FeedbackProblem | null {
  if (feedbackShowsRating(draft.context) && !(draft.rating >= 1 && draft.rating <= 5)) {
    return 'rating';
  }
  const selected = options.find((option) => option.id === draft.optionId) ?? null;
  if (!selected) return 'option';
  if (selected.is_other && draft.otherText.trim().length === 0) return 'other';
  return null;
}

export function feedbackCanSubmit(
  draft: FeedbackDraft,
  options: readonly FeedbackOption[]
): boolean {
  return feedbackProblem(draft, options) === null;
}

/** Options arrive with backend labels only — never translated client-side. */
export function selectedFeedbackOption(
  options: readonly FeedbackOption[],
  optionId: number | null
): FeedbackOption | null {
  if (optionId === null) return null;
  return options.find((option) => option.id === optionId) ?? null;
}

/* ── Photos (dispute UI, uploads still stubbed) ──────────────────────────── */



/* ── Errors ──────────────────────────────────────────────────────────────── */

export type FeedbackFailureKind =
  | 'unauthorized'
  | 'validation'
  | 'network'
  | 'forbidden'
  | 'notfound'
  | 'server'
  | 'unknown';

/**
 * Maps a transport failure onto the screen's states. `status` is the HTTP status
 * (0 for a request that never reached the server — timeout, offline, DNS).
 * Nothing raw from the response is ever rendered; the screen shows one friendly
 * sentence per kind.
 */
export function classifyFeedbackFailure(status: number): FeedbackFailureKind {
  if (status === 0) return 'network';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notfound';
  if (status === 422) return 'validation';
  if (status >= 500) return 'server';
  return 'unknown';
}

/**
 * Pulls the first human-readable message out of a FastAPI 422 body
 * ({detail: [{loc, msg, type, input, ctx}]}) — or null when the body is not
 * that shape, in which case the screen keeps its own friendly copy.
 */
export function firstValidationMessage(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail.trim().length > 0 ? detail : null;
  if (!Array.isArray(detail)) return null;
  for (const item of detail) {
    if (item && typeof item === 'object') {
      const msg = (item as { msg?: unknown }).msg;
      if (typeof msg === 'string' && msg.trim().length > 0) return msg;
    }
  }
  return null;
}
