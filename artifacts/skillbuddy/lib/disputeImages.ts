/**
 * Dispute images — the dispute-flavoured names for the shared image rules in
 * lib/imageAttachments. The rules are identical for every feedback photo
 * endpoint (JPG/PNG/WebP, max 5, EXIF/GPS stripped server-side); only the file
 * prefix differs, so `dispute-…` names stay stable for existing dispute photos.
 *
 * This module is a compatibility layer: screens/tests written before review
 * photos existed keep importing these names, while the implementation lives in
 * one place.
 */
import { MAX_DISPUTE_IMAGES } from './feedback';
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

export { MAX_DISPUTE_IMAGES };

export type DisputeImageFormat = AttachmentImageFormat;
export type DisputeImageFormatInfo = AttachmentImageFormatInfo;

export const resolveDisputeImageFormat = resolveImageFormat;
export const disputeMime = imageMime;
export const disputeExtension = imageExtension;

/** `dispute-<timestamp>-<n>.jpg` — a clean, collision-free, correct-extension name. */
export function buildDisputeImageName(
  timestamp: number,
  index: number,
  format: DisputeImageFormat
): string {
  return buildAttachmentImageName('dispute', timestamp, index, format);
}

export const remainingDisputeSlots = remainingAttachmentSlots;
export const canAddDisputeImage = canAddAttachmentImage;
export const selectNewDisputeUris = selectNewAttachmentUris;

export const DISPUTE_MAX_DIMENSION = ATTACHMENT_MAX_DIMENSION;
export const DISPUTE_JPEG_QUALITY = ATTACHMENT_JPEG_QUALITY;
export const resizeDimensions = resizeImageDimensions;

export type DisputeAttachment = AttachmentImage;
export const attachmentItems = attachmentImageItems;

export type DisputeUploadFailure = ImageUploadFailure;
export const classifyDisputeUploadFailure = classifyImageUploadFailure;

export type DisputeRemoveFailure = ImageRemoveFailure;
export const classifyDisputeRemoveFailure = classifyImageRemoveFailure;

/**
 * Five is documented for both dispute and review photos. Kept as the source of
 * truth for dispute slots so a future change stays consistent.
 */
export const DISPUTE_IMAGE_LIMIT = MAX_ATTACHMENT_IMAGES;
