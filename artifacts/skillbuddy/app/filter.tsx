import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { CATEGORIES } from '@/data/mockData';

const c = colors.light;

const RATINGS = [
  { label: '4.5 and above', stars: 4.5 },
  { label: '4.0 - 4.5', stars: 4.0 },
  { label: '3.5 - 4.0', stars: 3.5 },
  { label: '3.0 - 3.5', stars: 3.0 },
  { label: '2.5 - 3.0', stars: 2.5 },
];

const DATES = ['Today', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function FilterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [selectedCat, setSelectedCat] = useState('All');
  const [selectedRating, setSelectedRating] = useState(4.5);
  const [selectedDate, setSelectedDate] = useState('Today');

  const catTabs = ['All', ...CATEGORIES.slice(0, 5).map((cat) => cat.name)];

  return (
    <View style={styles.root}>
      <View style={styles.handle} />
      <View style={styles.headerRow}>
        <Text style={styles.title}>Filter</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="x" size={22} color="#1A1A1A" />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        {/* Category */}
        <Text style={styles.sectionLabel}>Category</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
        >
          {catTabs.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.catTab, selectedCat === cat && { backgroundColor: c.primary }]}
              onPress={() => setSelectedCat(cat)}
            >
              <Text style={[styles.catTabText, selectedCat === cat && { color: '#FFF' }]}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Price Range */}
        <Text style={styles.sectionLabel}>Price Range</Text>
        <View style={styles.priceRow}>
          <Text style={styles.priceLabel}>$20</Text>
          <View style={styles.sliderTrack}>
            <View style={[styles.sliderFill, { backgroundColor: c.primary }]} />
          </View>
          <Text style={styles.priceLabel}>$70</Text>
        </View>

        {/* Reviews */}
        <Text style={styles.sectionLabel}>Reviews</Text>
        <View style={{ paddingHorizontal: 20, gap: 14 }}>
          {RATINGS.map((r) => (
            <TouchableOpacity
              key={r.stars}
              style={styles.ratingRow}
              onPress={() => setSelectedRating(r.stars)}
            >
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <Feather
                    key={i}
                    name="star"
                    size={14}
                    color={i <= Math.floor(r.stars) ? c.rating : '#E8E8E8'}
                  />
                ))}
              </View>
              <Text style={styles.ratingLabel}>{r.label}</Text>
              <View style={[styles.radio, selectedRating === r.stars && { borderColor: c.primary }]}>
                {selectedRating === r.stars && (
                  <View style={[styles.radioFill, { backgroundColor: c.primary }]} />
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Available Date */}
        <Text style={styles.sectionLabel}>Available Date</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
        >
          {DATES.map((d, i) => (
            <TouchableOpacity
              key={d}
              style={[styles.dateTab, selectedDate === d && { backgroundColor: c.primary }]}
              onPress={() => setSelectedDate(d)}
            >
              <Text style={[styles.dateDay, selectedDate === d && { color: '#FFF' }]}>{d}</Text>
              <Text style={[styles.dateNum, selectedDate === d && { color: '#FFF' }]}>{4 + i} Oct</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </ScrollView>

      {/* Bottom Buttons */}
      <View style={[styles.bottomRow, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.resetBtn, { borderColor: c.primary }]}
          onPress={() => {
            setSelectedCat('All');
            setSelectedRating(4.5);
            setSelectedDate('Today');
          }}
        >
          <Text style={[styles.resetText, { color: c.primary }]}>Reset Filter</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.applyBtn, { backgroundColor: c.primary }]}
          onPress={() => router.back()}
        >
          <Text style={styles.applyText}>Apply</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#DDD', alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 18, color: '#1A1A1A' },
  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#1A1A1A', paddingHorizontal: 20, marginTop: 20, marginBottom: 12 },
  catTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#E8E8E8', backgroundColor: '#F5F5F5' },
  catTabText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: '#737373' },
  priceRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 12 },
  priceLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: '#737373' },
  sliderTrack: { flex: 1, height: 4, backgroundColor: '#E8E8E8', borderRadius: 2, position: 'relative' },
  sliderFill: { position: 'absolute', left: '15%', right: '15%', height: '100%', borderRadius: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  starsRow: { flexDirection: 'row', gap: 2 },
  ratingLabel: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, color: '#1A1A1A' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#DDD', alignItems: 'center', justifyContent: 'center' },
  radioFill: { width: 10, height: 10, borderRadius: 5 },
  dateTab: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: '#E8E8E8', alignItems: 'center', minWidth: 62 },
  dateDay: { fontFamily: 'Inter_500Medium', fontSize: 12, color: '#737373' },
  dateNum: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#1A1A1A', marginTop: 2 },
  bottomRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  resetBtn: { flex: 1, borderWidth: 1.5, borderRadius: 28, paddingVertical: 14, alignItems: 'center' },
  resetText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  applyBtn: { flex: 1, borderRadius: 28, paddingVertical: 14, alignItems: 'center' },
  applyText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#FFF' },
});
