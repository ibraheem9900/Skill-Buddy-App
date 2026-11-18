/**
 * GalleryCategoryGroupsView — the "By category" half of the grouped gallery.
 *
 * ONE request (by-category, per_category = 6) fills every section. This is a
 * DIFFERENT slice of data from the by-service groups (newest N per category vs
 * newest N per service), so it is never merged with, or derived from, them.
 *
 * Chips come from already-cached categories (no request) and only for
 * categories that actually have a group. In this view a chip SCROLLS to that
 * category's section — the list is not filtered, so the user keeps the whole
 * category overview. No refetch happens on either action.
 *
 * "See all" appears when the raw group reached per_category (it may be
 * truncated); otherwise the same link reads "View category gallery" and still
 * opens the paginated list filtered by category_id.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
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
import useCategoryMediaGroups from '@/hooks/useCategoryMediaGroups';
import {
  DEFAULT_PER_CATEGORY,
  resolveCategoryName,
  toGalleryViewerItems,
  type CategoryGalleryGroupView,
  type DisplayMedia,
} from '@/lib/mediaGallery';
import { formatTaskFeedbackTime } from '@/lib/taskFeedback';

const TILE = 116;
/** Rough row height used only as a scroll-to-index fallback. */
const ROW_ESTIMATE = 186;

function CategoryGroupRow({
  group,
  onSeeAll,
  onPressPhoto,
}: {
  group: CategoryGalleryGroupView;
  onSeeAll: () => void;
  onPressPhoto: (index: number) => void;
}) {
  const { t, tCat } = useLanguage();
  const categories = useCachedCategories();
  const cachedName = categories?.find((category) => category.id === group.categoryId)?.name ?? null;
  const localized = tCat(String(group.categoryId));
  const title = resolveCategoryName(group, localized, cachedName);

  return (
    <ServiceWorkSection
      title={title || t('gallery_category_gallery')}
      media={group.media}
      onPressPhoto={onPressPhoto}
      onSeeAll={onSeeAll}
      seeAllLabel={group.mayHaveMore ? t('see_all') : t('gallery_view_category')}
      size={TILE}
      maxItems={DEFAULT_PER_CATEGORY}
      testID={`category-group-${group.categoryId}`}
    />
  );
}

export default function GalleryCategoryGroupsView({ bottomInset = 0 }: { bottomInset?: number }) {
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();

  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [pulling, setPulling] = useState(false);
  const [viewer, setViewer] = useState<{ media: readonly DisplayMedia[]; index: number } | null>(
    null
  );
  const listRef = useRef<FlatList<CategoryGalleryGroupView>>(null);

  const { status, groups, failure, refresh } = useCategoryMediaGroups({
    perCategory: DEFAULT_PER_CATEGORY,
  });

  const categories = useCachedCategories();
  const chips = useMemo(() => {
    const cached = categories ?? [];
    return cached.filter((category) =>
      groups.some((group) => group.categoryId === category.id)
    );
  }, [categories, groups]);

  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  }, [refresh]);

  /** Scroll to a category's section (no filtering, no refetch). */
  const scrollToCategory = useCallback(
    (categoryId: number | null) => {
      setActiveCategory(categoryId);
      if (categoryId === null) {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
        return;
      }
      const index = groups.findIndex((group) => group.categoryId === categoryId);
      if (index < 0) return;
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
    },
    [groups]
  );

  const openCategoryGallery = useCallback(
    (group: CategoryGalleryGroupView) => {
      router.push({
        pathname: '/gallery/category/[categoryId]',
        params: {
          categoryId: String(group.categoryId),
          title: group.categoryName ?? '',
        },
      } as any);
    },
    [router]
  );

  const viewerItems = viewer
    ? toGalleryViewerItems(viewer.media, (iso) => formatTaskFeedbackTime(iso, language))
    : [];

  const firstLoad = status === 'loading' && groups.length === 0;
  const failedWithNothing = status === 'error' && groups.length === 0;
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
        ref={listRef}
        data={groups}
        keyExtractor={(group) => `cat-group-${group.categoryId}`}
        renderItem={({ item }) => (
          <Animated.View entering={FadeIn.duration(220)}>
            <CategoryGroupRow
              group={item}
              onSeeAll={() => openCategoryGallery(item)}
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
        // Variable-height rows: fall back to an estimate instead of crashing.
        onScrollToIndexFailed={({ index }) => {
          listRef.current?.scrollToOffset({
            offset: Math.max(0, index * ROW_ESTIMATE),
            animated: true,
          });
        }}
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
                  onPress={() => scrollToCategory(null)}
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
                      onPress={() => scrollToCategory(category.id)}
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
