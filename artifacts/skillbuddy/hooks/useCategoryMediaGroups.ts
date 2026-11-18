/**
 * useCategoryMediaGroups — the category-grouped source of the public gallery.
 *
 * ENDPOINT: GET /api/v1/media-gallery/public/by-category?per_category=1..50
 * (PUBLIC — verified live 2026-11-18: 200 with no Authorization header AND with
 * a bogus bearer token; 0/99/"abc" → 422). No limit/offset: the groups are not
 * paginated, so a full category list uses the paginated List Public Media
 * endpoint filtered by category_id.
 *
 * A thin binding over the SAME store as the by-service source
 * (hooks/useGalleryGroupStore): one session cache per `per_category`, one
 * in-flight request, 5-minute stale window, zero-request selectors. The two
 * endpoints return different slices of data; nothing merges them.
 */
import { useCallback } from 'react';
import { BASE_URL, authApi } from '@/services/api';
import {
  DEFAULT_PER_CATEGORY,
  clampPerCategory,
  normalizeCategoryGroups,
  type CategoryGalleryGroupView,
} from '@/lib/mediaGallery';
import {
  createGroupStore,
  type GalleryFailure,
  type GalleryStatus,
} from '@/hooks/useGalleryGroupStore';

export type { GalleryFailure, GalleryStatus };

const store = createGroupStore<CategoryGalleryGroupView>({
  name: 'by-category',
  defaultSize: DEFAULT_PER_CATEGORY,
  clampSize: clampPerCategory,
  fetch: (size) => authApi.listPublicMediaByCategory({ per_category: size }),
  normalize: (raw, size) => normalizeCategoryGroups(raw, BASE_URL, size),
  idOf: (group) => group.categoryId,
});

/** Load (or adopt) the groups for one `per_category` value. */
export const loadCategoryGroups = store.load;

/** Pull-to-refresh / Try Again target. */
export function refreshCategoryGroups(perCategory: number = DEFAULT_PER_CATEGORY): Promise<void> {
  return store.load(perCategory, true);
}

/**
 * A category's cached group with ZERO requests and no subscription (screen
 * headings, cards, and the single-category preview all use this).
 */
export const peekGroupForCategory = store.peek;

export interface UseCategoryMediaGroupsOptions {
  /** Preview size requested from the server (1..50, default 6). */
  perCategory?: number;
}

export function useCategoryMediaGroups(options: UseCategoryMediaGroupsOptions = {}) {
  const { groups, getGroup, size, ...rest } = store.useGroups(
    options.perCategory ?? DEFAULT_PER_CATEGORY
  );

  const getGroupForCategory = useCallback(
    (categoryId: number | null | undefined) => getGroup(categoryId),
    [getGroup]
  );

  return {
    ...rest,
    groups,
    /** Same array — kept for symmetry with the by-service hook. */
    allGroups: groups,
    perCategory: size,
    getGroupForCategory,
  };
}

/**
 * A category card's cover photo from the shared grouped cache (ONE request for
 * every mounted card, zero per card). See useGalleryGroupStore.useCover for why
 * a card only shows what is already cached.
 */
export function useCategoryGroupCover(categoryId: number | null | undefined): string | null {
  return store.useCover(categoryId);
}

/** Test/debug helper — clears the by-category session cache. */
export const resetCategoryMediaGroupsCache = store.reset;

export default useCategoryMediaGroups;
