/**
 * useMyMedia — paged state for GET /api/v1/media-gallery/mine ("My Media").
 *
 * RULES (all from lib/myMedia):
 *   • the response is a PLAIN ARRAY; paging is limit/offset with no total, so a
 *     page shorter than the limit ends the list and `offset` advances by the
 *     rows the server actually sent;
 *   • refresh REPLACES the list (offset back to 0), loadMore APPENDS and
 *     de-duplicates by id;
 *   • a failed NEXT page keeps everything already on screen and only sets
 *     `loadMoreFailed` (the footer retry), while a failed FIRST page is the
 *     screen's error state;
 *   • overlapping page requests are ignored (one request in flight at a time),
 *     and a refresh cancels an in-flight next page.
 *
 * USER SCOPING: the session cache is tagged with the signed-in user's id and is
 * discarded the moment that id changes (logout → null, or another account).
 * One user can never see another user's rows, and a returning user gets their
 * list back with no loader flash.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_URL, authApi } from '@/services/api';
import {
  MY_MEDIA_PAGE_SIZE,
  clampMyMediaLimit,
  mergeMyMediaPage,
  myMediaHasMore,
  nextMyMediaOffset,
  normalizeMyMediaArray,
  type MyMediaEntry,
} from '@/lib/myMedia';

export type MyMediaStatus = 'idle' | 'loading' | 'ready' | 'error';
export type MyMediaFailure =
  | 'offline'
  | 'unauthorized'
  | 'invalid'
  | 'server'
  | 'unknown';

/** How long a hydrated list is trusted before a silent background refresh. */
export const MY_MEDIA_STALE_MS = 60_000;

interface MyMediaCacheEntry {
  /** Owner of this cache — a different account must never read it. */
  userId: string;
  items: MyMediaEntry[];
  /** Rows the API sent (before skipped rows) — drives the end-of-list rule. */
  rawCount: number;
  hasMore: boolean;
  /** Next offset to request. */
  offset: number;
  fetchedAt: number;
}

let cache: MyMediaCacheEntry | null = null;

/** Clears the session cache (logout, account switch, tests). */
export function resetMyMediaCache() {
  cache = null;
}

function classifyFailure(status: number | undefined): MyMediaFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 422) return 'invalid';
  if (typeof status === 'number' && status >= 500) return 'server';
  if (status === undefined || status === 0) return 'offline';
  return 'unknown';
}

export interface UseMyMediaOptions {
  /** Id of the signed-in user; null means signed out (no request is made). */
  userId: string | null;
  /** Extra switch for screens that mount before the session is ready. */
  enabled?: boolean;
}

