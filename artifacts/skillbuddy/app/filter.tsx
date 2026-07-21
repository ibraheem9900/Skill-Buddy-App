/**
 * Filter screen — opens as a transparent-modal bottom sheet.
 * The top area is a dimmed backdrop (tapping it dismisses).
 * The bottom panel slides up with rounded top corners, drag-to-dismiss, and real filter state.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  Dimensions,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { CATEGORIES } from '@/data/mockData';
import { useServiceFilters, DEFAULT_FILTERS } from '@/context/FilterContext';

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_HEIGHT = Math.round(SCREEN_H * 0.72);

const RATINGS = [
  { label: '4.5 & above', stars: 4.5 },
  { label: '4.0 – 4.5',   stars: 4.0 },
  { label: '3.5 – 4.0',   stars: 3.5 },
  { label: '3.0 – 3.5',   stars: 3.0 },
];

const TODAY = new Date();
const DATES = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(TODAY);
  d.setDate(TODAY.getDate() + i);
  return {
    key: i === 0 ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' }),
    sub: d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
  };
});

export default function FilterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();

  // ── Filter state ──────────────────────────────────────────────────────────
  const { filters, setFilters, resetFilters: resetContextFilters } = useServiceFilters();
  const initialCatName = CATEGORIES.find((cat) => cat.id === filters.categoryId)?.name ?? 'All';
  const [selectedCat, setSelectedCat] = useState(initialCatName);
  const [selectedRating, setSelectedRating] = useState<number | null>(filters.minRating);
  const [selectedDate, setSelectedDate] = useState<string | null>(filters.date);
  const [minPrice, setMinPrice] = useState(filters.minPrice);
  const [maxPrice, setMaxPrice] = useState(filters.maxPrice);

  const catTabs = ['All', ...CATEGORIES.slice(0, 6).map((cat) => cat.name)];

  // ── Drag-to-dismiss ───────────────────────────────────────────────────────
  const translateY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5 && g.dy > 0,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) {
          Animated.timing(translateY, { toValue: SHEET_HEIGHT, duration: 220, useNativeDriver: true }).start(() => router.back());
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const dismiss = useCallback(() => {
    Animated.timing(translateY, { toValue: SHEET_HEIGHT, duration: 200, useNativeDriver: true }).start(() => router.back());
  }, []);

  const resetFilters = () => {
    setSelectedCat('All');
    setSelectedRating(null);
    setSelectedDate(null);
    setMinPrice(DEFAULT_FILTERS.minPrice);
    setMaxPrice(DEFAULT_FILTERS.maxPrice);
    resetContextFilters();
  };

  const applyFilters = () => {
    const categoryId = selectedCat === 'All' ? null : CATEGORIES.find((cat) => cat.name === selectedCat)?.id ?? null;
    setFilters({
      categoryId,
      minPrice,
      maxPrice,
      minRating: selectedRating,
      date: selectedDate,
    });
    dismiss();
  };

  return (
    <View style={styles.root}>
      {/* Dimmed backdrop */}
      <TouchableWithoutFeedback onPress={dismiss}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: c.card, paddingBottom: insets.bottom + 16, transform: [{ translateY }] },
        ]}
      >
        {/* Drag handle */}
        <View {...panResponder.panHandlers} style={styles.handleArea}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />
        </View>

        {/* Header row */}
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: c.text }]}>Filter</Text>
          <TouchableOpacity onPress={dismiss} style={[styles.closeBtn, { backgroundColor: c.muted }]}>
            <Feather name="x" size={18} color={c.text} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
          {/* Category */}
          <Text style={[styles.sectionLabel, { color: c.text }]}>Category</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
          >
            {catTabs.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[
                  styles.catTab,
                  { borderColor: c.border, backgroundColor: c.muted },
                  selectedCat === cat && { backgroundColor: c.primary, borderColor: c.primary },
                ]}
                onPress={() => setSelectedCat(cat)}
              >
                <Text style={[styles.catTabText, { color: c.mutedForeground }, selectedCat === cat && { color: '#FFF' }]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Price Range */}
          <Text style={[styles.sectionLabel, { color: c.text }]}>Price Range</Text>
          <View style={styles.priceRow}>
            <View style={[styles.priceBox, { borderColor: c.border, backgroundColor: c.muted }]}>
              <Text style={[styles.priceBoxLabel, { color: c.mutedForeground }]}>Min</Text>
              <Text style={[styles.priceBoxValue, { color: c.text }]}>€{minPrice}</Text>
            </View>
            <View style={[styles.sliderTrack, { backgroundColor: c.border }]}>
              <View style={[styles.sliderFill, { backgroundColor: c.primary }]} />
            </View>
            <View style={[styles.priceBox, { borderColor: c.border, backgroundColor: c.muted }]}>
              <Text style={[styles.priceBoxLabel, { color: c.mutedForeground }]}>Max</Text>
              <Text style={[styles.priceBoxValue, { color: c.text }]}>€{maxPrice}</Text>
            </View>
          </View>

          {/* Reviews */}
          <Text style={[styles.sectionLabel, { color: c.text }]}>Minimum Rating</Text>
          <View style={{ paddingHorizontal: 20, gap: 12 }}>
            {RATINGS.map((r) => (
              <TouchableOpacity
                key={r.stars}
                style={styles.ratingRow}
                onPress={() => setSelectedRating(selectedRating === r.stars ? null : r.stars)}
                activeOpacity={0.7}
              >
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <MaterialIcons key={i} name="star" size={14} color={i <= Math.floor(r.stars) ? '#FFB800' : c.border} />
                  ))}
                </View>
                <Text style={[styles.ratingLabel, { color: c.text }]}>{r.label}</Text>
                <View
                  style={[
                    styles.radio,
                    { borderColor: c.border },
                    selectedRating === r.stars && { borderColor: c.primary },
                  ]}
                >
                  {selectedRating === r.stars && (
                    <View style={[styles.radioFill, { backgroundColor: c.primary }]} />
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* Available Date */}
          <Text style={[styles.sectionLabel, { color: c.text }]}>Available Date</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
          >
            {DATES.map((d) => (
              <TouchableOpacity
                key={d.key}
                style={[
                  styles.dateTab,
                  { borderColor: c.border, backgroundColor: c.muted },
                  selectedDate === d.key && { backgroundColor: c.primary, borderColor: c.primary },
                ]}
                onPress={() => setSelectedDate(selectedDate === d.key ? null : d.key)}
              >
                <Text style={[styles.dateDay, { color: c.mutedForeground }, selectedDate === d.key && { color: '#FFF' }]}>
                  {d.key}
                </Text>
                <Text style={[styles.dateNum, { color: c.text }, selectedDate === d.key && { color: '#FFF' }]}>
                  {d.sub}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </ScrollView>

        {/* Bottom buttons */}
        <View style={[styles.bottomRow, { borderTopColor: c.border }]}>
          <TouchableOpacity
            style={[styles.resetBtn, { borderColor: c.primary }]}
            onPress={resetFilters}
          >
            <Text style={[styles.resetText, { color: c.primary }]}>Reset Filter</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.applyBtn, { backgroundColor: c.primary }]}
            onPress={applyFilters}
          >
            <Text style={styles.applyText}>Apply</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    height: SHEET_HEIGHT,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    paddingHorizontal: 20,
    marginTop: 18,
    marginBottom: 10,
  },
  catTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  catTabText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 10,
  },
  priceBox: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    minWidth: 62,
  },
  priceBoxLabel: { fontFamily: 'Inter_400Regular', fontSize: 10 },
  priceBoxValue: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  sliderTrack: { flex: 1, height: 4, borderRadius: 2 },
  sliderFill: { position: 'absolute', left: '10%', right: '10%', height: '100%', borderRadius: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  starsRow: { flexDirection: 'row', gap: 2 },
  ratingLabel: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioFill: { width: 10, height: 10, borderRadius: 5 },
  dateTab: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    minWidth: 64,
  },
  dateDay: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  dateNum: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 2 },
  bottomRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  resetBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 28,
    paddingVertical: 14,
    alignItems: 'center',
  },
  resetText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  applyBtn: { flex: 1, borderRadius: 28, paddingVertical: 14, alignItems: 'center' },
  applyText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#FFF' },
});
