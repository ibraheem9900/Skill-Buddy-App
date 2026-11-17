/**
 * Image attachments — the shared, pure rules behind every photo uploader in the
 * feedback flow (dispute photos and review photos).
 *
 * Documented contract both places:
 *   • JPG/PNG/WebP only (HEIC/HEIF must be converted to JPEG),
 *   • max 5 photos per feedback/review,
 *   • EXIF/GPS is stripped by the server (nothing here touches metadata),
 *   • multipart body: exactly one `file` part.
 *
 * No file-size limit is documented, so none is invented — the client only
 * resizes to 1600px and re-encodes at quality 0.8 to keep uploads quick.
 *
 * The item shape inside an attachment list is documented in the live OpenAPI as
 * `MediaItemResponse[]` (numeric `id`, nullable `url`), but no real row has been
 * observed in this environment, so parsing stays defensive: an item is only
 * rendered when it carries a usable image URL, and it is only removable when it
 * also carries a numeric id.
 */

export const MAX_ATTACHMENT_IMAGES = 5;

export type AttachmentImageFormat = 'jpeg' | 'png' | 'webp';

export interface AttachmentImageFormatInfo {
  format: AttachmentImageFormat;
  /** True when the picker handed us a format the server refuses (HEIC/HEIF). */
  convert: boolean;
}

const EXTENSION_FORMAT: Record<string, AttachmentImageFormat> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
};

const MIME_FORMAT: Record<string, AttachmentImageFormat> = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/pjpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** HEIC/HEIF are what iOS cameras produce; they MUST be converted to JPEG. */
const CONVERT_MIMES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

function extensionOf(fileName: string | null | undefined): string {
  if (!fileName) return '';
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * Decides what the server will receive. Returns null for a type the API does not
 * accept (e.g. GIF, PDF, video) so the screen can explain it instead of sending
 * a file that would be rejected.
 */
export function resolveImageFormat(
  mimeType: string | null | undefined,
  fileName?: string | null
): AttachmentImageFormatInfo | null {
  const mime = (mimeType ?? '').trim().toLowerCase();
  const ext = extensionOf(fileName);

  if (CONVERT_MIMES.has(mime)) return { format: 'jpeg', convert: true };
  if (mime && MIME_FORMAT[mime]) return { format: MIME_FORMAT[mime], convert: false };

  // iOS sometimes omits the mime type; the extension is then the only signal.
  if (ext === 'heic' || ext === 'heif') return { format: 'jpeg', convert: true };
  if (ext && EXTENSION_FORMAT[ext]) return { format: EXTENSION_FORMAT[ext], convert: false };
  // An unknown mime with no usable extension is not something to guess about.
  return null;
}

export function imageMime(format: AttachmentImageFormat): string {
  return format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
}

export function imageExtension(format: AttachmentImageFormat): string {
  return format === 'png' ? 'png' : format === 'webp' ? 'webp' : 'jpg';
}

/**
 * `<prefix>-<timestamp>-<n>.<ext>` — a clean, collision-free, correct-extension
 * name. The prefix keeps dispute and review photos distinguishable in logs.
 */
export function buildAttachmentImageName(
  prefix: string,
  timestamp: number,
  index: number,
  format: AttachmentImageFormat
): string {
  const stamp = Number.isFinite(timestamp) ? Math.abs(Math.trunc(timestamp)) : Date.now();
  const safePrefix = prefix.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'image';
  return `${safePrefix}-${stamp}-${Math.max(0, Math.trunc(index))}.${imageExtension(format)}`;
}

/* ── Slots ────────────────────────────────────────────────────────────────── */

/** Slots left, counting images the server already holds plus local ones. */
export function remainingAttachmentSlots(
  existingCount: number,
  pendingCount: number,
  max: number = MAX_ATTACHMENT_IMAGES
): number {
  const used = Math.max(0, existingCount) + Math.max(0, pendingCount);
  return Math.max(0, max - used);
}

export function canAddAttachmentImage(
  existingCount: number,
  pendingCount: number,
  max: number = MAX_ATTACHMENT_IMAGES
): boolean {
  return remainingAttachmentSlots(existingCount, pendingCount, max) > 0;
}

/**
 * Trims a multi-pick to what still fits and drops uris already in the picker.
 * Returns the accepted uris plus how many were refused, so the screen can say
 * what happened instead of silently ignoring taps.
 */
export function selectNewAttachmentUris(
  existingUris: readonly string[],
  picked: readonly string[],
  slots: number
): { accepted: string[]; overflow: number; duplicates: number } {
  const seen = new Set(existingUris);
  const accepted: string[] = [];
  let overflow = 0;
  let duplicates = 0;
  for (const uri of picked) {
    if (seen.has(uri)) {
      duplicates += 1;
      continue;
    }
    if (accepted.length >= Math.max(0, slots)) {
      overflow += 1;
      continue;
    }
    seen.add(uri);
    accepted.push(uri);
  }
  return { accepted, overflow, duplicates };
}

/* ── Resize ───────────────────────────────────────────────────────────────── */

export const ATTACHMENT_MAX_DIMENSION = 1600;
export const ATTACHMENT_JPEG_QUALITY = 0.8;

/**
 * Longest side capped at `max`, aspect ratio kept, no upscaling. Returns null
 * when the photo already fits (so no manipulation pass is needed at all).
 */
export function resizeImageDimensions(
  width: number,
  height: number,
  max: number = ATTACHMENT_MAX_DIMENSION
): { width: number; height: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  if (width <= max && height <= max) return null;
  const scale = max / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/* ── Attachment items ─────────────────────────────────────────────────────── */

const URL_KEYS = ['url', 'file_url', 'image_url', 'uri'] as const;

function isImageUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^file:\/\//i.test(value);
}

/** One uploaded photo as the app can prove it from an attachment list. */
export interface AttachmentImage {
  /** `null` when the item carried no numeric id — such a photo is VIEW ONLY. */
  id: number | null;
  url: string;
}

function attachmentId(entry: Record<string, unknown>): number | null {
  if (typeof entry.id === 'number' && Number.isFinite(entry.id)) return entry.id;
  if (typeof entry.attachment_id === 'number' && Number.isFinite(entry.attachment_id)) {
    return entry.attachment_id;
  }
  return null;
}

/**
 * Reads an attachment list without guessing field names beyond the obvious
 * ones: a plain image url string, or an object carrying an image url plus a
 * numeric id (never `id` alone, never a filename). The documented
 * `MediaItemResponse` uses `{id, url}`, where `url` may be null; anything without
 * a usable URL is skipped instead of rendering a broken tile.
 */
export function attachmentImageItems(attachments: readonly unknown[]): AttachmentImage[] {
  const out: AttachmentImage[] = [];
  const seen = new Set<string>();
  for (const entry of attachments) {
    let url: string | null = null;
    let id: number | null = null;
    if (typeof entry === 'string') {
      url = isImageUrl(entry) ? entry : null;
    } else if (entry !== null && typeof entry === 'object') {
      const row = entry as Record<string, unknown>;
      for (const key of URL_KEYS) {
        const value = row[key];
        if (typeof value === 'string' && isImageUrl(value)) {
          url = value;
          break;
        }
      }
      id = attachmentId(row);
    }
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ id, url });
  }
  return out;
}

