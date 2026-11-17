import { useCallback } from 'react';
import { MAX_REVIEW_PHOTOS, classifyReviewPhotoUploadFailure } from '@/lib/reviewPhotos';
import { useImageAttachmentUploader, type ImageAttachmentUploader } from '@/hooks/useImageAttachmentUploader';
import { useAttachmentRemoval, type AttachmentRemoval } from '@/hooks/useAttachmentRemoval';
import { invalidateJobReviews, updateJobReviewsMyReview } from '@/hooks/useJobReviews';
import { invalidateProviderReviews } from '@/hooks/useProviderReviews';
import { invalidateClientReviews } from '@/hooks/useClientReviews';
import { removeReviewPhoto, uploadReviewPhoto, type JobReview } from '@/services/feedback';

/**
 * Photo queue for ONE review — adding AND removing.
 *
 * REVIEW ID IS NULL UNTIL THE REVIEW IS SUBMITTED. The form therefore queues
 * photos locally, submits the review first, then passes the returned review id
 * here: the generic uploader adopts the id and starts sending the queue in order
 * (one request at a time). A 201 response is the updated JobReviewResponse, so
 * the job-review cache is patched immediately and the public review lists are
 * invalidated.
 *
 * Removal uses the SAME useAttachmentRemoval state machine as dispute photos.
 * A 204 is not optimistic: the tile stays until the request succeeds, then the
 * job-review cache is invalidated (my_review is re-read from the server) and the
 * public provider/client review pages are dropped, so the photo disappears
 * everywhere without a manual refresh and the freed slot lets a 5th photo in.
 *
 * Only the review author is given these actions, and only on "My review"
 * surfaces — see MyReviewCard / ReviewPhotoEditor.
 */
export interface ReviewPhotoUploader extends ImageAttachmentUploader {
  /** DELETE state + actions for photos the server already holds. */
  removal: AttachmentRemoval;
}

export function useReviewPhotos(
  reviewId: number | null,
  existingCount: number,
  jobId?: number | null
): ReviewPhotoUploader {
  const onUploaded = useCallback(
    (updated: JobReview) => {
      const targetJob = updated.job_id ?? jobId ?? null;
      if (targetJob !== null) updateJobReviewsMyReview(targetJob, updated);
      // The uploaded photo can appear on the public pilot/client review pages;
      // their caches are stale the moment the server returns 201.
      invalidateProviderReviews();
      invalidateClientReviews();
    },
    [jobId]
  );

  // After a 204 (or a 404, where the row is merely stale) the cached review must
  // be re-read: the DELETE has no body, so the authoritative attachment list
  // only comes back from GET /jobs/{id}/reviews.
  const onRemoved = useCallback(() => {
    if (jobId !== null && jobId !== undefined) invalidateJobReviews(jobId);
    invalidateProviderReviews();
    invalidateClientReviews();
  }, [jobId]);

  const uploader = useImageAttachmentUploader<JobReview>(
    reviewId,
    existingCount,
    uploadReviewPhoto,
    onUploaded,
    {
      limit: MAX_REVIEW_PHOTOS,
      // The review card renders server attachments as soon as the cache update
      // lands, so a local success tile is not needed for even one frame.
      removeUploadedDelayMs: 0,
      classifyFailure: classifyReviewPhotoUploadFailure,
    }
  );

  const removal = useAttachmentRemoval(reviewId, removeReviewPhoto, onRemoved);

  return { ...uploader, removal };
}

export default useReviewPhotos;
