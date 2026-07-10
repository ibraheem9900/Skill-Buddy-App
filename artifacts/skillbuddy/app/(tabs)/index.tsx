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
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { CATEGORIES, OFFERS, SERVICES } from '@/data/mockData';
import ServiceCard from '@/components/ServiceCard';
import CategoryItem from '@/components/CategoryItem';
import SpecialOfferCard from '@/components/SpecialOfferCard';
import LogoImage from '@/components/LogoImage';

const { width: SCREEN_W } = Dimensions.get('window');
// One full offer card per "page": full width minus 32px horizontal padding
const OFFER_W = SCREEN_W - 32;
const SNAP_INTERVAL = OFFER_W + 12; // card width + gap

// ─── How It Works ─────────────────────────────────────────────────────────────
const HOW_IT_WORKS: {
  step: number;
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  desc: string;
}[] = [
  { step: 1, icon: 'search',         title: 'Browse Services', desc: 'Search or explore categories near you' },
  { step: 2, icon: 'file-text',      title: 'Post a Job',      desc: 'Describe your need and set a budget' },
  { step: 3, icon: 'message-circle', title: 'Get Bids',        desc: 'Pilots send competitive offers' },
  { step: 4, icon: 'user-check',     title: 'Choose Pilot',    desc: 'Pick the best match by rating & price' },
  { step: 5, icon: 'check-circle',   title: 'Job Done!',       desc: 'Pay securely and leave a review' },
];

// ─── Testimonials ─────────────────────────────────────────────────────────────
const TESTIMONIALS = [
  {
    id: 't1',
    name: 'Anna K.',
    initials: 'AK',
    rating: 5,
    comment: 'Incredibly fast and professional. My apartment has never been this clean!',
    service: 'Deep House Cleaning',
    avatarColor: '#4ECDC4',
  },
  {
    id: 't2',
    name: 'Marcus L.',
    initials: 'ML',
    rating: 5,
    comment: 'Found a great electrician within minutes. SkillBuddy is a game changer.',
    service: 'Electrical Repair',
    avatarColor: '#FF6B6B',
  },
  {
    id: 't3',
    name: 'Sofia R.',
    initials: 'SR',
    rating: 5,
    comment: 'The badge system keeps providers accountable. Highly recommend!',
    service: 'Plumbing',
    avatarColor: '#A29BFE',
  },
];

// ─── Badge tiers ──────────────────────────────────────────────────────────────
const BADGE_TIERS = [
  { tier: 'Bronze', color: '#CD7F32', icon: 'award' as const },
  { tier: 'Silver', color: '#A0A0A0', icon: 'award' as const },
  { tier: 'Gold',   color: '#FFB800', icon: 'award' as const },
];

