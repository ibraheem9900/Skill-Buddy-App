import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import RemoteImage from '@/components/RemoteImage';
import type { CategoryResponse } from '@/types';

/**
 * Server category tile — the app-wide rendering for a REAL category from
 * GET /api/v1/categories. Extracted from the categories screen so Home and the
 * categories grid share one component after the local CategoryItem grid was
 * removed with the mock data.
 *
 * ICON: the schema's icon_url is OPTIONAL (required: ['id','name']) and may
 * 404, so the shared RemoteImage box handles it — loader while it loads,
 * tap-to-retry (or a glyph when there is no URL) when it fails. DESCRIPTION is
 * consumed via the accessibility label; the name is the server's own string.
 */
export default function ServerCategoryTile({ category }: { category: CategoryResponse }) {
  const router = useRouter();
  const { colors: c } = useTheme();

  return (
    <TouchableOpacity
      style={styles.tile}
      activeOpacity={0.85}
      onPress={() => router.push(`/category/${category.id}` as any)}
      accessibilityLabel={category.description ? `${category.name}. ${category.description}` : category.name}
    >
      <View style={[styles.tileCircle, { backgroundColor: c.muted }]}>
        <RemoteImage
          uri={category.icon_url}
          style={styles.tileImage}
          contentFit="contain"
          backgroundColor="transparent"
          fallbackIcon="grid"
          fallbackIconSize={26}
          accessibilityLabel={category.name}
        />
      </View>
      <Text style={[styles.tileLabel, { color: c.text }]} numberOfLines={1}>
        {category.name}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', gap: 8, width: 72 },
  tileCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tileImage: { width: 34, height: 34, borderRadius: 0 },

  tileLabel: { fontFamily: 'Manrope_500Medium', fontSize: 13, textAlign: 'center' },
});
