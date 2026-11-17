import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import ReviewCard from '@/components/ReviewCard';
import ReviewPhotoEditor from '@/components/ReviewPhotoEditor';
import { useLanguage } from '@/context/LanguageContext';
import { useReviewPhotos } from '@/hooks/useReviewPhotos';
import { attachmentImageItems } from '@/lib/imageAttachments';
import type { Review } from '@/lib/reviews';
import type { FeedbackSide } from '@/lib/taskFeedback';
import type { MediaViewerItem } from '@/components/MediaViewer';

/**
 * "My review" + the photo editor for it.
 *
 * The review itself still renders through the ONE ReviewCard (public/private
 * chip, stars, options, comment). This wrapper owns the review-photo grid so
 * adding — and now REMOVING — a photo is possible from every screen that shows
 * my review: Job Details, Job reviews and the already-reviewed guard.
 *
 * Photos are rendered by the editor (not the summary card) so they carry the
 * real attachment id: removing one calls DELETE /reviews/{id}/attachments/{aid},
 * stays non-optimistic, and refreshes the job-review cache plus the public
 * review lists. Only this component — i.e. the author's own review — wires that.
 */
interface Props {
  review: Review;
  viewerSide: FeedbackSide;
  optionLookup: ReadonlyMap<number, string>;
  onOpenMedia: (items: MediaViewerItem[], index: number) => void;
  compact?: boolean;
  /** Heading for the review card; defaults to "Your review". */
  title?: string;
  /** Hide the photo editor where only the review summary belongs. */
  showPhotoEditor?: boolean;
}

export default function MyReviewCard({
  review,
  viewerSide,
  optionLookup,
  onOpenMedia,
  compact = false,
  title,
  showPhotoEditor = true,
}: Props) {
  const { t } = useLanguage();
  // The documented cap counts every attachment the server holds, including one
  // whose URL is temporarily null. The grid skips unrenderable items but the
  // counter must still reserve their slot — hence existingCount from the array
  // length, not from the rendered tiles.
  const existingPhotos = review.attachments.length;
  const photos = useReviewPhotos(review.id, existingPhotos, review.job_id);
  const uploaded = useMemo(() => attachmentImageItems(review.attachments), [review.attachments]);

  return (
    <View style={styles.wrap}>
      <ReviewCard
        review={review}
        viewerSide={viewerSide}
        variant="mine"
        title={title ?? t('fb_rev_your')}
        optionLookup={optionLookup}
        onOpenMedia={onOpenMedia}
        compact={compact}
        showPhotos={false}
      />
      {showPhotoEditor && review.id !== null ? (
        <ReviewPhotoEditor uploader={photos} uploaded={uploaded} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
});
