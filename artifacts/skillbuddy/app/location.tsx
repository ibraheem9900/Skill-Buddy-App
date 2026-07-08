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
import colors from '@/constants/colors';

const c = colors.light;

const SUGGESTIONS = [
  { id: '1', name: 'Tallinn City Center', sub: 'Tallinn, Estonia', icon: 'place' as const },
  { id: '2', name: 'Riga Old Town', sub: 'Riga, Latvia', icon: 'place' as const },
  { id: '3', name: 'Vilnius Old Town', sub: 'Vilnius, Lithuania', icon: 'place' as const },
  { id: '4', name: 'Tartu', sub: 'Tartu, Estonia', icon: 'place' as const },
  { id: '5', name: 'Pärnu', sub: 'Pärnu, Estonia', icon: 'place' as const },
  { id: '6', name: 'Kaunas', sub: 'Kaunas, Lithuania', icon: 'place' as const },
  { id: '7', name: 'Jūrmala', sub: 'Jūrmala, Latvia', icon: 'place' as const },
];

export default function LocationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? SUGGESTIONS.filter(
        (s) =>
          s.name.toLowerCase().includes(query.toLowerCase()) ||
          s.sub.toLowerCase().includes(query.toLowerCase())
      )
    : SUGGESTIONS;

  const selectLocation = (name: string) => {
    // In a real app this would write to a LocationContext; here we just go back
    router.back();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.title}>Choose Location</Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <Feather name="search" size={18} color="#737373" style={{ marginLeft: 14 }} />
        <TextInput
          style={styles.input}
          placeholder="Search city or address…"
          placeholderTextColor="#BCBCBC"
          value={query}
          onChangeText={setQuery}
          autoFocus
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} style={{ marginRight: 12 }}>
            <Feather name="x-circle" size={18} color="#BCBCBC" />
          </TouchableOpacity>
        )}
      </View>

      {/* Use current location */}
      <TouchableOpacity style={styles.currentRow} onPress={() => selectLocation('Current Location')}>
        <View style={[styles.currentIcon, { backgroundColor: c.primaryLight }]}>
          <MaterialIcons name="my-location" size={18} color={c.primary} />
        </View>
        <View>
          <Text style={styles.currentLabel}>Use current location</Text>
          <Text style={styles.currentSub}>Detect via GPS</Text>
        </View>
        <Feather name="chevron-right" size={18} color="#BCBCBC" style={{ marginLeft: 'auto' }} />
      </TouchableOpacity>

      <View style={styles.divider} />

      {/* Results list */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="map-pin" size={32} color="#DDD" />
            <Text style={styles.emptyText}>No results for "{query}"</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.resultRow} onPress={() => selectLocation(item.name)} activeOpacity={0.7}>
            <View style={styles.resultIcon}>
              <MaterialIcons name={item.icon} size={18} color="#737373" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.resultName}>{item.name}</Text>
              <Text style={styles.resultSub}>{item.sub}</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#BCBCBC" />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 18, color: '#1A1A1A' },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, backgroundColor: '#F5F5F5', borderRadius: 14, gap: 8 },
  input: { flex: 1, paddingVertical: 12, paddingRight: 4, fontFamily: 'Inter_400Regular', fontSize: 15, color: '#1A1A1A' },
  currentRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  currentIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  currentLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#1A1A1A' },
  currentSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#737373', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#F0F0F0', marginHorizontal: 16, marginBottom: 8 },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  resultIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  resultName: { fontFamily: 'Inter_500Medium', fontSize: 14, color: '#1A1A1A' },
  resultSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#737373', marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#BCBCBC' },
});
