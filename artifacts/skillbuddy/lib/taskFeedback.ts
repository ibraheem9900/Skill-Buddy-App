/**
 * Task feedback history — pure helpers for
 * GET /api/v1/jobs/{job_id}/milestones/{milestone_id}/feedback ("List Milestone
 * Feedback": every denial/dispute on a milestone, visible to participants and
 * admins).
 *
 * SHAPES THAT ARE **NOT** DOCUMENTED: `selected_options` and `attachments` are
 * documented only as arrays. A real authenticated call on 2026-11-15 returned
 * `200 []` for every milestone in both the client's and the pilot's accounts (no
 * feedback row exists yet — there is no creation endpoint wired), so the item
 * shape of both arrays is UNVERIFIED. Everything below therefore treats them as
 * `unknown[]` and extracts only what it can prove:
 *   • selected_options: numbers → resolved through the loaded feedback options
 *     (unresolvable ids are skipped, never rendered), objects with a `label`
 *     (or `name`) → that string.
 *   • attachments: strings / objects carrying an http(s) image url.
 * Anything else is dropped silently — the UI never shows raw ids or JSON.
 */
import { parseApiIsoUtc } from './jobDetail';

/** Kinds the docs show or the feature implies; anything else still renders. */
export type KnownFeedbackKind = 'DENIAL' | 'DISPUTE';
/**
 * Known literals PLUS any other string, so an undocumented kind (the docs only
 * confirm "DENIAL") can never crash a screen or widen a type error.
 */
export type FeedbackKind = KnownFeedbackKind | (string & {});

export type KnownFeedbackAuthorSide = 'CLIENT' | 'PROVIDER';
/** Same fallback idea as FeedbackKind. */
export type FeedbackAuthorSide = KnownFeedbackAuthorSide | (string & {});

/** One row of the List Milestone Feedback response. */
export interface TaskFeedback {
  id: number;
  job_id: number;
  milestone_id: number;
  kind: FeedbackKind;
  author_side: FeedbackAuthorSide;
  /** Undocumented item shape — see resolveOptionLabels. */
  selected_options: unknown[];
  message: string;
  /** Undocumented item shape — see attachmentUrls. */
  attachments: unknown[];
  created_at: string;
}

export type FeedbackSide = 'CLIENT' | 'PROVIDER';

function asObject(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
}

function asNumber(raw: unknown, fallback = 0): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

/**
 * Reads the untrusted 200 body. Rows without a usable `id` are dropped (they
 * cannot be keyed in a list), every other field is coerced defensively.
 */
export function normalizeTaskFeedback(raw: unknown): TaskFeedback[] {
  if (!Array.isArray(raw)) return [];
  const items: TaskFeedback[] = [];
  for (const entry of raw) {
    const row = asObject(entry);
    if (!row || typeof row.id !== 'number' || !Number.isFinite(row.id)) continue;
    items.push({
      id: row.id,
      job_id: asNumber(row.job_id),
      milestone_id: asNumber(row.milestone_id),
      kind: typeof row.kind === 'string' ? row.kind : '',
      author_side: typeof row.author_side === 'string' ? row.author_side : '',
      selected_options: Array.isArray(row.selected_options) ? row.selected_options : [],
      message: typeof row.message === 'string' ? row.message : '',
      attachments: Array.isArray(row.attachments) ? row.attachments : [],
      created_at: typeof row.created_at === 'string' ? row.created_at : '',
    });
  }
  return sortTaskFeedback(items);
}

export function taskFeedbackTime(item: TaskFeedback): number | null {
  const date = parseApiIsoUtc(item.created_at);
  return date ? date.getTime() : null;
}

/**
 * CHRONOLOGICAL, OLDEST → NEWEST: the history is read as a conversation on one
 * Task (the denial, then the reply/dispute), so the newest entry sits at the
 * bottom. Items with an unusable timestamp go last, ordered by id.
 */
export function sortTaskFeedback(items: readonly TaskFeedback[]): TaskFeedback[] {
  return [...items].sort((a, b) => {
    const at = taskFeedbackTime(a);
    const bt = taskFeedbackTime(b);
    if (at === null && bt === null) return a.id - b.id;
    if (at === null) return 1;
    if (bt === null) return -1;
    return at - bt || a.id - b.id;
  });
}

