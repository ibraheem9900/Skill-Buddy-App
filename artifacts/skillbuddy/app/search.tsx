import React, { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { SERVICES } from '@/data/mockData';
import ServiceCard from '@/components/ServiceCard';
import EmptyState from '@/components/EmptyState';

const c = colors.light;

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('Home Cleaning');

  const filtered = SERVICES.filter(
    (s) =>
      !query ||
      s.title.toLowerCase().includes(query.toLowerCase()) ||
      s.category.toLowerCase().includes(query.toLowerCase()) ||
      s.provider.name.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Search Header */}
      <View style={styles.searchHeader}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color="#1A1A1A" />
        </TouchableOpacity>
        <View style={styles.searchBar}>
          <Feather name="search" size={18} color={c.primary} />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search services..."
            placeholderTextColor="#9E9E9E"
            returnKeyType="search"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <View style={[styles.clearBtn, { backgroundColor: c.primaryLight }]}>
                <Feather name="x" size={14} color={c.primary} />
              </View>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity onPress={() => router.push('/filter')}>
          <Feather name="sliders" size={20} color="#1A1A1A" />
        </TouchableOpacity>
      </View>

      <Text style={styles.resultCount}>
        {filtered.length} Result{filtered.length !== 1 ? 's' : ''} Found
      </Text>

      <FlatList
        data={filtered}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 0 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            icon="search"
            title="No Results Found"
            subtitle={`No services match "${query}". Try a different search term.`}
          />
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 50).duration(300)}>
            <ServiceCard service={item} variant="list" />
          </Animated.View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF' },
  searchHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1.5, borderColor: c.primary, borderRadius: 25,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, color: '#1A1A1A' },
  clearBtn: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  resultCount: { fontFamily: 'Inter_700Bold', fontSize: 16, color: '#1A1A1A', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
});
