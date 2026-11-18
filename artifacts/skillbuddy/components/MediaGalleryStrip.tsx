/**
 * MediaGalleryStrip — the horizontal photo strip shared by the grouped gallery,
 * the home preview, category previews and service previews.
 *
 * One tile per DisplayMedia, square and fixed-size so the surrounding layout
 * never jumps; RemoteImage already gives every tile the app's loader, the
 * tap-to-retry placeholder and expo-image's short cross-fade, so no new image
 * stack is introduced. Videos get a play badge instead of being handed to an
 * image component.
 *
 * Laziness: it is a horizontal FlatList with a small window, so only the tiles
 * near the viewport are mounted. `maxItems` caps what a preview asks for.
 */
import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import RemoteImage from '@/components/RemoteImage';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import type { DisplayMedia } from '@/lib/mediaGallery';

interface Props {
  media: readonly DisplayMedia[];
  onPressPhoto?: (index: number) => void;
  /** Square tile edge in px (default 116). */
  size?: number;
  /** Optional cap on how many tiles this strip renders. */
  maxItems?: number;
  /** Horizontal padding of the strip's content (default 16). */
  contentPadding?: number;
  testID?: string;
}

export default function MediaGalleryStrip({
  media,
  onPressPhoto,
  size = 116,
  maxItems,
  contentPadding = 16,
  testID,
}: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  const visible = useMemo(
    () => (typeof maxItems === 'number' ? media.slice(0, maxItems) : media),
    [media, maxItems]
  );

  if (visible.length === 0) return null;

  return (
    <FlatList
      data={visible}
      horizontal
      testID={testID}
      showsHorizontalScrollIndicator={false}
      keyExtractor={(item, index) => `media-${item.id}-${index}`}
      contentContainerStyle={{ paddingHorizontal: contentPadding, gap: 8 }}
      initialNumToRender={4}
      maxToRenderPerBatch={4}
      windowSize={3}
      removeClippedSubviews
      renderItem={({ item, index }) => (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onPressPhoto ? () => onPressPhoto(index) : undefined}
          disabled={!onPressPhoto}
          accessibilityRole={onPressPhoto ? 'button' : 'image'}
          accessibilityLabel={item.caption ?? t('gallery_photo')}
          style={{ width: size, height: size }}
        >
          <RemoteImage
            uri={item.url}
            style={[
              styles.tile,
              { width: size, height: size, backgroundColor: c.muted, borderColor: c.border },
            ]}
            fallbackIcon={item.kind === 'video' ? 'video' : 'image'}
            fallbackIconSize={20}
            accessibilityLabel={item.caption ?? t('gallery_photo')}
          />
          {item.kind === 'video' ? (
            <View style={styles.playBadge} pointerEvents="none">
              <Feather name="play" size={13} color="#FFFFFF" />
            </View>
          ) : null}
          {item.caption ? (
            <View style={styles.captionScrim} pointerEvents="none">
              <Text style={styles.captionText} numberOfLines={1}>
                {item.caption}
              </Text>
            </View>
          ) : null}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  playBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  captionScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  captionText: { fontFamily: 'Manrope_500Medium', fontSize: 10, color: '#FFFFFF' },
});
