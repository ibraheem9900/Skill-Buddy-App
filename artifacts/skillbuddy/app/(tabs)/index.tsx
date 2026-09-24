import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/context/ThemeContext';
import { Image } from 'expo-image';
import { BLOG_POSTS } from '@/data/blogData';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import useClientDashboard from '@/hooks/useClientDashboard';
import useClientBookings from '@/hooks/useClientBookings';
import { formatAmountSpent } from '@/hooks/useClientProfile';
import {
  getBookingStatus,
  getBookingTitle,
  getBookingDate,
  getBookingPrice,
  getBookingProvider,
  getBookingKey,
} from '@/lib/bookingFields';
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
// Titles/descriptions are translation keys (full 5-language coverage).
const SPECIALTIES = [
  { icon: 'shield-check-outline',  titleKey: 'home_specialty_1', descKey: 'home_specialty_1_desc' },
  { icon: 'account-check-outline', titleKey: 'home_specialty_2', descKey: 'home_specialty_2_desc' },
  { icon: 'tag-outline',           titleKey: 'home_specialty_3', descKey: 'home_specialty_3_desc' },
  { icon: 'headset',               titleKey: 'home_specialty_4', descKey: 'home_specialty_4_desc' },
] as const;

// ─── Quick-access tiles ───────────────────────────────────────────────────────
const QUICK_TILES = [
  { icon: 'view-grid-outline',    labelKey: 'home_browse_services', route: '/categories' as const },
  { icon: 'calendar-check-outline', labelKey: 'home_my_bookings',  route: '/(tabs)/profile' as const },
  { icon: 'message-text-outline', labelKey: 'home_chat',           route: '/(tabs)/inbox' as const },
  { icon: 'account-outline',      labelKey: 'home_profile',        route: '/(tabs)/profile' as const },
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
  const { theme, colors: c } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { activeRole } = useRole();
  // Client dashboard summary (GET /api/v1/clients/dashboard) — CLIENT role
  // only; fresh fetch on every entry + pull-to-refresh (never cached).
  const clientDash = useClientDashboard();
  // Client bookings list (GET /api/v1/clients/bookings) — same role gating;
  // fresh fetch per entry + pull-to-refresh, no stale cache.
  const clientBookings = useClientBookings();
  const dashLoaded = useRef(false);
  const isDark = theme === 'dark';
  const [refreshing, setRefreshing] = useState(false);
  const [offerIdx, setOfferIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  // Simulate a 500ms initial loading state for dashboard sections
  React.useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(t);
  }, []);

  // Fetch the summary when a signed-in CLIENT enters the dashboard
  React.useEffect(() => {
    if (user && activeRole === 'CLIENT') {
      dashLoaded.current = true;
      void clientDash.load();
      void clientBookings.load();
    } else {
      dashLoaded.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeRole]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setLoading(true);
    const tasks: Promise<unknown>[] = [];
    // Real refresh for the client stats + bookings (spec: pull-to-refresh)
    if (dashLoaded.current) {
      tasks.push(clientDash.refresh());
      tasks.push(clientBookings.refresh());
    }
    // Plus the original simulated settle for the rest of the sections
    tasks.push(
      new Promise((resolve) =>
        setTimeout(() => {
          setRefreshing(false);
          setLoading(false);
          resolve(null);
        }, 1500),
      ),
    );
    void Promise.all(tasks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const TAB_H = Platform.OS === 'web' ? 84 : 60;

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: c.headerBg, paddingTop: insets.top + 10 }]}>
        {/* Dark theme: subtle green radial glow at the very top, fading to
            the near-black header — mirrors the web app's hero. Light theme
            keeps the plain approved green header. */}
        {isDark && (
          <View style={styles.headerGlow} pointerEvents="none">
            <LinearGradient
              colors={['rgba(77,191,173,0.22)', 'rgba(77,191,173,0.07)', 'transparent']}
              style={StyleSheet.absoluteFill}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
            />
            <View style={styles.headerGlowOrb} />
          </View>
        )}
        {/* Logo + notification row — small brand mark (height 30 → ~72px wide).
            Loaders use their own sizes (BrandedLoader 46-48, InlineLoader 18),
            kept separate from this static header mark. */}
        <View style={styles.logoRow}>
          <LogoImage variant="white" height={30} />
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
            <Text style={styles.searchPlaceholder}>{t('search_placeholder')}</Text>
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
        {/* Section heading — no "Welcome back, Name" greeting, per request */}
        <Animated.View entering={FadeInDown.delay(20).duration(380)} style={[styles.section, { paddingHorizontal: 16 }]}>
          <Text style={[styles.welcomeText, { color: c.text }]}>
            {t('home_heading')}
          </Text>
        </Animated.View>

        {/* Credit Points Card */}
        <Animated.View entering={FadeInDown.delay(40).duration(380)} style={{ paddingHorizontal: 16, marginTop: 4 }}>
          <View style={[styles.creditCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={[styles.creditIcon, { backgroundColor: c.primaryLight }]}>
              <MaterialCommunityIcons name="star-circle-outline" size={22} color={c.primary} />
            </View>
            <View style={styles.creditBody}>
              <Text style={[styles.creditLabel, { color: c.mutedForeground }]}>{t('home_credit_points')}</Text>
              <Text style={[styles.creditValue, { color: c.text }]}>
                {t('profile_pts', { n: CURRENT_USER.creditPoints.toLocaleString() })}
              </Text>
            </View>
            <Text style={[styles.creditNote, { color: c.mutedForeground }]}>
              {t('home_earn_note')}
            </Text>
          </View>
        </Animated.View>

        {/* Client Activity Summary — live GET /api/v1/clients/dashboard data
            (CLIENT role + signed-in only). Fresh fetch per entry + via
            pull-to-refresh; spinner while loading, inline retry on error —
            never cached stale. */}
        {user && activeRole === 'CLIENT' && (
          <Animated.View entering={FadeInDown.delay(50).duration(380)} style={{ paddingHorizontal: 16, marginTop: 12 }}>
            <View style={[styles.activityCard, { backgroundColor: c.card, borderColor: c.border }]}>
              {clientDash.status === 'error' ? (
                <TouchableOpacity style={styles.activityErrorRow} onPress={clientDash.refresh}>
                  <MaterialCommunityIcons name="wifi-off" size={16} color={c.destructive} />
                  <Text style={[styles.activityErrorText, { color: c.destructive }]}>
                    {t(clientDash.errorMessage ?? 'cd_err_network')}
                  </Text>
                  <Text style={[styles.activityRetryText, { color: c.primary }]}>{t('cd_retry')}</Text>
                </TouchableOpacity>
              ) : (
                <>
                  {[
                    {
                      icon: 'calendar-check-outline' as const,
                      label: t('cd_bookings'),
                      value: clientDash.status === 'loading' ? null : clientDash.summary?.total_bookings,
                    },
                    {
                      icon: 'check-circle-outline' as const,
                      label: t('cd_completed'),
                      value: clientDash.status === 'loading' ? null : clientDash.summary?.total_completed_jobs,
                    },
                    {
                      icon: 'progress-clock' as const,
                      label: t('cd_active'),
                      value: clientDash.status === 'loading' ? null : clientDash.summary?.total_active_jobs,
                    },
                    {
                      icon: 'cash' as const,
                      label: t('cd_spent'),
                      value:
                        clientDash.status === 'loading'
                          ? null
                          : formatAmountSpent(clientDash.summary?.total_amount_spent),
                    },
                  ].map((cell, i) => (
                    <View
                      key={cell.label}
                      style={[styles.activityCell, i < 3 && { borderRightWidth: 1, borderRightColor: c.border }]}
                    >
                      <MaterialCommunityIcons name={cell.icon} size={15} color={c.primary} />
                      {cell.value === null ? (
                        <ActivityIndicator size="small" color={c.primary} style={styles.activitySpinner} />
                      ) : (
                        <Text style={[styles.activityValue, { color: c.text }]} numberOfLines={1}>
                          {cell.value}
                        </Text>
                      )}
                      <Text style={[styles.activityLabel, { color: c.mutedForeground }]} numberOfLines={1}>
                        {cell.label}
                      </Text>
                    </View>
                  ))}
                </>
              )}
            </View>
          </Animated.View>
        )}

        {/* My Bookings — live GET /api/v1/clients/bookings list (CLIENT role
            + signed-in only). Booking items are OPAQUE per the API schema, so
            fields are extracted defensively via lib/bookingFields.ts (the web
            app's candidate-key strategy — no guessed field names). Shows the
            3 most recent; loading skeletons, empty state, inline retry. */}
        {user && activeRole === 'CLIENT' && (
          <Animated.View entering={FadeInDown.delay(55).duration(380)} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: c.text }]}>{t('home_my_bookings')}</Text>
              {clientBookings.status === 'ready' && (
                <Text style={[styles.bookingsCount, { color: c.mutedForeground }]}>
                  {t('cb_count', { n: clientBookings.total })}
                </Text>
              )}
            </View>
            <View style={[styles.bookingsCard, { backgroundColor: c.card, borderColor: c.border }]}>
              {clientBookings.status === 'loading' ? (
                [0, 1].map((i) => (
                  <View key={i} style={[styles.bookingRow, i === 0 && { borderTopWidth: 0 }, { borderBottomColor: c.border }]}>
                    <View style={[styles.bookingIconWrap, { backgroundColor: c.primaryLight }]}>
                      <MaterialCommunityIcons name="calendar-blank" size={18} color={c.primary} />
                    </View>
                    <ActivityIndicator size="small" color={c.primary} />
                  </View>
                ))
              ) : clientBookings.status === 'error' ? (
                <TouchableOpacity style={styles.bookingErrorRow} onPress={clientBookings.refresh}>
                  <MaterialCommunityIcons name="wifi-off" size={16} color={c.destructive} />
                  <Text style={[styles.bookingErrorText, { color: c.destructive }]}>
                    {t(clientBookings.errorMessage ?? 'cb_err_network')}
                  </Text>
                  <Text style={[styles.bookingRetryText, { color: c.primary }]}>{t('cb_retry')}</Text>
                </TouchableOpacity>
              ) : clientBookings.bookings.length === 0 ? (
                <View style={styles.bookingEmptyWrap}>
                  <MaterialCommunityIcons name="calendar-plus" size={22} color={c.mutedForeground} />
                  <Text style={[styles.bookingEmptyText, { color: c.mutedForeground }]}>{t('cb_empty')}</Text>
                  <TouchableOpacity onPress={() => router.push('/(tabs)/services' as any)}>
                    <Text style={[styles.bookingBrowseText, { color: c.primary }]}>{t('home_browse_services')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                clientBookings.bookings.slice(0, 3).map((booking, i, arr) => {
                  const title = getBookingTitle(booking) || t('cb_fallback_title');
                  const status = getBookingStatus(booking);
                  const rawDate = getBookingDate(booking);
                  const parsed = rawDate ? new Date(rawDate) : null;
                  const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleDateString() : rawDate;
                  const price = getBookingPrice(booking);
                  const provider = getBookingProvider(booking);
                  return (
                    <View
                      key={getBookingKey(booking, i)}
                      style={[styles.bookingRow, i === 0 && { borderTopWidth: 0 }, { borderBottomColor: c.border }]}
                    >
                      <View style={[styles.bookingIconWrap, { backgroundColor: c.primaryLight }]}>
                        <MaterialCommunityIcons name="calendar-check-outline" size={18} color={c.primary} />
                      </View>
                      <View style={styles.bookingBody}>
                        <Text style={[styles.bookingTitle, { color: c.text }]} numberOfLines={1}>{title}</Text>
                        {(provider || date) && (
                          <Text style={[styles.bookingSub, { color: c.mutedForeground }]} numberOfLines={1}>
                            {[provider, date].filter(Boolean).join(' · ')}
                          </Text>
                        )}
                      </View>
                      <View style={styles.bookingRight}>
                        {!!price && <Text style={[styles.bookingPrice, { color: c.text }]}>€{price}</Text>}
                        {!!status && (
                          <View style={[styles.bookingStatusBadge, { backgroundColor: c.primaryLight }]}>
                            <Text style={[styles.bookingStatusText, { color: c.primary }]} numberOfLines={1}>
                              {status}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </Animated.View>
        )}

        {/* Quick-access tiles */}
        <Animated.View entering={FadeInDown.delay(60).duration(380)} style={styles.section}>
          <View style={styles.quickGrid}>
            {QUICK_TILES.map((tile) => (
              <TouchableOpacity
                key={tile.labelKey}
                style={[styles.quickTile, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => router.push(tile.route as any)}
                activeOpacity={0.75}
              >
                <View style={[styles.quickIconWrap, { backgroundColor: c.primaryLight }]}>
                  <MaterialCommunityIcons name={tile.icon as any} size={22} color={c.primary} />
                </View>
                <Text style={[styles.quickLabel, { color: c.text }]} numberOfLines={1}>
                  {t(tile.labelKey)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>

        {/* Special Offers */}
        <Animated.View entering={FadeInDown.delay(80).duration(380)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>{t('home_special_for_you')}</Text>
            <TouchableOpacity>
              <Text style={[styles.seeAll, { color: c.primary }]}>{t('see_all')}</Text>
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
            <Text style={[styles.sectionTitle, { color: c.text }]}>{t('home_categories')}</Text>
            <TouchableOpacity onPress={() => router.push('/categories')}>
              <Text style={[styles.seeAll, { color: c.primary }]}>{t('see_all')}</Text>
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
              {IS_PERSONALIZED ? t('home_recommended') : t('home_popular_services')}
            </Text>
            <TouchableOpacity onPress={() => router.push('/search')}>
              <Text style={[styles.seeAll, { color: c.primary }]}>{t('see_all')}</Text>
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
            <Text style={[styles.sectionTitle, { color: c.text }]}>{t('home_why_skillbuddy')}</Text>
          </View>
          <FlatList
            data={SPECIALTIES}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(s) => s.titleKey}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
            renderItem={({ item }) => (
              <View style={[styles.specialtyCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <View style={[styles.specialtyIconWrap, { backgroundColor: c.primaryLight }]}>
                  <MaterialCommunityIcons name={item.icon as any} size={22} color={c.primary} />
                </View>
                <Text style={[styles.specialtyTitle, { color: c.text }]}>{t(item.titleKey)}</Text>
                <Text style={[styles.specialtyDesc, { color: c.mutedForeground }]}>{t(item.descKey)}</Text>
              </View>
            )}
          />
        </Animated.View>

        {/* Earn Badges */}
        <Animated.View entering={FadeInDown.delay(160).duration(380)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>{t('home_earn_badges')}</Text>
            <TouchableOpacity>
              <Text style={[styles.seeAll, { color: c.primary }]}>{t('home_learn_more')}</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.badgeCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.badgeCardRow}>
              <View style={styles.badgeCardLeft}>
                <View style={styles.badgeCardTitleRow}>
                  <Feather name="award" size={15} color={c.primary} />
                  <Text style={[styles.badgeCardTitle, { color: c.text }]}>{t('home_unlock_rewards')}</Text>
                </View>
                <Text style={[styles.badgeCardSub, { color: c.mutedForeground }]}>
                  {t('home_badge_sub')}
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
              {t('home_badge_progress')}
            </Text>
          </View>
        </Animated.View>

        {/* From the Blog — compact teaser, links to full Blog listing */}
        <Animated.View entering={FadeInDown.delay(170).duration(380)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>{t('home_from_blog')}</Text>
            <TouchableOpacity onPress={() => router.push('/blog' as any)}>
              <Text style={[styles.seeAll, { color: c.primary }]}>{t('see_all')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
            {BLOG_POSTS.slice(0, 3).map((post) => (
              <TouchableOpacity
                key={post.id}
                style={[styles.blogTeaserCard, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => router.push(`/blog/${post.id}` as any)}
              >
                <Image source={{ uri: post.image }} style={styles.blogTeaserImage} contentFit="cover" />
                <Text style={[styles.blogTeaserTitle, { color: c.text }]} numberOfLines={2}>{post.title}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Animated.View>

        {/* Invite Friends */}
        <Animated.View entering={FadeInDown.delay(180).duration(380)} style={{ paddingHorizontal: 16, marginTop: 16 }}>
          <View style={[styles.inviteCard, { backgroundColor: c.primaryLight, borderColor: c.primary }]}>
            <View style={styles.inviteLeft}>
              <MaterialCommunityIcons name="account-multiple-plus-outline" size={28} color={c.primary} />
              <View style={styles.inviteText}>
                <Text style={[styles.inviteTitle, { color: c.text }]}>{t('home_invite_title')}</Text>
                <Text style={[styles.inviteSub, { color: c.mutedForeground }]}>
                  {t('home_invite_sub')}
                </Text>
              </View>
            </View>
            <TouchableOpacity style={[styles.inviteBtn, { backgroundColor: c.primary }]}>
              <Text style={styles.inviteBtnText}>{t('home_invite_btn')}</Text>
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
    overflow: 'hidden',
  },
  headerGlow: {
    ...StyleSheet.absoluteFillObject,
  },
  headerGlowOrb: {
    position: 'absolute',
    top: -70,
    alignSelf: 'center',
    width: 260,
    height: 160,
    borderRadius: 130,
    backgroundColor: 'rgba(46, 158, 122, 0.12)',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 },
  locationBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: '#FFF' },
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
  notifBadgeText: { fontFamily: 'Manrope_700Bold', fontSize: 10, color: '#FFF' },
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
  searchPlaceholder: { fontFamily: 'Manrope_400Regular', fontSize: 13, color: '#9E9E9E' },
  filterBtn: {
    backgroundColor: '#FFF',
    width: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Welcome ───────────────────────────────────────────────────────────────
  welcomeText: { fontFamily: 'Manrope_700Bold', fontSize: 20 },

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
  creditLabel: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  creditValue: { fontFamily: 'Manrope_700Bold', fontSize: 20, marginTop: 1 },
  creditNote: { fontFamily: 'Manrope_400Regular', fontSize: 11, textAlign: 'right', lineHeight: 16 },

  // ── Client activity summary strip ────────────────────────────────
  activityCard: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  activityCell: { flex: 1, alignItems: 'center', gap: 3, paddingHorizontal: 2 },
  activityValue: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  activityLabel: { fontFamily: 'Manrope_400Regular', fontSize: 10, textAlign: 'center' },
  activitySpinner: { height: 18 },
  activityErrorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 6 },
  activityErrorText: { fontFamily: 'Manrope_400Regular', fontSize: 11, flex: 1 },
  activityRetryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },

  // ── My Bookings section ──────────────────────────────────────────
  bookingsCount: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  bookingsCard: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  bookingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  bookingIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bookingBody: { flex: 1, minWidth: 0 },
  bookingTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  bookingSub: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 1 },
  bookingRight: { alignItems: 'flex-end', gap: 3, maxWidth: 110 },
  bookingPrice: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  bookingStatusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  bookingStatusText: { fontFamily: 'Manrope_600SemiBold', fontSize: 10, textTransform: 'capitalize' },
  bookingErrorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, paddingHorizontal: 14 },
  bookingErrorText: { fontFamily: 'Manrope_400Regular', fontSize: 12, flex: 1 },
  bookingRetryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  bookingEmptyWrap: { alignItems: 'center', gap: 6, paddingVertical: 20, paddingHorizontal: 14 },
  bookingEmptyText: { fontFamily: 'Manrope_400Regular', fontSize: 12, textAlign: 'center' },
  bookingBrowseText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },

  // ── Quick tiles ──────────────────────────────────────────────────
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
  quickLabel: { fontFamily: 'Manrope_500Medium', fontSize: 11, textAlign: 'center' },

  // ── Sections ──────────────────────────────────────────────────────────────
  section: { marginTop: 20 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  seeAll: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
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
  specialtyTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  specialtyDesc: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16 },

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
  badgeCardTitle: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
  badgeCardSub: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  badgeTiers: { flexDirection: 'row', gap: 12 },
  badgeTierItem: { alignItems: 'center', gap: 3 },
  badgeTierLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 10 },
  badgeTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  badgeFill: { height: '100%', borderRadius: 3 },
  badgeProgressLabel: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 6 },

  // ── Blog teaser ──────────────────────────────────────────────────────────
  blogTeaserCard: { width: 160, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  blogTeaserImage: { width: '100%', height: 90 },
  blogTeaserTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, lineHeight: 16, padding: 10 },

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
  inviteTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  inviteSub: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2, lineHeight: 16 },
  inviteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  inviteBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: '#FFF' },
});
