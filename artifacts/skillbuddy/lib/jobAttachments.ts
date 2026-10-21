/**
 * jobAttachments.ts
 *
 * The client-side rules for the wizard's "Add attachment" strip.
 *
 * ── WHAT THE API DOCUMENTS (live OpenAPI, re-read 2026-10-21) ──────────────
 *   POST   /api/v1/jobs/{job_id}/attachments            multipart/form-data,
 *          ONE required field named `file`, 201 → JobResponse
 *   DELETE /api/v1/jobs/{job_id}/attachments/{id}       removes one attachment
 *
 * The spec declares NO maximum file size, NO maximum count, NO allowed
 * media-type list and NO pagination. The limits below are therefore the APP's
 * own guard rails — chosen so a phone photo uploads on a weak connection and so
 * the strip stays one screen tall — and they are reported as unconfirmed with
 * the backend team. They are enforced client-side with a message that names the
 * real number, never silently.
 *
 * Upload order is fixed: the job is created FIRST (POST /api/v1/jobs), then each
 * file is sent to /jobs/{id}/attachments. A failed file must never cause a second
 * job — see app/job/post.tsx, which keeps the created job id and retries only the
 * files that failed.
 */

/** The app's own ceiling (reported to the backend team as unconfirmed). */
export const MAX_ATTACHMENTS = 5;

/**
 * 10 MB, matching the app's existing single-attachment screen
 * (lib/jobAttachment.ATTACHMENT_MAX_BYTES) so one file never passes on one
 * surface and fails on another. Still an app guard: the API documents none.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Formats the picker may return and the API is expected to accept. */
export const ACCEPTED_ATTACHMENT_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** One file, as the uploader needs it (React Native's multipart part shape). */
export interface AttachmentDraft {
  /** Stable local id for React keys and removal. */
  id: string;
  /** Local file URI (`file:///…` on Android). */
  uri: string;
  /** File name with the extension the server should see. */
  name: string;
  mimeType: string;
  /** Size in bytes when the picker reported one. */
  size: number | null;
}

/** Why a picked file was not accepted. */
export type AttachmentRejectionReason = 'too_many' | 'too_large' | 'type';

export interface AttachmentRejection {
  name: string;
  reason: AttachmentRejectionReason;
}

export interface AttachmentQueueResult {
  /** The full queue after the addition (never longer than MAX_ATTACHMENTS). */
  accepted: AttachmentDraft[];
  /** Files that were dropped, with the reason the UI must explain. */
  rejected: AttachmentRejection[];
}

/** `image/jpeg` etc. from a file name, for pickers that omit the mime type. */
export function mimeFromName(name: string): string {
  const lower = (name || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic';
  return 'image/jpeg';
}

/** Is this one of the formats the strip accepts? (HEIC is converted before this.) */
export function isAcceptedMime(mime: string | null | undefined): boolean {
  const value = typeof mime === 'string' ? mime.toLowerCase() : '';
  return (ACCEPTED_ATTACHMENT_MIME as readonly string[]).includes(value);
}

/** `2.4 MB` / `840 KB` — a human size, never a raw byte count. */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  const kb = bytes / 1024;
  return `${Math.max(1, Math.round(kb))} KB`;
}

/**
 * Add picked files to the queue, enforcing the count, the size and the format.
 *
 * Rules, in this order (so the message is always the most specific one):
 *   1. the queue never exceeds MAX_ATTACHMENTS — the extras are reported as
 *      `too_many`, and the caller's picker limit usually prevents them anyway;
 *   2. an unsupported format is `type` (HEIC must be converted by the picker's
 *      compatible-format option before it reaches this function);
 *   3. a file over MAX_ATTACHMENT_BYTES is `too_large`.
 * Duplicate URIs are ignored silently: re-picking the same photo is not an error.
 */
export function addToAttachmentQueue(
  existing: AttachmentDraft[],
  incoming: AttachmentDraft[],
  max: number = MAX_ATTACHMENTS,
  maxBytes: number = MAX_ATTACHMENT_BYTES
): AttachmentQueueResult {
  const accepted = [...existing];
  const rejected: AttachmentRejection[] = [];
  const seen = new Set(existing.map((file) => file.uri));

  for (const file of incoming) {
    const size = typeof file.size === 'number' ? file.size : null;
    if (seen.has(file.uri)) continue;
    if (accepted.length >= max) {
      rejected.push({ name: file.name, reason: 'too_many' });
      continue;
    }
    if (!isAcceptedMime(file.mimeType)) {
      rejected.push({ name: file.name, reason: 'type' });
      continue;
    }
    if (size !== null && size > maxBytes) {
      rejected.push({ name: file.name, reason: 'too_large' });
      continue;
    }
    seen.add(file.uri);
    accepted.push(file);
  }

  return { accepted, rejected };
}

/** How many more files may be picked (feeds the picker's own selection limit). */
export function remainingSlots(count: number, max: number = MAX_ATTACHMENTS): number {
  return Math.max(0, max - count);
}
