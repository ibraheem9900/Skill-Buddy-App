/**
 * mediaGallery.ts — the ONE set of rules behind every public gallery surface
 * ("Our work by service", the home preview, category/service previews and the
 * paginated "See all" list).
 *
 * DOCUMENTED (live OpenAPI, re-fetched 2026-11-18):
 *
 *   GET /api/v1/media-gallery/public            → PublicMediaResponse
 *     params: service_id?, category_id?, limit (1..100, default 30), offset (>=0)
 *     body:   { service_id, category_id, items: MediaItemResponse[] }  ← a WRAPPER,
 *             NOT a bare array (verified against the live spec and a real call).
 *
 *   GET /api/v1/media-gallery/public/by-service → ServiceGalleryGroup[]  (bare ARRAY)
 *     params: per_service (1..50, default 10). NO limit/offset — groups are not
 *     paginated. Each group: { service_id, service_title, category_id, items }.
 *     The group's `category_id` is NULLABLE on the wire (`anyOf[int, null]`),
 *     even though the task brief shows it as a number — both are handled.
 *
 *   GET /api/v1/services/{service_id}/gallery      → PublicMediaPage
 *     params: service_id (path), limit (1..100, default 30), offset (>= 0).
 *     The DEDICATED single-service page: same WRAPPER as List Public Media.
 *     Verified live 2026-11-18: public (200 with and without a token), and an
 *     unknown service (999999) is 200 with an EMPTY items array, NOT a 404.
 *
 *   GET /api/v1/categories/{category_id}/gallery  → PublicMediaPage
 *     params: category_id (path), limit (1..100, default 30), offset (>= 0).
 *     The DEDICATED single-category page (all services in that category) — the
 *     source for the category screen preview and the category "See all" grid.
 *     Verified live: public, unknown category → 200 with EMPTY items (not 404).
 *
 *   All three endpoints carry NO `security` block in the live spec → PUBLIC.
 *   Verified live: HTTP 200 with no Authorization header AND with a bogus
 *   bearer token.
 *
 * MediaItemResponse on the wire:
 *   required: id, uploaded_by_side, feedback_type, is_public, can_be_public,
 *             media_type, created_at
 *   nullable: job_id, service_id, category_id, caption, url
 *
 * The backend is currently unseeded: every media-gallery endpoint answers 200
 * with an empty payload, so group ordering, service_title language, real
 * media_type values and the URL format could NOT be observed. Everything below
 * is therefore driven by the schema, never by a guess dressed up as fact.
 *
 * PRIVACY: `job_id`, `uploaded_by_side`, `can_be_public` and `is_public` are
 * read for filtering and then DROPPED — a DisplayMedia entry carries only what
 * a public gallery may show (url, kind, caption, date, id).
 *
 * Pure functions only (no React, no axios) so this module is unit-testable.
 */

import type { CategoryMediaGroup, MediaItem, ServiceMediaGroup } from '@/types';

export type { CategoryMediaGroup, MediaItem, ServiceMediaGroup };

/** Path prefix — the service file builds the two documented URLs from these. */
export const MEDIA_GALLERY_PATH = '/api/v1/media-gallery/public';
export const MEDIA_GALLERY_BY_SERVICE_PATH = '/api/v1/media-gallery/public/by-service';
export const MEDIA_GALLERY_BY_CATEGORY_PATH = '/api/v1/media-gallery/public/by-category';

/**
 * GET /api/v1/services/{service_id}/gallery — the DEDICATED single-service page
 * (limit 1..100 / offset >= 0). It answers the same {service_id, category_id,
 * items} wrapper as List Public Media, so everything downstream is unchanged.
 */
export const SERVICE_GALLERY_PATH = (serviceId: number) =>
  `/api/v1/services/${serviceId}/gallery`;

