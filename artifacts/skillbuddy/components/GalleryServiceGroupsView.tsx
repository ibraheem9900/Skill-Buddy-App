/**
 * GalleryServiceGroupsView — the "By service" half of the grouped gallery.
 *
 * ONE request (by-service, per_service = 6) fills every section. Category chips
 * filter the SAME cached groups on the client by the GROUP's category_id and
 * never refetch. Server order is preserved. A group whose items all failed
 * normalisation is dropped upstream, so a zero-photo section can never render.
 *
 * Extracted from the gallery screen when the "By service | By category" toggle
 * arrived; behaviour is unchanged. Only the ACTIVE view is mounted, so opening
 * the screen never fires both grouped endpoints at once.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import MediaViewer from '@/components/MediaViewer';
import ServiceWorkSection from '@/components/ServiceWorkSection';
import {
  GalleryEmptyState,
  GalleryErrorState,
  GallerySkeletonSections,
} from '@/components/GalleryStatusViews';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useCachedCategories } from '@/hooks/useCategories';
import { useCachedServiceTitle } from '@/hooks/useServices';
import useServiceMediaGroups from '@/hooks/useServiceMediaGroups';
import {
  DEFAULT_PER_SERVICE,
  toGalleryViewerItems,
  type DisplayMedia,
  type ServiceGalleryGroupView,
} from '@/lib/mediaGallery';
import { formatTaskFeedbackTime } from '@/lib/taskFeedback';

const TILE = 116;

function ServiceGroupRow({
  group,
  onSeeAll,
  onPressPhoto,
}: {
  group: ServiceGalleryGroupView;
  onSeeAll: () => void;
  onPressPhoto: (index: number) => void;
}) {
  const { t } = useLanguage();
  const cachedTitle = useCachedServiceTitle(group.serviceId);
  const title = (cachedTitle ?? group.serviceTitle).trim();

  return (
    <ServiceWorkSection
      title={title || t('gallery_service_title')}
      media={group.media}
      onPressPhoto={onPressPhoto}
      onSeeAll={onSeeAll}
      // The per-service TOTAL is not documented: "See all" only when the raw
      // group reached the per_service we asked for; otherwise the always-
      // available "View service gallery".
      seeAllLabel={group.mayHaveMore ? t('see_all') : t('gallery_view_service')}
      size={TILE}
      maxItems={DEFAULT_PER_SERVICE}
      testID={`group-${group.serviceId}`}
    />
  );
}

export default function GalleryServiceGroupsView({ bottomInset = 0 }: { bottomInset?: number }) {
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();

  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [pulling, setPulling] = useState(false);
  const [viewer, setViewer] = useState<{ media: readonly DisplayMedia[]; index: number } | null>(
    null
  );

  const { status, groups, allGroups, failure, refresh } = useServiceMediaGroups({
    perService: DEFAULT_PER_SERVICE,
    categoryId: activeCategory,
  });

  // Chips: already-cached categories (no request), only those that actually
  // have a group — a chip that would filter to nothing is never offered.
  const categories = useCachedCategories();
  const chips = useMemo(() => {
    const cached = categories ?? [];
    return cached.filter((category) =>
      allGroups.some((group) => group.categoryId === category.id)
    );
  }, [allGroups, categories]);

  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  }, [refresh]);

  const openServiceGallery = useCallback(
    (group: ServiceGalleryGroupView) => {
      router.push({
        pathname: '/gallery/[serviceId]',
        params: {
          serviceId: String(group.serviceId),
          title: (group.serviceTitle ?? '').trim(),
        },
      } as any);
    },
    [router]
  );

  const viewerItems = viewer
    ? toGalleryViewerItems(viewer.media, (iso) => formatTaskFeedbackTime(iso, language))
    : [];

  const firstLoad = status === 'loading' && allGroups.length === 0;
  const failedWithNothing = status === 'error' && allGroups.length === 0;
  const isEmpty = status === 'ready' && groups.length === 0;

  if (firstLoad) {
    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        <GallerySkeletonSections tile={TILE} />
      </ScrollView>
    );
  }

  if (failedWithNothing) {
    return <GalleryErrorState failure={failure} onRetry={() => void onRefresh()} retrying={pulling} />;
  }

  if (isEmpty) {
    return <GalleryEmptyState onRetry={() => void onRefresh()} />;
  }

  return (
    <>
      <FlatList
        data={groups}
        keyExtractor={(group) => `svc-group-${group.serviceId}`}
        renderItem={({ item }) => (
          <Animated.View entering={FadeIn.duration(220)}>
            <ServiceGroupRow
              group={item}
              onSeeAll={() => openServiceGallery(item)}
              onPressPhoto={(index) => setViewer({ media: item.media, index })}
            />
          </Animated.View>
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: bottomInset + 32, gap: 22 }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={4}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={() => void onRefresh()}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
        ListHeaderComponent={
          chips.length > 0 ? (
            <View style={styles.chipRow}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingBottom: 2 }}
              >
                <TouchableOpacity
                  style={[
                    styles.chip,
                    {
                      backgroundColor: activeCategory === null ? c.primary : c.card,
                      borderColor: activeCategory === null ? c.primary : c.border,
                    },
                  ]}
                  onPress={() => setActiveCategory(null)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: activeCategory === null ? '#FFFFFF' : c.text },
                    ]}
                    numberOfLines={1}
                  >
                    {t('services_all')}
                  </Text>
                </TouchableOpacity>
                {chips.map((category) => {
                  const active = activeCategory === category.id;
                  return (
                    <TouchableOpacity
                      key={String(category.id)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? c.primary : c.card,
                          borderColor: active ? c.primary : c.border,
                        },
                      ]}
                      onPress={() => setActiveCategory(category.id)}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                    >
                      <Text
                        style={[styles.chipText, { color: active ? '#FFFFFF' : c.text }]}
                        numberOfLines={1}
                      >
                        {category.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null
        }
      />

      <MediaViewer
        visible={viewer !== null}
        items={viewerItems}
        initialIndex={viewer?.index ?? 0}
        onClose={() => setViewer(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  chipRow: { paddingBottom: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 200,
  },
  chipText: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
});
