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
 *   • `uploaded_by_side` is CONFIRMED by the live OpenAPI as CLIENT | PROVIDER
 *     and is shown as a small side badge (the app's own "Client" / "SkillBuddy
 *     Pilot" wording; any unexpected value is shown verbatim). `feedback_type`
 *     is confirmed as COMPLETED | DENIAL | DISPUTE but is NOT displayed or used
 *     to filter — every row the token owns is listed, whatever role uploaded
 *     it (role filtering is an open product question);
 *   • category NAMES: the payload carries `category_id` only, so the screen
 *     joins it against the already-cached GET /categories list (and the app's
 *     own `cat_<id>` copy) — one cached lookup per tile, zero requests;
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

/** Page size for My Media (server default 50, hard maximum 100). */
export const MY_MEDIA_PAGE_SIZE = 50;

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
  /**
   * Raw `uploaded_by_side` ("CLIENT", likely also a pilot value). The full enum
   * is NOT confirmed, so it is shown as a NEUTRAL badge with exactly the value
   * the server sent — never mapped to invented copy and never used to filter.
   * Null when the server sent nothing usable.
   */
  uploadedBySide: string | null;
  /** Raw `feedback_type` ("COMPLETED" in the docs). Display-only; unconfirmed. */
  feedbackType: string | null;
  /**
   * Related category id. The payload carries NO name, so the screen joins this
   * against the categories the app has already cached (GET /categories) — no
   * per-item request is ever made.
   */
  categoryId: number | null;
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
    uploaded_by_side?: unknown;
    feedback_type?: unknown;
    category_id?: unknown;
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
    uploadedBySide: trimmedValue(item.uploaded_by_side),
    feedbackType: trimmedValue(item.feedback_type),
    categoryId:
      typeof item.category_id === 'number' && Number.isFinite(item.category_id)
        ? item.category_id
        : null,
  };
}

/** A non-empty trimmed string, else null (used for the raw enum badges). */
export function trimmedValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

/**
 * The side badge for `uploaded_by_side`.
 *
 * CONFIRMED from the live OpenAPI (re-fetched 2026-11-19): `MediaUploaderSide`
 * is exactly `CLIENT | PROVIDER`, so those two resolve to the app's own existing
 * wording ("Client" / "SkillBuddy Pilot") when the caller passes its translated
 * labels. Anything else is shown VERBATIM as a neutral badge — the documented
 * fallback for a value the app does not know.
 *
 * Filtering by the active role is an OPEN PRODUCT QUESTION: nothing is filtered.
 */
export interface MyMediaSideLabels {
  client?: string | null;
  provider?: string | null;
}

export function myMediaSideLabel(
  side: string | null | undefined,
  labels?: MyMediaSideLabels
): string | null {
  const raw = trimmedValue(side);
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === 'CLIENT') return trimmedValue(labels?.client) ?? 'CLIENT';
  if (upper === 'PROVIDER') return trimmedValue(labels?.provider) ?? 'PROVIDER';
  return raw;
}

/**
 * A category name for one media row, resolved WITHOUT a request:
 *   1. the app's own `cat_<id>` translation (the name every other screen uses),
 *   2. the name from the already-cached GET /categories list,
 *   3. null (the row simply shows no category line).
 * `categoryId` is only an id on this endpoint, so a per-item request would be
 * the only other option — and it is never made.
 */
export function myMediaCategoryLabel(
  categoryId: number | null | undefined,
  cachedName?: string | null,
  localizedName?: string | null
): string | null {
  if (typeof categoryId !== 'number' || !Number.isFinite(categoryId)) return null;
  const candidates = [localizedName, cachedName];
  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate.trim() : '';
    if (value.length > 0) return value;
  }
  return null;
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