/**
 * GET /api/v1/categories/{category_id}/gallery — the DEDICATED single-category
 * page (limit 1..100 / offset >= 0). Same {service_id, category_id, items}
 * wrapper as the other pages; `service_id` is null on a category page and
 * `category_id` echoes the path id (the top-level pair is context only).
 *
 * Verified live 2026-11-18: PUBLIC (200 with no token AND with a bogus one);
 * an unknown category (999999) answers 200 with an EMPTY items array, NOT a
 * 404; limit=0 / 101, offset=-1 and a non-integer path are 422.
 */
export const CATEGORY_GALLERY_PATH = (categoryId: number) =>
  `/api/v1/categories/${categoryId}/gallery`;

/** The preview size used by the grouped screen, home preview and service cards. */
export const DEFAULT_PER_SERVICE = 6;
/**
 * The preview size for the by-CATEGORY groups. Same value as by-service on
 * purpose: the two group stores are separate, but pinning both to 6 keeps the
 * "may have more" threshold, the tile counts and the payload size identical
 * across the two views of the gallery (and inside the task's 6..10 preview
 * guidance / never-above-20 rule).
 */
export const DEFAULT_PER_CATEGORY = 6;
/**
 * Hard server ceiling for `per_service` (the live spec's maximum). Every
 * preview in the app asks for DEFAULT_PER_SERVICE (6), well inside the task's
 * own "never above 20 for a preview" limit; this constant exists so a caller
 * cannot accidentally exceed the documented range.
 */
export const MAX_PER_SERVICE = 50;
/** Page size for the paginated "See all" list (`limit`, server max 100). */
export const PUBLIC_MEDIA_PAGE_SIZE = 24;

/** Only COMPLETED feedback is public per MediaFeedbackType's own description. */
export const PUBLIC_FEEDBACK_TYPE = 'COMPLETED';

export type MediaKind = 'image' | 'video';

/** The documented query for GET /api/v1/media-gallery/public. */
export interface ListPublicMediaParams {
  service_id?: number;
  category_id?: number;
  /** 1..100, server default 30. */
  limit?: number;
  /** >= 0. */
  offset?: number;
}

/** A media entry that is actually renderable, with everything private stripped. */
export interface DisplayMedia {
  /** Server id, or a negative synthetic id when the row carried none. */
  id: number;
  /** Absolute URL, ready for <Image> / the video player. */
  url: string;
  kind: MediaKind;
  /** Server caption, trimmed; null when absent or blank. */
  caption: string | null;
  /** Raw ISO timestamp; format with formatMediaDate() at render time. */
  createdAt: string | null;
}

/** One service section, ready to render. */
export interface ServiceGalleryGroupView {
  serviceId: number;
  /** Server title, exactly as received (never translated client-side). */
  serviceTitle: string;
  /** The GROUP's category — used for grouping/filtering, never the item's. */
  categoryId: number | null;
  media: DisplayMedia[];
  /**
   * `items.length` BEFORE filtering. The per-service TOTAL is not documented,
   * so "See all" is offered when rawCount >= the per_service we requested:
   * that is the only honest signal that the server may be holding more.
   */
  rawCount: number;
  /** rawCount >= perService → the group may be truncated. */
  mayHaveMore: boolean;
}

/* ── media_type ──────────────────────────────────────────────────────────── */

/**
 * Classify a raw `media_type`. The live schema declares it as a plain
 * `string` with no enum, so recognised values are matched by prefix:
 *   "video…"            → video
 *   "image…"/photo/img/picture/jpeg/jpg/png/webp → image
 *   empty/missing       → image (a URL with no type is the safer default)
 *   anything else       → null → the item is SKIPPED silently, never rendered
 *     as a broken tile and never guessed into a video.
 */
export function mediaKindOf(mediaType: string | null | undefined): MediaKind | null {
  if (typeof mediaType !== 'string') return 'image';
  const raw = mediaType.trim().toLowerCase();
  if (raw.length === 0) return 'image';
  if (raw.includes('video')) return 'video';
  if (
    raw.startsWith('image') ||
    raw === 'photo' ||
    raw === 'picture' ||
    raw === 'img' ||
    raw === 'jpeg' ||
    raw === 'jpg' ||
    raw === 'png' ||
    raw === 'webp'
  ) {
    return 'image';
  }
  return null;
}

