import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DotsLoader from '@/components/DotsLoader';
import MediaVideo from '@/components/MediaVideo';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';

export interface MediaViewerItem {
  uri: string;
  title: string;
  kind: 'image' | 'video' | 'file';
  /**
   * Optional second line (the public gallery puts the photo's localised date
   * here). Omitted by every pre-existing caller, so nothing changes for them.
   */
  subtitle?: string;
  /**
   * Read-only "Public" / "Private" chip. Rendered ONLY when the viewer is in
   * own-media mode; public gallery callers never pass it.
   */
  badge?: string | null;
}

interface Props {
  visible: boolean;
  items: MediaViewerItem[];
  initialIndex?: number;
  onClose: () => void;
  /**
   * Optional destructive action for the image on screen (used by the dispute
   * history for the author's own photos). Hidden entirely when omitted, so no
   * existing viewer gains a button.
   */
  onDelete?: () => void;
  deleteLabel?: string;
  /** Shows the three-dot loader in place of the trash icon while deleting. */
  deleting?: boolean;
  /**
   * Optional "near the end" callback so a paginated gallery can fetch the next
   * page while the user swipes. Omitted by every other caller, so their viewer
   * behaves exactly as before.
   */
  onEndReached?: () => void;
  /**
   * TRUE only when these photos are the signed-in user's OWN media (My media).
   * It is what makes the header pencil and the per-photo visibility chip
   * appear; public galleries leave it at the default false, so their viewer is
   * pixel-identical to before. The client never guesses ownership: every
   * current public caller keeps this off.
   */
  isOwnMedia?: boolean;
  /** Own-media only: open the editor for the photo on screen. */
  onEditMedia?: (index: number) => void;
}

/** One page: pinch to zoom, release back to a comfortable size. */
function ZoomPage({ item, width, height }: { item: MediaViewerItem; width: number; height: number }) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    setFailed(false);
  }, [item.uri, savedScale, scale]);

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(5, Math.max(1, savedScale.value * event.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.02) {
        scale.value = withTiming(1);
        savedScale.value = 1;
      }
    });

  const zoomStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      <GestureDetector gesture={pinch}>
        <Animated.View style={[styles.page, zoomStyle]}>
          {item.kind === 'image' && !failed ? (
            <Image
              source={{ uri: item.uri }}
              style={{ width, height: height * 0.72 }}
              contentFit="contain"
              transition={120}
              onError={() => setFailed(true)}
            />
          ) : item.kind === 'video' ? (
            /* A public gallery row may be a video (media_type contains
               "video"). expo-video is already in the installed build, so the
               viewer plays it instead of showing a "preview unavailable"
               placeholder for a file it can actually render. */
            <MediaVideo
              url={item.uri}
              style={{ width, height: height * 0.62 }}
              cover={false}
              controls
            />
          ) : (
            <View style={styles.filePage}>
              <Feather
                name={item.kind === 'image' ? 'image' : 'file-text'}
                size={48}
                color="#FFF"
              />
              <Text style={styles.fileTitle} numberOfLines={3}>
                {item.title}
              </Text>
              <Text style={[styles.unavailable, { color: c.mutedForeground }]}>
                {t('media_preview_unavailable')}
              </Text>
            </View>
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * Full-screen media preview: black surface, horizontal paging, pinch zoom,
 * close button and an "n / total" counter. One component serves job
 * attachments, certification previews and the pilot's view.
 */
export default function MediaViewer({
  visible,
  items,
  initialIndex = 0,
  onClose,
  onDelete,
  deleteLabel,
  deleting = false,
  onEndReached,
  isOwnMedia = false,
  onEditMedia,
}: Props) {
  const canEdit = isOwnMedia && !!onEditMedia;
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const listRef = useRef<FlatList<MediaViewerItem>>(null);
  const safeIndex = Math.max(0, Math.min(initialIndex, Math.max(0, items.length - 1)));
  const [index, setIndex] = useState(safeIndex);

  useEffect(() => {
    if (!visible) return;
    setIndex(safeIndex);
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: safeIndex, animated: false });
    }, 40);
    return () => clearTimeout(timer);
  }, [safeIndex, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel={t('media_close')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="x" size={22} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.counter}>
            {items.length === 0 ? '0 / 0' : `${index + 1} / ${items.length}`}
          </Text>
          {onDelete ? (
            <TouchableOpacity
              onPress={onDelete}
              disabled={deleting}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel={deleteLabel ?? t('media_close')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              {deleting ? (
                <DotsLoader color="#FFFFFF" size={6} gap={4} />
              ) : (
                <Feather name="trash-2" size={20} color="#FFF" />
              )}
            </TouchableOpacity>
          ) : canEdit ? (
            <TouchableOpacity
              onPress={() => onEditMedia?.(index)}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel={t('media_edit_action')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Feather name="edit-2" size={19} color="#FFF" />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>

        <FlatList
          ref={listRef}
          data={items}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item, i) => `${item.uri}-${i}`}
          getItemLayout={(_, i) => ({ index: i, length: width, offset: width * i })}
          initialScrollIndex={items.length > 0 ? safeIndex : undefined}
          onScrollToIndexFailed={({ index: failedIndex }) => {
            listRef.current?.scrollToOffset({ offset: failedIndex * width, animated: false });
          }}
          onMomentumScrollEnd={(event) => {
            const next = Math.round(event.nativeEvent.contentOffset.x / width);
            setIndex(Math.max(0, Math.min(next, items.length - 1)));
          }}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.8}
          renderItem={({ item }) => <ZoomPage item={item} width={width} height={height} />}
        />

        {/* Own media only: the photo's current visibility, read-only. */}
        {isOwnMedia && items[index]?.badge ? (
          <View
            style={[styles.ownerChip, { top: insets.top + 96 }]}
            pointerEvents="none"
          >
            <Text style={styles.ownerChipText} numberOfLines={1}>
              {items[index]?.badge}
            </Text>
          </View>
        ) : null}

        {items[index]?.title || items[index]?.subtitle ? (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
            {items[index]?.title ? (
              <Text style={[styles.caption, { color: c.mutedForeground }]} numberOfLines={2}>
                {items[index].title}
              </Text>
            ) : null}
            {items[index]?.subtitle ? (
              <Text style={[styles.captionDate, { color: c.mutedForeground }]} numberOfLines={1}>
                {items[index].subtitle}
              </Text>
            ) : null}
          </View>
        ) : null}

        {items.length === 0 ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
            <View style={styles.filePage}>
              <Feather name="image" size={48} color="#FFF" />
              <Text style={styles.fileTitle}>{t('media_preview_unavailable')}</Text>
            </View>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    height: 92,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, color: '#FFF' },
  ownerChip: {
    position: 'absolute',
    left: 16,
    zIndex: 2,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  ownerChipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11, color: '#FFF' },
  page: { alignItems: 'center', justifyContent: 'center' },
  filePage: { alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  fileTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 15, color: '#FFF', textAlign: 'center' },
  unavailable: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 14,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  caption: { fontFamily: 'Manrope_400Regular', fontSize: 12, textAlign: 'center' },
  captionDate: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
  },
});
