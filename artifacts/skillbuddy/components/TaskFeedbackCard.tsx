import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import ImageAttachmentPicker from '@/components/ImageAttachmentPicker';
import { useImageAttachmentUploader } from '@/hooks/useImageAttachmentUploader';
import { useDisputeAttachmentRemoval } from '@/hooks/useDisputeAttachmentRemoval';
import { attachmentItems, type DisputeAttachment, type DisputeRemoveFailure } from '@/lib/disputeImages';
import { uploadDisputeImage } from '@/services/feedback';
import {
  authorLabelKind,
  formatTaskFeedbackTime,
  kindLabelKind,
  resolveOptionLabels,
  type FeedbackSide,
  type KindLabelKind,
  type TaskFeedback,
} from '@/lib/taskFeedback';

/**
 * One denial/dispute entry of a Task's feedback history.
 *
 * Every field is rendered defensively: unknown kinds and author sides fall back
 * to neutral labels, option ids that cannot be resolved are skipped (never
 * printed), and attachments that are not image urls render nothing.
 */
const KIND_KEY: Record<KindLabelKind, TranslationKey> = {
  denial: 'fb_kind_denial',
  dispute: 'fb_kind_dispute',
  other: 'fb_kind_other',
};

const AUTHOR_KEY: Record<'you' | 'client' | 'pilot' | 'participant', TranslationKey> = {
  you: 'fb_author_you',
  client: 'fb_author_client',
  pilot: 'fb_author_pilot',
  participant: 'fb_author_participant',
};

interface Props {
  item: TaskFeedback;
  viewerSide: FeedbackSide;
  optionLookup: ReadonlyMap<number, string>;
  onOpenImages: (item: TaskFeedback, attachments: DisputeAttachment[], index: number) => void;
  /** Re-reads the history after this entry gained an image. */
  onUploaded?: () => void;
  /** Lets the screen toast a removal (its own popup lives in the grid). */
  onRemovalResult?: (result: 'removed' | 'gone' | 'failed', failure?: DisputeRemoveFailure) => void;
}

export default function TaskFeedbackCard({
  item,
  viewerSide,
  optionLookup,
  onOpenImages,
  onUploaded,
  onRemovalResult,
}: Props) {
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [truncatable, setTruncatable] = useState(false);

  const kind = kindLabelKind(item.kind);
  const author = authorLabelKind(item.author_side, viewerSide);
  const time = formatTaskFeedbackTime(item.created_at, language);
  const labels = resolveOptionLabels(item.selected_options, optionLookup);
  const attachments = attachmentItems(item.attachments);

  // Only the author may add pictures to their own denial/dispute, and only while
  // the 5-per-feedback limit (server attachments + queued ones) allows it.
  // The other side is read-only: no add tile, and uploaded photos carry no
  // remove control at all — Remove Dispute Image (DELETE) is still a TODO stub.
  const canAddMore = author === 'you';
  const handleUploaded = useCallback(() => onUploaded?.(), [onUploaded]);
  const uploader = useImageAttachmentUploader<TaskFeedback>(
    canAddMore ? item.id : null,
    attachments.length,
    uploadDisputeImage,
    handleUploaded
  );
  // Same author-only rule for deleting: the other side never gets the hook's
  // actions, and every uploaded photo without a numeric id is view-only.
  const removal = useDisputeAttachmentRemoval(canAddMore ? item.id : null);

  const kindStyle =
    kind === 'denial'
      ? { backgroundColor: c.urgentBg, borderColor: c.urgentBorder, text: c.urgentText }
      : kind === 'dispute'
        ? { backgroundColor: c.destructiveLight, borderColor: c.destructive, text: c.destructive }
        : { backgroundColor: c.muted, borderColor: c.border, text: c.mutedForeground };

  const onTextLayout = useCallback(
    (event: { nativeEvent: { lines: unknown[] } }) => {
      if (!truncatable && event.nativeEvent.lines.length > 4) setTruncatable(true);
    },
    [truncatable]
  );

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.headRow}>
        <View
          style={[
            styles.kindBadge,
            { backgroundColor: kindStyle.backgroundColor, borderColor: kindStyle.borderColor },
          ]}
        >
          <Feather
            name={kind === 'dispute' ? 'alert-triangle' : kind === 'denial' ? 'slash' : 'message-circle'}
            size={11}
            color={kindStyle.text}
          />
          <Text style={[styles.kindText, { color: kindStyle.text }]}>{t(KIND_KEY[kind])}</Text>
        </View>
        <Text style={[styles.author, { color: c.text }]} numberOfLines={1}>
          {t(AUTHOR_KEY[author])}
        </Text>
      </View>

      {time ? (
        <Text style={[styles.time, { color: c.mutedForeground }]}>{time}</Text>
      ) : null}

      {labels.length > 0 ? (
        <View style={styles.chipWrap}>
          {labels.map((label, index) => (
            <View
              key={`${label}-${index}`}
              style={[styles.chip, { backgroundColor: c.primaryLight, borderColor: c.border }]}
            >
              <Text style={[styles.chipText, { color: c.accentForeground }]}>{label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {item.message.trim().length > 0 ? (
        <>
          <Text
            style={[styles.message, { color: c.text }]}
            numberOfLines={expanded ? undefined : 4}
            onTextLayout={onTextLayout}
          >
            {item.message}
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

      {/* Uploaded photos and the add tile share ONE grid (the same widget the
          dispute form uses), so the counter, the states and the remove action
          stay in one place. Read-only for the other side. */}
      {canAddMore || attachments.length > 0 ? (
        <View style={styles.addWrap}>
          <ImageAttachmentPicker
            uploader={uploader}
            existingCount={attachments.length}
            uploaded={attachments}
            removal={canAddMore ? removal : undefined}
            label={canAddMore ? t('fb_images_add_more') : t('fb_images_label')}
            namePrefix="dispute"
            canAdd={canAddMore}
            showHint={false}
            onOpenAttachment={(index) => onOpenImages(item, attachments, index)}
            onRemovalResult={onRemovalResult}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  kindBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  kindText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
  author: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 13, textAlign: 'right' },
  time: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  chipText: { fontFamily: 'Manrope_500Medium', fontSize: 12, flexShrink: 1 },
  message: { fontFamily: 'Manrope_400Regular', fontSize: 14, lineHeight: 20 },
  moreBtn: { alignSelf: 'flex-start' },
  moreText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  addWrap: { marginTop: 4 },
});
