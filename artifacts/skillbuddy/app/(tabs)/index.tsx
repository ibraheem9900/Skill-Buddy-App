import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import useClientDashboard from '@/hooks/useClientDashboard';
import useClientBookings from '@/hooks/useClientBookings';
import { useCreditWallet } from '@/hooks/useWallet';
import { formatAmountSpent } from '@/hooks/useClientProfile';
import {
  failureCopyKind,
  resolveDataViewState,
  type FailureCopyKind,
} from '@/lib/dataState';
import {
  getBookingStatus,
  getBookingTitle,
  getBookingDate,
  getBookingPrice,
  getBookingProvider,
  getBookingKey,
} from '@/lib/bookingFields';
import ServerServiceRow from '@/components/ServerServiceRow';
import ServerCategoryTile from '@/components/ServerCategoryTile';
import HomeBanners from '@/components/HomeBanners';
import SpecialOffers from '@/components/SpecialOffers';
import useServices from '@/hooks/useServices';
import useCategories from '@/hooks/useCategories';
import useSelectedLocation from '@/hooks/useSelectedLocation';
import LogoImage from '@/components/LogoImage';
import SkeletonCard from '@/components/SkeletonCard';
import UpdateBanner from '@/components/UpdateBanner';
import { withTabPagerPage } from '@/components/tabBar/TabPagerPage';
import { loadHomeContent, type HomeContent } from '@/lib/homeContent';
import { formatCompactPoints } from '@/lib/carousel';
import { recentBookings } from '@/lib/recentBookings';
import { htmlToFlowText } from '@/lib/htmlText';

// No notifications backend exists yet (the API exposes no /notifications
// endpoint), so the header bell never shows an unread badge — the previous
// count came from a local fixture removed with the mock data.
const UNREAD_COUNT = 0;

/** How many bookings the Home list shows ("Recent Bookings"). */
const RECENT_BOOKINGS_LIMIT = 3;

// ─── SkillBuddy Specialties ───────────────────────────────────────────────────
// Titles/descriptions are translation keys (full 5-language coverage).
const SPECIALTIES = [
  { icon: 'shield-check-outline',  titleKey: 'home_specialty_1', descKey: 'home_specialty_1_desc' },
  { icon: 'account-check-outline', titleKey: 'home_specialty_2', descKey: 'home_specialty_2_desc' },
  { icon: 'tag-outline',           titleKey: 'home_specialty_3', descKey: 'home_specialty_3_desc' },
  { icon: 'headset',               titleKey: 'home_specialty_4', descKey: 'home_specialty_4_desc' },
] as const;

