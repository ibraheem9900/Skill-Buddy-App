import React, { useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';

const SUGGESTIONS = [
  { id: '1', name: 'Tallinn City Center', sub: 'Tallinn, Estonia' },
  { id: '2', name: 'Riga Old Town', sub: 'Riga, Latvia' },
  { id: '3', name: 'Vilnius Old Town', sub: 'Vilnius, Lithuania' },
  { id: '4', name: 'Tartu', sub: 'Tartu, Estonia' },
  { id: '5', name: 'Pärnu', sub: 'Pärnu, Estonia' },
  { id: '6', name: 'Kaunas', sub: 'Kaunas, Lithuania' },
  { id: '7', name: 'Jūrmala', sub: 'Jūrmala, Latvia' },
];

export default function LocationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? SUGGESTIONS.filter(
        (s) =>
          s.name.toLowerCase().includes(query.toLowerCase()) ||
          s.sub.toLowerCase().includes(query.toLowerCase())
      )
    : SUGGESTIONS;

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: c.muted }]}
        >
          <Feather name="arrow-left" size={20} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: c.text }]}>Enter Your Location</Text>
      </View>

      {/* Search bar */}
      <View style={[styles.searchRow, { backgroundColor: c.muted }]}>
        <Feather name="search" size={18} color={c.mutedForeground} style={{ marginLeft: 14 }} />
        <TextInput
          style={[styles.input, { color: c.text }]}
          placeholder="Search city or address…"
          placeholderTextColor={c.mutedForeground}
          value={query}
          onChangeText={setQuery}
          autoFocus
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} style={{ marginRight: 12 }}>
            <Feather name="x-circle" size={18} color={c.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {/* Use current location */}
      <TouchableOpacity
        style={[styles.currentRow]}
        onPress={() => router.back()}
        activeOpacity={0.7}
      >
        <View style={[styles.currentIcon, { backgroundColor: c.primaryLight }]}>
          <MaterialIcons name="my-location" size={18} color={c.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.currentLabel, { color: c.text }]}>Use current location</Text>
          <Text style={[styles.currentSub, { color: c.mutedForeground }]}>Detect via GPS</Text>
        </View>
        <Feather name="chevron-right" size={18} color={c.mutedForeground} />
      </TouchableOpacity>

      <View style={[styles.divider, { backgroundColor: c.border }]} />

      {/* Results list */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="map-pin" size={32} color={c.border} />
            <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
              No results for &ldquo;{query}&rdquo;
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.resultRow}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <View style={[styles.resultIcon, { backgroundColor: c.muted }]}>
              <MaterialIcons name="place" size={18} color={c.mutedForeground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.resultName, { color: c.text }]}>{item.name}</Text>
              <Text style={[styles.resultSub, { color: c.mutedForeground }]}>{item.sub}</Text>
            </View>
            <Feather name="chevron-right" size={16} color={c.mutedForeground} />
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: c.border }]} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 14,
    gap: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    paddingRight: 4,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  currentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  currentIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  currentSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16, marginBottom: 8 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  resultIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultName: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  resultSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  separator: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
});
