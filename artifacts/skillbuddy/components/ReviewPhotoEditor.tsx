import React, { useCallback } from 'react';
import ImageAttachmentPicker from '@/components/ImageAttachmentPicker';
import { useAppAlert } from '@/context/AlertModalContext';
import { useLanguage } from '@/context/LanguageContext';
import type { AttachmentImage } from '@/lib/imageAttachments';
import type { ReviewPhotoUploader } from '@/hooks/useReviewPhotos';

/**
 * The review-photo grid for "My review" surfaces.
 *
 * Server-side review photos are rendered HERE (not by ReviewCard) because the
 * author may also remove them: passing `uploaded` + `removal` gives the grid the
 * real attachment ids, the 5-photo counter and the trash action. When `uploaded`
 * is omitted the editor only shows the local queue (the review form and the
 * post-submit step), exactly as before.
 *
 * Removal is only wired from surfaces that show the viewer's OWN review; the
 * public lists and "Their review" render photos through the view-only ReviewCard.
 */
interface Props {
  uploader: ReviewPhotoUploader;
  /** Server photos (as the removable grid). Omit for local-queue-only views. */
  uploaded?: readonly AttachmentImage[];
  /** False hides the add tile (e.g. the success view after submitting). */
  canAdd?: boolean;
}

export default function ReviewPhotoEditor({ uploader, uploaded, canAdd = true }: Props) {
  const { t } = useLanguage();
  const showAlert = useAppAlert();
  const hasPhotos = (uploaded?.length ?? 0) + uploader.existingCount > 0;

  const onRemovalResult = useCallback(
    (result: 'removed' | 'gone' | 'failed') => {
      if (result === 'removed') {
        showAlert({ title: t('fb_remove_toast'), icon: 'check' });
      } else if (result === 'gone') {
        // 404: the server already had it removed, the list was merely stale.
        showAlert({ title: t('fb_remove_gone_toast'), icon: 'check' });
      }
      // A failure keeps the photo and is explained by the grid's own note + Retry.
    },
    [showAlert, t]
  );

  return (
    <ImageAttachmentPicker
      uploader={uploader}
      existingCount={uploaded ? uploaded.length : uploader.existingCount}
      uploaded={uploaded}
      removal={uploaded ? uploader.removal : undefined}
      labelKey="fb_rev_photos_label"
      addKey={hasPhotos ? 'fb_rev_photos_add_more' : 'fb_rev_photos_add'}
      hintKey="fb_rev_photos_hint"
      pendingNoteKey="fb_rev_photos_pending"
      failedNoteKey="fb_rev_photos_failed"
      namePrefix="review"
      canAdd={canAdd}
      showHint={false}
      removeTitleKey="fb_rev_remove_title"
      removeMsgKey="fb_rev_remove_msg"
      onRemovalResult={onRemovalResult}
    />
  );
}
