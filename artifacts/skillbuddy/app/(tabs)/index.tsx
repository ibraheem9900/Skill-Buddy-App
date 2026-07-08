import React, { useCallback, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { CATEGORIES, OFFERS, SERVICES } from '@/data/mockData';
import ServiceCard from '@/components/ServiceCard';
import CategoryItem from '@/components/CategoryItem';
import SpecialOfferCard from '@/components/SpecialOfferCard';

const { width } = Dimensions.get('window');
const c = colors.light;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [location] = useState('New York, USA');
  const [offerIdx, setOfferIdx] = useState(0);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1500);
  }, []);

  const TAB_HEIGHT = Platform.OS === 'web' ? 84 : 60;

  return (
    <View style={styles.root}>
      {/* Green Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.locationRow}>
          <View style={styles.locationLeft}>
            <MaterialIcons name="location-on" size={18} color="#FFB800" />
            <TouchableOpacity style={styles.locationBtn} onPress={() => router.push('/location')}>
              <Text style={styles.locationText}>{location}</Text>
              <Feather name="chevron-down" size={16} color="#FFF" />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.notifBtn} onPress={() => router.push('/notifications')}>
            <Feather name="bell" size={20} color="#FFF" />
            <View style={styles.notifDot} />
          </TouchableOpacity>
        </View>
        {/* Search Bar */}
        <Pressable style={styles.searchWrap} onPress={() => router.push('/search')}>
          <View style={styles.searchBar}>
            <Feather name="search" size={18} color="#9E9E9E" />
            <Text style={styles.searchPlaceholder}>Search</Text>
          </View>
          <TouchableOpacity style={styles.filterBtn} onPress={() => router.push('/filter')}>
            <Feather name="sliders" size={18} color={c.primary} />
          </TouchableOpacity>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: TAB_HEIGHT + 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} />}
      >
        {/* Special For You */}
        <Animated.View entering={FadeInDown.delay(50).duration(400)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>#SpecialForYou</Text>
            <TouchableOpacity><Text style={[styles.seeAll, { color: c.primary }]}>See All</Text></TouchableOpacity>
          </View>
          <FlatList
            data={OFFERS}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(o) => o.id}
            contentContainerStyle={{ paddingHorizontal: 16 }}
            renderItem={({ item }) => <SpecialOfferCard offer={item} />}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / 290);
              setOfferIdx(idx);
            }}
          />
          <View style={styles.dotsRow}>
            {OFFERS.map((_, i) => (
              <View key={i} style={[styles.dot, offerIdx === i && { backgroundColor: c.primary, width: 16 }]} />
            ))}
          </View>
        </Animated.View>

        {/* Categories */}
        <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Categories</Text>
            <TouchableOpacity onPress={() => router.push('/categories')}>
              <Text style={[styles.seeAll, { color: c.primary }]}>See all</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={CATEGORIES.slice(0, 8)}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(cat) => cat.id}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            renderItem={({ item }) => <CategoryItem category={item} />}
          />
        </Animated.View>

        {/* Popular Services */}
        <Animated.View entering={FadeInDown.delay(150).duration(400)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Popular Services</Text>
            <TouchableOpacity onPress={() => router.push('/search')}><Text style={[styles.seeAll, { color: c.primary }]}>See all</Text></TouchableOpacity>
          </View>
          <FlatList
            data={SERVICES}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(s) => s.id}
            contentContainerStyle={{ paddingHorizontal: 16 }}
            renderItem={({ item }) => <ServiceCard service={item} />}
          />
        </Animated.View>

        {/* Nearby Services */}
        <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Nearby Services</Text>
            <TouchableOpacity onPress={() => router.push('/search')}><Text style={[styles.seeAll, { color: c.primary }]}>See all</Text></TouchableOpacity>
          </View>
          <FlatList
            data={SERVICES.slice(0).reverse()}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(s) => s.id + '-n'}
            contentContainerStyle={{ paddingHorizontal: 16 }}
            renderItem={({ item }) => <ServiceCard service={item} />}
          />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F8F8' },
  header: {
    backgroundColor: c.primary,
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  locationLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#FFF' },
  notifBtn: { position: 'relative', backgroundColor: 'rgba(255,255,255,0.2)', width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  notifDot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: '#E74C3C', borderWidth: 1.5, borderColor: c.primary },
  searchWrap: { flexDirection: 'row', gap: 10 },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFF', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
  },
  searchPlaceholder: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#9E9E9E' },
  filterBtn: { backgroundColor: '#FFF', width: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  section: { marginTop: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 14 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, color: '#1A1A1A' },
  seeAll: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#DDD' },
});
