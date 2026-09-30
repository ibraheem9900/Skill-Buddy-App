/**
 * Services Tab — single-screen flow per spec:
 *   Inline search input + Filter chip → Categories row (filters list in-place) → Services list
 * No navigation away from this screen; the bottom tab bar stays visible throughout.
 * Tapping an individual service card goes to /service/[id].
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { CATEGORIES, SERVICES } from '@/data/mockData';
import { useServiceFilters, DEFAULT_FILTERS } from '@/context/FilterContext';
import { useLanguage } from '@/context/LanguageContext';
import ServiceCard from '@/components/ServiceCard';
import ServerServiceRow from '@/components/ServerServiceRow';
import useServices from '@/hooks/useServices';
import { parseServicePrice } from '@/lib/servicePrice';

const ALL_ID = '__all__';

export default function ServicesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t, tCat } = useLanguage();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState('');
  const [selectedCatId, setSelectedCatId] = useState<string>(ALL_ID);
  const { filters, activeCount } = useServiceFilters();

  // ── Live catalog: GET /api/v1/services ───────────────────────────────────
  // Fetched once per session (module cache inside useServices) and re-checked
  // on focus. The endpoint accepts NO query parameters (verified against the
  // live OpenAPI), so every control below filters client-side.
  const {
    status: svcStatus,
    services: serverServices,
    load: loadServices,
    refresh: refreshServices,
  } = useServices();

  useFocusEffect(
    React.useCallback(() => {
      void loadServices();
    }, [loadServices]),
  );

  // Same server-backed-with-local-fallback discipline as the categories
  // screen: live services win the moment the backend seeds them; until then
  // the curated local catalog keeps this tab working (the API currently
  // returns [], so without the fallback the whole tab would be empty).
  const useServer = (serverServices?.length ?? 0) > 0;
  const firstLoad = svcStatus === 'loading' && serverServices == null;

  const TAB_H = Platform.OS === 'web' ? 84 : 60;

  // The filter bottom sheet's category selection stays in sync with the
  // on-screen category row — whichever was set most recently wins.
  useEffect(() => {
    if (filters.categoryId) setSelectedCatId(filters.categoryId);
  }, [filters.categoryId]);

  // Live-filter services by category, search query, AND the bottom-sheet
  // filters (price range, minimum rating) — the Apply button now genuinely
  // changes what's shown here instead of just closing the sheet.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SERVICES.filter((s) => {
      const matchCat = selectedCatId === ALL_ID || s.categoryId === selectedCatId;
      const matchQ =
        !q ||
        s.title.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.provider.name.toLowerCase().includes(q);
      const matchPrice = s.price >= filters.minPrice && s.price <= filters.maxPrice;
      const matchRating = !filters.minRating || s.rating >= filters.minRating;
      return matchCat && matchQ && matchPrice && matchRating;
    });
  }, [query, selectedCatId, filters]);

  /**
   * Live-catalog filtering — CLIENT-SIDE by necessity: GET /api/v1/services
   * declares no query parameters at all, so there is no search / category /
   * page / limit / sort to send and no server-side filtering to delegate to.
   *
   *   search      → title / description / category_name
   *   category    → the chip's curated id OR name vs the item's
   *                 category_id / category_name (best-effort: the API has no
   *                 taxonomy id that maps to the app's curated chips yet)
   *   price range → price_from when the API supplied a usable one; items with
   *                 no price ("on request") always pass
   *   min rating  → NOT applied: the API returns no rating field at all, so
   *                 the screen shows a note instead of silently hiding items
   */
  const filteredServer = useMemo(() => {
    if (!useServer) return [];
    const q = query.trim().toLowerCase();
    const chip =
      selectedCatId === ALL_ID ? null : CATEGORIES.find((cat) => cat.id === selectedCatId);
    return (serverServices ?? []).filter((s) => {
      const matchQ =
        !q ||
        (s.title ?? '').toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        (s.category_name ?? '').toLowerCase().includes(q);
      const matchCat =
        !chip ||
        String(s.category_id) === chip.id ||
        (s.category_name ?? '').trim().toLowerCase() === chip.name.trim().toLowerCase();
      const from = parseServicePrice(s.price_from);
      const matchPrice = from === null || (from >= filters.minPrice && from <= filters.maxPrice);
      return matchQ && matchCat && matchPrice;
    });
  }, [useServer, serverServices, query, selectedCatId, filters.minPrice, filters.maxPrice]);

  /** The live API exposes no rating, so a min-rating filter can't apply to it. */
  const ratingFilterUnavailable = useServer && !!filters.minRating;
  const resultCount = useServer ? filteredServer.length : filtered.length;

  const handleCategoryPress = (id: string) => {
    setSelectedCatId((prev) => (prev === id ? ALL_ID : id));
    Keyboard.dismiss();
  };

  const clearSearch = () => {
    setQuery('');
    inputRef.current?.focus();
  };

  const activeCategoryName =
    selectedCatId === ALL_ID
      ? t('services_all_services')
      : (tCat(CATEGORIES.find((cat) => cat.id === selectedCatId)?.id ?? '') || t('services_title'));

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: c.headerBg, paddingTop: insets.top + 10 }]}>
        <Text style={styles.headerTitle}>{t('services_title')}</Text>

        {/* Inline search bar — always editable, never redirects */}
        <View style={styles.searchRow}>
          <View style={[styles.searchBar, { backgroundColor: '#FFF' }]}>
            <Feather name="search" size={15} color="#9E9E9E" />
            <TextInput
              ref={inputRef}
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={t('search_placeholder')}
              placeholderTextColor="#9E9E9E"
              returnKeyType="search"
              onSubmitEditing={Keyboard.dismiss}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={clearSearch} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <View style={styles.clearBtn}>
                  <Feather name="x" size={12} color="#9E9E9E" />
                </View>
              </TouchableOpacity>
            )}
          </View>
          {/* Filter button — opens filter bottom sheet */}
          <TouchableOpacity
            style={styles.filterBtn}
            onPress={() => router.push('/filter')}
            activeOpacity={0.8}
          >
            <Feather name="sliders" size={16} color={c.primary} />
            {activeCount > 0 && (
              <View style={[styles.filterBadge, { backgroundColor: c.destructive, borderColor: c.surface }]}>
                <Text style={styles.filterBadgeText}>{activeCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + TAB_H + 20 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Categories row ────────────────────────────────────────────────── */}
        <View style={styles.catSection}>
          <View style={styles.catHeaderRow}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>{t('services_categories')}</Text>
            <TouchableOpacity onPress={() => router.push('/categories')}>
              <Text style={[styles.seeAll, { color: c.primary }]}>{t('see_all')}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* "All" chip */}
            <TouchableOpacity
              style={[
                styles.catChip,
                {
                  backgroundColor: selectedCatId === ALL_ID ? c.primary : c.card,
                  borderColor: selectedCatId === ALL_ID ? c.primary : c.border,
                },
              ]}
              onPress={() => { setSelectedCatId(ALL_ID); Keyboard.dismiss(); }}
              activeOpacity={0.8}
            >
              <Feather
                name="grid"
                size={14}
                color={selectedCatId === ALL_ID ? '#FFF' : c.text}
              />
              <Text style={[styles.catChipText, { color: selectedCatId === ALL_ID ? '#FFF' : c.text }]}>
                {t('services_all')}
              </Text>
            </TouchableOpacity>

            {CATEGORIES.map((cat) => {
              const active = selectedCatId === cat.id;
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.catChip,
                    {
                      backgroundColor: active ? c.primary : c.card,
                      borderColor: active ? c.primary : c.border,
                    },
                  ]}
                  onPress={() => handleCategoryPress(cat.id)}
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons
                    name={cat.iconName as any}
                    size={14}
                    color={active ? '#FFF' : c.primary}
                  />
                  <Text style={[styles.catChipText, { color: active ? '#FFF' : c.text }]}>
                    {tCat(cat.id)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Results header ────────────────────────────────────────────────── */}
        <View style={styles.resultsHeader}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>
            {activeCategoryName}
          </Text>
          <Text style={[styles.resultCount, { color: c.mutedForeground }]}>
            {t('services_available_count', { n: resultCount })}
          </Text>
        </View>

        {/* ── Live-catalog states: loading / error / local fallback ─────────── */}
        {!useServer && svcStatus === 'error' ? (
          <View style={[styles.stateBanner, { backgroundColor: c.card, borderColor: c.destructive }]}>
            <Feather name="wifi-off" size={16} color={c.destructive} />
            <Text style={[styles.stateText, { color: c.destructive }]}>{t('services_load_error')}</Text>
            <TouchableOpacity onPress={() => void refreshServices()} hitSlop={6}>
              <Text style={[styles.stateRetry, { color: c.primary }]}>{t('cats_retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : firstLoad ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={c.primary} />
            <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('services_loading')}</Text>
          </View>
        ) : !useServer && svcStatus === 'ready' ? (
          <Text style={[styles.fallbackNote, { color: c.mutedForeground }]}>
            {t('services_local_fallback')}
          </Text>
        ) : null}

        {ratingFilterUnavailable ? (
          <Text style={[styles.fallbackNote, { color: c.mutedForeground }]}>
            {t('services_rating_filter_unavailable')}
          </Text>
        ) : null}

        {/* ── Empty state ──────────────────────────────────────────────────── */}
        {resultCount === 0 && (
          <View style={styles.emptyWrap}>
            <View style={[styles.emptyIconWrap, { backgroundColor: c.primaryLight }]}>
              <Feather name="search" size={32} color={c.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: c.text }]}>{t('services_no_results_title')}</Text>
            <Text style={[styles.emptySub, { color: c.mutedForeground }]}>
              {query.length > 0
                ? t('services_no_results_query', { query })
                : t('services_no_results_category')}{' '}
              {t('services_try_custom_quote')}
            </Text>
            <TouchableOpacity
              style={[styles.emptyBtn, { backgroundColor: c.primary }]}
              onPress={() => router.push('/quote-request' as any)}
              activeOpacity={0.85}
            >
              <Text style={styles.emptyBtnText}>{t('services_get_custom_quote')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.emptyBtnOutline, { borderColor: c.primary }]}
              onPress={() => router.push('/(tabs)/inbox' as any)}
              activeOpacity={0.85}
            >
              <Feather name="message-circle" size={16} color={c.primary} />
              <Text style={[styles.emptyBtnOutlineText, { color: c.primary }]}>
                {t('services_start_live_chat')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Services list ─────────────────────────────────────────────────── */}
        {/* Live rows while the API has data (cover-fit thumbnails, formatted
            prices, no fabricated provider/rating); otherwise the curated
            local cards exactly as before. */}
        {useServer
          ? filteredServer.length > 0 && (
              <View style={styles.servicesList}>
                {filteredServer.map((item, index) => (
                  <Animated.View
                    key={`svc_${item.id}`}
                    entering={FadeInDown.delay(index * 50).duration(300)}
                  >
                    <ServerServiceRow service={item} />
                  </Animated.View>
                ))}
              </View>
            )
          : filtered.length > 0 && (
              <View style={styles.servicesList}>
                {filtered.map((item, index) => (
                  <Animated.View
                    key={item.id}
                    entering={FadeInDown.delay(index * 50).duration(300)}
                  >
                    <ServiceCard service={item} variant="list" />
                  </Animated.View>
                ))}
              </View>
            )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    gap: 10,
  },
  headerTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 20,
    color: '#FFF',
  },
  searchRow: { flexDirection: 'row', gap: 8 },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    color: '#1A1A1A',
    // Explicit height avoids web rendering quirks
    height: 24,
  },
  clearBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtn: {
    backgroundColor: '#FFF',
    width: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  filterBadgeText: { fontFamily: 'Manrope_700Bold', fontSize: 9, color: '#FFF' },

  // ── Category chips ──────────────────────────────────────────────────────────
  catSection: { paddingTop: 20 },
  catHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  catChipText: { fontFamily: 'Manrope_500Medium', fontSize: 13 },

  // ── Results ─────────────────────────────────────────────────────────────────
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 22,
    marginBottom: 12,
  },
  sectionTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  seeAll: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
  resultCount: { fontFamily: 'Manrope_400Regular', fontSize: 13 },
  servicesList: { paddingHorizontal: 16 },

  // ── Live-catalog state banners ──────────────────────────────────────────────
  stateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 12, flex: 1 },
  stateRetry: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  fallbackNote: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },

  // ── Empty state ─────────────────────────────────────────────────────────────
  emptyWrap: {
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 17, textAlign: 'center' },
  emptySub: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { marginTop: 4, paddingHorizontal: 28, paddingVertical: 13, borderRadius: 28 },
  emptyBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15, color: '#FFF' },
  emptyBtnOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 28,
    borderWidth: 1.5,
  },
  emptyBtnOutlineText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
});
