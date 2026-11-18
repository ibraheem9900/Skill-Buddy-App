/**
 * usePublicMediaPage — the paginated destination behind every "See all".
 *
 * THREE documented sources, ONE hook (no parallel hook, no duplicated paging):
 *   • SERVICE-ONLY (serviceId set, no categoryId) → the DEDICATED
 *     GET /api/v1/services/{service_id}/gallery?limit&offset. This is the
 *     endpoint built for one service, so every single-service screen uses it.
 *   • CATEGORY-ONLY (categoryId set, no serviceId) → the DEDICATED
 *     GET /api/v1/categories/{category_id}/gallery?limit&offset — public media
 *     of one category across ALL its services (see lib/categoryGalleryFetch).
 *   • every other combination (both, none) → List Public Media
 *     (GET /api/v1/media-gallery/public), unchanged.
 * All three answer the same wrapper {service_id, category_id, items} and are
 * PUBLIC (verified live with no token and with a bogus one, so an expired
 * session can never force a logout from here).
 *
 * NO TOTAL COUNT. `limit` is 1..100 (24 here, server default 30) and `offset`
 * is >= 0. "There may be more" is inferred the only honest way available: the
 * last page came back with exactly `limit` RAW rows. The offset always advances
 * by the RAW rows received, never the filtered count, or rows dropped by the
 * public-media rules (private, non-COMPLETED, unsupported media_type, no URL)
 * would be requested again forever. Duplicate ids are dropped by URL, so a
 * refresh mid-scroll cannot double a tile.
 *
 * SESSION CACHE (dedicated sources only): the first page is kept per
 * `${serviceId|categoryId}|${limit}` for GALLERY_STALE_MS. Returning to the
 * screen (viewer opened/closed, back and forward) therefore shows the photos
 * immediately with NO loader and no refetch; once the window is stale the cached
 * page stays on screen while one silent refresh runs in the background.
 * Pull-to-refresh always hits the network.
 *
 * Errors: the first page failing sets `status = 'error'` (screen shows Try
 * Again); a later page failing keeps the photos already on screen and exposes
 * `loadMoreFailed` so the footer can offer a retry instead of wiping the list.
 * A 404 (or the measured 200-with-empty-items for an unknown id) is an EMPTY
 * page, never an error, and a 422 hides the section rather than breaking it.
 * 401 is classified as "unauthorized" and never breaks public browsing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_URL, authApi } from '@/services/api';
import {
  PUBLIC_MEDIA_PAGE_SIZE,
  isDuplicateMedia,
  normalizeMediaItems,
  rememberMedia,
  type DisplayMedia,
} from '@/lib/mediaGallery';
import { fetchServiceGalleryPage } from '@/lib/serviceGalleryFetch';
import { fetchCategoryGalleryPage } from '@/lib/categoryGalleryFetch';
import { GALLERY_STALE_MS } from '@/hooks/useGalleryGroupStore';

export type PublicMediaStatus = 'idle' | 'loading' | 'ready' | 'error';
export type PublicMediaFailure = 'offline' | 'unauthorized' | 'invalid' | 'server' | 'unknown';

/** Which documented endpoint the current page set came from. */
export type PublicMediaSource = 'service-gallery' | 'category-gallery' | 'public-media';

function classifyFailure(status: number | undefined): PublicMediaFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 422) return 'invalid';
  if (typeof status === 'number' && status >= 500) return 'server';
  if (status === undefined || status === 0) return 'offline';
  return 'unknown';
}

export interface UsePublicMediaPageOptions {
  /** A single service — alone it selects the dedicated Get Service Gallery. */
  serviceId?: number | null;
  /** A single category — alone it selects the dedicated Get Category Gallery. */
  categoryId?: number | null;
  limit?: number;
  /**
   * Skip the request entirely (default true). An invalid route id must NOT fall
   * back to an unfiltered list — that would show every service's photos on an
   * error screen.
   */
  enabled?: boolean;
}

interface GalleryPageCacheEntry {
  items: DisplayMedia[];
  rawCount: number;
  hasMore: boolean;
  /** Next raw offset — already advanced past filtered-out rows. */
  offset: number;
  fetchedAt: number;
}

