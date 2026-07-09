import React, { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { SERVICES } from '@/data/mockData';
import ServiceCard from '@/components/ServiceCard';
import EmptyState from '@/components/EmptyState';

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
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
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      {/* Search Header */}
      <View style={[styles.searchHeader, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={c.text} />
        </TouchableOpacity>
        <View style={[styles.searchBar, { backgroundColor: c.input }]}>
          <Feather name="search" size={18} color={c.primary} />
          <TextInput
            ref={inputRef}
            style={[styles.searchInput, { color: c.text }]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search services..."
            placeholderTextColor={c.mutedForeground}
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
          <Feather name="sliders" size={20} color={c.text} />
        </TouchableOpacity>
      </View>

      {/* Results count */}
      <View style={[styles.resultRow, { borderBottomColor: c.border }]}>
        <Text style={[styles.resultCount, { color: c.mutedForeground }]}>
          {filtered.length} results for{' '}
          <Text style={{ color: c.text, fontFamily: 'Inter_600SemiBold' }}>"{query}"</Text>
        </Text>
      </View>

      {filtered.length === 0 ? (
        <EmptyState
          icon="search"
          title="No Results"
          subtitle={`No services match "${query}". Try a different search term.`}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: 16, gap: 0 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(index * 50).duration(300)}>
              <ServiceCard service={item} variant="list" />
            </Animated.View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14 },
  clearBtn: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  resultRow: { paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1 },
  resultCount: { fontFamily: 'Inter_400Regular', fontSize: 13 },
});
