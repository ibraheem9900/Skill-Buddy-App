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
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';

export interface MediaViewerItem {
  uri: string;
  title: string;
  kind: 'image' | 'file';
}

interface Props {
  visible: boolean;
  items: MediaViewerItem[];
  initialIndex?: number;
  onClose: () => void;
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
export default function MediaViewer({ visible, items, initialIndex = 0, onClose }: Props) {
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
          <View style={{ width: 40 }} />
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
          renderItem={({ item }) => <ZoomPage item={item} width={width} height={height} />}
        />

        {items[index]?.title ? (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={[styles.caption, { color: c.mutedForeground }]} numberOfLines={2}>
              {items[index].title}
            </Text>
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
});