// ─── Screen ───────────────────────────────────────────────────────────────────
function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme, colors: c } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { activeRole } = useRole();

  // The location the user picked on /location (real geo APIs). Falls back to
  // the "Enter Your Location" prompt when nothing is selected yet — the old
  // hardcoded "Riga, Latvia" fixture is gone.
  const selectedLocation = useSelectedLocation();
  const locationLabel = selectedLocation
    ? [selectedLocation.cityName, selectedLocation.countryName].filter(Boolean).join(', ')
    : t('location_title');

  // Live catalogs (fetched once per session, module-cached): the categories
  // row and the services section both show REAL server data — the local
  // catalog fixtures were removed with the mock data.
  const {
    status: catStatus,
    categories: apiCategories,
    load: loadCategories,
    refresh: refreshCategories,
  } = useCategories();
  const {
    status: svcStatus,
    services: apiServices,
    load: loadServices,
    refresh: refreshServices,
  } = useServices();

  React.useEffect(() => {
    void loadCategories();
    void loadServices();
  }, [loadCategories, loadServices]);
  // Client dashboard summary (GET /api/v1/clients/dashboard) — CLIENT role
  // only; fresh fetch on every entry + pull-to-refresh (never cached).
  const clientDash = useClientDashboard();
  // Client bookings list (GET /api/v1/clients/bookings) — same role gating;
  // fresh fetch per entry + pull-to-refresh, no stale cache.
  const clientBookings = useClientBookings();
  // Credit points come from the REAL wallet (GET /api/v1/wallet/credits), not a
  // `?? 0` default on the user object — the previous zero looked hardcoded.
  const creditWallet = useCreditWallet();
  const dashLoaded = useRef(false);
  const isDark = theme === 'dark';
  const [refreshing, setRefreshing] = useState(false);

  // Home promotional content (the top banner carousel + Special Offers).
  // NOTHING here is hardcoded in the screen: lib/homeContent is the single
  // typed seam, and swapping it for GET /api/v1/home/content later means
  // changing only that function (see the backend spec in the report).
  const [homeContent, setHomeContent] = useState<HomeContent | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    loadHomeContent()
      .then((content) => {
        if (!cancelled) setHomeContent(content);
      })
      .catch(() => {
        // A promotional seam that fails must never break Home: no banners.
        if (!cancelled) setHomeContent({ banners: [], offers: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);


  // Skeletons only while a request is genuinely in flight — the old fixed
  // 500 ms "loading" timer made every visit look slow for no reason.
  const servicesLoading = svcStatus === 'loading' && apiServices == null;

  // ONE decision per section: a 200 with zeros/[] is empty (no Retry), and only
  // a failed request may offer Retry.
  const pointsState = resolveDataViewState({
    status: creditWallet.status,
    hasData: creditWallet.status === 'ready',
    failure: creditWallet.failure,
  });
  // Compact "0 pts" pill in the header (next to the bell). The number is the
  // SAME credit wallet the removed Credit Points card used — never a fixture.
  // Hidden while loading and while the request failed (no fake zero).
  const pointsPillLabel =
    pointsState === 'ready' || pointsState === 'empty' || pointsState === 'unavailable'
      ? (() => {
          const compact = formatCompactPoints(creditWallet.balance);
          return compact === null ? null : t('profile_pts', { n: compact });
        })()
      : null;
  const activityState = resolveDataViewState({
    status: clientDash.status,
    hasData: clientDash.summary != null,
    failure: clientDash.failure,
  });
  const activityCopy: Record<FailureCopyKind, string> = {
    network: t('cd_err_network'),
    timeout: t('cd_err_timeout'),
    server: t('cd_err_generic'),
    session: t('cd_err_session'),
    generic: t('cd_err_generic'),
  };
  const bookingsState = resolveDataViewState({
    status: clientBookings.status,
    hasData: clientBookings.bookings.length > 0,
    failure: clientBookings.failure,
  });
  const bookingsCopy: Record<FailureCopyKind, string> = {
    network: t('cb_err_network'),
    timeout: t('cb_err_timeout'),
    server: t('cb_err_generic'),
    session: t('cb_err_session'),
    generic: t('cb_err_generic'),
  };
  // "Recent Bookings": newest first, at most three (Fix 2a). The endpoint order
  // is not guaranteed, so ordering happens in one tested helper.
  const recentList = recentBookings(
    clientBookings.bookings,
    (booking) => getBookingDate(booking),
    RECENT_BOOKINGS_LIMIT
  );

  // Fetch the summary when a signed-in CLIENT enters the dashboard
  React.useEffect(() => {
    if (user && activeRole === 'CLIENT') {
      dashLoaded.current = true;
      void clientDash.load();
      void clientBookings.load();
      void creditWallet.load();
    } else {
      dashLoaded.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeRole]);

  // Pull-to-refresh waits for the REAL requests — no artificial settle timer.
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const tasks: Promise<unknown>[] = [refreshCategories(), refreshServices()];
    if (dashLoaded.current) {
      // CLIENT-only endpoints are only refreshed for a client session.
      tasks.push(clientDash.refresh());
      tasks.push(clientBookings.refresh());
      tasks.push(creditWallet.refresh());
    }
    void Promise.all(tasks).finally(() => setRefreshing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshCategories, refreshServices, creditWallet.refresh, clientDash.refresh, clientBookings.refresh]);

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
            <View
              style={[
                styles.headerGlowOrb,
                theme === 'dark'
                  ? null
                  : { backgroundColor: 'rgba(43, 121, 92, 0.12)' },
              ]}
            />
          </View>
        )}
        {/* Logo + notification row — small brand mark (height 30 → ~72px wide).
            Loaders use their own sizes (BrandedLoader 46-48, InlineLoader 18),
            kept separate from this static header mark. */}
        <View style={styles.logoRow}>
          <LogoImage variant="white" height={30} />
          <View style={styles.headerActions}>
            {/* Earned credit points, compact, left of the bell. It is the same
                GET /api/v1/wallet/credits balance the old card showed; it is
                hidden while loading and tappable only because the points
                screen already exists (/profile/credit-points). */}
            {user && activeRole === 'CLIENT' && pointsPillLabel ? (
              <TouchableOpacity
                style={styles.pointsPill}
                onPress={() => router.push('/profile/credit-points' as any)}
                accessibilityRole="button"
                accessibilityLabel={`${t('home_credit_points')}: ${pointsPillLabel}`}
              >
                <MaterialCommunityIcons name="star" size={12} color="#FFB800" />
                <Text style={styles.pointsPillText} numberOfLines={1}>{pointsPillLabel}</Text>
              </TouchableOpacity>
            ) : null}
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
        </View>

        {/* Location row */}
        <View style={styles.locationRow}>
          <MaterialIcons name="location-on" size={15} color="#FFB800" />
          <TouchableOpacity style={styles.locationBtn} onPress={() => router.push('/location')}>
            <Text style={styles.locationText} numberOfLines={1}>{locationLabel}</Text>
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
        {/* "Update available" banner — compares the installed APK's stamped
            build with the latest GitHub release; hidden while up to date or
            after the user dismisses that release. Android release builds only. */}
        <UpdateBanner />

        {/* Section heading — no "Welcome back, Name" greeting, per request */}
        <Animated.View entering={FadeInDown.delay(20).duration(380)} style={[styles.section, { paddingHorizontal: 16 }]}>
          <Text style={[styles.welcomeText, { color: c.text }]}>
            {t('home_heading')}
          </Text>
        </Animated.View>

        {/* Banner carousel (Fix 3a) — replaced the Credit Points card. Three
            slides, in the boss's order: Badges → transport → partner. The
            badges slide reads the LIVE client dashboard total; the other two
            are TODO(content) placeholders with no logos and no invented
            claims. Every slide comes from lib/homeContent, never the screen. */}
        {user && activeRole === 'CLIENT' && homeContent && homeContent.banners.length > 0 && (
          <Animated.View entering={FadeInDown.delay(40).duration(380)} style={{ paddingHorizontal: 16, marginTop: 4 }}>
            <HomeBanners
              banners={homeContent.banners}
              completedJobs={
                activityState === 'loading' ? null : clientDash.summary?.total_completed_jobs ?? null
              }
            />
          </Animated.View>
        )}

        {/* Client Activity Summary — live GET /api/v1/clients/dashboard data
            (CLIENT role + signed-in only). Fresh fetch per entry + via
            pull-to-refresh; spinner while loading, inline retry on error —
            never cached stale. */}
        {user && activeRole === 'CLIENT' && (
          <Animated.View entering={FadeInDown.delay(50).duration(380)} style={{ paddingHorizontal: 16, marginTop: 12 }}>
            <View style={[styles.activityCard, { backgroundColor: c.card, borderColor: c.border }]}>
              {activityState === 'error' ? (
                <TouchableOpacity style={styles.activityErrorRow} onPress={() => void clientDash.refresh()}>
                  <MaterialCommunityIcons
                    name={failureCopyKind(clientDash.failure) === 'network' ? 'wifi-off' : 'alert-circle-outline'}
                    size={16}
                    color={c.destructive}
                  />
                  <Text style={[styles.activityErrorText, { color: c.destructive }]}>
                    {activityCopy[failureCopyKind(clientDash.failure)]}
                  </Text>
                  <Text style={[styles.activityRetryText, { color: c.primary }]}>{t('cd_retry')}</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <View style={styles.activityRow}>
                  {[
                    {
                      icon: 'calendar-check-outline' as const,
                      label: t('cd_bookings'),
                      value: activityState === 'loading' ? null : clientDash.summary?.total_bookings ?? 0,
                    },
                    {
                      icon: 'check-circle-outline' as const,
                      label: t('cd_completed'),
                      value: activityState === 'loading' ? null : clientDash.summary?.total_completed_jobs ?? 0,
                    },
                    {
                      icon: 'progress-clock' as const,
                      label: t('cd_active'),
                      value: activityState === 'loading' ? null : clientDash.summary?.total_active_jobs ?? 0,
                    },
                    {
                      icon: 'cash' as const,
                      label: t('cd_spent'),
                      value:
                        activityState === 'loading'
                          ? null
                          : clientDash.summary
                            ? formatAmountSpent(clientDash.summary.total_amount_spent)
                            : '€0',
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
                  </View>
                  {activityState === 'unavailable' && (
                    <Text style={[styles.activityNote, { color: c.mutedForeground }]}>
                      {t('home_activity_not_ready')}
                    </Text>
                  )}
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
              <Text style={[styles.sectionTitle, { color: c.text }]}>{t('home_recent_bookings')}</Text>
              {bookingsState !== 'loading' && bookingsState !== 'error' && (
                <Text style={[styles.bookingsCount, { color: c.mutedForeground }]}>
                  {t('cb_count', { n: clientBookings.total })}
                </Text>
              )}
            </View>
            <View style={[styles.bookingsCard, { backgroundColor: c.card, borderColor: c.border }]}>
              {bookingsState === 'loading' ? (
                [0, 1].map((i) => (
                  <View key={i} style={[styles.bookingRow, i === 0 && { borderTopWidth: 0 }, { borderBottomColor: c.border }]}>
                    <View style={[styles.bookingIconWrap, { backgroundColor: c.primaryLight }]}>
                      <MaterialCommunityIcons name="calendar-blank" size={18} color={c.primary} />
                    </View>
                    <ActivityIndicator size="small" color={c.primary} />
                  </View>
                ))
              ) : bookingsState === 'error' ? (
                <TouchableOpacity style={styles.bookingErrorRow} onPress={() => void clientBookings.refresh()}>
                  <MaterialCommunityIcons
                    name={failureCopyKind(clientBookings.failure) === 'network' ? 'wifi-off' : 'alert-circle-outline'}
                    size={16}
                    color={c.destructive}
                  />
                  <Text style={[styles.bookingErrorText, { color: c.destructive }]}>
                    {bookingsCopy[failureCopyKind(clientBookings.failure)]}
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
                recentList.map((booking, i) => {
                  const title = htmlToFlowText(getBookingTitle(booking)) || t('cb_fallback_title');
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

        {/* The row of four quick-action buttons (Browse Services / My Bookings /
            Chat / Profile) was removed: every one of those destinations is
            already in the tab bar or on this screen, and the boss called them
            redundant. Its component, data and styles were removed with it. */}

        {/* Categories */}
        <Animated.View entering={FadeInDown.delay(100).duration(380)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>{t('home_categories')}</Text>
            <TouchableOpacity onPress={() => router.push('/categories')}>
              <Text style={[styles.seeAll, { color: c.primary }]}>{t('see_all')}</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={(apiCategories ?? []).slice(0, 8)}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(cat) => String(cat.id)}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            ListEmptyComponent={
              catStatus === 'error' && apiCategories == null ? (
                <TouchableOpacity
                  style={[styles.catalogErrorRow, { borderColor: c.destructive }]}
                  onPress={() => void refreshCategories()}
                  activeOpacity={0.8}
                >
                  <Feather name="wifi-off" size={14} color={c.destructive} />
                  <Text style={[styles.catalogErrorText, { color: c.destructive }]}>{t('cats_error')}</Text>
                  <Text style={[styles.catalogErrorRetry, { color: c.primary }]}>{t('cats_retry')}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={{ color: c.mutedForeground, fontFamily: 'Manrope_400Regular', fontSize: 13, paddingHorizontal: 4 }}>
                  {t('empty_categories_title')}
                </Text>
              )
            }
            renderItem={({ item }) => <ServerCategoryTile category={item} />}
          />
        </Animated.View>

        {/* Personalized / Popular Services */}
        <Animated.View entering={FadeInDown.delay(120).duration(380)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>
              {t('home_popular_services')}
            </Text>
            <TouchableOpacity onPress={() => router.push('/search')}>
              <Text style={[styles.seeAll, { color: c.primary }]}>{t('see_all')}</Text>
            </TouchableOpacity>
          </View>
          {servicesLoading ? (
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
              data={(apiServices ?? []).slice(0, 4)}
              scrollEnabled={false}
              showsVerticalScrollIndicator={false}
              keyExtractor={(s) => String(s.id)}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              ListEmptyComponent={
                svcStatus === 'error' && apiServices == null ? (
                  <TouchableOpacity
                    style={[styles.catalogErrorRow, { borderColor: c.destructive }]}
                    onPress={() => void refreshServices()}
                    activeOpacity={0.8}
                  >
                    <Feather name="wifi-off" size={14} color={c.destructive} />
                    <Text style={[styles.catalogErrorText, { color: c.destructive }]}>{t('services_load_error')}</Text>
                    <Text style={[styles.catalogErrorRetry, { color: c.primary }]}>{t('cats_retry')}</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={{ color: c.mutedForeground, fontFamily: 'Manrope_400Regular', fontSize: 13, paddingHorizontal: 4 }}>
                    {t('services_empty_title')}
                  </Text>
                )
              }
              renderItem={({ item }) => <ServerServiceRow service={item} />}
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

        {/* The old bottom "Earn Badges" block moved to the TOP of Home as the
            first banner slide (Fix 3c), so it is not rendered here twice. */}

        {/* Special Offers (Fix 4b) — where the badge block used to be. Three
            data-driven cards in the SAME AutoSlidingCarousel as the banners,
            with a peek of the next card. TODO(content): brand-neutral
            placeholders until the boss's real offers arrive. */}
        {user && activeRole === 'CLIENT' && homeContent && homeContent.offers.length > 0 ? (
          <Animated.View entering={FadeInDown.delay(160).duration(380)}>
            <SpecialOffers offers={homeContent.offers} />
          </Animated.View>
        ) : null}

        {/* From the Blog — removed: the API exposes no blog endpoint, so the
            fixture posts are gone. The /blog screen itself still exists and
            shows an honest empty state. */}

        {/* Invite Friends */}
        <Animated.View entering={FadeInDown.delay(180).duration(380)} style={{ paddingHorizontal: 16, marginTop: 16 }}>
          <View style={[styles.inviteCard, { backgroundColor: c.primaryLight, borderColor: c.primary }]}>
            <View style={styles.inviteLeft}>
              <MaterialCommunityIcons name="account-multiple-plus-outline" size={28} color={c.primary} />
              {/* No points badge/amount on the left any more: the reward is a
                  commission-free month, not points (Fix 4a). */}
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
    ...StyleSheet.absoluteFill,
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Compact "0 pts" pill — fixed max width and a single line, so it can never
  // push the logo or the location row on a narrow screen.
  pointsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 92,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  pointsPillText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 12,
    color: '#FFF',
    flexShrink: 1,
  },
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

  // ── Client activity summary strip ────────────────────────────────
  activityCard: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  activityRow: { flexDirection: 'row' },
  activityNote: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 11,
    paddingHorizontal: 10,
    paddingTop: 8,
    textAlign: 'center',
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
  catalogErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 4,
    maxWidth: 320,
  },
  catalogErrorText: { flexShrink: 1, fontFamily: 'Manrope_400Regular', fontSize: 12 },
  catalogErrorRetry: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },

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

export default withTabPagerPage(HomeScreen, 0);