export default function useMyMedia({ userId, enabled = true }: UseMyMediaOptions) {
  const limit = clampMyMediaLimit(MY_MEDIA_PAGE_SIZE);
  const canLoad = enabled && userId !== null;

  const [items, setItems] = useState<MyMediaEntry[]>([]);
  const [status, setStatus] = useState<MyMediaStatus>('idle');
  const [failure, setFailure] = useState<MyMediaFailure | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const offsetRef = useRef(0);
  const itemsRef = useRef<MyMediaEntry[]>([]);
  const rawCountRef = useRef(0);
  const hasMoreRef = useRef(false);
  const busyRef = useRef(false);
  /** Bumped by every refresh so a stale in-flight response is discarded. */
  const seqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const commit = useCallback((next: MyMediaEntry[], raw: number, more: boolean, offset: number) => {
    itemsRef.current = next;
    rawCountRef.current = raw;
    hasMoreRef.current = more;
    offsetRef.current = offset;
    setItems(next);
    setHasMore(more);
    if (cache) {
      cache = { ...cache, items: next, rawCount: raw, hasMore: more, offset, fetchedAt: Date.now() };
    }
  }, []);

  /**
   * Reset or hydrate whenever the signed-in user changes. A different id (or a
   * logout) drops the previous account's rows before anything is rendered.
   */
  useEffect(() => {
    busyRef.current = false;
    seqRef.current += 1;
    setLoadingMore(false);
    setLoadMoreFailed(false);
    setFailure(null);

    if (userId === null) {
      cache = null;
      itemsRef.current = [];
      rawCountRef.current = 0;
      hasMoreRef.current = false;
      offsetRef.current = 0;
      setItems([]);
      setHasMore(false);
      setStatus('idle');
      return;
    }

    if (cache && cache.userId !== userId) cache = null;

    if (cache) {
      itemsRef.current = cache.items;
      rawCountRef.current = cache.rawCount;
      hasMoreRef.current = cache.hasMore;
      offsetRef.current = cache.offset;
      setItems(cache.items);
      setHasMore(cache.hasMore);
      setStatus('ready');
      return;
    }

    itemsRef.current = [];
    rawCountRef.current = 0;
    hasMoreRef.current = false;
    offsetRef.current = 0;
    setItems([]);
    setHasMore(false);
    setStatus('idle');
  }, [userId]);

  /**
   * First load / pull-to-refresh / focus. With rows already on screen this is
   * SILENT (no loader flash); a cold screen shows the skeleton.
   */
  const refresh = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!canLoad || userId === null) return;
      const silent = options.silent ?? itemsRef.current.length > 0;
      busyRef.current = true;
      seqRef.current += 1;
      const mySeq = seqRef.current;
      const hadItems = itemsRef.current.length > 0;

      if (!silent || !hadItems) {
        setStatus('loading');
        setFailure(null);
      }
      setLoadingMore(false);
      setLoadMoreFailed(false);

      try {
        const raw = await authApi.getMyMedia({ limit, offset: 0 });
        if (!mountedRef.current || mySeq !== seqRef.current) return;
        const page = normalizeMyMediaArray(raw, BASE_URL);
        const more = myMediaHasMore(raw.length, limit);
        cache = {
          userId,
          items: page,
          rawCount: raw.length,
          hasMore: more,
          offset: nextMyMediaOffset(0, raw.length),
          fetchedAt: Date.now(),
        };
        commit(page, raw.length, more, nextMyMediaOffset(0, raw.length));
        setStatus('ready');
        setFailure(null);
      } catch (err: any) {
        if (!mountedRef.current || mySeq !== seqRef.current) return;
        const reason = classifyFailure(err?.response?.status);
        setFailure(reason);
        if (hadItems) {
          // Keep what is on screen — the failure is a banner, not a wipe.
          setStatus('ready');
          setLoadMoreFailed(true);
        } else {
          setStatus('error');
        }
      } finally {
        if (mySeq === seqRef.current) busyRef.current = false;
      }
    },
    [canLoad, commit, limit, userId]
  );

  /** Next page. Ignored while another request is in flight or at the end. */
  const loadMore = useCallback(async () => {
    if (!canLoad || userId === null) return;
    if (busyRef.current || !hasMoreRef.current) return;
    busyRef.current = true;
    const mySeq = seqRef.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);

    const offset = offsetRef.current;
    try {
      const raw = await authApi.getMyMedia({ limit, offset });
      if (!mountedRef.current || mySeq !== seqRef.current) return;
      const page = normalizeMyMediaArray(raw, BASE_URL);
      const merged = mergeMyMediaPage(itemsRef.current, page);
      const more = myMediaHasMore(raw.length, limit);
      const nextOffset = nextMyMediaOffset(offset, raw.length);
      cache = {
        userId,
        items: merged,
        rawCount: rawCountRef.current + raw.length,
        hasMore: more,
        offset: nextOffset,
        fetchedAt: Date.now(),
      };
      commit(merged, rawCountRef.current + raw.length, more, nextOffset);
      setStatus('ready');
    } catch {
      if (!mountedRef.current || mySeq !== seqRef.current) return;
      // Keeps the loaded rows and offers the footer retry only.
      setLoadMoreFailed(true);
    } finally {
      if (mountedRef.current && mySeq === seqRef.current) {
        setLoadingMore(false);
        busyRef.current = false;
      }
    }
  }, [canLoad, commit, limit, userId]);

  /**
   * Screen entry: hydrate (already done by the userId effect), then refresh
   * silently when the cached page is old, or load for real when it is cold.
   */
  const load = useCallback(async () => {
    if (!canLoad) return;
    const fresh = cache && cache.userId === userId && Date.now() - cache.fetchedAt < MY_MEDIA_STALE_MS;
    if (fresh) {
      setStatus('ready');
      return;
    }
    await refresh({ silent: itemsRef.current.length > 0 });
  }, [canLoad, refresh, userId]);

  return {
    items,
    status,
    failure,
    loadingMore,
    loadMoreFailed,
    hasMore,
    load,
    refresh,
    loadMore,
  };
}
