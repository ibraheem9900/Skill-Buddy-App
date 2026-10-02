import React, { useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import type { CategoryResponse } from '@/types';

/**
 * Server category tile — the app-wide rendering for a REAL category from
 * GET /api/v1/categories. Extracted from the categories screen so Home and the
 * categories grid share one component after the local CategoryItem grid was
 * removed with the mock data.
 *
 * ICON FALLBACK: the schema's icon_url is OPTIONAL (required: ['id','name'])
 * and may 404 — a failed/missing image falls back to a glyph so the grid never
 * shows a broken image. DESCRIPTION is consumed via the accessibility label;
 * the name is the server's own string.
 */
export default function ServerCategoryTile({ category }: { category: CategoryResponse }) {
  const router = useRouter();
  const { colors: c } = useTheme();
  const [iconFailed, setIconFailed] = useState(false);
  const showImage = !!category.icon_url && !iconFailed;

  return (
    <TouchableOpacity
      style={styles.tile}
      activeOpacity={0.85}
      onPress={() => router.push(`/category/${category.id}` as any)}
      accessibilityLabel={category.description ? `${category.name}. ${category.description}` : category.name}
    >
      <View style={[styles.tileCircle, { backgroundColor: c.muted }]}>
        {showImage ? (
          <Image
            source={{ uri: category.icon_url as string }}
            style={styles.tileImage}
            resizeMode="contain"
            onError={() => setIconFailed(true)}
          />
        ) : (
          <MaterialCommunityIcons name="shape-plus" size={28} color={c.primary} />
        )}
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
  tileImage: { width: 34, height: 34 },
  tileLabel: { fontFamily: 'Manrope_500Medium', fontSize: 13, textAlign: 'center' },
});