// ─── Star row ─────────────────────────────────────────────────────────────────
function Stars({ count }: { count: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <MaterialIcons key={i} name="star" size={12} color={i <= count ? '#FFB800' : '#E0E0E0'} />
      ))}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [offerIdx, setOfferIdx] = useState(0);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1500);
  }, []);

  const TAB_H = Platform.OS === 'web' ? 84 : 60;

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: c.headerBg, paddingTop: insets.top + 8 }]}>
        {/* Logo + notification row */}
        <View style={styles.logoRow}>
          <LogoImage variant="white" height={30} />
          <TouchableOpacity
            style={[styles.notifBtn, { borderColor: 'rgba(255,255,255,0.3)' }]}
            onPress={() => router.push('/notifications')}
          >
            <Feather name="bell" size={18} color="#FFF" />
            <View style={[styles.notifDot, { borderColor: c.headerBg }]} />
          </TouchableOpacity>
        </View>

        {/* Location row */}
        <View style={styles.locationRow}>
          <MaterialIcons name="location-on" size={15} color="#FFB800" />
          <TouchableOpacity style={styles.locationBtn} onPress={() => router.push('/location')}>
            <Text style={styles.locationText}>Riga, Latvia</Text>
            <Feather name="chevron-down" size={13} color="#FFF" />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <Pressable style={styles.searchWrap} onPress={() => router.push('/search')}>
          <View style={styles.searchBar}>
            <Feather name="search" size={15} color="#9E9E9E" />
            <Text style={styles.searchPlaceholder}>Search for a service…</Text>
          </View>
          <TouchableOpacity style={styles.filterBtn} onPress={() => router.push('/filter')}>
            <Feather name="sliders" size={15} color={c.primary} />
          </TouchableOpacity>
        </Pressable>
      </View>

      {/* ── Scroll ─────────────────────────────────────────────────────────── */}
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: TAB_H + insets.bottom + 8 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} />
        }
      >
        {/* Special Offers */}
        <Animated.View entering={FadeInDown.delay(40).duration(380)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Special For You</Text>
            <TouchableOpacity>
              <Text style={[styles.seeAll, { color: c.primary }]}>See All</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={OFFERS}
            horizontal
            pagingEnabled={false}
            snapToInterval={SNAP_INTERVAL}
            snapToAlignment="start"
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            keyExtractor={(o) => o.id}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            renderItem={({ item }) => (
              <SpecialOfferCard offer={item} cardWidth={OFFER_W} />
            )}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / SNAP_INTERVAL);
              setOfferIdx(Math.max(0, Math.min(idx, OFFERS.length - 1)));
            }}
          />
          <View style={styles.dotsRow}>
            {OFFERS.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  offerIdx === i
                    ? { backgroundColor: c.primary, width: 16, borderRadius: 3 }
                    : { backgroundColor: c.border, width: 5 },
                ]}
              />
            ))}
          </View>
        </Animated.View>

        {/* Categories */}
        <Animated.View entering={FadeInDown.delay(80).duration(380)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Categories</Text>
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
        <Animated.View entering={FadeInDown.delay(120).duration(380)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Popular Services</Text>
            <TouchableOpacity onPress={() => router.push('/search')}>
              <Text style={[styles.seeAll, { color: c.primary }]}>See all</Text>
            </TouchableOpacity>
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

        {/* Earn Badges */}
        <Animated.View entering={FadeInDown.delay(160).duration(380)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Earn Badges</Text>
            <TouchableOpacity>
              <Text style={[styles.seeAll, { color: c.primary }]}>Learn more</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.badgeCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.badgeCardRow}>
              <View style={styles.badgeCardLeft}>
                <View style={styles.badgeCardTitleRow}>
                  <Feather name="award" size={15} color={c.primary} />
                  <Text style={[styles.badgeCardTitle, { color: c.text }]}>Unlock Real Rewards</Text>
                </View>
                <Text style={[styles.badgeCardSub, { color: c.mutedForeground }]}>
                  Complete jobs to climb the tiers
                </Text>
              </View>
              <View style={styles.badgeTiers}>
                {BADGE_TIERS.map((b) => (
                  <View key={b.tier} style={styles.badgeTierItem}>
                    <Feather name={b.icon} size={22} color={b.color} />
                    <Text style={[styles.badgeTierLabel, { color: b.color }]}>{b.tier}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={[styles.badgeTrack, { backgroundColor: c.border }]}>
              <View style={[styles.badgeFill, { backgroundColor: c.primary, width: '30%' }]} />
            </View>
            <Text style={[styles.badgeProgressLabel, { color: c.mutedForeground }]}>
              3 / 10 jobs to Silver
            </Text>
          </View>
        </Animated.View>

        {/* How It Works */}
        <Animated.View entering={FadeInDown.delay(200).duration(380)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>How It Works</Text>
          </View>
          <FlatList
            data={HOW_IT_WORKS}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(h) => String(h.step)}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
            renderItem={({ item }) => (
              <View style={[styles.howCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <View style={[styles.howStep, { backgroundColor: c.primaryLight }]}>
                  <Text style={[styles.howStepNum, { color: c.primary }]}>{item.step}</Text>
                </View>
                <View style={[styles.howIconWrap, { backgroundColor: c.accent }]}>
                  <Feather name={item.icon} size={20} color={c.primary} />
                </View>
                <Text style={[styles.howTitle, { color: c.text }]}>{item.title}</Text>
                <Text style={[styles.howDesc, { color: c.mutedForeground }]}>{item.desc}</Text>
              </View>
            )}
          />
        </Animated.View>

        {/* Nearby Services */}
        <Animated.View entering={FadeInDown.delay(240).duration(380)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Nearby Services</Text>
            <TouchableOpacity onPress={() => router.push('/search')}>
              <Text style={[styles.seeAll, { color: c.primary }]}>See all</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={[...SERVICES].reverse()}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(s) => s.id + '-n'}
            contentContainerStyle={{ paddingHorizontal: 16 }}
            renderItem={({ item }) => <ServiceCard service={item} />}
          />
        </Animated.View>

        {/* What People Say */}
        <Animated.View entering={FadeInDown.delay(280).duration(380)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>What People Say</Text>
          </View>
          <FlatList
            data={TESTIMONIALS}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(t) => t.id}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.testimonialCard,
                  { backgroundColor: c.card, borderColor: c.border },
                ]}
              >
                <View style={styles.testimonialTop}>
                  <View style={[styles.avatar, { backgroundColor: item.avatarColor }]}>
                    <Text style={styles.avatarText}>{item.initials}</Text>
                  </View>
                  <View style={styles.testimonialMeta}>
                    <Text style={[styles.testimonialName, { color: c.text }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[styles.testimonialService, { color: c.mutedForeground }]} numberOfLines={1}>
                      {item.service}
                    </Text>
                  </View>
                  <View style={{ flexShrink: 0 }}>
                    <Stars count={item.rating} />
                  </View>
                </View>
                <Text style={[styles.testimonialComment, { color: c.mutedForeground }]}>
                  &ldquo;{item.comment}&rdquo;
                </Text>
              </View>
            )}
          />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const CARD_W = Math.min(SCREEN_W * 0.76, 290);

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 },
  locationBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#FFF' },
  notifBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    width: 38,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#E74C3C',
    borderWidth: 1.5,
  },
  searchWrap: { flexDirection: 'row', gap: 8 },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchPlaceholder: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#9E9E9E' },
  filterBtn: {
    backgroundColor: '#FFF',
    width: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Sections ──────────────────────────────────────────────────────────────
  section: { marginTop: 16 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  seeAll: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5, marginTop: 10 },
  dot: { height: 5, borderRadius: 3 },

  // ── Badge card ────────────────────────────────────────────────────────────
  badgeCard: {
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  badgeCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  badgeCardLeft: { flex: 1, gap: 4, marginRight: 12 },
  badgeCardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeCardTitle: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  badgeCardSub: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  badgeTiers: { flexDirection: 'row', gap: 12 },
  badgeTierItem: { alignItems: 'center', gap: 3 },
  badgeTierLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  badgeTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  badgeFill: { height: '100%', borderRadius: 3 },
  badgeProgressLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 6 },

  // ── How it works ──────────────────────────────────────────────────────────
  howCard: {
    width: 130,
    borderRadius: 16,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  howStep: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  howStepNum: { fontFamily: 'Inter_700Bold', fontSize: 10 },
  howIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  howTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  howDesc: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 15 },

  // ── Testimonials ──────────────────────────────────────────────────────────
  testimonialCard: {
    width: CARD_W,
    borderRadius: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  testimonialTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: '#FFF' },
  testimonialMeta: { flex: 1, minWidth: 0, flexShrink: 1 },
  testimonialName: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  testimonialService: { fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 1 },
  testimonialComment: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
});
