/**
 * The paginated "See all" list for ONE category.
 *
 * Same body as the service route (components/GalleryPagedList), but paged from
 * the DEDICATED GET /api/v1/categories/{category_id}/gallery?limit&offset
 * (public media of one category across all its services). The first page is
 * kept per category in a session cache, so reopening this screen shows the
 * photos immediately; the rest pages in on scroll by raw offset.
 *
 * Heading order: the name passed in by the group → the app's own localised
 * category name (`cat_<id>` translation) → the cached GET /categories name →
 * the cached by-category group's category_name → the generic label. Nothing
 * here fires a request just to label the screen.
 */
import React, { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import GalleryPagedList from '@/components/GalleryPagedList';
import { useLanguage } from '@/context/LanguageContext';
import { useCachedCategories } from '@/hooks/useCategories';
import { peekGroupForCategory } from '@/hooks/useCategoryMediaGroups';
import { resolveCategoryName } from '@/lib/mediaGallery';

export default function CategoryGalleryScreen() {
  const { t, tCat } = useLanguage();
  const params = useLocalSearchParams<{ categoryId: string; title?: string }>();
  const categories = useCachedCategories();

  const numericId =
    params.categoryId && /^\d+$/.test(String(params.categoryId))
      ? Number(params.categoryId)
      : null;

  const heading = useMemo(() => {
    const fromRoute = (params.title ?? '').trim();
    if (fromRoute.length > 0) return fromRoute;

    const cachedName =
      categories?.find((category) => category.id === numericId)?.name ?? null;
    const group = numericId === null ? null : peekGroupForCategory(numericId);
    const resolved = resolveCategoryName(
      { categoryName: group?.categoryName ?? '' },
      numericId === null ? '' : tCat(String(numericId)),
      cachedName
    );
    return resolved || t('gallery_category_gallery');
  }, [categories, numericId, params.title, t, tCat]);

  return (
    <GalleryPagedList
      categoryId={numericId}
      title={heading}
      invalidTitle={t('gallery_category_gallery')}
    />
  );
}