/** First-page session cache for the dedicated single-service/-category sources. */
const galleryPageCache = new Map<string, GalleryPageCacheEntry>();

/** Test/debug helper — clears the single-service page cache. */
export function resetServiceGalleryPageCache() {
  for (const key of [...galleryPageCache.keys()]) {
    if (key.startsWith('s')) galleryPageCache.delete(key);
  }
}

/** Test/debug helper — clears the single-category page cache. */
export function resetCategoryGalleryPageCache() {
  for (const key of [...galleryPageCache.keys()]) {
    if (key.startsWith('c')) galleryPageCache.delete(key);
  }
}

export function usePublicMediaPage(options: UsePublicMediaPageOptions) {
  const requestedLimit = options.limit ?? PUBLIC_MEDIA_PAGE_SIZE;
  const limit = Math.min(100, Math.max(1, Math.trunc(requestedLimit)));
  const serviceId = options.serviceId ?? null;
  const categoryId = options.categoryId ?? null;
  const enabled = options.enabled ?? true;

  /** Service-only / category-only views use their dedicated endpoint. */
  const isServiceSource = serviceId !== null && categoryId === null;
  const isCategorySource = categoryId !== null && serviceId === null;
  const source: PublicMediaSource = isServiceSource
    ? 'service-gallery'
    : isCategorySource
      ? 'category-gallery'
      : 'public-media';
  const cacheKey = isServiceSource
    ? `s${serviceId}|l${limit}`
    : isCategorySource
      ? `c${categoryId}|l${limit}`
      : null;

  const filterKey = `${serviceId ?? 's0'}|${categoryId ?? 'c0'}|${limit}|${enabled}`;

  const [items, setItems] = useState<DisplayMedia[]>([]);
  const [status, setStatus] = useState<PublicMediaStatus>('idle');
  const [failure, setFailure] = useState<PublicMediaFailure | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  /** Raw rows received so far — the grid may show fewer after filtering. */
  const [rawCount, setRawCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const offsetRef = useRef(0);
  const seqRef = useRef(0);
  const busyRef = useRef(false);
  /** Mirror of the items on screen — paging offsets and the cache read from it. */
  const itemsRef = useRef<DisplayMedia[]>([]);
  const rawCountRef = useRef(0);

  const fetchPage = useCallback(
    async (offset: number, replace: boolean, silent = false) => {
      if (!enabled || busyRef.current) return;
      busyRef.current = true;
      const mySeq = ++seqRef.current;
      if (replace) {
        // A silent revalidation keeps the cached page on screen untouched.
        if (!silent) {
          setStatus('loading');
          setFailure(null);
        }
      } else {
        setLoadingMore(true);
        setLoadMoreFailed(false);
      }

      try {
        let page: DisplayMedia[];
        let rawRows: number;
        if (isServiceSource && serviceId !== null) {
          const result = await fetchServiceGalleryPage(serviceId, { limit, offset });
          page = result.media;
          rawRows = result.rawCount;
        } else if (isCategorySource && categoryId !== null) {
          const result = await fetchCategoryGalleryPage(categoryId, { limit, offset });
          page = result.media;
          rawRows = result.rawCount;
        } else {
          const response = await authApi.getPublicMedia({
            limit,
            offset,
            ...(serviceId !== null ? { service_id: serviceId } : {}),
            ...(categoryId !== null ? { category_id: categoryId } : {}),
          });
          const rawItems = Array.isArray(response.items) ? response.items : [];
          page = normalizeMediaItems(rawItems, BASE_URL);
          rawRows = rawItems.length;
        }
        if (mySeq !== seqRef.current) return;

        // Dedupe by item id (plus URL) so a refresh mid-scroll cannot repeat a
        // photo, and a page overlapping the previous one is merged cleanly.
        const seen = new Set<string>();
        if (!replace) itemsRef.current.forEach((media) => rememberMedia(media, seen));
        const fresh = page.filter((media) => !isDuplicateMedia(media, seen));
        const nextItems = replace ? page : [...itemsRef.current, ...fresh];
        const nextRaw = (replace ? 0 : rawCountRef.current) + rawRows;
        const nextHasMore = rawRows >= limit;
        const nextOffset = offset + rawRows;

        itemsRef.current = nextItems;
        rawCountRef.current = nextRaw;
        setItems(nextItems);
        setRawCount(nextRaw);
        setHasMore(nextHasMore);
        offsetRef.current = nextOffset;
        setStatus('ready');
        setFailure(null);

        // Cache the dedicated sources (List Public Media keeps its old
        // behaviour: always fresh on mount, as before this change).
        if (cacheKey) {
          galleryPageCache.set(cacheKey, {
            items: nextItems,
            rawCount: nextRaw,
            hasMore: nextHasMore,
            offset: nextOffset,
            fetchedAt: Date.now(),
          });
        }
      } catch (err: any) {
        if (mySeq !== seqRef.current) return;
        const mapped = classifyFailure(err?.response?.status);
        console.log(
          `[usePublicMediaPage] ${
            source === 'service-gallery'
              ? 'GET /services/{id}/gallery'
              : source === 'category-gallery'
                ? 'GET /categories/{id}/gallery'
                : 'GET /media-gallery/public'
          } failed`,
          err?.response?.status ?? err?.message ?? 'network',
          mapped
        );
        if (replace) {
          // A silent background refresh never disturbs what is on screen.
          if (silent) return;
          setStatus('error');
          setFailure(mapped);
          itemsRef.current = [];
          rawCountRef.current = 0;
          setItems([]);
          setRawCount(0);
          setHasMore(false);
          offsetRef.current = 0;
          if (cacheKey) galleryPageCache.delete(cacheKey);
        } else {
          setLoadMoreFailed(true);
        }
      } finally {
        if (mySeq === seqRef.current) {
          busyRef.current = false;
          setLoadingMore(false);
        }
      }
    },
    [cacheKey, categoryId, enabled, isCategorySource, isServiceSource, limit, serviceId, source]
  );

  /**
   * First page — re-runs when the filter, the page size or the source changes.
   * For a single service/category the session cache answers first, so returning
   * to the screen (viewer opened/closed, back and forward) costs NO request and
   * shows no loader; a stale cache stays visible while it revalidates.
   */
  useEffect(() => {
    offsetRef.current = 0;
    seqRef.current += 1;
    busyRef.current = false;
    setLoadingMore(false);
    setLoadMoreFailed(false);

    if (cacheKey) {
      const memo = galleryPageCache.get(cacheKey);
      if (memo) {
        itemsRef.current = memo.items;
        rawCountRef.current = memo.rawCount;
        setItems(memo.items);
        setRawCount(memo.rawCount);
        setHasMore(memo.hasMore);
        offsetRef.current = memo.offset;
        setStatus('ready');
        setFailure(null);
        if (Date.now() - memo.fetchedAt < GALLERY_STALE_MS) return;
        // Stale-while-revalidate: cached photos stay on screen.
        void fetchPage(0, true, true);
        return;
      }
    }

    itemsRef.current = [];
    rawCountRef.current = 0;
    setItems([]);
    setRawCount(0);
    setHasMore(false);
    void fetchPage(0, true);
    // fetchPage is recreated only when the source/filter/limit changes.
  }, [cacheKey, fetchPage, filterKey]);

  const loadMore = useCallback(() => {
    if (status !== 'ready' || !hasMore || busyRef.current) return;
    void fetchPage(offsetRef.current, false);
  }, [fetchPage, hasMore, status]);

  const refresh = useCallback(() => {
    offsetRef.current = 0;
    void fetchPage(0, true);
  }, [fetchPage]);

  return {
    items,
    rawCount,
    hasMore,
    status,
    failure,
    /** Which endpoint is in use — reported by dedicated screens, never shown. */
    source,
    loading: status === 'loading',
    loadingMore,
    loadMoreFailed,
    loadMore,
    refresh,
    limit,
  };
}

export default usePublicMediaPage;
