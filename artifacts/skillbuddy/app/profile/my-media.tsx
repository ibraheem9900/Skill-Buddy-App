/**
 * My Media — GET /api/v1/media-gallery/mine (the signed-in user's own uploads).
 *
 * WHERE THIS LIVES: reached from the Profile tab ("My Media") for BOTH roles.
 * The endpoint is scoped by the bearer token and carries `uploaded_by_side`
 * values for either side, so a provider and a client each get their own rows
 * from the same item; there is no separate provider-only screen to hang it on.
 * (Confirmed with nobody yet — the task brief asks the team which role owns the
 * screen; both roles are shown here and this note is the flag.)
 *
 * SCOPE: read-only. No upload, no edit, no visibility toggle — `is_public` is
 * shown as a small read-only chip ("Public" / "Private") and nothing more.
 * `job_id` never reaches this component.
 *
 * STATES: first-load skeleton → grid; an EMPTY ARRAY is a calm empty state, not
 * an error; a failed first page is an error card with Retry; a failed NEXT page
 * keeps the loaded tiles and shows a small footer retry. Pull-to-refresh
 * replaces the list (offset 0).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import BackButton from '@/components/BackButton';
import DotsLoader from '@/components/DotsLoader';
import MediaGalleryGrid from '@/components/MediaGalleryGrid';
import MediaViewer from '@/components/MediaViewer';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import useMyMedia, { type MyMediaFailure } from '@/hooks/useMyMedia';
import { formatMyMediaDate } from '@/lib/myMedia';
import { toGalleryViewerItems, type DisplayMedia } from '@/lib/mediaGallery';

function failureMessageKey(failure: MyMediaFailure | null) {
  switch (failure) {
    case 'offline':
      return 'gallery_offline' as const;
    case 'unauthorized':
      return 'gallery_unauthorized' as const;
    case 'invalid':
      return 'gallery_invalid' as const;
    case 'server':
      return 'gallery_server' as const;
    default:
      return 'gallery_unknown' as const;
  }
}

export default function MyMediaScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();
  const { user } = useAuth();

  const userId = user?.id ?? null;
  const { items, status, failure, loadingMore, loadMoreFailed, load, refresh, loadMore } =
    useMyMedia({ userId });

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  /** Read-only visibility label per tile — never a toggle. */
  const publicIds = useMemo(
    () => new Set(items.filter((entry) => entry.isPublic).map((entry) => entry.id)),
    [items]
  );
  const formatDate = useCallback(
    (iso: string) => formatMyMediaDate(iso, language),
    [language]
  );

  const viewerItems = useMemo(
    () =>
      viewerIndex === null ? [] : toGalleryViewerItems(items as DisplayMedia[], formatDate),
    [items, viewerIndex, formatDate]
  );

  const firstLoad = status === 'loading' && items.length === 0;
  const failedWithNothing = status === 'error' && items.length === 0;

  const emptyComponent = !userId ? (
    <View style={styles.stateWrap}>
      <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Feather name="lock" size={28} color={c.mutedForeground} />
        <Text style={[styles.stateTitle, { color: c.text }]}>{t('my_media_sign_in_title')}</Text>
        <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
          {t('my_media_sign_in_sub')}
        </Text>
      </View>
    </View>
  ) : failedWithNothing ? (
    <View style={styles.stateWrap}>
      <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Feather
          name={failure === 'offline' ? 'wifi-off' : 'alert-circle'}
          size={30}
          color={c.destructive}
        />
        <Text style={[styles.stateTitle, { color: c.text }]}>{t('my_media_error_title')}</Text>
        <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
          {t(failureMessageKey(failure))}
        </Text>
        <TouchableOpacity
          style={[styles.stateBtn, { backgroundColor: c.primary }]}
          onPress={() => refresh()}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <Feather name="refresh-cw" size={15} color="#FFFFFF" />
          <Text style={styles.stateBtnText}>{t('try_again')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  ) : firstLoad ? (
    <View style={styles.center}>
      <DotsLoader color={c.mutedForeground} size={7} gap={5} />
    </View>
  ) : status === 'ready' ? (
    <View style={styles.emptyWrap}>
      <View style={[styles.emptyIcon, { backgroundColor: c.primaryLight }]}>
        <Feather name="image" size={30} color={c.primary} />
      </View>
      <Text style={[styles.stateTitle, { color: c.text }]}>{t('my_media_empty_title')}</Text>
      <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
        {t('my_media_empty_sub')}
      </Text>
    </View>
  ) : null;

  const footer = loadingMore ? (
    <View style={styles.footer}>
      <DotsLoader color={c.mutedForeground} size={6} gap={5} />
    </View>
  ) : loadMoreFailed && items.length > 0 ? (
    <TouchableOpacity
      style={styles.footerRetry}
      onPress={() => loadMore()}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      <Feather name="refresh-cw" size={14} color={c.primary} />
      <Text style={[styles.footerRetryText, { color: c.primary }]}>
        {t('my_media_load_more_failed')}
      </Text>
    </TouchableOpacity>
  ) : null;

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('my_media_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <MediaGalleryGrid
        media={items as unknown as DisplayMedia[]}
        onPressPhoto={userId ? (index) => setViewerIndex(index) : undefined}
        chipFor={
          userId ? (item) => (publicIds.has(item.id) ? t('my_media_public') : t('my_media_private')) : undefined
        }
        ListEmptyComponent={emptyComponent}
        ListFooterComponent={footer}
        onEndReached={() => loadMore()}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 28 }}
        refreshControl={
          <RefreshControl
            refreshing={status === 'loading' && items.length > 0}
            onRefresh={() => refresh()}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      />

      <MediaViewer
        visible={viewerIndex !== null}
        items={viewerItems}
        initialIndex={viewerIndex ?? 0}
        onClose={() => setViewerIndex(null)}
        onEndReached={() => loadMore()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  center: { alignItems: 'center', paddingTop: 64 },
  stateWrap: { paddingTop: 48, paddingHorizontal: 8 },
  stateCard: {
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 26,
  },
  stateTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, textAlign: 'center' },
  stateSub: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 12,
  },
  stateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 24,
    minHeight: 44,
  },
  stateBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, color: '#FFFFFF' },
  emptyWrap: { alignItems: 'center', paddingTop: 56, gap: 10, paddingHorizontal: 12 },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { alignItems: 'center', paddingVertical: 18 },
  footerRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  footerRetryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
