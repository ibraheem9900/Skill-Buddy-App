/**
 * GalleryPagedList — the ONE paginated "See all" screen body, shared by the
 * service and category routes.
 *
 * Each route keeps its own documented source, limit 24 + offset:
 *   • service only → GET /api/v1/services/{service_id}/gallery (the dedicated
 *     single-service endpoint; see hooks/usePublicMediaPage, which also keeps
 *     its first page in a per-service session cache so reopening the screen, or
 *     closing the viewer, does not refetch);
 *   • category only → GET /api/v1/categories/{category_id}/gallery (the
 *     dedicated category endpoint, see lib/categoryGalleryFetch).
 * The grouped endpoints have no limit/offset, so every "See all" lands here.
 *
 * The viewer is fed from the LIVE items array, so swiping near the end can pull
 * the next page while it stays open.
 *
 * The heading is resolved by the route (passed category/service name, then the
 * app's own cached name), so this component never fetches anything just to
 * label itself.
 */
import React, { useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import BackButton from '@/components/BackButton';
import DotsLoader from '@/components/DotsLoader';
import MediaGalleryGrid, { GalleryLoadingMore } from '@/components/MediaGalleryGrid';
import MediaViewer from '@/components/MediaViewer';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import usePublicMediaPage, { type PublicMediaFailure } from '@/hooks/usePublicMediaPage';
import { toGalleryViewerItems } from '@/lib/mediaGallery';
import { formatTaskFeedbackTime } from '@/lib/taskFeedback';

function failureMessageKey(failure: PublicMediaFailure | null) {
  switch (failure) {
    case 'offline':
      return 'gallery_offline' as const;
    case 'unauthorized':
      return 'gallery_unauthorized' as const;
    case 'invalid':
      return 'gallery_invalid' as const;
    default:
      return 'gallery_unknown' as const;
  }
}

interface Props {
  /** Exactly one of these is set (the route decides which). */
  serviceId?: number | null;
  categoryId?: number | null;
  /** Already-resolved heading. */
  title: string;
  /** Shown when the route id is unusable (non-numeric deep link). */
  invalidTitle: string;
}

export default function GalleryPagedList({
  serviceId = null,
  categoryId = null,
  title,
  invalidTitle,
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();

  const enabled = serviceId !== null || categoryId !== null;

  const { items, status, failure, loading, loadingMore, loadMoreFailed, loadMore, refresh } =
    usePublicMediaPage({ serviceId, categoryId, enabled });

  /** Only the index is kept: the pages behind it come from the live list. */
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const viewerItems = useMemo(
    () =>
      viewerIndex === null
        ? []
        : toGalleryViewerItems(items, (iso) => formatTaskFeedbackTime(iso, language)),
    [items, viewerIndex, language]
  );

  const failedWithNothing = (status === 'error' && items.length === 0) || !enabled;

  const emptyComponent = failedWithNothing ? (
    <View style={styles.stateWrap}>
      <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Feather
          name={failure === 'offline' ? 'wifi-off' : 'alert-circle'}
          size={30}
          color={c.destructive}
        />
        <Text style={[styles.stateTitle, { color: c.text }]}>{t('gallery_error_title')}</Text>
        <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
          {t(enabled ? failureMessageKey(failure) : 'gallery_unknown')}
        </Text>
        {enabled ? (
          <TouchableOpacity
            style={[styles.stateBtn, { backgroundColor: c.primary }]}
            onPress={() => refresh()}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Feather name="refresh-cw" size={15} color="#FFFFFF" />
            <Text style={styles.stateBtnText}>{t('try_again')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  ) : loading ? (
    <View style={styles.center}>
      <DotsLoader color={c.mutedForeground} size={7} gap={5} />
    </View>
  ) : status === 'ready' ? (
    <View style={styles.emptyWrap}>
      <View style={[styles.emptyIcon, { backgroundColor: c.primaryLight }]}>
        <Feather name="image" size={30} color={c.primary} />
      </View>
      <Text style={[styles.stateTitle, { color: c.text }]}>{t('gallery_empty_title')}</Text>
      <Text style={[styles.stateSub, { color: c.mutedForeground }]}>{t('gallery_empty_sub')}</Text>
    </View>
  ) : null;

  const footer = loadingMore ? (
    <GalleryLoadingMore />
  ) : loadMoreFailed ? (
    <TouchableOpacity
      style={styles.footerRetry}
      onPress={() => loadMore()}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      <Feather name="refresh-cw" size={14} color={c.primary} />
      <Text style={[styles.footerRetryText, { color: c.primary }]}>
        {t('gallery_load_more_failed')}
      </Text>
    </TouchableOpacity>
  ) : null;

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.headerBg }]}>
        <BackButton />
        <Text style={styles.headerTitle} numberOfLines={1}>
          {enabled ? title : invalidTitle}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <MediaGalleryGrid
        media={items}
        onPressPhoto={(index) => setViewerIndex(index)}
        ListEmptyComponent={emptyComponent}
        ListFooterComponent={footer}
        onEndReached={() => loadMore()}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 28 }}
        refreshControl={
          <RefreshControl
            refreshing={loading && items.length > 0}
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  headerTitle: {
    flex: 1,
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  headerSpacer: { width: 40 },
  center: { alignItems: 'center', paddingTop: 60 },
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
  footerRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  footerRetryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
