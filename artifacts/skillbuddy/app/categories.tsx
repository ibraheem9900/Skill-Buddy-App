import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { CATEGORIES } from '@/data/mockData';
import CategoryItem from '@/components/CategoryItem';

export default function CategoriesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();

  const footer = (
    <Animated.View entering={FadeInDown.delay(600).duration(400)} style={[styles.quoteBanner, { backgroundColor: c.primaryLight, borderColor: c.primary }]}>
      <View style={styles.quoteInner}>
        <View style={[styles.quoteIconWrap, { backgroundColor: c.primary }]}>
          <Feather name="help-circle" size={22} color="#FFF" />
        </View>
        <View style={styles.quoteText}>
          <Text style={[styles.quoteTitle, { color: c.text }]}>Can't find what you need?</Text>
          <Text style={[styles.quoteSub, { color: c.mutedForeground }]}>Get a custom quote from our experts</Text>
        </View>
      </View>
      <TouchableOpacity
        style={[styles.quoteBtn, { backgroundColor: c.primary }]}
        onPress={() => router.push('/quote-request' as any)}
        activeOpacity={0.85}
      >
        <Text style={styles.quoteBtnText}>Get a Custom Quote</Text>
      </TouchableOpacity>
    </Animated.View>
  );

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: 8 }]}>
      <FlatList
        data={CATEGORIES}
        keyExtractor={(c) => c.id}
        numColumns={4}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        columnWrapperStyle={{ justifyContent: 'space-between', marginBottom: 20 }}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={footer}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 30).duration(300)}>
            <CategoryItem category={item} />
          </Animated.View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  quoteBanner: {
    marginTop: 8,
    marginHorizontal: 4,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  quoteInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  quoteIconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  quoteText: { flex: 1 },
  quoteTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  quoteSub: { fontFamily: 'Manrope_400Regular', fontSize: 13, marginTop: 2 },
  quoteBtn: {
    borderRadius: 28,
    paddingVertical: 13,
    alignItems: 'center',
  },
  quoteBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15, color: '#FFF' },
});
