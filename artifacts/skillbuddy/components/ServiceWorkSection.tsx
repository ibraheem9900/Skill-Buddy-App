/**
 * ServiceWorkSection — one service's public work photos: a title row plus a
 * horizontal strip, with an optional "See all" that opens the paginated list
 * filtered by that service.
 *
 * Used by the grouped "Our work by service" screen, the category preview and
 * the service-detail preview. It renders nothing at all for an empty group, so
 * a service section with zero displayable photos can never appear.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import MediaGalleryStrip from '@/components/MediaGalleryStrip';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import type { DisplayMedia } from '@/lib/mediaGallery';

interface Props {
  title: string;
  media: readonly DisplayMedia[];
  onPressPhoto?: (index: number) => void;
  onSeeAll?: () => void;
  /** Defaults to the shared "See all" copy. */
  seeAllLabel?: string;
  size?: number;
  maxItems?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export default function ServiceWorkSection({
  title,
  media,
  onPressPhoto,
  onSeeAll,
  seeAllLabel,
  size = 116,
  maxItems,
  style,
  testID,
}: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  if (media.length === 0) return null;

  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
          {title}
        </Text>
        {onSeeAll ? (
          <TouchableOpacity
            onPress={onSeeAll}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            style={styles.seeAllBtn}
          >
            <Text style={[styles.seeAll, { color: c.primary }]} numberOfLines={1}>
              {seeAllLabel ?? t('see_all')}
            </Text>
            <Feather name="chevron-right" size={14} color={c.primary} />
          </TouchableOpacity>
        ) : null}
      </View>
      <MediaGalleryStrip
        media={media}
        onPressPhoto={onPressPhoto}
        size={size}
        maxItems={maxItems}
        contentPadding={0}
        testID={testID ? `${testID}-strip` : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingRight: 2,
  },
  title: { flex: 1, fontFamily: 'Manrope_700Bold', fontSize: 16, lineHeight: 22 },
  seeAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 1, maxWidth: '45%' },
  seeAll: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
});
