/**
 * Services Tab — single-screen flow per spec:
 *   Inline search input + Filter chip → Categories row (filters list in-place) → Services list
 * No navigation away from this screen; the bottom tab bar stays visible throughout.
 * Tapping an individual service card goes to /service/[id].
 *
 * The green header is the SHARED TabGreenHeader (also used by the Jobs tab) —
 * this screen's look is unchanged, only the markup moved into the component.
 *
 * FOUR DISTINCT STATES (FIX: the list used to flicker a false "No Services
 * Found" while loading, and a stale hook instance could show it forever):
 *   error          → message + "Try Again" button (only when there is no data)
 *   loading        → spinner row that REPLACES the empty state, never stacks
 *   truly empty    → "No services yet" + Custom Quote / Live Chat / Try Again
 *   has data       → list (search + category filtering client-side, as before)
 * plus pull-to-refresh on the list.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  ScrollView,
  RefreshControl,
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
import { useServiceFilters, DEFAULT_FILTERS } from '@/context/FilterContext';
import { useLanguage } from '@/context/LanguageContext';
import ServerServiceRow from '@/components/ServerServiceRow';
import TabGreenHeader from '@/components/TabGreenHeader';
import useServices from '@/hooks/useServices';
import useCategories from '@/hooks/useCategories';
import { parseServicePrice } from '@/lib/servicePrice';
import { withTabPagerPage } from '@/components/tabBar/TabPagerPage';

const ALL_ID = '__all__';

function ServicesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const inputRef = useRef<TextInput>(null);

  const [searchText, setSearchText] = useState('');
  /** The filtering query — a 300 ms-debounced copy of what the user typed. */
  const [query, setQuery] = useState('');
  const [selectedCatId, setSelectedCatId] = useState<string>(ALL_ID);
  /** True while pull-to-refresh is running — drives the RefreshControl spinner. */
  const [pulling, setPulling] = useState(false);
  const { filters, activeCount } = useServiceFilters();

  // FIX (search): the typed text filters the list only after the user pauses
  // typing for ~300 ms. The input itself updates instantly, so typed characters
  // are always visible and never swallowed.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  // ── Live catalog: GET /api/v1/services ───────────────────────────────────
  // Fetched once per session (module cache inside useServices) and re-checked
  // on focus — including when the cached list is EMPTY or the last attempt
  // FAILED, which is exactly how the intermittent "0 available" screen stuck
  // around (see hooks/useServices.ts). The endpoint accepts NO query
  // parameters (verified against the live OpenAPI), so every control below
  // filters client-side.
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

  // Category chips come from the SAME public API (GET /api/v1/categories) —
  // no curated local list. STRICT API-ONLY: an empty catalog renders an
  // honest empty state; the local-fallback path was removed with the mock
  // data (the API currently returns [], and that is a real server state).
  const {
    status: catStatus,
    categories: serverCategories,
    load: loadCategories,
    refresh: refreshCategories,
  } = useCategories();

  useFocusEffect(
    React.useCallback(() => {
      void loadCategories();
    }, [loadCategories]),
  );

  // Pull-to-refresh re-runs BOTH fetches (force), with a visible spinner.
  const onRefresh = async () => {
    setPulling(true);
    try {
      await Promise.all([refreshServices(), refreshCategories()]);
    } finally {
      setPulling(false);
    }
  };

  /** Retry from the error / empty states — same visible loading path. */
  const retryNow = () => {
    void refreshServices();
  };

  // FIX (states): an empty catalog that is still LOADING must show the
  // spinner, not a premature "No services found" (serverServices === [] from
  // the previous run would otherwise keep the empty state visible while the
  // retry is in flight).
  const firstLoad =
    (svcStatus === 'loading' && (serverServices == null || serverServices.length === 0)) ||
    (catStatus === 'loading' && serverCategories == null);
  const catalogEmpty =
    svcStatus === 'ready' && (serverServices?.length ?? 0) === 0;
  /** A real failure with NOTHING to show — never an "empty" masquerade. */
  const catalogError = svcStatus === 'error' && (serverServices?.length ?? 0) === 0;

  const TAB_H = Platform.OS === 'web' ? 84 : 60;

  // The filter bottom sheet's category selection stays in sync with the
  // on-screen category row — whichever was set most recently wins.
  useEffect(() => {
    if (filters.categoryId) setSelectedCatId(filters.categoryId);
  }, [filters.categoryId]);

  // Live-filter services by search query AND the bottom-sheet filters
  // (price range, minimum rating) — applied to the SERVER-backed list only.

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
    const q = query.trim().toLowerCase();
    const chip =
      selectedCatId === ALL_ID
        ? null
        : (serverCategories ?? []).find((cat) => String(cat.id) === selectedCatId);
    return (serverServices ?? []).filter((s) => {
      const matchQ =
        !q ||
        (s.title ?? '').toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        (s.category_name ?? '').toLowerCase().includes(q);
      const matchCat =
        !chip ||
        String(s.category_id) === String(chip.id) ||
        (s.category_name ?? '').trim().toLowerCase() === (chip.name ?? '').trim().toLowerCase();
      const from = parseServicePrice(s.price_from);
      // FIX (all services hidden): the untouched default price range
      // (€20–€200) used to be applied to every item, so any service cheaper
      // than €20 (and the whole list when the catalog is low-priced)
      // silently vanished. The price range now only filters when the user
      // actually moved the bounds in the filter sheet.
      const priceRangeMoved =
        filters.minPrice !== DEFAULT_FILTERS.minPrice ||
        filters.maxPrice !== DEFAULT_FILTERS.maxPrice;
      const matchPrice =
        !priceRangeMoved || from === null || (from >= filters.minPrice && from <= filters.maxPrice);
      return matchQ && matchCat && matchPrice;
    });
  }, [serverCategories, serverServices, query, selectedCatId, filters.minPrice, filters.maxPrice]);

  /** The live API exposes no rating, so a min-rating filter can't apply to it. */
  const ratingFilterUnavailable =
    !!filters.minRating && !catalogEmpty && !catalogError && !firstLoad;
  const resultCount = filteredServer.length;

  const handleCategoryPress = (id: string) => {
    setSelectedCatId((prev) => (prev === id ? ALL_ID : id));
    Keyboard.dismiss();
  };

  const clearSearch = () => {
    setSearchText('');
    setQuery('');
    inputRef.current?.focus();
  };

  const activeCategoryName =
    selectedCatId === ALL_ID
      ? t('services_all_services')
      : (serverCategories?.find((cat) => String(cat.id) === selectedCatId)?.name ??
        t('services_title'));

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* ── Header (SHARED with the Jobs tab) ──────────────────────────────── */}
      <TabGreenHeader
        title={t('services_title')}
        search={{
          value: searchText,
          onChange: setSearchText,
          onClear: clearSearch,
          placeholder: t('search_placeholder'),
          onSubmit: Keyboard.dismiss,
          inputRef,
        }}
        filter={{ count: activeCount, onPress: () => router.push('/filter') }}
      />

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + TAB_H + 20 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={() => void onRefresh()}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
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

            {(serverCategories ?? []).map((cat) => {
              const id = String(cat.id);
              const active = selectedCatId === id;
              return (
                <TouchableOpacity
                  key={id}
                  style={[
                    styles.catChip,
                    {
                      backgroundColor: active ? c.primary : c.card,
                      borderColor: active ? c.primary : c.border,
                    },
                  ]}
                  onPress={() => handleCategoryPress(id)}
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons
                    name="tag"
                    size={14}
                    color={active ? '#FFF' : c.primary}
                  />
                  <Text style={[styles.catChipText, { color: active ? '#FFF' : c.text }]}>
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Results header (hidden while loading/error for distinct states) ─ */}
        {!firstLoad && !catalogError ? (
          <View style={styles.resultsHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>
              {activeCategoryName}
            </Text>
            <Text style={[styles.resultCount, { color: c.mutedForeground }]}>
              {t('services_available_count', { n: resultCount })}
            </Text>
          </View>
        ) : null}

        {/* ── ERROR: message + Try Again (only with nothing to show) ───────── */}
        {catalogError ? (
          <View style={styles.stateWrap}>
            <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Feather name="wifi-off" size={32} color={c.destructive} />
              <Text style={[styles.emptyTitle, { color: c.text }]}>{t('services_load_error')}</Text>
              <TouchableOpacity
                style={[styles.emptyBtn, { backgroundColor: c.primary }]}
                onPress={retryNow}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                <Feather name="refresh-cw" size={16} color="#FFF" />
                <Text style={[styles.emptyBtnTextRow]}>{t('try_again')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : firstLoad ? (
          /* ── LOADING: spinner row, replaces (never stacks with) the empty state */
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={c.primary} />
            <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('services_loading')}</Text>
          </View>
        ) : ratingFilterUnavailable ? (
          <Text style={[styles.fallbackNote, { color: c.mutedForeground }]}>
            {t('services_rating_filter_unavailable')}
          </Text>
        ) : null}

        {/* ── TRULY EMPTY (200 + []): Custom Quote / Live Chat / Try Again ─── */}
        {catalogEmpty ? (
          <View style={styles.emptyWrap}>
            <View style={[styles.emptyIconWrap, { backgroundColor: c.primaryLight }]}>
              <Feather name="grid" size={32} color={c.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: c.text }]}>{t('services_empty_title')}</Text>
            <Text style={[styles.emptySub, { color: c.mutedForeground }]}>
              {t('services_empty_sub')}
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
            <TouchableOpacity
              style={[styles.emptyBtnOutline, { borderColor: c.primary }]}
              onPress={retryNow}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Feather name="refresh-cw" size={16} color={c.primary} />
              <Text style={[styles.emptyBtnOutlineText, { color: c.primary }]}>
                {t('try_again')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : !catalogError && !firstLoad && resultCount === 0 ? (
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
        ) : null}

        {/* ── Services list ─────────────────────────────────────────────────── */}
        {/* Server rows only — the local-card fallback was removed with the
            mock data (strict API). */}
        {filteredServer.length > 0 && (
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
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },

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
  stateWrap: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 8 },
  stateCard: {
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingVertical: 24,
    width: '100%',
  },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 12, flex: 1 },
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
  emptyBtn: {
    marginTop: 4,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emptyBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15, color: '#FFF' },
  emptyBtnTextRow: { fontFamily: 'Manrope_600SemiBold', fontSize: 15, color: '#FFF' },
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

export default withTabPagerPage(ServicesScreen, 1);
