/**
 * mediaEdit.ts — the rules behind editing ONE media item
 * (PATCH /api/v1/media-gallery/{item_id} — "Update Media").
 *
 * DOCUMENTED (live OpenAPI, re-fetched 2026-11-19):
 *   PATCH /api/v1/media-gallery/{item_id}
 *     AUTH: REQUIRED (OAuth2 password bearer). The shared axios instance
 *     attaches the bearer token and refreshes an expired one once, so nothing
 *     here touches headers.
 *     PATH: item_id — integer, required.
 *     BODY: application/json, marked required by the spec, with the example
 *       { "is_public": true, "caption": "string" }
 *     — but NEITHER property carries a `required` entry in the schema, so a
 *       PARTIAL body is what the docs actually allow. This app sends ONLY the
 *       fields the user changed (see buildMediaUpdatePatch); if the server
 *       rejects a partial body with 422, sending both fields is the fallback to
 *       implement — it is NOT guessed here.
 *     200 = the complete, updated MediaItemResponse (same shape as every other
 *       media-gallery row). That response is the SOURCE OF TRUTH for caches.
 *     422 = HTTPValidationError {detail:[{loc,msg,type,input,ctx}]}.
 *
 * UNKNOWNS (deliberately not invented — see the delivery report):
 *   • whether "" (or null) clears a caption, and the maximum caption length.
 *     There is no documented limit, so the UI shows a SOFT character count and
 *     never blocks on an invented maximum; a server 422 is shown under the field.
 *   • the exact ownership rule. "Public only for a CLIENT's photos of a
 *     successfully completed job" is expressed by `can_be_public`, and that flag
 *     is the ONLY gate used here. A 403/404 is surfaced as "You can't edit this
 *     photo" — the client NEVER guesses ownership from public gallery rows.
 *   • whether making a photo private removes it from public galleries. The
 *     PATCH response is authoritative: `is_public === false` (or any row that
 *     no longer passes the public-media rules) is REMOVED from every public
 *     cache immediately.
 *
 * Pure functions only (no React, no axios) so the rules are unit-testable.
 */

import {
  mediaKindOf,
  normalizeMediaItem,
  resolveMediaUrl,
  type DisplayMedia,
  type MediaKind,
} from '@/lib/mediaGallery';
import type { MediaItem } from '@/types';

/** The documented path — the service layer builds the URL from this. */
export const MEDIA_ITEM_PATH = (itemId: number) => `/api/v1/media-gallery/${itemId}`;

/** item_id must be a real positive integer or the request is never sent. */
export function isValidMediaItemId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * The subset of a media row the editor needs. It carries NO private fields:
 * `job_id`, `uploaded_by_side` and `feedback_type` never reach the UI.
 *
 * `canBePublic` is the server's gate for the visibility switch; `isPublic` is
 * the current state. Both are read-only inputs for the form.
 */
export interface MediaEditable {
  id: number;
  url: string;
  kind: MediaKind;
  caption: string | null;
  isPublic: boolean;
  canBePublic: boolean;
}

/** Any row that carries the editor's fields → the editor's view model. */
export function toEditableMedia(source: {
  id: number;
  url: string;
  kind: MediaKind;
  caption: string | null;
  isPublic: boolean;
  canBePublic: boolean;
}): MediaEditable {
  return {
    id: source.id,
    url: source.url,
    kind: source.kind,
    caption: source.caption,
    isPublic: source.isPublic === true,
    canBePublic: source.canBePublic === true,
  };
}

/**
 * A full MediaItemResponse → the editor's view model, or null when the row
 * cannot be edited (no id, no usable URL, unsupported media_type).
 *
 * The PUBLIC filter is deliberately NOT applied here: a private photo and a
 * non-COMPLETED one are still the owner's and still editable (only visibility
 * is gated, and that gate is `can_be_public`).
 */
