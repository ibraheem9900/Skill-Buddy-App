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
import { useAuth } from '@/context/AuthContext';
import { CATEGORIES, OFFERS, SERVICES } from '@/data/mockData';
import ServiceCard from '@/components/ServiceCard';
import CategoryItem from '@/components/CategoryItem';
import SpecialOfferCard from '@/components/SpecialOfferCard';
import LogoMark from '@/components/LogoMark';

const { width } = Dimensions.get('window');

// ─── Mock data for new sections ───────────────────────────────────────────────

const HOW_IT_WORKS = [
  { step: 1, emoji: '🔍', title: 'Browse Services', desc: 'Search or explore categories near you' },
  { step: 2, emoji: '📋', title: 'Post a Job', desc: 'Describe what you need, set your budget' },
  { step: 3, emoji: '💬', title: 'Get Bids', desc: 'Pilots send you competitive offers' },
  { step: 4, emoji: '⭐', title: 'Choose Pilot', desc: 'Pick the best match by rating & price' },
  { step: 5, emoji: '✅', title: 'Job Done!', desc: 'Pay securely, leave a review' },
];

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

const BADGE_TIERS = [
  { tier: 'Bronze', color: '#CD7F32', min: 0, max: 10, icon: '🥉' },
  { tier: 'Silver', color: '#A0A0A0', min: 10, max: 50, icon: '🥈' },
  { tier: 'Gold', color: '#FFB800', min: 50, max: 100, icon: '🥇' },
];

