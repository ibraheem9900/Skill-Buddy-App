import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import RatingStars from '@/components/RatingStars';
import type { MediaViewerItem } from '@/components/MediaViewer';
import { attachmentImageItems } from '@/lib/imageAttachments';
import { resolveOptionLabels, formatTaskFeedbackTime, type FeedbackSide } from '@/lib/taskFeedback';
import type { Review } from '@/lib/reviews';

/**
 * ONE review card, used by the Job Details "Reviews" card, the "Job reviews"
 * screen and the review screen's already-reviewed guard.
 *
 * Everything is defensive because two arrays are still undocumented:
 * `selected_options` is resolved through the options lookup (ids are never
 * printed; an unknown id is skipped) and `attachments` only renders items that
 * carry an image url. A review the API gives as {} or null never reaches this
 * component — the normaliser turns it into "no review".
 */
interface Props {
  review: Review;
  /** Which side of THIS job the viewer is on (labels/copy only). */
  viewerSide: FeedbackSide;
  /**
   * 'mine' adds the Public/Private chip; 'theirs' never shows their choice;
   * 'public' is the provider-profile variant — no chip, a neutral reviewer
   * label as the title, and only what the public review payload carries.
   */
  variant: 'mine' | 'theirs' | 'public';
  /** Card heading, already translated by the caller. */
  title: string;
  optionLookup: ReadonlyMap<number, string>;
  onOpenMedia: (items: MediaViewerItem[], index: number) => void;
  /** Job Details shows a short version; the reviews screen shows everything. */
  compact?: boolean;
  /**
   * False when the owner renders the photos itself ("My review" renders them in
   * the removable photo grid instead, so they must not appear twice).
   */
  showPhotos?: boolean;
}

export default function ReviewCard({
  review,
  viewerSide,
  variant,
  title,
  optionLookup,
  onOpenMedia,
  compact = false,
  showPhotos = true,
}: Props) {
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [truncatable, setTruncatable] = useState(false);

  const labels = resolveOptionLabels(review.selected_options, optionLookup);
  const attachments = attachmentImageItems(review.attachments);
  const date = formatTaskFeedbackTime(review.published_at ?? review.created_at, language);
  const lines = compact ? 3 : 5;

  const onTextLayout = useCallback(
    (event: { nativeEvent: { lines: unknown[] } }) => {
      if (!truncatable && event.nativeEvent.lines.length > lines) setTruncatable(true);
    },
    [lines, truncatable]
  );

  const openAttachment = useCallback(
    (index: number) => {
      onOpenMedia(
        attachments.map((attachment) => ({
          uri: attachment.url,
          title: title,
          kind: 'image' as const,
        })),
        index
      );
    },
    [attachments, onOpenMedia, title]
  );

  const publicLabel = review.show_publicly ? t('fb_rev_public_chip') : t('fb_rev_private_chip');

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.headRow}>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
          {title}
        </Text>
        {variant === 'mine' ? (
          <View
            style={[
              styles.badge,
              {
                backgroundColor: review.show_publicly ? c.primaryLight : c.muted,
                borderColor: c.border,
              },
            ]}
          >
            <Feather
              name={review.show_publicly ? 'eye' : 'eye-off'}
              size={11}
              color={review.show_publicly ? c.primary : c.mutedForeground}
            />
            <Text
              style={[
                styles.badgeText,
                { color: review.show_publicly ? c.primary : c.mutedForeground },
              ]}
            >
              {publicLabel}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.ratingRow}>
        <RatingStars rating={review.rating} size={16} showValue={false} color={c.rating} />
        {date ? <Text style={[styles.date, { color: c.mutedForeground }]}>{date}</Text> : null}
      </View>

      {labels.length > 0 ? (
        <View style={styles.chipWrap}>
          {labels.slice(0, compact ? 4 : undefined).map((label, index) => (
            <View
              key={`${label}-${index}`}
              style={[styles.chip, { backgroundColor: c.primaryLight, borderColor: c.border }]}
            >
              <Text style={[styles.chipText, { color: c.accentForeground }]}>{label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {review.comment.trim().length > 0 ? (
        <>
          <Text
            style={[styles.comment, { color: c.text }]}
            numberOfLines={expanded ? undefined : lines}
            onTextLayout={onTextLayout}
          >
            {review.comment.trim()}
          </Text>
          {truncatable || expanded ? (
            <TouchableOpacity
              onPress={() => setExpanded((value) => !value)}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              style={styles.moreBtn}
            >
              <Text style={[styles.moreText, { color: c.primary }]}>
                {expanded ? t('fb_show_less') : t('fb_show_more')}
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}

      {showPhotos && attachments.length > 0 ? (
        <View style={styles.thumbRow}>
          {attachments.slice(0, compact ? 3 : attachments.length).map((attachment, index) => (
            <TouchableOpacity
              key={`${attachment.id ?? 'p'}-${attachment.url}`}
              onPress={() => openAttachment(index)}
              activeOpacity={0.85}
              accessibilityRole="imagebutton"
              style={[styles.thumb, { borderColor: c.border }]}
            >
              <Image
                source={{ uri: attachment.url }}
                style={styles.thumbImage}
                contentFit="cover"
                transition={120}
              />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  badgeText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  date: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  chipText: { fontFamily: 'Manrope_500Medium', fontSize: 12, flexShrink: 1 },
  comment: { fontFamily: 'Manrope_400Regular', fontSize: 14, lineHeight: 20 },
  moreBtn: { alignSelf: 'flex-start' },
  moreText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: 64, height: 64, borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  thumbImage: { width: '100%', height: '100%' },
});
