import React, { useCallback, useEffect, useState } from 'react';
import {
  Dimensions,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { formatServicePrice } from '@/lib/servicePrice';
import { sanitizeRichText } from '@/lib/sanitizeRichText';
import { prepareMedia, pickThumbnail, type PreparedMedia } from '@/lib/serviceMedia';
import useServiceDetail from '@/hooks/useServiceDetail';
import MediaVideo from '@/components/MediaVideo';
import RatingStars from '@/components/RatingStars';
import BrandedLoader from '@/components/BrandedLoader';

const W = Dimensions.get('window').width;

const TABS = ['service_tab_about', 'service_tab_gallery', 'service_tab_reviews'] as const;
type Tab = (typeof TABS)[number];

export default function ServiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  // SERVER vs LOCAL routing: the detail endpoint takes an INTEGER path param,
  // so a purely numeric id is a real server service id (pushed from the
  // server-backed lists) → fetch GET /api/v1/services/{service_id}. Anything
  // else is a local catalog/synthetic id (svc_…, synth_…) → the original mock
  // path, byte-for-byte unchanged.
  const numericId = id && /^\d+$/.test(id) ? Number(id) : null;
  const isServer = numericId !== null;
  const {
    status: svcdStatus,
    service: serverService,
    load: loadServer,
    refresh: refreshServer,
  } = useServiceDetail(numericId);

  // Re-check on every focus (mirrors the lists' useFocusEffect discipline):
  // cached ids hydrate instantly, unknown ids fetch once per session.
  useFocusEffect(
    useCallback(() => {
      if (isServer) loadServer();
    }, [isServer, loadServer])
  );

  // Strict API: the local catalog fixtures (SERVICES / MOCK_REVIEWS) and the
  // id-based local lookup were removed with the mock data. Non-numeric ids
  // (old deep links into the removed local grid) render the not-found screen.

  const [activeTab, setActiveTab] = useState<Tab>('service_tab_about');
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [screenLoading, setScreenLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setScreenLoading(false), 400);
    return () => clearTimeout(t);
  }, []);

  // Gallery sources: server media (sorted by `position`, URL-less entries
  // dropped, media_type resolved to image/video) or the local images. Video
  // entries must never reach an <Image>, so every entry carries its kind.
  const galleryItems: PreparedMedia[] = prepareMedia(serverService?.media);
  // Cover = the entry flagged is_thumbnail (lowest position wins — assumption
  // flagged in lib/serviceMedia); tapping a thumbnail overrides it.
  const coverItem = pickThumbnail(galleryItems);
  const heroItem =
    (selectedImage !== null ? galleryItems[selectedImage] : coverItem) ??
    galleryItems[0] ??
    null;
  const isSelectedThumb = (index: number) =>
    selectedImage !== null ? index === selectedImage : galleryItems[index] === coverItem;

  // ── Server-derived display fields (never fabricate provider/rating/unit) ──
  const displayTitle = serverService?.title ?? '';
  const displayCategory = serverService?.category_name ?? '';
  const serverPrice = serverService ? formatServicePrice(serverService) : null;
  const isActive = serverService ? serverService.is_active : true;

  // Rich text: server fields may carry HTML — sanitized to clean text (RN has
  // no DOM; raw tags would render literally). Local mock descriptions are
  // plain strings and go through the original path unchanged.
  const serverDesc =
    isServer && serverService ? sanitizeRichText(serverService.description) : null;
  const serverWhatToExpect =
    isServer && serverService ? sanitizeRichText(serverService.what_to_expect) : null;
  const serverInclusions =
    isServer && serverService
      ? (serverService.inclusion_options ?? []).map((o) => o.name)
      : null;

  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  // Hero image: subtle parallax (slower scroll-away) + zoom on pull-down bounce.
  const heroStyle = useAnimatedStyle(() => {
    const y = scrollY.value;
    const scale = y < 0 ? 1 - y / 300 : 1;
    const translateY = y < 0 ? 0 : -y * 0.4;
    return { transform: [{ scale }, { translateY }] };
  });

  // Floating header bar: transparent-over-image at top, fades to a solid
  // surface once the hero has scrolled mostly out of view.
  const floatingHeaderStyle = useAnimatedStyle(() => ({
    backgroundColor: c.surface,
    opacity: interpolate(scrollY.value, [180, 260], [0, 1], Extrapolation.CLAMP),
  }));

  const floatingTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [200, 260], [0, 1], Extrapolation.CLAMP),
  }));

  // ── Server state gates (placed after every hook, like the original loader) ──
  const serverPending = isServer && (svcdStatus === 'idle' || svcdStatus === 'loading');
  if (screenLoading || serverPending) {
    return (
      <View style={[styles.root, { backgroundColor: c.surface }]}>
        <BrandedLoader size={44} />
      </View>
    );
  }

  // 404 "Service not found." (live-verified; undocumented but real) — a dead
  // link must not look like a network failure, so it gets its own screen and
  // no retry (same id can never succeed).
  // A NON-NUMERIC id lands here too: the local catalog fixtures it used to
  // resolve were removed (strict API), so it can never load.
  if (!isServer || svcdStatus === 'notfound') {
    return (
      <View style={[styles.root, { backgroundColor: c.surface, paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={[styles.iconBtn, styles.stateBack]} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color="#1A1A1A" />
        </TouchableOpacity>
        <View style={styles.stateWrap}>
          <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="search" size={28} color={c.mutedForeground} />
            <Text style={[styles.stateText, { color: c.text }]}>{t('svcd_not_found')}</Text>
          </View>
        </View>
      </View>
    );
  }

  // 422 int_parsing — the server's `detail` array is logged by the hook; the
  // user sees a friendly, retryable card (never a crash).
  if (isServer && svcdStatus === 'invalid') {
    return (
      <View style={[styles.root, { backgroundColor: c.surface, paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={[styles.iconBtn, styles.stateBack]} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color="#1A1A1A" />
        </TouchableOpacity>
        <View style={styles.stateWrap}>
          <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.destructive }]}>
            <Feather name="alert-circle" size={28} color={c.destructive} />
            <Text style={[styles.stateText, { color: c.destructive }]}>{t('svcd_invalid')}</Text>
            <TouchableOpacity onPress={() => refreshServer()} hitSlop={6}>
              <Text style={[styles.stateRetry, { color: c.primary }]}>{t('cats_retry')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // Network/timeout/5xx — retryable.
  if (isServer && svcdStatus === 'error') {
    return (
      <View style={[styles.root, { backgroundColor: c.surface, paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={[styles.iconBtn, styles.stateBack]} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color="#1A1A1A" />
        </TouchableOpacity>
        <View style={styles.stateWrap}>
          <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.destructive }]}>
            <Feather name="wifi-off" size={28} color={c.destructive} />
            <Text style={[styles.stateText, { color: c.destructive }]}>{t('svcd_load_error')}</Text>
            <TouchableOpacity onPress={() => refreshServer()} hitSlop={6}>
              <Text style={[styles.stateRetry, { color: c.primary }]}>{t('cats_retry')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // By here the server path is ready with a non-null detail.
  const svc = serverService!;

  return (
    <View style={[styles.root, { backgroundColor: c.surface }]}>
      {/* Floating header — transparent over the hero image, fades to a solid
          surface with the title once the hero has scrolled past. Back and
          bookmark stay accessible throughout. */}
      <Animated.View style={[styles.floatingHeader, { top: 0, paddingTop: insets.top + 8 }, floatingHeaderStyle]} />
      <View style={[styles.floatingHeaderRow, { top: insets.top + 8 }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color="#1A1A1A" />
        </TouchableOpacity>
        <Animated.Text style={[styles.floatingTitle, { color: c.text }, floatingTitleStyle]} numberOfLines={1}>
          {displayTitle}
        </Animated.Text>
        {/* Bookmark affordance removed with the local catalog: the stored
            bookmark shape came from the local fixtures (favorites now join the
            server catalog in the favorites screen). */}
        <View style={styles.iconBtn} />
      </View>

      <Animated.ScrollView
        style={styles.body}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {/* Hero — scrolls away naturally with the rest of the content, with
            a subtle parallax/zoom effect instead of staying stuck in place. */}
        <View style={{ height: 300, overflow: 'hidden' }}>
          <Animated.View style={heroStyle}>
            {heroItem ? (
              heroItem.kind === 'video' ? (
                <MediaVideo
                  url={heroItem.url}
                  style={styles.heroImage}
                  cover
                  autoplay
                  muted
                  loop
                  controls={false}
                />
              ) : (
                <Image source={{ uri: heroItem.url }} style={styles.heroImage} contentFit="cover" />
              )
            ) : (
              <View style={[styles.heroImage, styles.heroFallback, { backgroundColor: c.muted }]}>
                <Feather name="image" size={44} color={c.mutedForeground} />
              </View>
            )}
          </Animated.View>
          {/* Thumbnail strip — gallery order (position ascending) */}
          {galleryItems.length > 1 && (
            <FlatList
              data={galleryItems}
              keyExtractor={(item, i) => `${item.id}-${i}`}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.thumbStrip}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
              renderItem={({ item, index }) => (
                <TouchableOpacity onPress={() => setSelectedImage(index)} activeOpacity={0.8}>
                  {item.kind === 'video' ? (
                    <MediaVideo
                      url={item.url}
                      style={[
                        styles.thumb,
                        isSelectedThumb(index) && { borderWidth: 2, borderColor: c.primary },
                      ]}
                      cover
                      controls={false}
                    />
                  ) : (
                    <Image
                      source={{ uri: item.url }}
                      style={[
                        styles.thumb,
                        isSelectedThumb(index) && { borderWidth: 2, borderColor: c.primary },
                      ]}
                      contentFit="cover"
                    />
                  )}
                </TouchableOpacity>
              )}
            />
          )}
        </View>
        {/* Inactive banner — the service exists but is not currently offered
            (is_active=false). Browsing stays possible; booking is disabled. */}
        {isServer && !isActive && (
          <View style={[styles.unavailableCard, { backgroundColor: c.muted }]}>
            <Feather name="slash" size={16} color={c.mutedForeground} />
            <Text style={[styles.unavailableText, { color: c.mutedForeground }]}>
              {t('svcd_unavailable')}
            </Text>
          </View>
        )}
        {/* Title row */}
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: c.text }]}>{displayTitle}</Text>
            {displayCategory ? (
              <Text style={[styles.categoryLabel, { color: c.mutedForeground }]}>{displayCategory}</Text>
            ) : null}
          </View>
          {serverPrice ? (
            <View style={styles.priceBox}>
              <Text style={[styles.price, { color: c.primary }]}>{serverPrice}</Text>
            </View>
          ) : null}
        </View>

        {/* Provider row / fabricated rating stats removed with the local
            catalog: the detail API provides no provider or rating data, so
            nothing is shown rather than invented. */}

        {/* Tabs */}
        <View style={[styles.tabRow, { borderBottomColor: c.border }]}>
          {TABS.map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[
                styles.tab,
                activeTab === tab && { borderBottomColor: c.primary, borderBottomWidth: 2 },
              ]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, { color: activeTab === tab ? c.primary : c.mutedForeground }]}>
                {t(tab)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* About tab */}
        {activeTab === 'service_tab_about' && (
          <Animated.View entering={FadeIn} style={{ paddingHorizontal: 20, paddingTop: 16 }}>
            {
              <>
                {serverDesc ? (
                  <>
                    <Text style={[styles.sectionTitle, { color: c.text }]}>{t('service_description')}</Text>
                    <Text style={[styles.body2, { color: c.mutedForeground }]}>{serverDesc}</Text>
                  </>
                ) : null}
                {serverWhatToExpect ? (
                  <>
                    <Text style={[styles.sectionTitle, { color: c.text, marginTop: serverDesc ? 20 : 0 }]}>
                      {t('svcd_what_to_expect')}
                    </Text>
                    <Text style={[styles.body2, { color: c.mutedForeground }]}>{serverWhatToExpect}</Text>
                  </>
                ) : null}
                {serverInclusions && serverInclusions.length > 0 ? (
                  <>
                    <Text style={[styles.sectionTitle, { color: c.text, marginTop: 20 }]}>
                      {t('service_whats_included')}
                    </Text>
                    {serverInclusions.map((item) => (
                      <View key={item} style={styles.includeRow}>
                        <Feather name="check-circle" size={16} color={c.primary} />
                        <Text style={[styles.includeText, { color: c.text }]}>{item}</Text>
                      </View>
                    ))}
                  </>
                ) : null}
              </>
            }
          </Animated.View>
        )}

        {/* Gallery tab */}
        {activeTab === 'service_tab_gallery' && (
          <Animated.View entering={FadeIn} style={{ paddingHorizontal: 16, paddingTop: 16 }}>
            {galleryItems.length > 0 ? (
              <View style={styles.galleryGrid}>
                {galleryItems.map((item, i) => (
                  <TouchableOpacity
                    key={`${item.id}-${i}`}
                    onPress={() => setSelectedImage(i)}
                    activeOpacity={0.85}
                  >
                    {item.kind === 'video' ? (
                      <MediaVideo url={item.url} style={styles.galleryItem} cover controls />
                    ) : (
                      <Image source={{ uri: item.url }} style={styles.galleryItem} contentFit="cover" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={styles.emptyGallery}>
                <Feather name="image" size={36} color={c.border} />
                <Text style={[styles.emptyGalleryText, { color: c.mutedForeground }]}>
                  {t('svcd_no_media')}
                </Text>
              </View>
            )}
          </Animated.View>
        )}

        {/* Reviews tab */}
        {activeTab === 'service_tab_reviews' && (
          <Animated.View entering={FadeIn} style={{ paddingTop: 16 }}>
            {/* The service endpoints carry no reviews — never show mock
                reviews. Honest empty state until a reviews API ships. */}
            <View style={styles.emptyGallery}>
              <Feather name="message-square" size={36} color={c.border} />
              <Text style={[styles.emptyGalleryText, { color: c.mutedForeground }]}>
                {t('svcd_no_reviews')}
              </Text>
            </View>
          </Animated.View>
        )}
      </Animated.ScrollView>

      {/* Bottom Bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12, backgroundColor: c.surface, borderTopColor: c.border }]}>
        <TouchableOpacity style={[styles.chatBtn, { borderColor: c.primary }]}>
          <Feather name="message-circle" size={20} color={c.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.bookBtn, { backgroundColor: c.primary }, isServer && !isActive && { opacity: 0.4 }]}
          disabled={isServer && !isActive}
          onPress={() => router.push(`/job/post?serviceId=${svc.id}` as any)}
        >
          <Text style={styles.bookBtnText}>{t('book_now')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  heroImage: { width: '100%', height: 300 },
  heroFallback: { alignItems: 'center', justifyContent: 'center' },
  floatingHeader: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 90,
    zIndex: 10,
  },
  floatingHeaderRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  floatingTitle: {
    flex: 1,
    marginHorizontal: 10,
    fontFamily: 'Manrope_700Bold',
    fontSize: 16,
    textAlign: 'center',
  },
  heroOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  thumbStrip: { position: 'absolute', bottom: 12 },
  thumb: { width: 56, height: 56, borderRadius: 10 },
  body: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 20, paddingTop: 20, gap: 12 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 18, flex: 1 },
  categoryLabel: { fontFamily: 'Manrope_400Regular', fontSize: 13, marginTop: 2 },
  priceBox: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  price: { fontFamily: 'Manrope_700Bold', fontSize: 22 },
  priceUnit: { fontFamily: 'Manrope_400Regular', fontSize: 13, marginBottom: 3 },
  providerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginTop: 16, gap: 10 },
  providerInitials: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerInitialsText: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  providerName: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  providerSub: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 2 },
  ratingCount: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 20,
    padding: 16,
    borderRadius: 16,
    justifyContent: 'space-around',
  },
  statItem: { alignItems: 'center' },
  statValue: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  statLabel: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 2 },
  tabRow: { flexDirection: 'row', marginTop: 20, borderBottomWidth: 1 },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  sectionTitle: { fontFamily: 'Manrope_700Bold', fontSize: 15, marginBottom: 8 },
  body2: { fontFamily: 'Manrope_400Regular', fontSize: 14, lineHeight: 22 },
  includeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  includeText: { fontFamily: 'Manrope_400Regular', fontSize: 14 },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  galleryItem: { width: (W - 40) / 2, height: (W - 40) / 2, borderRadius: 12 },
  emptyGallery: { alignItems: 'center', gap: 10, paddingVertical: 48 },
  emptyGalleryText: { fontFamily: 'Manrope_400Regular', fontSize: 14, textAlign: 'center' },
  reviewCard: { marginHorizontal: 20, marginBottom: 16, padding: 16, borderRadius: 16 },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  reviewerInitials: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewerInitialsText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  reviewerName: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  reviewDate: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 2 },
  reviewText: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 20 },
  // Full-screen server state (404 / 422 / network) — centered card + back.
  stateBack: { alignSelf: 'flex-start', marginLeft: 16, marginTop: 8 },
  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  stateCard: {
    alignItems: 'center',
    gap: 12,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    width: '100%',
  },
  stateText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, textAlign: 'center' },
  stateRetry: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  // is_active=false banner under the title row.
  unavailableCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  unavailableText: { fontFamily: 'Manrope_500Medium', fontSize: 13, flex: 1 },
  bottomBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 12,
    borderTopWidth: 1,
  },
  chatBtn: { width: 50, height: 50, borderRadius: 25, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  bookBtn: { flex: 1, borderRadius: 28, paddingVertical: 14, alignItems: 'center' },
  bookBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: '#FFF' },
});