/* ── selected_options ─────────────────────────────────────────────────────── */

function labelOfOptionObject(raw: Record<string, unknown>): string | null {
  if (typeof raw.label === 'string' && raw.label.trim().length > 0) return raw.label;
  if (typeof raw.name === 'string' && raw.name.trim().length > 0) return raw.name;
  return null;
}

/**
 * Turns one item's `selected_options` into display labels.
 *
 * `lookup` is the merged id → label map from GET /api/v1/feedback/options
 * (loaded across the contexts a Task can produce). Numbers that are not in it
 * are skipped — a raw id is never shown. Duplicates are collapsed.
 */
export function resolveOptionLabels(
  selected: readonly unknown[],
  lookup: ReadonlyMap<number, string>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (label: string) => {
    const trimmed = label.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  for (const entry of selected) {
    if (typeof entry === 'number') {
      const label = lookup.get(entry);
      if (label) push(label);
      continue;
    }
    if (typeof entry === 'string') {
      // A raw string is only shown when it is plainly a LABEL, never an id.
      if (/^\d+$/.test(entry.trim())) {
        const label = lookup.get(Number(entry));
        if (label) push(label);
      }
      continue;
    }
    const row = asObject(entry);
    if (!row) continue;
    const label = labelOfOptionObject(row);
    if (label) push(label);
    else if (typeof row.id === 'number') {
      // An option-shaped object whose label the backend omitted: resolve the id.
      const resolved = lookup.get(row.id);
      if (resolved) push(resolved);
    }
  }
  return out;
}

/* ── attachments ──────────────────────────────────────────────────────────── */

function isImageUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^file:\/\//i.test(value);
}

const URL_KEYS = ['url', 'file_url', 'image_url', 'uri'] as const;

/**
 * Extracts image urls from the undocumented `attachments` array. Accepts plain
 * url strings and objects with a url-ish string field; everything else (and
 * every non-image file) is ignored, so an unexpected shape renders nothing
 * instead of crashing.
 */
export function attachmentUrls(attachments: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const entry of attachments) {
    if (typeof entry === 'string') {
      if (isImageUrl(entry)) out.push(entry);
      continue;
    }
    const row = asObject(entry);
    if (!row) continue;
    for (const key of URL_KEYS) {
      const value = row[key];
      if (typeof value === 'string' && isImageUrl(value)) {
        out.push(value);
        break;
      }
    }
  }
  return [...new Set(out)];
}

/* ── Labels ───────────────────────────────────────────────────────────────── */

export type AuthorLabelKind = 'you' | 'client' | 'pilot' | 'participant';

/**
 * "You" when the item was written by the viewer's own side of THIS job,
 * otherwise the other side's name. Unknown author_side values fall back to a
 * neutral "Participant" instead of printing a raw enum.
 */
export function authorLabelKind(
  authorSide: FeedbackAuthorSide,
  viewerSide: FeedbackSide
): AuthorLabelKind {
  const side = authorSide.toUpperCase();
  if (side === viewerSide) return 'you';
  if (side === 'CLIENT') return 'client';
  if (side === 'PROVIDER') return 'pilot';
  return 'participant';
}

export type KindLabelKind = 'denial' | 'dispute' | 'other';

export function kindLabelKind(kind: FeedbackKind): KindLabelKind {
  const value = kind.toUpperCase();
  if (value === 'DENIAL') return 'denial';
  if (value === 'DISPUTE') return 'dispute';
  return 'other';
}

/* ── Time ─────────────────────────────────────────────────────────────────── */

const LOCALE_TAGS: Record<string, string> = {
  en: 'en-GB',
  et: 'et-EE',
  lv: 'lv-LV',
  lt: 'lt-LT',
  de: 'de-DE',
};

/**
 * "15 Nov 2026, 21:56" — the device's timezone, formatted in the active app
 * language (falling back to en-GB for a code the app does not ship). An
 * unusable timestamp renders nothing rather than "Invalid Date".
 */
export function formatTaskFeedbackTime(value: string, language: string): string {
  const date = parseApiIsoUtc(value);
  if (!date) return '';
  const tag = LOCALE_TAGS[language] ?? 'en-GB';
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
