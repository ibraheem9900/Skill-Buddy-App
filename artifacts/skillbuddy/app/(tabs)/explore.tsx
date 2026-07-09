import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { SERVICES } from '@/data/mockData';
import ServiceCard from '@/components/ServiceCard';
import ExploreMap from '@/components/ExploreMap';

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const [query, setQuery] = useState('');

  const filtered = SERVICES.filter(
    (s) =>
      !query ||
      s.title.toLowerCase().includes(query.toLowerCase()) ||
      s.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <View style={[styles.root, { backgroundColor: c.primaryLight }]}>
      {/* Map fills the background */}
      <View style={StyleSheet.absoluteFillObject}>
        <ExploreMap />
      </View>

      {/* Search overlay */}
      <View style={[styles.searchOverlay, { top: insets.top + 12 }]}>
        <View style={[styles.searchBar, { backgroundColor: c.card }]}>
          <Feather name="search" size={18} color={c.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: c.text }]}
            placeholder="Search Services"
            placeholderTextColor={c.mutedForeground}
            value={query}
            onChangeText={setQuery}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Feather name="x-circle" size={18} color={c.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, { backgroundColor: c.primary }]}
          onPress={() => router.push('/filter')}
        >
          <Feather name="sliders" size={18} color="#FFF" />
        </TouchableOpacity>
      </View>

      {/* Bottom services panel */}
      <View style={[styles.bottomPanel, { backgroundColor: c.card, paddingBottom: insets.bottom + 10 }]}>
        <View style={[styles.panelHandle, { backgroundColor: c.border }]} />
        <Text style={[styles.panelTitle, { color: c.text }]}>{filtered.length} Services Nearby</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 0 }}
        >
          {filtered.map((svc) => (
            <ServiceCard key={svc.id} service={svc} />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  searchOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 10,
    flexDirection: 'row',
    gap: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14 },
  filterBtn: { width: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bottomPanel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  panelHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  panelTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
});
