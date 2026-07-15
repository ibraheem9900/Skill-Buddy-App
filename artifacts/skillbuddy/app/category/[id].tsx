import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { CATEGORIES, SUBSERVICES } from '@/data/mockData';
import { getServiceForSubservice } from '@/lib/serviceLookup';

export default function CategoryDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const category = CATEGORIES.find((cat) => cat.id === id) ?? CATEGORIES[0];
  const subservices = SUBSERVICES.filter((ss) => ss.categoryId === id);

  const handleSubservicePress = (subserviceId: string) => {
    const service = getServiceForSubservice(subserviceId);
    router.push(`/service/${service.id}` as any);
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: c.primary }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Feather name="arrow-left" size={22} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{category.name}</Text>
        <View style={{ width: 38 }} />
      </View>

      <FlatList
        data={subservices}
        keyExtractor={(ss) => ss.id}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Feather name="inbox" size={40} color={c.border} />
            <Text style={[styles.emptyText, { color: c.mutedForeground }]}>No subservices found.</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 60).duration(350)}>
            <TouchableOpacity
              style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={() => handleSubservicePress(item.id)}
              activeOpacity={0.82}
            >
              <View style={[styles.iconCircle, { backgroundColor: c.primaryLight }]}>
                <Feather name="tool" size={20} color={c.primary} />
              </View>
              <View style={styles.cardBody}>
                <Text style={[styles.cardTitle, { color: c.text }]}>{item.name}</Text>
                <Text style={[styles.cardDesc, { color: c.mutedForeground }]} numberOfLines={2}>
                  {item.description}
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={c.mutedForeground} />
            </TouchableOpacity>
          </Animated.View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
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
    paddingVertical: 14,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  headerTitle: {
    flex: 1,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: '#FFF',
    textAlign: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, marginBottom: 3 },
  cardDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  emptyWrap: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
});