/* ── Failures ─────────────────────────────────────────────────────────────── */

export type ImageUploadFailure =
  | 'offline'
  | 'unauthorized'
  | 'notallowed'
  | 'too-large'
  | 'invalid'
  | 'server'
  | 'unknown';

/**
 * Maps a transport failure to the message the user gets. 413 is "too large",
 * 422 is a rejected file, 403/404 means this is not the user's photo (or it is
 * gone). Nothing raw is ever shown.
 */
export function classifyImageUploadFailure(status: number): ImageUploadFailure {
  if (status === 0) return 'offline';
  if (status === 401) return 'unauthorized';
  if (status === 403 || status === 404) return 'notallowed';
  if (status === 413) return 'too-large';
  if (status === 422) return 'invalid';
  if (status >= 500) return 'server';
  return 'unknown';
}

/**
 * DELETE /attachments/{id} documents only 204 and 422; every other code is
 * handled generically. 404 is its own state because it means the photo is
 * already gone — nothing to undo, just refresh. 409 is reported as "can no
 * longer be changed" without claiming to know WHY the backend refused.
 */
export type ImageRemoveFailure =
  | 'offline'
  | 'unauthorized'
  | 'forbidden'
  | 'gone'
  | 'invalid'
  | 'conflict'
  | 'server'
  | 'unknown';

export function classifyImageRemoveFailure(status: number): ImageRemoveFailure {
  if (status === 0) return 'offline';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'gone';
  if (status === 409) return 'conflict';
  if (status === 422) return 'invalid';
  if (status >= 500) return 'server';
  return 'unknown';
}

/* ── Removal contract ─────────────────────────────────────────────────────── */

export type ImageRemovalState = 'removing' | 'failed';

export interface ImageRemovalEntry {
  state: ImageRemovalState;
  failure: ImageRemoveFailure | null;
}

export type ImageRemovalResult =
  | { status: 'ok' }
  | { status: 'gone' }
  | { status: 'failed'; failure: ImageRemoveFailure }
  | { status: 'busy' }
  | { status: 'unavailable' };

/**
 * What a picker needs to render server-side removal. Kept structural so the
 * dispute removal hook can be passed without teaching this module about it.
 */
export interface ImageAttachmentRemoval {
  stateOf: (attachmentId: number) => ImageRemovalEntry | undefined;
  remove: (attachmentId: number) => Promise<ImageRemovalResult>;
  removing: boolean;
}
