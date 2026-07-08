import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Animated, { FadeInDown } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { CATEGORIES, SERVICES } from '@/data/mockData';

const c = colors.light;

export default function CategoryDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const category = CATEGORIES.find((cat) => cat.id === id) ?? CATEGORIES[0];
  const services = SERVICES.filter((s) => s.categoryId === id);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: c.primary }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{category.name} Services:</Text>
        <TouchableOpacity>
          <Feather name="more-vertical" size={22} color="#FFF" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={services.length > 0 ? services : SERVICES}
        keyExtractor={(s) => s.id}
        numColumns={2}
        contentContainerStyle={{ padding: 12 }}
        columnWrapperStyle={{ gap: 12, marginBottom: 12 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 60).duration(350)} style={styles.gridCard}>
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/service/${item.id}` as any)}
              activeOpacity={0.85}
            >
              <Image source={{ uri: item.image }} style={styles.cardImage} contentFit="cover" />
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
                <Text style={styles.avgPrice}>
                  Avg. Project: ${item.avgPriceMin ?? item.price}–${item.avgPriceMax ?? item.price + 50}
                </Text>
              </View>
            </TouchableOpacity>
          </Animated.View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F8F8' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, color: '#FFF', flex: 1, marginHorizontal: 12 },
  gridCard: { flex: 1 },
  card: { backgroundColor: '#FFF', borderRadius: 16, overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6 },
  cardImage: { width: '100%', height: 130 },
  cardBody: { padding: 10 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#1A1A1A', marginBottom: 4 },
  avgPrice: { fontFamily: 'Inter_400Regular', fontSize: 12, color: c.primary },
});