/* ── URLs ────────────────────────────────────────────────────────────────── */

/**
 * Resolve a media URL against the API base. `url` is nullable on the wire and
 * may be absolute (`https://…`), protocol-relative (`//host/x.jpg`) or relative
 * (`/uploads/x.jpg`, `uploads/x.jpg`). No real row has been observed yet, so
 * every documented possibility is supported and anything unusable returns null
 * (the tile is dropped rather than rendered broken).
 */
export function resolveMediaUrl(
  url: string | null | undefined,
  baseUrl: string
): string | null {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (raw.length === 0) return null;
  // Whitespace inside a URL is never valid — it is not a path we can guess at.
  if (/\s/.test(raw)) return null;
  if (/^data:image\//i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  const base = baseUrl.replace(/\/+$/, '');
  return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`;
}

/* ── Item normalisation ──────────────────────────────────────────────────── */

function trimmedCaption(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

/**
 * One raw MediaItemResponse → DisplayMedia, or null when it must not be shown:
 *   • not an object                       → null
 *   • no usable `url`                     → null
 *   • `is_public === false`               → null
 *   • `feedback_type !== "COMPLETED"`     → null  (DENIAL/DISPUTE are private)
 *   • unsupported `media_type`            → null
 * A missing `is_public`/`feedback_type` is treated as "not provably public"
 * and skipped: a public gallery never errs towards showing private photos.
 */
export function normalizeMediaItem(
  raw: unknown,
  baseUrl: string,
  index = 0
): DisplayMedia | null {
  if (raw === null || typeof raw !== 'object') return null;
  const item = raw as MediaItem;

  if (item.is_public !== true) return null;
  if (item.feedback_type !== PUBLIC_FEEDBACK_TYPE) return null;

  const kind = mediaKindOf(item.media_type);
  if (kind === null) return null;

  const url = resolveMediaUrl(item.url, baseUrl);
  if (!url) return null;

  return {
    id: typeof item.id === 'number' && Number.isFinite(item.id) ? item.id : -index - 1,
    url,
    kind,
    caption: trimmedCaption(item.caption),
    createdAt: typeof item.created_at === 'string' ? item.created_at : null,
  };
}

/**
 * Stable identities for a photo across pages and refreshes: the server `id`
 * (rows without one get a synthetic negative id, so it is skipped) plus the
 * resolved URL, which also catches the same photo listed twice with different
 * rows. A photo is a duplicate when ANY of its keys was already seen.
 */
export function mediaIdentityKeys(media: DisplayMedia): string[] {
  const keys = [`url:${media.url}`];
  if (media.id >= 0) keys.push(`id:${media.id}`);
  return keys;
}

/** True when the photo repeats one already collected in `seen`. */
export function isDuplicateMedia(media: DisplayMedia, seen: Set<string>): boolean {
  return mediaIdentityKeys(media).some((key) => seen.has(key));
}

/** Record a photo's identities; call once it is accepted into the list. */
export function rememberMedia(media: DisplayMedia, seen: Set<string>): void {
  mediaIdentityKeys(media).forEach((key) => seen.add(key));
}

/** Normalise an item array, dropping everything that must not be public. */
export function normalizeMediaItems(
  items: unknown,
  baseUrl: string
): DisplayMedia[] {
  if (!Array.isArray(items)) return [];
  const out: DisplayMedia[] = [];
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const media = normalizeMediaItem(item, baseUrl, index);
    if (!media) return;
    // The same row can repeat across pages; dedupe on id and URL.
    if (isDuplicateMedia(media, seen)) return;
    rememberMedia(media, seen);
    out.push(media);
  });
  return out;
}

/** Clamp `per_service` to the documented 1..50 range (and to whole numbers). */
export function clampPerService(value: number | null | undefined): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : DEFAULT_PER_SERVICE;
  return Math.min(MAX_PER_SERVICE, Math.max(1, n));
}

/**
 * `per_category` has exactly the same documented range as `per_service`
 * (integer, 1..50), so it clamps identically — verified live: 0 → 422
 * greater_than_equal, 99 → 422 less_than_equal, "abc" → 422 int_parsing.
 */
export const clampPerCategory = clampPerService;

/* ── Group normalisation ─────────────────────────────────────────────────── */

/**
 * by-service payload → renderable groups.
 *
 *   • SERVER ORDER IS KEPT — the docs do not define an ordering, no real payload
 *     has been observed, and silently re-sorting would hide whatever the
 *     backend actually does. (No alphabetical or "newest first" sort is applied.)
 *   • A group whose items all fail normalisation is DROPPED, so no service
 *     section with zero displayable photos can ever render.
 *   • `rawCount` keeps the pre-filter length for the "may have more" rule.
 *   • Non-array payloads (null/undefined/object) become [].
 */
export function normalizeServiceGroups(
  raw: unknown,
  baseUrl: string,
  perService: number = DEFAULT_PER_SERVICE
): ServiceGalleryGroupView[] {
  if (!Array.isArray(raw)) return [];
  const size = clampPerService(perService);
  const out: ServiceGalleryGroupView[] = [];

  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const group = entry as Partial<ServiceMediaGroup> & { items?: unknown };
    const serviceId = group.service_id;
    if (typeof serviceId !== 'number' || !Number.isFinite(serviceId)) continue;

    const items = Array.isArray(group.items) ? group.items : [];
    const media = normalizeMediaItems(items, baseUrl);
    if (media.length === 0) continue;

    const rawCount = items.length;
    out.push({
      serviceId,
      serviceTitle: typeof group.service_title === 'string' ? group.service_title : '',
      categoryId:
        typeof group.category_id === 'number' && Number.isFinite(group.category_id)
          ? group.category_id
          : null,
      media,
      rawCount,
      mayHaveMore: rawCount >= size,
    });
  }
  return out;
}

/* ── Category groups (by-category) ───────────────────────────────────────── */

/** One category section, ready to render (by-category endpoint). */
export interface CategoryGalleryGroupView {
  categoryId: number;
  /** Server name, exactly as received (never translated client-side). */
  categoryName: string;
  media: DisplayMedia[];
  /** `items.length` BEFORE filtering — the "may have more" signal. */
  rawCount: number;
  /** rawCount >= perCategory → the group may be truncated. */
  mayHaveMore: boolean;
}

/**
 * by-category payload → renderable groups.
 *
 * Same rules as the service groups (this IS the shared normalizer path):
 *   • SERVER ORDER IS KEPT — the docs define no ordering and no populated
 *     payload has been observed, so nothing is re-sorted (no alphabetical, no
 *     "newest first" re-ordering).
 *   • A group whose items all fail normalisation is DROPPED.
 *   • `rawCount` keeps the pre-filter length for the "may have more" rule.
 *   • Non-array payloads (null/undefined/object) become [].
 */
export function normalizeCategoryGroups(
  raw: unknown,
  baseUrl: string,
  perCategory: number = DEFAULT_PER_CATEGORY
): CategoryGalleryGroupView[] {
  if (!Array.isArray(raw)) return [];
  const size = clampPerCategory(perCategory);
  const out: CategoryGalleryGroupView[] = [];

  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const group = entry as Partial<CategoryMediaGroup> & { items?: unknown };
    const categoryId = group.category_id;
    if (typeof categoryId !== 'number' || !Number.isFinite(categoryId)) continue;

    const items = Array.isArray(group.items) ? group.items : [];
    const media = normalizeMediaItems(items, baseUrl);
    if (media.length === 0) continue;

    const rawCount = items.length;
    out.push({
      categoryId,
      categoryName: typeof group.category_name === 'string' ? group.category_name : '',
      media,
      rawCount,
      mayHaveMore: rawCount >= size,
    });
  }
  return out;
}

/** A category's group, or null when the cache holds none for it. */
export function findGroupForCategory(
  groups: readonly CategoryGalleryGroupView[],
  categoryId: number | null | undefined
): CategoryGalleryGroupView | null {
  if (categoryId === null || categoryId === undefined) return null;
  return groups.find((group) => group.categoryId === categoryId) ?? null;
}

/**
 * The title to show for a category group: the app's OWN localised name first
 * (the `cat_<id>` translation the rest of the app uses, then the cached
 * GET /categories name), and only then the server's `category_name`.
 * No request is made to resolve it.
 */
export function resolveCategoryName(
  group: Pick<CategoryGalleryGroupView, 'categoryName'>,
  localizedName?: string | null,
  cachedName?: string | null
): string {
  const candidates = [localizedName, cachedName, group.categoryName];
  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate.trim() : '';
    if (value.length > 0) return value;
  }
  return '';
}

/** The List Public Media wrapper ({service_id, category_id, items}) → items. */
export function normalizePublicMediaResponse(raw: unknown, baseUrl: string): DisplayMedia[] {
  if (raw === null || typeof raw !== 'object') return [];
  return normalizeMediaItems((raw as { items?: unknown }).items, baseUrl);
}

/* ── Selectors ───────────────────────────────────────────────────────────── */

/** Client-side category filter over already-loaded groups (no refetch). */
export function filterGroupsByCategory(
  groups: readonly ServiceGalleryGroupView[],
  categoryId: number | null | undefined
): ServiceGalleryGroupView[] {
  if (categoryId === null || categoryId === undefined) return [...groups];
  return groups.filter((group) => group.categoryId === categoryId);
}

/** A service's group, or null when the cache holds none for it. */
export function findGroupForService(
  groups: readonly ServiceGalleryGroupView[],
  serviceId: number | null | undefined
): ServiceGalleryGroupView | null {
  if (serviceId === null || serviceId === undefined) return null;
  return groups.find((group) => group.serviceId === serviceId) ?? null;
}

/** The best cover for a card: the group's first photo, if any (any group shape). */
export function groupCoverUrl(
  group: { media: readonly DisplayMedia[] } | null | undefined
): string | null {
  const first = group?.media?.[0];
  return first ? first.url : null;
}

/**
 * The title to display for a group: the app's own cached service title when it
 * has one for that id (it is the same server field, but the cached record is
 * what the rest of the app already shows), else the group's own service_title,
 * else ''.
 */
export function resolveServiceTitle(
  group: Pick<ServiceGalleryGroupView, 'serviceTitle'>,
  cachedTitle: string | null | undefined
): string {
  const cached = typeof cachedTitle === 'string' ? cachedTitle.trim() : '';
  if (cached.length > 0) return cached;
  return group.serviceTitle.trim();
}

/* ── Full-screen viewer mapping ──────────────────────────────────────────── */

/** What MediaViewer needs: no private fields, caption + localised date. */
export interface GalleryViewerItem {
  uri: string;
  title: string;
  subtitle: string;
  kind: MediaKind;
}

/**
 * DisplayMedia[] → viewer pages. `formatDate` is injected (the screens pass
 * formatTaskFeedbackTime with the active language) so this module stays pure
 * and the date is always in the user's timezone and language.
 */
export function toGalleryViewerItems(
  media: readonly DisplayMedia[],
  formatDate?: (iso: string) => string
): GalleryViewerItem[] {
  return media.map((item) => ({
    uri: item.url,
    title: item.caption ?? '',
    subtitle: item.createdAt && formatDate ? formatDate(item.createdAt) : '',
    kind: item.kind,
  }));
}
