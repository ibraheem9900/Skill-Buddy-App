/**
 * Review photos — the review-flavoured names for the shared image rules in
 * lib/imageAttachments.
 *
 * DOCUMENTED (live OpenAPI, 2026-11-16):
 *   POST /api/v1/reviews/{review_id}/attachments — "Add Review Photo"
 *     body: multipart/form-data, exactly one `file` part
 *     accepts JPG/PNG/WebP, max 5 per review, location data removed
 *     201 → JobReviewResponse (with `attachments: MediaItemResponse[]`)
 *   DELETE /api/v1/reviews/{review_id}/attachments/{attachment_id} — "Remove
 *     Review Photo": 204 with an EMPTY body, 422 validation error. Nothing is
 *     documented about 401/403/404/409, or about an ownership/window rule, so
 *     the client maps whatever status arrives to one friendly sentence and
 *     never invents a rule of its own.
 *
 * The documented 5-photo cap counts the attachments the server already holds
 * plus the photos still queued on this device. `MediaItemResponse` carries a
 * numeric `id` and a nullable `url`; no review row with attachments has been
 * observed live in this environment, so parsing stays defensive.
 */
import {
  ATTACHMENT_JPEG_QUALITY,
  ATTACHMENT_MAX_DIMENSION,
  MAX_ATTACHMENT_IMAGES,
  attachmentImageItems,
  buildAttachmentImageName,
  canAddAttachmentImage,
  classifyImageRemoveFailure,
  classifyImageUploadFailure,
  imageExtension,
  imageMime,
  remainingAttachmentSlots,
  resizeImageDimensions,
  resolveImageFormat,
  selectNewAttachmentUris,
  type AttachmentImage,
  type AttachmentImageFormat,
  type AttachmentImageFormatInfo,
  type ImageRemoveFailure,
  type ImageUploadFailure,
} from './imageAttachments';

/** The same documented per-item cap as dispute photos. */
export const MAX_REVIEW_PHOTOS = MAX_ATTACHMENT_IMAGES;

export type ReviewPhotoFormat = AttachmentImageFormat;
export type ReviewPhotoFormatInfo = AttachmentImageFormatInfo;

export const resolveReviewPhotoFormat = resolveImageFormat;
export const reviewPhotoMime = imageMime;
export const reviewPhotoExtension = imageExtension;

/** `review-<timestamp>-<n>.jpg` — clear, collision-free, correct extension. */
export function buildReviewPhotoName(
  timestamp: number,
  index: number,
  format: ReviewPhotoFormat
): string {
  return buildAttachmentImageName('review', timestamp, index, format);
}

export const remainingReviewPhotoSlots = remainingAttachmentSlots;
export const canAddReviewPhoto = canAddAttachmentImage;
export const selectNewReviewPhotoUris = selectNewAttachmentUris;

export const REVIEW_PHOTO_MAX_DIMENSION = ATTACHMENT_MAX_DIMENSION;
export const REVIEW_PHOTO_JPEG_QUALITY = ATTACHMENT_JPEG_QUALITY;
export const resizeReviewPhotoDimensions = resizeImageDimensions;

export type ReviewPhotoAttachment = AttachmentImage;
export const reviewPhotoAttachments = attachmentImageItems;

export type ReviewPhotoUploadFailure = ImageUploadFailure;
export const classifyReviewPhotoUploadFailure = classifyImageUploadFailure;

export type ReviewPhotoRemoveFailure = ImageRemoveFailure;
export const classifyReviewPhotoRemoveFailure = classifyImageRemoveFailure;

/**
 * Uploaded review photos can be removed from "My review" surfaces by their
 * author. The DELETE succeeds with an empty 204 body, so removal is never
 * optimistic: the tile stays until the server confirms, then the review cache
 * and the public review lists are refreshed.
 */
export const REVIEW_PHOTO_REMOVE_AVAILABLE = true;
