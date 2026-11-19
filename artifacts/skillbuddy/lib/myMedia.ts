/**
 * myMedia.ts — the rules behind "My Media" (GET /api/v1/media-gallery/mine).
 *
 * DOCUMENTED (live OpenAPI, re-fetched 2026-11-18):
 *   GET /api/v1/media-gallery/mine?limit&offset
 *     AUTH: REQUIRED (OAuth2 password bearer) — unlike every endpoint in
 *     lib/mediaGallery. Verified live: no token → 401
 *     {"detail":"Not authenticated"}. The shared axios instance attaches
 *     `Authorization: Bearer <token>` and its interceptor refreshes an expired
 *     token, so nothing here touches headers.
 *     limit: integer 1..100, default 50. offset: integer >= 0, default 0.
 *     200 = a PLAIN JSON ARRAY of MediaItemResponse — NOT {items: [...]}, no
 *     "total", no "message" (verified against the live schema). A wrapped
 *     payload is treated as a contract break and yields [] instead of a crash.
 *
 * SCOPED BY THE TOKEN: no user id is passed; the server decides whose rows
 * these are, and nothing here filters by user.
 *
 * UNCONFIRMED WITH THE BACKEND TEAM — reported, never guessed:
 *   • allowed `media_type` values (the schema is a free string), so the type is
 *     classified by lib/mediaGallery.mediaKindOf: any *video* → video, the
 *     image family → image, anything else is SKIPPED rather than rendered as a
 *     broken tile;
 *   • the `uploaded_by_side` / `feedback_type` value lists — neither is used
 *     for filtering or badges here, so an unknown value is harmless;
 *   • whether `url` is absolute or relative, and whether the media host wants a
 *     bearer token — resolveMediaUrl accepts absolute, protocol-relative,
 *     root-relative and bare paths, and the image component loads them
 *     anonymously (no per-image auth header), exactly like the public gallery;
 *   • the server's default sort. The list is rendered in the order the API
 *     returns it — there is NO local re-sort.
 *
 * NOT FILTERED ON PURPOSE: this is the user's own list, so private items are
 * shown (that is the point). `is_public` / `can_be_public` are read-only
 * labels. `job_id` never reaches this type at all.
 *
 * Pure functions only (no React, no axios) so the rules are unit-testable.
 */

import { mediaKindOf, resolveMediaUrl, type MediaKind } from '@/lib/mediaGallery';

export type { MediaKind };

/** The documented path — the service layer builds the URL from this. */
export const MY_MEDIA_PATH = '/api/v1/media-gallery/mine';

/** Page size for My Media (server allows 1..100; the task asks for ~20). */
export const MY_MEDIA_PAGE_SIZE = 20;

/** Hard server ceiling for `limit`. */
export const MY_MEDIA_MAX_LIMIT = 100;

/** One row of GET /api/v1/media-gallery/mine, ready to render. */
export interface MyMediaEntry {
  /** Server id — the key UPDATE/DELETE will need later, and the dedupe key. */
  id: number;
  url: string;
  kind: MediaKind;
  caption: string | null;
  createdAt: string | null;
  /** Read-only status of THIS item (never an action in this task). */
  isPublic: boolean;
  canBePublic: boolean;
}

/** Clamp a requested page size into the documented 1..100 range. */
export function clampMyMediaLimit(value: number | null | undefined): number {
  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.trunc(value)
      : MY_MEDIA_PAGE_SIZE;
  return Math.min(MY_MEDIA_MAX_LIMIT, Math.max(1, n));
}

/** Clamp a requested offset to a whole number >= 0. */
export function clampMyMediaOffset(value: number | null | undefined): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.max(0, n);
}

function trimmedCaption(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

/**
 * One raw MediaItemResponse → MyMediaEntry, or null when it cannot be drawn:
 *   • not an object / no usable `url` → null (nothing to show; the API allows
 *     `url` to be null)
 *   • unsupported `media_type`         → null (skipped, never a broken box)
 * Private rows are KEPT: this is the owner's own list.
 */
export function normalizeMyMediaItem(
  raw: unknown,
  baseUrl: string,
  index = 0
): MyMediaEntry | null {
  if (raw === null || typeof raw !== 'object') return null;
  const item = raw as {
    id?: unknown;
    media_type?: unknown;
    caption?: unknown;
    url?: unknown;
    created_at?: unknown;
    is_public?: unknown;
    can_be_public?: unknown;
  };

  const kind = mediaKindOf(typeof item.media_type === 'string' ? item.media_type : null);
  if (kind === null) return null;

  const url = resolveMediaUrl(typeof item.url === 'string' ? item.url : null, baseUrl);
  if (!url) return null;

  return {
    // A missing id gets a synthetic negative one so the row still renders and
    // the offset can advance; identity then falls back to the URL.
    id: typeof item.id === 'number' && Number.isFinite(item.id) ? item.id : -index - 1,
    url,
    kind,
    caption: trimmedCaption(item.caption),
    createdAt: typeof item.created_at === 'string' ? item.created_at : null,
    isPublic: item.is_public === true,
    // "Can this be made public" only means something when the server says so.
    canBePublic: item.can_be_public === true,
  };
}

function identityKey(entry: MyMediaEntry): string {
  return entry.id >= 0 ? `id:${entry.id}` : `url:${entry.url}`;
}

/**
 * The 200 payload → renderable rows. The endpoint answers a BARE ARRAY; any
 * other shape (object wrapper, null, error body) yields [] so a contract
 * change cannot crash the screen.
 */
export function normalizeMyMediaArray(raw: unknown, baseUrl: string): MyMediaEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: MyMediaEntry[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const entry = normalizeMyMediaItem(item, baseUrl, index);
    if (!entry) return;
    const key = identityKey(entry);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  });
  return out;
}

/**
 * Append one page to the list, dropping rows already on screen (a row can
 * shift between requests). Items are NEVER re-sorted: the API order stands.
 */
export function mergeMyMediaPage(
  current: readonly MyMediaEntry[],
  page: readonly MyMediaEntry[]
): MyMediaEntry[] {
  const seen = new Set(current.map(identityKey));
  const fresh = page.filter((entry) => {
    const key = identityKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return fresh.length === 0 ? [...current] : [...current, ...fresh];
}

/**
 * "There may be another page" — the response carries no total, so a FULL page
 * is the only signal. A short page (fewer raw rows than the limit) ends paging.
 * `rawCount` is the number of rows the API sent, BEFORE any row was skipped.
 */
export function myMediaHasMore(rawCount: number, limit: number): boolean {
  return rawCount >= limit;
}

/** Next offset — derived from the rows actually received, never from the UI. */
export function nextMyMediaOffset(offset: number, rawCount: number): number {
  return Math.max(0, Math.trunc(offset)) + Math.max(0, Math.trunc(rawCount));
}

const LOCALE_TAGS: Record<string, string> = {
  en: 'en-GB',
  de: 'de-DE',
  et: 'et-EE',
  lv: 'lv-LV',
  lt: 'lt-LT',
};

/**
 * `created_at` (ISO 8601 UTC) → "12 Nov 2026" in the user's own timezone and
 * language. Returns '' for a missing/invalid value so the line is dropped.
 */
export function formatMyMediaDate(
  iso: string | null | undefined,
  language: string,
  now?: Date
): string {
  if (typeof iso !== 'string' || iso.trim().length === 0) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  // Guard against a clock-skewed "future" timestamp rendering oddly.
  if (now && date.getTime() > now.getTime() + 60_000) return '';
  const tag = LOCALE_TAGS[language] ?? 'en-GB';
  try {
    return date.toLocaleDateString(tag, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}