export function editableFromMediaItem(item: MediaItem, baseUrl: string): MediaEditable | null {
  if (!isValidMediaItemId(item?.id)) return null;
  const url = resolveMediaUrl(item.url, baseUrl);
  if (!url) return null;
  const kind = mediaKindOf(item.media_type);
  if (!kind) return null;
  const caption = typeof item.caption === 'string' ? item.caption.trim() : '';
  return {
    id: item.id,
    url,
    kind,
    caption: caption.length > 0 ? caption : null,
    isPublic: item.is_public === true,
    canBePublic: item.can_be_public === true,
  };
}

/** The editable form state: the caption as typed and the switch's value. */
export interface MediaEditDraft {
  caption: string;
  isPublic: boolean;
}

/** The documented request body — only the fields that CHANGED are present. */
export interface MediaUpdatePatch {
  caption?: string;
  is_public?: boolean;
}

/**
 * Captions are trimmed at the edges before they are compared or sent. An empty
 * result is sent as '' — that is the documented way to clear a caption (the
 * alternative, null, is not shown in the spec's example, so it is not used).
 */
export function captionForRequest(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function draftFor(item: MediaEditable): MediaEditDraft {
  return { caption: item.caption ?? '', isPublic: item.isPublic === true };
}

/**
 * The PATCH body for a draft, or null when nothing changed. Only changed fields
 * are included, so a caption edit can never carry a visibility change (or the
 * other way round) that the user did not make.
 */
export function buildMediaUpdatePatch(
  draft: MediaEditDraft,
  item: MediaEditable
): MediaUpdatePatch | null {
  const patch: MediaUpdatePatch = {};
  const nextCaption = captionForRequest(draft.caption);
  if (nextCaption !== captionForRequest(item.caption)) patch.caption = nextCaption;
  // `can_be_public` is the server's gate: never ask to make an ineligible photo
  // public (the switch is disabled anyway — this keeps the rule in the data
  // layer). Turning a photo PRIVATE is always allowed.
  const requestedPublic = draft.isPublic === true;
  const nextPublic = requestedPublic && !item.canBePublic ? false : requestedPublic;
  if (nextPublic !== (item.isPublic === true)) patch.is_public = nextPublic;
  return Object.keys(patch).length > 0 ? patch : null;
}

/* ── Failures ────────────────────────────────────────────────────────────── */

export type MediaUpdateFailure =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid'
  | 'server'
  | 'offline'
  | 'unknown';

/**
 * HTTP status → a friendly, translatable code. 401 keeps the app's normal
 * refresh flow (the interceptor runs first; only a still-failing request lands
 * here). 403 and 404 are the documented ownership failures.
 */
export function classifyMediaUpdateFailure(status: number | null | undefined): MediaUpdateFailure {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'invalid';
  if (typeof status === 'number' && status >= 500) return 'server';
  if (status === undefined || status === null || status === 0) return 'offline';
  return 'unknown';
}

/** A server `detail`/`msg` is shown only when it is a short, readable sentence. */
const MAX_SERVER_MESSAGE = 180;

function readable(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_SERVER_MESSAGE) return null;
  // Never surface raw JSON, a URL or a bare status code as if it were copy.
  if (/^[{[]/.test(text) || /^https?:/i.test(text) || /^\d{3}$/.test(text)) return null;
  return text;
}

/**
 * The backend's own readable message, if it sent one: a plain `detail` string
 * (the usual FastAPI style for 4xx) or the first validation entry's `msg`.
 */
export function readServerMessage(data: unknown): string | null {
  if (data === null || typeof data !== 'object') return null;
  const body = data as { detail?: unknown; message?: unknown };
  const direct = readable(body.detail);
  if (direct) return direct;
  if (Array.isArray(body.detail)) {
    for (const entry of body.detail) {
      const message = readable((entry as { msg?: unknown } | null)?.msg);
      if (message) return message;
    }
  }
  return readable(body.message);
}

/** Per-field 422 messages, keyed by the form field they belong to. */
export interface MediaUpdateFieldErrors {
  caption?: string;
  is_public?: string;
}

function fieldOfEntry(entry: unknown): 'caption' | 'is_public' | null {
  const loc = (entry as { loc?: unknown } | null)?.loc;
  if (!Array.isArray(loc)) return null;
  for (let i = loc.length - 1; i >= 0; i -= 1) {
    const part = loc[i];
    if (part === 'caption') return 'caption';
    if (part === 'is_public') return 'is_public';
  }
  return null;
}

export function fieldErrorsFromValidation(data: unknown): MediaUpdateFieldErrors {
  const errors: MediaUpdateFieldErrors = {};
  if (data === null || typeof data !== 'object') return errors;
  const detail = (data as { detail?: unknown }).detail;
  if (!Array.isArray(detail)) return errors;
  for (const entry of detail) {
    const field = fieldOfEntry(entry);
    if (!field) continue;
    const message = readable((entry as { msg?: unknown } | null)?.msg);
    if (message && !errors[field]) errors[field] = message;
  }
  return errors;
}

/**
 * The 200 body → the authoritative updated row. Only the documented required
 * fields are checked; a body that is not a media item is a contract break and
 * yields null (the caller keeps the form open and reports a failure) rather
 * than writing guessed values into every cache.
 */
export function normalizeUpdatedMedia(raw: unknown): MediaItem | null {
  if (raw === null || typeof raw !== 'object') return null;
  const item = raw as Partial<MediaItem>;
  if (!isValidMediaItemId(item.id)) return null;
  if (typeof item.is_public !== 'boolean') return null;
  if (typeof item.can_be_public !== 'boolean') return null;
  if (typeof item.media_type !== 'string') return null;
  if (typeof item.created_at !== 'string') return null;
  return item as MediaItem;
}

/**
 * The item's NEW public representation, or null when it must not appear in any
 * public view. `normalizeMediaItem` already enforces the public rules
 * (is_public, COMPLETED feedback, supported media_type, usable URL).
 */
export function publicDisplayMedia(item: MediaItem, baseUrl: string): DisplayMedia | null {
  return normalizeMediaItem(item, baseUrl);
}

/* ── Cache transforms (shared by the group stores and the page cache) ────── */

/**
 * Replace (or remove) one photo in a list. The SAME array is returned when the
 * id is not present, so a cache can detect "nothing changed" by reference.
 */
export function applyMediaToMediaList(
  media: readonly DisplayMedia[],
  id: number,
  next: DisplayMedia | null
): { media: DisplayMedia[]; changed: boolean } {
  const index = media.findIndex((entry) => entry.id === id);
  if (index === -1) {
    // Unchanged: return the original reference (never copied needlessly).
    return { media: media as DisplayMedia[], changed: false };
  }
  if (next === null) {
    return { media: media.filter((entry) => entry.id !== id), changed: true };
  }
  const copy = [...media];
  copy[index] = next;
  return { media: copy, changed: true };
}

/** What every gallery group shape has in common. */
export interface MediaGroupLike {
  media: DisplayMedia[];
  rawCount: number;
}

/**
 * Apply one photo's new state to every group: replace it in place, remove it
 * from a group it left, and DROP a group left with no photos (a public preview
 * must never render a heading over an empty strip). `rawCount` shrinks on
 * removal so "may have more" stays honest; server order is never re-sorted.
 */
export function applyMediaToGroups<T extends MediaGroupLike>(
  groups: readonly T[],
  id: number,
  next: DisplayMedia | null
): { groups: T[]; changed: boolean } {
  let changed = false;
  const out: T[] = [];
  for (const group of groups) {
    const result = applyMediaToMediaList(group.media, id, next);
    if (!result.changed) {
      out.push(group);
      continue;
    }
    changed = true;
    if (result.media.length === 0) continue;
    out.push({
      ...group,
      media: result.media,
      rawCount:
        next === null ? Math.max(0, group.rawCount - 1) : group.rawCount,
    } as T);
  }
  return { groups: changed ? out : (groups as T[]), changed };
}

/** The fields a successful PATCH returns for an already-listed "my media" row. */
export function updatedMyMediaFields(item: MediaItem): {
  caption: string | null;
  isPublic: boolean;
  canBePublic: boolean;
} {
  const caption = captionForRequest(item.caption);
  return {
    caption: caption.length > 0 ? caption : null,
    isPublic: item.is_public === true,
    canBePublic: item.can_be_public === true,
  };
}
