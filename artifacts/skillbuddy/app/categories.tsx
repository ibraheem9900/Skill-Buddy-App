import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { CATEGORIES } from '@/data/mockData';
import CategoryItem from '@/components/CategoryItem';
import useCategories from '@/hooks/useCategories';
import type { CategoryResponse } from '@/types';

/**
 * Server category tile — same visual language as CategoryItem (muted
 * circle + icon + label, /category/{id} navigation). ICON FALLBACK: the
 * schema's icon_url is OPTIONAL (required: ['id','name']) and may 404 —
 * a failed/missing image falls back to a glyph so the grid never shows a
 * broken image. DESCRIPTION is consumed via the accessibility label (no
 * category detail screen exists yet — Get Category by ID is a separate
 * task); the name is the server's own string (local cat_* translation
 * keys cover only the curated fallback ids).
 */
function ServerCategoryTile({ category }: { category: CategoryResponse }) {
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

/**
 * Categories (GET /api/v1/categories — PUBLIC per live verification).
 *
 * SERVER-BACKED WITH LOCAL FALLBACK: the live API currently returns an
 * EMPTY array (backend has no seeded categories), while the app ships a
 * curated local grid (mockData CATEGORIES + icon fonts + cat_* copy) that
 * 11 screens already rely on. So: server categories render the moment the
 * backend has them (verbatim names, icon_url with glyph fallback,
 * description in the accessibility label); until then the local grid keeps
 * the product working, with a small note explaining it. Loading shows a
 * spinner banner over the grid; network failure shows a retry banner;
 * pull-to-refresh force-refetches (session cache otherwise).
 */
/** Unified grid row — the server list and the curated local fallback
 * have different item types (numeric vs string ids, icon_url vs icon
 * fonts); the discriminator keeps the FlatList fully typed. */
type CategoryRow =
  | { kind: 'server'; server: CategoryResponse }
  | { kind: 'local'; local: (typeof CATEGORIES)[number] };

export default function CategoriesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { status, categories: serverCategories, load, refresh } = useCategories();

  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load]),
  );

  const useServer = (serverCategories?.length ?? 0) > 0;
  const firstLoad = status === 'loading' && serverCategories == null;

  const footer = (
    <>
      {!useServer && status === 'ready' ? (
        <Text style={[styles.fallbackNote, { color: c.mutedForeground }]}>{t('cats_empty')}</Text>
      ) : null}
      <Animated.View entering={FadeInDown.delay(600).duration(400)} style={[styles.quoteBanner, { backgroundColor: c.primaryLight, borderColor: c.primary }]}>
        <View style={styles.quoteInner}>
          <View style={[styles.quoteIconWrap, { backgroundColor: c.primary }]}>
            <Feather name="help-circle" size={22} color="#FFF" />
          </View>
          <View style={styles.quoteText}>
            <Text style={[styles.quoteTitle, { color: c.text }]}>{t('categories_quote_title')}</Text>
            <Text style={[styles.quoteSub, { color: c.mutedForeground }]}>{t('categories_quote_sub')}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.quoteBtn, { backgroundColor: c.primary }]}
          onPress={() => router.push('/quote-request' as any)}
          activeOpacity={0.85}
        >
          <Text style={styles.quoteBtnText}>{t('services_get_custom_quote')}</Text>
        </TouchableOpacity>
      </Animated.View>
    </>
  );

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: 8 }]}>
      <FlatList<CategoryRow>
        data={
          useServer
            ? (serverCategories as CategoryResponse[]).map((server) => ({ kind: 'server' as const, server }))
            : CATEGORIES.map((local) => ({ kind: 'local' as const, local }))
        }
        keyExtractor={(item) => String(item.kind === 'server' ? item.server.id : item.local.id)}
        numColumns={4}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        columnWrapperStyle={{ justifyContent: 'space-between', marginBottom: 20 }}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={footer}
        ListHeaderComponent={
          status === 'error' ? (
            <View style={[styles.stateBanner, { backgroundColor: c.card, borderColor: c.destructive }]}>
              <Feather name="wifi-off" size={16} color={c.destructive} />
              <Text style={[styles.stateText, { color: c.destructive }]}>{t('cats_error')}</Text>
              <TouchableOpacity onPress={() => void refresh()} hitSlop={6}>
                <Text style={[styles.stateRetry, { color: c.primary }]}>{t('cats_retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : firstLoad ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={c.primary} />
              <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('cats_loading')}</Text>
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={status === 'loading' && !firstLoad}
            onRefresh={() => void refresh()}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 30).duration(300)}>
            {item.kind === 'server' ? (
              <ServerCategoryTile category={item.server} />
            ) : (
              <CategoryItem category={item.local} />
            )}
          </Animated.View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tile: { alignItems: 'center', gap: 8, width: 72 },
  tileCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tileImage: { width: 34, height: 34 },
  tileLabel: { fontFamily: 'Manrope_500Medium', fontSize: 13, textAlign: 'center' },
  stateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 12, flex: 1 },
  stateRetry: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 14 },
  fallbackNote: { fontFamily: 'Manrope_400Regular', fontSize: 11, textAlign: 'center', marginBottom: 14 },
  quoteBanner: {
    marginTop: 8,
    marginHorizontal: 4,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  quoteInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  quoteIconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  quoteText: { flex: 1 },
  quoteTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  quoteSub: { fontFamily: 'Manrope_400Regular', fontSize: 13, marginTop: 2 },
  quoteBtn: {
    borderRadius: 28,
    paddingVertical: 13,
    alignItems: 'center',
  },
  quoteBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15, color: '#FFF' },
});
