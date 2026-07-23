/**
 * Services Tab — single-screen flow per spec:
 *   Inline search input + Filter chip → Categories row (filters list in-place) → Services list
 * No navigation away from this screen; the bottom tab bar stays visible throughout.
 * Tapping an individual service card goes to /service/[id].
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { CATEGORIES, SERVICES } from '@/data/mockData';
import { useServiceFilters, DEFAULT_FILTERS } from '@/context/FilterContext';
import ServiceCard from '@/components/ServiceCard';

const ALL_ID = '__all__';

export default function ServicesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState('');
  const [selectedCatId, setSelectedCatId] = useState<string>(ALL_ID);
  const { filters, activeCount } = useServiceFilters();

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
      ? 'All Services'
      : (CATEGORIES.find((cat) => cat.id === selectedCatId)?.name ?? 'Services');

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: c.headerBg, paddingTop: insets.top + 10 }]}>
        <Text style={styles.headerTitle}>Services</Text>

        {/* Inline search bar — always editable, never redirects */}
        <View style={styles.searchRow}>
          <View style={[styles.searchBar, { backgroundColor: '#FFF' }]}>
            <Feather name="search" size={15} color="#9E9E9E" />
            <TextInput
              ref={inputRef}
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search services…"
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
            <Text style={[styles.sectionTitle, { color: c.text }]}>Categories</Text>
            <TouchableOpacity onPress={() => router.push('/categories')}>
              <Text style={[styles.seeAll, { color: c.primary }]}>See all</Text>
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
                All
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
                    {cat.name}
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
            {filtered.length} available
          </Text>
        </View>

        {/* ── Empty state ──────────────────────────────────────────────────── */}
        {filtered.length === 0 && (
          <View style={styles.emptyWrap}>
            <View style={[styles.emptyIconWrap, { backgroundColor: c.primaryLight }]}>
              <Feather name="search" size={32} color={c.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: c.text }]}>No Services Found</Text>
            <Text style={[styles.emptySub, { color: c.mutedForeground }]}>
              {query.length > 0
                ? `No services match "${query}".`
                : 'No services in this category yet.'}{' '}
              Try a custom quote.
            </Text>
            <TouchableOpacity
              style={[styles.emptyBtn, { backgroundColor: c.primary }]}
              onPress={() => router.push('/quote-request' as any)}
              activeOpacity={0.85}
            >
              <Text style={styles.emptyBtnText}>Get a Custom Quote</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.emptyBtnOutline, { borderColor: c.primary }]}
              onPress={() => router.push('/(tabs)/inbox' as any)}
              activeOpacity={0.85}
            >
              <Feather name="message-circle" size={16} color={c.primary} />
              <Text style={[styles.emptyBtnOutlineText, { color: c.primary }]}>
                Start Live Chat
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Services list ─────────────────────────────────────────────────── */}
        {filtered.length > 0 && (
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
