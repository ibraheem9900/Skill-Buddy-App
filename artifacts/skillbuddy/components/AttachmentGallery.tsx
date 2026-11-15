import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { classifyMediaType, hasUsableUrl } from '@/lib/serviceMedia';
import MediaViewer, { type MediaViewerItem } from '@/components/MediaViewer';
import type { JobAttachmentResponse } from '@/types';

interface Props {
  attachments: JobAttachmentResponse[];
  canDelete: boolean;
  onDelete: (attachment: JobAttachmentResponse) => void;
  removingId?: number | null;
}

function fileNameOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const clean = url.split('?')[0];
  const last = clean.split('/').filter(Boolean).pop();
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function Thumbnail({
  attachment,
  size,
  onOpen,
  onDelete,
  canDelete,
  removing,
}: {
  attachment: JobAttachmentResponse;
  size: number;
  onOpen: () => void;
  onDelete: () => void;
  canDelete: boolean;
  removing: boolean;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const usable = hasUsableUrl(attachment.media_url);
  const image = classifyMediaType(attachment.media_type) === 'image';
  const name = fileNameOf(attachment.media_url) ?? t('att_file');

  return (
    <View style={[styles.card, { width: size, borderColor: c.border, backgroundColor: c.card }]}>
      <TouchableOpacity
        style={[styles.thumb, { width: size, height: size, backgroundColor: c.muted }]}
        onPress={() => {
          if (failed) {
            setFailed(false);
            setAttempt((n) => n + 1);
          }
          onOpen();
        }}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={name}
      >
        {usable && image && !failed ? (
          <Image
            key={`${attachment.media_url}-${attempt}`}
            source={{ uri: attachment.media_url as string }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={120}
            onError={() => setFailed(true)}
          />
        ) : (
          <View style={styles.fileThumb}>
            <Feather
              name={image ? 'image' : attachment.media_type?.includes('pdf') ? 'file-text' : 'paperclip'}
              size={30}
              color={c.mutedForeground}
            />
            {failed ? (
              <Text style={[styles.retryText, { color: c.mutedForeground }]}>
                {t('att_tap_retry')}
              </Text>
            ) : null}
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.captionRow}>
        <Feather name={image ? 'image' : 'file-text'} size={12} color={c.mutedForeground} />
        <Text style={[styles.caption, { color: c.text }]} numberOfLines={1}>
          {name}
        </Text>
        {canDelete ? (
          <TouchableOpacity
            onPress={onDelete}
            disabled={removing}
            style={styles.deleteButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t('att_delete')}
          >
            {removing ? (
              <ActivityIndicator size="small" color={c.destructive} />
            ) : (
              <Feather name="trash-2" size={14} color={c.destructive} />
            )}
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Attachments as a half-width rounded image grid (no raw S3 keys), with
 * full-screen paging/zoom. Non-images keep a file icon and a human filename.
 * Delete is only rendered for the owner while the job is editable.
 */
export default function AttachmentGallery({
  attachments,
  canDelete,
  onDelete,
  removingId = null,
}: Props) {
  const { width } = useWindowDimensions();
  const { t } = useLanguage();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const size = Math.max(120, Math.floor((width - 40 - 12) / 2));

  const items = useMemo<MediaViewerItem[]>(
    () =>
      attachments.map((attachment) => ({
        uri: attachment.media_url ?? '',
        title:
          fileNameOf(attachment.media_url) ??
          (classifyMediaType(attachment.media_type) === 'image' ? t('att_image') : t('att_file')),
        kind: classifyMediaType(attachment.media_type) === 'image' ? 'image' : 'file',
      })),
    [attachments, t]
  );

  if (attachments.length === 0) return null;

  return (
    <>
      <View style={styles.grid}>
        {attachments.map((attachment, index) => (
          <Thumbnail
            key={attachment.id}
            attachment={attachment}
            size={size}
            canDelete={canDelete}
            removing={removingId === attachment.id}
            onOpen={() => {
              setViewerIndex(index);
              setViewerOpen(true);
            }}
            onDelete={() => onDelete(attachment)}
          />
        ))}
      </View>

      <MediaViewer
        visible={viewerOpen}
        items={items}
        initialIndex={viewerIndex}
        onClose={() => setViewerOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  thumb: { alignItems: 'center', justifyContent: 'center' },
  fileThumb: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12 },
  retryText: { fontFamily: 'Manrope_500Medium', fontSize: 10, textAlign: 'center' },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  caption: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 11 },
  deleteButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
