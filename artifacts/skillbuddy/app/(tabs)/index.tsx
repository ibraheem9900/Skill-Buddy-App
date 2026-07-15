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
import { Feather, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import {
  CATEGORIES,
  CURRENT_USER,
  MOCK_BOOKINGS,
  NOTIFICATIONS,
  OFFERS,
  SERVICES,
} from '@/data/mockData';
import { getPersonalizedServices } from '@/lib/personalization';
import ServiceCard from '@/components/ServiceCard';
import CategoryItem from '@/components/CategoryItem';
import SpecialOfferCard from '@/components/SpecialOfferCard';
import LogoImage from '@/components/LogoImage';
import SkeletonCard from '@/components/SkeletonCard';

const { width: SCREEN_W } = Dimensions.get('window');
const OFFER_W = SCREEN_W - 32;
const SNAP_INTERVAL = OFFER_W + 12;

// ─── Unread notification count ────────────────────────────────────────────────
const UNREAD_COUNT = NOTIFICATIONS.filter((n) => !n.isRead).length;

// ─── Personalized services ────────────────────────────────────────────────────
const { services: PERSONALIZED, isPersonalized: IS_PERSONALIZED } =
  getPersonalizedServices(CURRENT_USER, SERVICES);

// ─── Badge tiers ──────────────────────────────────────────────────────────────
const BADGE_TIERS = [
  { tier: 'Bronze', color: '#CD7F32', icon: 'award' as const },
  { tier: 'Silver', color: '#A0A0A0', icon: 'award' as const },
  { tier: 'Gold',   color: '#FFB800', icon: 'award' as const },
];

// ─── SkillBuddy Specialties ───────────────────────────────────────────────────
const SPECIALTIES = [
  { icon: 'shield-check-outline', title: 'Built on Trust',        desc: 'Reviewed providers with verified IDs and credentials.' },
  { icon: 'account-check-outline',title: 'Verified Experts',      desc: 'Every professional passes our rigorous vetting process.' },
  { icon: 'tag-outline',          title: 'Transparent Pricing',   desc: 'See the full price before you book — no surprise charges.' },
  { icon: 'headset',              title: '24/7 Support',          desc: 'Our team is available around the clock whenever you need help.' },
] as const;

// ─── Quick-access tiles ───────────────────────────────────────────────────────
const QUICK_TILES = [
  { icon: 'view-grid-outline',    label: 'Browse Services', route: '/categories' as const },
  { icon: 'calendar-check-outline', label: 'My Bookings',  route: '/(tabs)/profile' as const },
  { icon: 'message-text-outline', label: 'Chat',           route: '/(tabs)/inbox' as const },
  { icon: 'account-outline',      label: 'Profile',        route: '/(tabs)/profile' as const },
] as const;

// ─── Stars ────────────────────────────────────────────────────────────────────
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
  const [loading, setLoading] = useState(true);

  // Simulate a 500ms initial loading state for dashboard sections
  React.useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(t);
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setLoading(true);
    setTimeout(() => {
      setRefreshing(false);
      setLoading(false);
    }, 1500);
  }, []);

  const TAB_H = Platform.OS === 'web' ? 84 : 60;

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: c.headerBg, paddingTop: insets.top + 10 }]}>
        {/* Logo + notification row */}
        <View style={styles.logoRow}>
          <LogoImage variant="white" height={42} />
          <TouchableOpacity
            style={[styles.notifBtn, { borderColor: 'rgba(255,255,255,0.3)' }]}
            onPress={() => router.push('/notifications')}
          >
            <Feather name="bell" size={18} color="#FFF" />
            {UNREAD_COUNT > 0 && (
              <View style={[styles.notifBadge, { borderColor: c.headerBg }]}>
                <Text style={styles.notifBadgeText}>
                  {UNREAD_COUNT > 9 ? '9+' : String(UNREAD_COUNT)}
                </Text>
              </View>
            )}
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
        contentContainerStyle={{ paddingBottom: insets.bottom + TAB_H + 20 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      >
        {/* Welcome Banner */}
        <Animated.View entering={FadeInDown.delay(20).duration(380)} style={styles.section}>
          <Text style={[styles.welcomeText, { color: c.text }]}>
            Welcome back, <Text style={[styles.welcomeName, { color: c.primary }]}>{CURRENT_USER.name}</Text>
          </Text>
          <Text style={[styles.welcomeSub, { color: c.mutedForeground }]}>
            What service do you need today?
          </Text>
        </Animated.View>

        {/* Credit Points Card */}
        <Animated.View entering={FadeInDown.delay(40).duration(380)} style={{ paddingHorizontal: 16, marginTop: 4 }}>
          <View style={[styles.creditCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={[styles.creditIcon, { backgroundColor: c.primaryLight }]}>
              <MaterialCommunityIcons name="star-circle-outline" size={22} color={c.primary} />
            </View>
            <View style={styles.creditBody}>
              <Text style={[styles.creditLabel, { color: c.mutedForeground }]}>Credit Points</Text>
              <Text style={[styles.creditValue, { color: c.text }]}>
                {CURRENT_USER.creditPoints.toLocaleString()} pts
              </Text>
            </View>
            <Text style={[styles.creditNote, { color: c.mutedForeground }]}>
              Earn 1 pt{'\n'}per €1 spent
            </Text>
          </View>
        </Animated.View>

        {/* Quick-access tiles */}
        <Animated.View entering={FadeInDown.delay(60).duration(380)} style={styles.section}>
          <View style={styles.quickGrid}>
            {QUICK_TILES.map((tile) => (
              <TouchableOpacity
                key={tile.label}
                style={[styles.quickTile, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => router.push(tile.route as any)}
                activeOpacity={0.75}
              >
                <View style={[styles.quickIconWrap, { backgroundColor: c.primaryLight }]}>
                  <MaterialCommunityIcons name={tile.icon as any} size={22} color={c.primary} />
                </View>
                <Text style={[styles.quickLabel, { color: c.text }]} numberOfLines={1}>
                  {tile.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>

        {/* Special Offers */}
        <Animated.View entering={FadeInDown.delay(80).duration(380)} style={styles.section}>
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
        <Animated.View entering={FadeInDown.delay(100).duration(380)} style={styles.section}>
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

        {/* Personalized / Popular Services */}
        <Animated.View entering={FadeInDown.delay(120).duration(380)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>
              {IS_PERSONALIZED ? 'More Like Your Bookings' : 'Popular Services'}
            </Text>
            <TouchableOpacity onPress={() => router.push('/search')}>
              <Text style={[styles.seeAll, { color: c.primary }]}>See all</Text>
            </TouchableOpacity>
          </View>
          {loading ? (
            <FlatList
              data={[1, 2, 3]}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(i) => String(i)}
              contentContainerStyle={{ paddingHorizontal: 16 }}
              renderItem={() => <SkeletonCard />}
            />
          ) : (
            <FlatList
              data={PERSONALIZED}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(s) => s.id}
              contentContainerStyle={{ paddingHorizontal: 16 }}
              renderItem={({ item }) => <ServiceCard service={item} />}
            />
          )}
        </Animated.View>

        {/* SkillBuddy Specialties */}
        <Animated.View entering={FadeInDown.delay(140).duration(380)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Why SkillBuddy?</Text>
          </View>
          <FlatList
            data={SPECIALTIES}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(s) => s.title}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
            renderItem={({ item }) => (
              <View style={[styles.specialtyCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <View style={[styles.specialtyIconWrap, { backgroundColor: c.primaryLight }]}>
                  <MaterialCommunityIcons name={item.icon as any} size={22} color={c.primary} />
                </View>
                <Text style={[styles.specialtyTitle, { color: c.text }]}>{item.title}</Text>
                <Text style={[styles.specialtyDesc, { color: c.mutedForeground }]}>{item.desc}</Text>
              </View>
            )}
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

        {/* Invite Friends */}
        <Animated.View entering={FadeInDown.delay(180).duration(380)} style={{ paddingHorizontal: 16, marginTop: 16 }}>
          <View style={[styles.inviteCard, { backgroundColor: c.primaryLight, borderColor: c.primary }]}>
            <View style={styles.inviteLeft}>
              <MaterialCommunityIcons name="account-multiple-plus-outline" size={28} color={c.primary} />
              <View style={styles.inviteText}>
                <Text style={[styles.inviteTitle, { color: c.text }]}>Invite Friends, Earn Points</Text>
                <Text style={[styles.inviteSub, { color: c.mutedForeground }]}>
                  Get 50 pts for every friend who books their first service.
                </Text>
              </View>
            </View>
            <TouchableOpacity style={[styles.inviteBtn, { backgroundColor: c.primary }]}>
              <Text style={styles.inviteBtnText}>Invite</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

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
  notifBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E74C3C',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  notifBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: '#FFF' },
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

  // ── Welcome ───────────────────────────────────────────────────────────────
  welcomeText: { fontFamily: 'Inter_400Regular', fontSize: 16 },
  welcomeName: { fontFamily: 'Inter_700Bold' },
  welcomeSub: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 2 },

  // ── Credit Points ─────────────────────────────────────────────────────────
  creditCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  creditIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creditBody: { flex: 1 },
  creditLabel: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  creditValue: { fontFamily: 'Inter_700Bold', fontSize: 20, marginTop: 1 },
  creditNote: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'right', lineHeight: 16 },

  // ── Quick tiles ───────────────────────────────────────────────────────────
  quickGrid: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
  },
  quickTile: {
    flex: 1,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  quickIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, textAlign: 'center' },

  // ── Sections ──────────────────────────────────────────────────────────────
  section: { marginTop: 20 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  seeAll: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5, marginTop: 10 },
  dot: { height: 5, borderRadius: 3 },

  // ── Specialty cards ───────────────────────────────────────────────────────
  specialtyCard: {
    width: 150,
    borderRadius: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  specialtyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  specialtyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  specialtyDesc: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },

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

  // ── Invite card ───────────────────────────────────────────────────────────
  inviteCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  inviteLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  inviteText: { flex: 1 },
  inviteTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  inviteSub: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2, lineHeight: 16 },
  inviteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  inviteBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#FFF' },
});
