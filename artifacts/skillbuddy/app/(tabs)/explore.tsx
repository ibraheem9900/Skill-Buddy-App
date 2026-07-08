import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { SERVICES } from '@/data/mockData';
import ServiceCard from '@/components/ServiceCard';
import ExploreMap from '@/components/ExploreMap';

const c = colors.light;

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const filtered = SERVICES.filter(
    (s) =>
      !query ||
      s.title.toLowerCase().includes(query.toLowerCase()) ||
      s.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <View style={styles.root}>
      {/* Map fills the background */}
      <View style={StyleSheet.absoluteFillObject}>
        <ExploreMap />
      </View>

      {/* Search overlay */}
      <View style={[styles.searchOverlay, { top: insets.top + 12 }]}>
        <View style={styles.searchBar}>
          <Feather name="search" size={18} color="#9E9E9E" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search Services"
            placeholderTextColor="#9E9E9E"
            value={query}
            onChangeText={setQuery}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Feather name="x-circle" size={18} color="#9E9E9E" />
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
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + 10 }]}>
        <View style={styles.panelHandle} />
        <Text style={styles.panelTitle}>{filtered.length} Services Nearby</Text>
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
  root: { flex: 1, backgroundColor: '#E8F5F3' },
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
    backgroundColor: '#FFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, color: '#1A1A1A' },
  filterBtn: { width: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bottomPanel: {
    backgroundColor: '#FFF',
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
    backgroundColor: '#DDD',
    alignSelf: 'center',
    marginBottom: 12,
  },
  panelTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: '#1A1A1A',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
});
