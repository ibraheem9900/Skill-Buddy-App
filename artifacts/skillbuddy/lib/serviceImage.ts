/**
 * serviceImage.ts — ONE resolver for "which image should this service show?".
 *
 * WHY (boss, Services list): one "Electrician" card showed the gray placeholder
 * while an identical one right below had a picture. Verified live against
 * GET /api/v1/services: there are TWO Electrician records — id 16 carries a
 * `thumbnail_url`, id 15 has `thumbnail_url: null` AND `media: []` (a duplicate
 * row in the data). Yoga Instructor (id 24) has none either. So the card was
 * telling the truth; the data is missing the picture.
 *
 * Still, the app must use every field the API offers before giving up:
 * `image` → `thumbnail` → the first usable gallery image (`media`, preferring
 * the entry flagged `is_thumbnail`, else the lowest `position`). That is the
 * order this helper implements, and every service surface goes through it so a
 * service that has a gallery but no thumbnail shows a picture.
 *
 * Pure (no React, no network) and unit tested.
 */

/** The image-bearing fields a service payload can carry. */
export interface ServiceImageSource {
  /** Not in today's OpenAPI, accepted defensively for future/legacy payloads. */
  image?: string | null;
  image_url?: string | null;
  thumbnail?: string | null;
  thumbnail_url?: string | null;
  /** Service media/gallery (ServiceMediaItem shape). */
  media?: readonly ServiceMediaLike[] | null;
  /** Some endpoints nest the gallery as `images`. */
  images?: readonly (ServiceMediaLike | string)[] | null;
}

export interface ServiceMediaLike {
  media_url?: string | null;
  media_type?: string | null;
  is_thumbnail?: boolean | null;
  position?: number | null;
}

/** A non-blank URL string, or null. Never a relative guess. */
function usableUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // An image must be fetchable by the <Image> component.
  if (!/^(https?:)?\/\//i.test(trimmed) && !trimmed.startsWith('data:image/')) return null;
  return trimmed;
}

function mediaUrl(entry: ServiceMediaLike | string | null | undefined): string | null {
  if (typeof entry === 'string') return usableUrl(entry);
  if (!entry || typeof entry !== 'object') return null;
  // Videos must never reach an <Image>.
  const kind = typeof entry.media_type === 'string' ? entry.media_type.toLowerCase() : '';
  if (kind.length > 0 && kind !== 'image' && kind !== 'photo') return null;
  return usableUrl(entry.media_url);
}

/**
 * The best usable image URL for a service, or null when the record genuinely
 * has none. Order: explicit image → thumbnail → gallery.
 */
export function resolveServiceImage(source: ServiceImageSource | null | undefined): string | null {
  if (!source) return null;

  const direct = usableUrl(source.image) ?? usableUrl(source.image_url);
  if (direct) return direct;

  const thumb = usableUrl(source.thumbnail) ?? usableUrl(source.thumbnail_url);
  if (thumb) return thumb;

  const gallery = Array.isArray(source.media)
    ? source.media
    : Array.isArray(source.images)
      ? source.images
      : [];
  if (gallery.length === 0) return null;

  // The entry explicitly flagged as the service's thumbnail wins…
  for (const entry of gallery) {
    if (typeof entry === 'object' && entry !== null && entry.is_thumbnail) {
      const url = mediaUrl(entry);
      if (url) return url;
    }
  }
  // …then the first image in gallery order (position ascending when known).
  const ordered = [...gallery].sort((a, b) => {
    const pa = typeof a === 'object' && a !== null && typeof a.position === 'number' ? a.position : Number.MAX_SAFE_INTEGER;
    const pb = typeof b === 'object' && b !== null && typeof b.position === 'number' ? b.position : Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });
  for (const entry of ordered) {
    const url = mediaUrl(entry);
    if (url) return url;
  }
  return null;
}

/** True when the record has no usable image anywhere (card shows the glyph). */
export function hasServiceImage(source: ServiceImageSource | null | undefined): boolean {
  return resolveServiceImage(source) !== null;
}
