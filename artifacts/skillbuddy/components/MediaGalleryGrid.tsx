/**
 * MediaGalleryGrid — the responsive grid used by the paginated "See all" list
 * (2 columns on phones, 3 on small tablets, 4 on large ones).
 *
 * A thin, lazy wrapper around FlatList: square tiles sized from the live window
 * width (so small and large screens both fit whole columns), RemoteImage for
 * the app's loader/retry/placeholder behaviour, a play badge for videos and the
 * caption as a one-line scrim. Infinite scroll and pull-to-refresh are passed in
 * by the screen, so the grid owns layout only.
 */
import React from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type ListRenderItem,
  type RefreshControlProps,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import RemoteImage from '@/components/RemoteImage';
import DotsLoader from '@/components/DotsLoader';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import type { DisplayMedia } from '@/lib/mediaGallery';

interface Props {
  media: readonly DisplayMedia[];
  onPressPhoto?: (index: number) => void;
  /** Override the responsive column count (2 / 3 / 4 by width). */
  columns?: number;
  /**
   * Optional short label pinned to a tile's top-left corner ("Public",
   * "Private"). Return null for no chip. Used by My Media's read-only
   * visibility status; the public gallery passes nothing.
   */
  chipFor?: (item: DisplayMedia) => string | null;
  contentPadding?: number;
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
  ListEmptyComponent?: React.ComponentType<any> | React.ReactElement | null;
  ListFooterComponent?: React.ComponentType<any> | React.ReactElement | null;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  onEndReached?: () => void;
  contentContainerStyle?: object;
}

export default function MediaGalleryGrid({
  media,
  onPressPhoto,
  columns: columnsProp,
  chipFor,
  contentPadding = 16,
  ListHeaderComponent,
  ListEmptyComponent,
  ListFooterComponent,
  refreshControl,
  onEndReached,
  contentContainerStyle,
}: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { width } = useWindowDimensions();

  const gap = 8;
  // Phones stay readable at 2 columns; tablets get 3, big screens 4.
  const columns = columnsProp ?? (width < 600 ? 2 : width < 900 ? 3 : 4);
  const tile = Math.max(
    72,
    Math.floor((width - contentPadding * 2 - gap * (columns - 1)) / columns)
  );

  const renderItem: ListRenderItem<DisplayMedia> = ({ item, index }) => (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPressPhoto ? () => onPressPhoto(index) : undefined}
      disabled={!onPressPhoto}
      accessibilityRole={onPressPhoto ? 'button' : 'image'}
      accessibilityLabel={item.caption ?? t('gallery_photo')}
      style={{ width: tile, height: tile, marginBottom: gap }}
    >
      <RemoteImage
        uri={item.url}
        style={[styles.tile, { width: tile, height: tile, backgroundColor: c.muted, borderColor: c.border }]}
        fallbackIcon={item.kind === 'video' ? 'video' : 'image'}
        fallbackIconSize={22}
        accessibilityLabel={item.caption ?? t('gallery_photo')}
      />
      {chipFor && chipFor(item) ? (
        <View style={styles.statusChip} pointerEvents="none">
          <Text style={styles.statusChipText}>{chipFor(item)}</Text>
        </View>
      ) : null}
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
  );

  return (
    <FlatList
      data={media as DisplayMedia[]}
      key={`grid-${columns}`}
      numColumns={columns}
      keyExtractor={(item, index) => `g-${item.id}-${index}`}
      renderItem={renderItem}
      columnWrapperStyle={columns > 1 ? { gap } : undefined}
      contentContainerStyle={[
        { paddingHorizontal: contentPadding, paddingBottom: 24 },
        contentContainerStyle,
      ]}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={ListEmptyComponent}
      ListFooterComponent={ListFooterComponent}
      refreshControl={refreshControl}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
      initialNumToRender={columns * 4}
      maxToRenderPerBatch={columns * 3}
      windowSize={5}
      removeClippedSubviews
    />
  );
}

/** The grid's own "loading more" footer (three dots, never the brand logo). */
export function GalleryLoadingMore() {
  const { colors: c } = useTheme();
  return (
    <View style={styles.footer}>
      <DotsLoader color={c.mutedForeground} size={6} gap={5} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  statusChip: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  statusChipText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: '#FFFFFF',
  },
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
  footer: { alignItems: 'center', paddingVertical: 18 },
});
