/**
 * serviceMedia.ts
 *
 * Shared media rules for the service media endpoints/sections. Both the
 * `media` array embedded in GET /api/v1/services/{service_id} and the bare
 * array from GET /api/v1/services/{service_id}/media use the SAME
 * ServiceMediaResponse shape, so the ordering / cover / image-vs-video logic
 * lives here once and is used by the Service Detail gallery and by
 * useServiceMedia.
 *
 * Pure functions only (no React, no axios) so they are trivially testable.
 *
 * ── media_type: the live schema does NOT constrain it ───────────────────────
 * ServiceMediaResponse.media_type is `{type: "string"}` — the spec defines no
 * enum for it anywhere (the only enums in the whole document are BidStatus,
 * BookingType, CreditTransactionType, InvoiceStatus, JobRequestType, JobStatus,
 * MilestoneStatus, PaymentMethod, PaymentStatus,
 * ProviderWalletTransactionType and UserRole). So "IMAGE"/"VIDEO" cannot be
 * confirmed from the docs, and the backend is unseeded so no real payload can
 * be observed either. Therefore: any value containing "video"
 * (case-insensitive) is treated as a video, everything else as an image, and
 * the first time an unrecognised value shows up it is logged so the real
 * values surface in the console instead of being guessed at.
 *
 * ── is_thumbnail: ASSUMPTION ────────────────────────────────────────────────
 * The docs do not say what happens when several entries are flagged. We take
 * the flagged entry with the LOWEST position as the cover (and fall back to
 * the first item by position when nothing is flagged). Flagged to the user.
 *
 * ── media_url is NULLABLE ───────────────────────────────────────────────────
 * It is not in the schema's `required` list, so entries without a usable URL
 * are dropped rather than rendered as broken boxes.
 */

import type { ServiceMediaItem } from '@/types';

export type MediaKind = 'image' | 'video';

/** A media entry that is actually renderable, with its kind resolved. */
export interface PreparedMedia {
  id: number;
  kind: MediaKind;
  url: string;
  position: number;
  isThumbnail: boolean;
}

/** media_type values we recognise as images without logging. */
const KNOWN_IMAGE_TYPES = ['image', 'img', 'photo', 'picture', 'thumbnail', 'cover'];

/** Log each unrecognised media_type only once per session (not per render). */
const loggedUnknownTypes = new Set<string>();

/**
 * Classify a raw `media_type`. Anything containing "video" is a video; an
 * empty/missing type is treated as an image (the only safe default that never
 * sends a video URL to an image component); every other value is an image,
 * logged once if we have not seen that exact value before.
 */
export function classifyMediaType(mediaType: string | null | undefined): MediaKind {
  const raw = typeof mediaType === 'string' ? mediaType.trim() : '';

  if (raw.toLowerCase().includes('video')) return 'video';
  if (raw.length === 0) return 'image';

  const lower = raw.toLowerCase();
  if (!KNOWN_IMAGE_TYPES.includes(lower) && !loggedUnknownTypes.has(lower)) {
    loggedUnknownTypes.add(lower);
    console.log(
      '[serviceMedia] unrecognised media_type — rendering as an image:',
      raw
    );
  }
  return 'image';
}

/** True when an entry should be rendered with a video player, not an image. */
export function isVideoMedia(item: ServiceMediaItem | null | undefined): boolean {
  return classifyMediaType(item?.media_type) === 'video';
}

/** A URL is usable only if it is a non-empty, non-whitespace string. */
export function hasUsableUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.trim().length > 0;
}

/**
 * Normalise a raw media array: drop entries with no usable URL, sort by
 * `position` ascending (stable; ties keep server order, non-numeric positions
 * sort last) and resolve each entry's kind. Safe with null/undefined.
 */
export function prepareMedia(
  items: ServiceMediaItem[] | null | undefined
): PreparedMedia[] {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item): item is ServiceMediaItem => !!item && hasUsableUrl(item.media_url))
    .map((item, index) => ({
      id: typeof item.id === 'number' ? item.id : index,
      kind: classifyMediaType(item.media_type),
      url: (item.media_url as string).trim(),
      position:
        typeof item.position === 'number' && Number.isFinite(item.position)
          ? item.position
          : Number.MAX_SAFE_INTEGER,
      isThumbnail: item.is_thumbnail === true,
      _index: index,
    }))
    .sort((a, b) => a.position - b.position || a._index - b._index)
    .map(({ _index, ...rest }) => rest);
}

/** Images only, in gallery order. */
export function imageMedia(items: PreparedMedia[]): PreparedMedia[] {
  return items.filter((item) => item.kind === 'image');
}

/** Videos only, in gallery order. */
export function videoMedia(items: PreparedMedia[]): PreparedMedia[] {
  return items.filter((item) => item.kind === 'video');
}

/**
 * The cover/thumbnail: the flagged entry with the LOWEST position, else the
 * first entry by position. Returns null for an empty list.
 *
 * ASSUMPTION (flagged to the user): the docs never define tie-breaking when
 * several entries have is_thumbnail = true, so lowest position wins.
 */
export function pickThumbnail(items: PreparedMedia[]): PreparedMedia | null {
  if (items.length === 0) return null;

  const flagged = items.filter((item) => item.isThumbnail);
  const pool = flagged.length > 0 ? flagged : items;

  return pool.reduce((best, item) => (item.position < best.position ? item : best));
}

/**
 * Cover URL used by compact list rows / hero images. A video can never be
 * handed to an image component, so when the cover is a video we fall back to
 * the first IMAGE; if the service has only videos this returns null and the
 * caller renders the video player instead.
 */
export function pickCoverImageUrl(items: PreparedMedia[]): string | null {
  const cover = pickThumbnail(items);
  if (cover && cover.kind === 'image') return cover.url;
  return imageMedia(items)[0]?.url ?? null;
}

/** The video to use as the hero when a service has NO images at all. */
export function pickCoverVideo(items: PreparedMedia[]): PreparedMedia | null {
  if (imageMedia(items).length > 0) return null;
  return pickThumbnail(items) ?? videoMedia(items)[0] ?? null;
}
