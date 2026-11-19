/**
 * useServiceMediaGroups — the service-grouped source of the public gallery.
 *
 * A thin, documented binding over the shared store
 * (hooks/useGalleryGroupStore): ONE session cache per `per_service`, ONE
 * in-flight request, stale-after-5-minutes, and synchronous selectors that cost
 * zero requests. The generic caching/normalising/stale logic lives in the store
 * so the by-category source (hooks/useCategoryMediaGroups) uses the exact same
 * machinery instead of a copy.
 *
 * ENDPOINT: GET /api/v1/media-gallery/public/by-service?per_service=1..50
 * (PUBLIC — verified with and without a token). It has no limit/offset; the
 * groups are not paginated, so "See all" opens the dedicated paginated
 * GET /api/v1/services/{service_id}/gallery screen for that one service.
 *
 * ERRORS: 401 is recorded as a friendly `GalleryFailure` and never breaks
 * public browsing; dedicated screens show "Try Again", host screens hide the
 * gallery section. Nothing here alerts.
 */
import { useCallback, useMemo } from 'react';
import { BASE_URL, authApi } from '@/services/api';
import {
  DEFAULT_PER_SERVICE,
  clampPerService,
  filterGroupsByCategory,
  normalizeServiceGroups,
  type DisplayMedia,
  type ServiceGalleryGroupView,
} from '@/lib/mediaGallery';
import { fetchServiceGalleryPage } from '@/lib/serviceGalleryFetch';
import {
  createGroupStore,
  type GalleryFailure,
  type GallerySingleGroup,
  type GalleryStatus,
} from '@/hooks/useGalleryGroupStore';

export type { GalleryFailure, GalleryStatus };

/** The small page a single-service fallback asks for (never above 20). */
const FALLBACK_LIMIT = DEFAULT_PER_SERVICE;

const store = createGroupStore<ServiceGalleryGroupView>({
  name: 'by-service',
  defaultSize: DEFAULT_PER_SERVICE,
  clampSize: clampPerService,
  fetch: (size) => authApi.listPublicMediaByService({ per_service: size }),
  normalize: (raw, size) => normalizeServiceGroups(raw, BASE_URL, size),
  idOf: (group) => group.serviceId,
});

/** Load (or adopt) the groups for one `per_service` value. */
export const loadServiceGroups = store.load;

/** Pull-to-refresh / Try Again target. */
export function refreshServiceGroups(perService: number = DEFAULT_PER_SERVICE): Promise<void> {
  return store.load(perService, true);
}

/**
 * A service's cached group with ZERO requests and no subscription (used for a
 * screen heading on the paginated list, which must not fire the grouped call
 * just to label itself).
 */
export const peekGroupForService = store.peek;

export interface UseServiceMediaGroupsOptions {
  /** Preview size requested from the server (1..50, default 6). */
  perService?: number;
  /** Optional client-side category filter — never triggers a request. */
  categoryId?: number | null;
}

export function useServiceMediaGroups(options: UseServiceMediaGroupsOptions = {}) {
  const { groups: allGroups, getGroup, size, ...rest } = store.useGroups(
    options.perService ?? DEFAULT_PER_SERVICE
  );

  const categoryId = options.categoryId ?? null;

  /** Client-side category filter over the SAME cache — instant, no refetch. */
  const groups = useMemo(
    () => filterGroupsByCategory(allGroups, categoryId),
    [allGroups, categoryId]
  );

  const getGroupForService = useCallback(
    (serviceId: number | null | undefined) => getGroup(serviceId),
    [getGroup]
  );

  return {
    ...rest,
    groups,
    allGroups,
    perService: size,
    getGroupForService,
  };
}

/**
 * A service card's cover photo from the shared grouped cache. Every mounted
 * card calls this; the store turns them into ONE request. Null while nothing is
 * cached, so the card keeps its existing thumbnail/placeholder behaviour.
 */
export function useServiceGroupCover(serviceId: number | null | undefined): string | null {
  return store.useCover(serviceId);
}

/**
 * The documented single-service fallback page. Uses the DEDICATED
 * GET /api/v1/services/{service_id}/gallery (through lib/serviceGalleryFetch,
 * which maps a 404 to an empty page and only falls back to List Public Media
 * if the path is not mounted on this deployment).
 */
async function fetchServiceFallback(serviceId: number): Promise<GallerySingleGroup> {
  const page = await fetchServiceGalleryPage(serviceId, { limit: FALLBACK_LIMIT });
  return { media: page.media, rawCount: page.rawCount };
}

export interface ServiceWorkPreview {
  media: GallerySingleGroup['media'];
  rawCount: number;
  mayHaveMore: boolean;
  loading: boolean;
  /** True when the grouped cache answered — i.e. no request was made. */
  fromCache: boolean;
}

/**
 * ONE service's public work photos, cache-first. The grouped call runs first;
 * only when it SETTLED without a group for this service does the single-service
 * page load — and only on the service detail screen, never in a list.
 */
export function useServiceWorkPreview(
  serviceId: number | null | undefined,
  enabled = true
): ServiceWorkPreview {
  return store.usePreview(serviceId, enabled, fetchServiceFallback);
}

/**
 * Apply ONE photo's PATCH response to every cached by-service bucket (and to
 * the single-service fallback pages) with no refetch. `next` is the item's new
 * PUBLIC representation; `null` removes it (it became private / was deleted).
 * Called by the Update Media flow, not by screens.
 */
export function applyServiceGroupMedia(id: number, next: DisplayMedia | null): void {
  store.applyMedia(id, next);
}

/** A photo became public: let every bucket refetch on its next load. */
export function markServiceGroupsStale(): void {
  store.markStale();
}

/** Test/debug helper — clears the by-service session cache. */
export const resetServiceMediaGroupsCache = store.reset;

export default useServiceMediaGroups;