// ─── Star Rating helper ────────────────────────────────────────────────────────
function Stars({ count }: { count: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <MaterialIcons key={i} name="star" size={13} color={i <= count ? '#FFB800' : '#E0E0E0'} />
      ))}
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { colors: c, theme } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [location] = useState('Riga, Latvia');
  const [offerIdx, setOfferIdx] = useState(0);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1500);
  }, []);

  const TAB_HEIGHT = Platform.OS === 'web' ? 84 : 60;
  const headerBg = c.headerBg;

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* ── Green Header ─────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: headerBg, paddingTop: insets.top + 8 }]}>
        {/* Logo mark + Notification */}
        <View style={styles.logoRow}>
          {/* Icon-only mark — white on the green header */}
          <LogoMark color="#FFFFFF" size={38} />
          <TouchableOpacity
            style={[styles.notifBtn, { borderColor: 'rgba(255,255,255,0.3)' }]}
            onPress={() => router.push('/notifications')}
          >
            <Feather name="bell" size={20} color="#FFF" />
            <View style={[styles.notifDot, { borderColor: headerBg }]} />
          </TouchableOpacity>
        </View>

        {/* Location */}
        <View style={styles.locationRow}>
          <MaterialIcons name="location-on" size={18} color="#FFB800" />
          <TouchableOpacity style={styles.locationBtn} onPress={() => router.push('/location')}>
            <Text style={styles.locationText}>{location}</Text>
            <Feather name="chevron-down" size={16} color="#FFF" />
          </TouchableOpacity>
        </View>

        {/* Search bar */}
        <Pressable style={styles.searchWrap} onPress={() => router.push('/search')}>
          <View style={styles.searchBar}>
            <Feather name="search" size={18} color="#9E9E9E" />
            <Text style={styles.searchPlaceholder}>Search for a service…</Text>
          </View>
          <TouchableOpacity style={styles.filterBtn} onPress={() => router.push('/filter')}>
            <Feather name="sliders" size={18} color={c.primary} />
          </TouchableOpacity>
        </Pressable>
      </View>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: TAB_HEIGHT + insets.bottom + 20 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      >
        {/* Special For You */}
        <Animated.View entering={FadeInDown.delay(50).duration(400)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>#SpecialForYou</Text>
            <TouchableOpacity>
              <Text style={[styles.seeAll, { color: c.primary }]}>See All</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={OFFERS}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(o) => o.id}
            contentContainerStyle={{ paddingHorizontal: 16 }}
            renderItem={({ item }) => <SpecialOfferCard offer={item} />}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / (width - 32));
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
                    ? { backgroundColor: c.primary, width: 16 }
                    : { backgroundColor: c.border },
                ]}
              />
            ))}
          </View>
        </Animated.View>

        {/* Categories */}
        <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.section}>
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
        <Animated.View entering={FadeInDown.delay(150).duration(400)} style={styles.section}>
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

        {/* ── Badges / Rewards Teaser ─────────────────────────────────── */}
        <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Earn Badges</Text>
            <TouchableOpacity>
              <Text style={[styles.seeAll, { color: c.primary }]}>Learn more</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.badgeCard, { backgroundColor: c.card, borderColor: c.border }]}
          >
            <View style={styles.badgeCardInner}>
              <View>
                <Text style={[styles.badgeCardTitle, { color: c.text }]}>
                  Unlock Real Rewards 🏆
                </Text>
                <Text style={[styles.badgeCardSub, { color: c.mutedForeground }]}>
                  Complete jobs to climb the tiers
                </Text>
              </View>
              <View style={styles.badgeTiers}>
                {BADGE_TIERS.map((b) => (
                  <View key={b.tier} style={styles.badgeTierItem}>
                    <Text style={styles.badgeTierEmoji}>{b.icon}</Text>
                    <Text style={[styles.badgeTierLabel, { color: b.color }]}>{b.tier}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={[styles.badgeProgressBar, { backgroundColor: c.border }]}>
              <View
                style={[styles.badgeProgressFill, { backgroundColor: c.primary, width: '30%' }]}
              />
            </View>
            <Text style={[styles.badgeProgressLabel, { color: c.mutedForeground }]}>
              3 / 10 jobs to Silver
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* ── How it Works ────────────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.delay(250).duration(400)} style={styles.section}>
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
                <Text style={styles.howEmoji}>{item.emoji}</Text>
                <Text style={[styles.howTitle, { color: c.text }]}>{item.title}</Text>
                <Text style={[styles.howDesc, { color: c.mutedForeground }]}>{item.desc}</Text>
              </View>
            )}
          />
        </Animated.View>

        {/* Nearby Services */}
        <Animated.View entering={FadeInDown.delay(300).duration(400)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Nearby Services</Text>
            <TouchableOpacity onPress={() => router.push('/search')}>
              <Text style={[styles.seeAll, { color: c.primary }]}>See all</Text>
            </TouchableOpacity>
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

        {/* ── Testimonials ────────────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.delay(350).duration(400)} style={[styles.section, { marginBottom: 8 }]}>
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
              <View style={[styles.testimonialCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <View style={styles.testimonialTop}>
                  <View style={[styles.testimonialAvatar, { backgroundColor: item.avatarColor }]}>
                    <Text style={styles.testimonialInitials}>{item.initials}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.testimonialName, { color: c.text }]}>{item.name}</Text>
                    <Text style={[styles.testimonialService, { color: c.mutedForeground }]}>
                      {item.service}
                    </Text>
                  </View>
                  <Stars count={item.rating} />
                </View>
                <Text style={[styles.testimonialComment, { color: c.mutedForeground }]}>
                  "{item.comment}"
                </Text>
              </View>
            )}
          />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 14 },
  locationBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#FFF' },
  notifBtn: {
    position: 'relative',
    backgroundColor: 'rgba(255,255,255,0.15)',
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E74C3C',
    borderWidth: 1.5,
  },
  searchWrap: { flexDirection: 'row', gap: 10 },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  searchPlaceholder: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#9E9E9E' },
  filterBtn: {
    backgroundColor: '#FFF',
    width: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { marginTop: 20 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  seeAll: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 },
  dot: { width: 6, height: 6, borderRadius: 3 },

  // Badge card
  badgeCard: {
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  badgeCardInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  badgeCardTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, marginBottom: 4 },
  badgeCardSub: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  badgeTiers: { flexDirection: 'row', gap: 10 },
  badgeTierItem: { alignItems: 'center', gap: 2 },
  badgeTierEmoji: { fontSize: 22 },
  badgeTierLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  badgeProgressBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  badgeProgressFill: { height: '100%', borderRadius: 3 },
  badgeProgressLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 6 },

  // How it works
  howCard: {
    width: 140,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    alignItems: 'flex-start',
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  howStep: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  howStepNum: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  howEmoji: { fontSize: 26 },
  howTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  howDesc: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },

  // Testimonials
  testimonialCard: {
    width: width * 0.72,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  testimonialTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  testimonialAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testimonialInitials: { fontFamily: 'Inter_700Bold', fontSize: 14, color: '#FFF' },
  testimonialName: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  testimonialService: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 1 },
  testimonialComment: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
});
