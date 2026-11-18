/**
 * CategoryWorkPreview — "Work in this category" on the category detail screen.
 *
 * Source: the DEDICATED GET /api/v1/categories/{category_id}/gallery?limit=6 —
 * public work photos from completed jobs across EVERY service in this category
 * (see lib/categoryGalleryFetch). It replaces the previous grouped-cache read
 * so this section is fed by the endpoint built for it, while the multi-category
 * "By category" overview keeps its own grouped call.
 *
 * The first page is kept in a per-category session cache (hooks/usePublicMediaPage),
 * so coming back to the screen shows the photos immediately and never flashes a
 * loader. An empty category (items: []) hides the section ENTIRELY — no error
 * card, no Retry — and a failure (including 422) hides it too, so the category
 * screen keeps its existing behaviour.
 *
 * "See all" opens the paginated category gallery, which pages the same endpoint
 * with limit/offset; the viewer pages in more photos as you swipe toward the end.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import MediaViewer from '@/components/MediaViewer';
import ServiceWorkSection from '@/components/ServiceWorkSection';
import { useLanguage } from '@/context/LanguageContext';
import { useCachedCategories } from '@/hooks/useCategories';
import usePublicMediaPage from '@/hooks/usePublicMediaPage';
import {
  DEFAULT_PER_CATEGORY,
  resolveCategoryName,
  toGalleryViewerItems,
} from '@/lib/mediaGallery';
import { formatTaskFeedbackTime } from '@/lib/taskFeedback';

const TILE = 108;

export default function CategoryWorkPreview({
  categoryId,
  fallbackName,
}: {
  categoryId: number | null;
  /** The category name already on screen (detail header) — a free fallback. */
  fallbackName?: string | null;
}) {
  const router = useRouter();
  const { t, tCat, language } = useLanguage();
  const categories = useCachedCategories();

  const { items, hasMore, loadMore } = usePublicMediaPage({
    categoryId,
    limit: DEFAULT_PER_CATEGORY,
    enabled: categoryId !== null,
  });

  /** Only the index is kept: the viewer reads the live list so it can page. */
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const title = useMemo(() => {
    if (categoryId === null) return (fallbackName ?? '').trim();
    const cachedName =
      categories?.find((category) => category.id === categoryId)?.name ?? null;
    const resolved = resolveCategoryName(
      { categoryName: '' },
      tCat(String(categoryId)),
      cachedName ?? fallbackName ?? null
    );
    return resolved;
  }, [categories, categoryId, fallbackName, tCat]);

  const viewerItems = useMemo(
    () =>
      viewerIndex === null
        ? []
        : toGalleryViewerItems(items, (iso) => formatTaskFeedbackTime(iso, language)),
    [items, viewerIndex, language]
  );

  if (items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <ServiceWorkSection
        title={t('gallery_work_in_category')}
        media={items}
        size={TILE}
        maxItems={DEFAULT_PER_CATEGORY}
        onPressPhoto={(index) => setViewerIndex(index)}
        onSeeAll={
          categoryId === null
            ? undefined
            : () =>
                router.push({
                  pathname: '/gallery/category/[categoryId]',
                  params: {
                    categoryId: String(categoryId),
                    title,
                  },
                } as any)
        }
        seeAllLabel={hasMore ? t('see_all') : t('gallery_view_category')}
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
  wrap: { marginBottom: 20 },
});
