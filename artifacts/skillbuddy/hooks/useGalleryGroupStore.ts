/**
 * useGalleryGroupStore — the ONE cache/store implementation shared by the two
 * grouped public-gallery endpoints:
 *
 *   • GET /api/v1/media-gallery/public/by-service  (per_service, 1..50)
 *   • GET /api/v1/media-gallery/public/by-category (per_category, 1..50)
 *
 * Neither has limit/offset: the groups are not paginated, so a screen that
 * needs "every service" or "every category" gets it in ONE call. Both endpoints
 * are PUBLIC (verified live: 200 with no token and with a bogus token).
 *
 * WHY A MODULE STORE: the grouped result powers many consumers at once (the
 * gallery screen, home preview, category screen, service cards). Per-screen
 * state would refetch the same payload per mount; this factory keeps per store:
 *
 *   • ONE session cache keyed by the documented size parameter (per_service /
 *     per_category),
 *   • ONE shared in-flight promise per key, so N mounted consumers cause ONE
 *     network request,
 *   • a 5-minute stale window (refetch on mount when stale, never on focus),
 *   • a sequence guard so a slow answer cannot overwrite a fresh one,
 *   • `peek()` / `useCover()` selectors that read the cache with ZERO requests.
 *
 * A failure NEVER stores [] as data (previously loaded groups stay on screen)
 * and is recorded as a friendly code — never a status code, never raw JSON.
 * Nothing here raises an alert, so a gallery failure can never take over
 * another screen.
 *
 * The two endpoints return DIFFERENT slices (newest N per category vs newest N
 * per service). Each store is independent on purpose: the app never merges,
 * de-duplicates or assumes one is a subset of the other.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { groupCoverUrl, type DisplayMedia } from '@/lib/mediaGallery';

export type GalleryStatus = 'idle' | 'loading' | 'ready' | 'error';

/** What went wrong, in words a screen can translate — never a status code. */
export type GalleryFailure = 'offline' | 'unauthorized' | 'invalid' | 'server' | 'unknown';

/** A cached group is re-checked after this long — not on every focus. */
export const GALLERY_STALE_MS = 5 * 60 * 1000;

/** What every group shape shares: displayable media plus the raw count. */
export interface GalleryGroupBase {
  media: DisplayMedia[];
  /** `items.length` BEFORE filtering — drives the "may have more" rule. */
  rawCount: number;
  /** rawCount >= the size we asked for → the group may be truncated. */
  mayHaveMore: boolean;
}

export interface GalleryGroupEntry<TGroup> {
  /** The size parameter this bucket was fetched with. */
  size: number;
  status: GalleryStatus;
  groups: TGroup[];
  error: GalleryFailure | null;
  fetchedAt: number | null;
}

/** The single-group page a dedicated screen may fall back to. */
export interface GallerySingleGroup {
  media: DisplayMedia[];
  rawCount: number;
}

/** 401/403 are reported as "unauthorized" but never thrown at the user. */
export function classifyGalleryFailure(status: number | undefined): GalleryFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 422) return 'invalid';
  if (typeof status === 'number' && status >= 500) return 'server';
  // No status at all = offline / timeout / DNS.
  if (status === undefined || status === 0) return 'offline';
  return 'unknown';
}

export interface GroupStoreConfig<TGroup extends GalleryGroupBase> {
  /** Debug label used in console lines ("by-service", "by-category"). */
  name: string;
  /** Size used by previews and by every selector (the cache default bucket). */
  defaultSize: number;
  /** Clamp the size parameter to the documented 1..50 range. */
  clampSize: (value: number | null | undefined) => number;
  /** The network call for one size bucket. */
  fetch: (size: number) => Promise<unknown>;
  /** The normaliser for that payload (shared with the other gallery rules). */
  normalize: (raw: unknown, size: number) => TGroup[];
  /** How to read a group's id (service_id / category_id). */
  idOf: (group: TGroup) => number;
}

export function createGroupStore<TGroup extends GalleryGroupBase>(config: GroupStoreConfig<TGroup>) {
  const entries = new Map<number, GalleryGroupEntry<TGroup>>();
  const listeners = new Set<() => void>();
  const inFlight = new Map<number, Promise<void>>();
  /** Session memo for single-group fallback pages, keyed `${name}:${id}`. */
  const singleCache = new Map<string, GallerySingleGroup>();

  function keyOf(size: number | null | undefined): number {
    return config.clampSize(size ?? config.defaultSize);
  }

  function entryFor(size: number): GalleryGroupEntry<TGroup> {
    const key = config.clampSize(size);
    const existing = entries.get(key);
    if (existing) return existing;
    const created: GalleryGroupEntry<TGroup> = {
      size: key,
      status: 'idle',
      groups: [],
      error: null,
      fetchedAt: null,
    };
    entries.set(key, created);
    return created;
  }

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function write(next: GalleryGroupEntry<TGroup>) {
    entries.set(next.size, next);
    emit();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /** The group for an id from ANY loaded size bucket (zero requests). */
  function findInAnyBucket(id: number): TGroup | null {
    for (const entry of entries.values()) {
      const hit = entry.groups.find((group) => config.idOf(group) === id);
      if (hit) return hit;
    }
    return null;
  }

  /** Load (or adopt) one size bucket. Concurrent callers share one promise. */
  function load(size?: number, force = false): Promise<void> {
    const key = keyOf(size);
    const entry = entryFor(key);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const fresh = entry.fetchedAt !== null && Date.now() - entry.fetchedAt < GALLERY_STALE_MS;
    if (!force && entry.status === 'ready' && fresh) return Promise.resolve();

    // Keep the previous groups visible while a refresh runs (pull-to-refresh).
    write({ ...entry, status: entry.status === 'ready' ? 'ready' : 'loading', error: null });

    const run = (async () => {
      try {
        const raw = await config.fetch(key);
        const groups = config.normalize(raw, key);
        write({ size: key, status: 'ready', groups, error: null, fetchedAt: Date.now() });
      } catch (err: any) {
        const failure = classifyGalleryFailure(err?.response?.status);
        console.log(
          `[${config.name}] grouped gallery failed`,
          err?.response?.status ?? err?.message ?? 'network',
          failure
        );
        // A failure is never stored as an empty list.
        write({ ...entryFor(key), status: 'error', error: failure });
      } finally {
        inFlight.delete(key);
      }
    })();

    inFlight.set(key, run);
    return run;
  }

  /** A group from the cache with ZERO requests and no subscription. */
  function peek(id: number | null | undefined): TGroup | null {
    if (id === null || id === undefined) return null;
    const own = entryFor(config.defaultSize).groups.find(
      (group) => config.idOf(group) === id
    );
    return own ?? findInAnyBucket(id);
  }

  /**
   * All groups of one bucket + status + a `getGroup` selector.
   * The view supplies its own client-side filtering.
   */
  function useGroups(size?: number) {
    const key = keyOf(size);
    const entry = useSyncExternalStore(
      subscribe,
      () => entryFor(key),
      () => entryFor(key)
    );

    useEffect(() => {
      void load(key);
    }, [key]);

    const refetch = useCallback(() => load(key, true), [key]);

    const getGroup = useCallback(
      (id: number | null | undefined) => (id === null || id === undefined ? null : peek(id)),
      // peek reads the live maps; entry.groups is what changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [entry.groups]
    );

    return {
      status: entry.status,
      failure: entry.error,
      loading: entry.status === 'loading',
      groups: entry.groups,
      size: key,
      lastFetchedAt: entry.fetchedAt,
      refetch,
      refresh: refetch,
      getGroup,
    };
  }

  /**
   * A card's cover photo from the cache. Every mounted card calls this and the
   * store turns them into ONE request; null while nothing is cached, so the
   * card keeps its existing placeholder instead of flickering.
   */
  function useCover(id: number | null | undefined, enabled = true): string | null {
    const entry = useSyncExternalStore(
      subscribe,
      () => entryFor(config.defaultSize),
      () => entryFor(config.defaultSize)
    );

    useEffect(() => {
      if (!enabled || id === null || id === undefined) return;
      void load(config.defaultSize);
    }, [enabled, id]);

    if (id === null || id === undefined) return null;
    const cached =
      entry.groups.find((group) => config.idOf(group) === id) ?? findInAnyBucket(id);
    return groupCoverUrl(cached);
  }

  /**
   * ONE id's public photos, cache-first.
   *
   * The grouped call runs first. Only when it has SETTLED and holds no group
   * for this id does `fetchOne` run — and only on a single-category /
   * single-service screen, never inside a list. A failure hides the section
   * (empty media). `fetchOne` MUST be a stable module-level function.
   */
  function usePreview(
    id: number | null | undefined,
    enabled: boolean,
    fetchOne?: (id: number) => Promise<GallerySingleGroup>
  ) {
    const entry = useSyncExternalStore(
      subscribe,
      () => entryFor(config.defaultSize),
      () => entryFor(config.defaultSize)
    );

    useEffect(() => {
      if (!enabled) return;
      void load(config.defaultSize);
    }, [enabled]);

    const cached = id === null || id === undefined ? null : peek(id);
    const settled = entry.status === 'ready' || entry.status === 'error';

    const [state, setState] = useState<GallerySingleGroup & { loading: boolean }>({
      media: [],
      rawCount: 0,
      loading: false,
    });

    useEffect(() => {
      if (!enabled || !fetchOne) return;
      if (id === null || id === undefined) return;
      if (cached) return;
      // Wait for the grouped request: it may still answer for this id.
      if (!settled) return;

      const memoKey = `${config.name}:${id}`;
      const memo = singleCache.get(memoKey);
      if (memo) {
        setState({ ...memo, loading: false });
        return;
      }

      let cancelled = false;
      setState({ media: [], rawCount: 0, loading: true });
      (async () => {
        try {
          const result = await fetchOne(id);
          singleCache.set(memoKey, result);
          if (!cancelled) setState({ ...result, loading: false });
        } catch (err: any) {
          console.log(
            `[${config.name}] single-group fallback failed`,
            err?.response?.status ?? err?.message ?? 'network'
          );
          if (!cancelled) setState({ media: [], rawCount: 0, loading: false });
        }
      })();

      return () => {
        cancelled = true;
      };
      // fetchOne is a stable module-level function by contract.
    }, [cached, enabled, fetchOne, id, settled]);

    if (cached) {
      return {
        group: cached,
        media: cached.media,
        rawCount: cached.rawCount,
        mayHaveMore: cached.mayHaveMore,
        loading: false,
        fromCache: true,
      };
    }

    return {
      group: null,
      media: state.media,
      rawCount: state.rawCount,
      mayHaveMore: state.rawCount >= config.defaultSize,
      loading: !settled || state.loading,
      fromCache: false,
    };
  }

  /** Test/debug helper — clears one store's whole session cache. */
  function reset() {
    entries.clear();
    inFlight.clear();
    singleCache.clear();
    listeners.forEach((listener) => listener());
  }

  return { subscribe, entryFor, load, peek, useGroups, useCover, usePreview, reset };
}

export type GalleryGroupStore<TGroup extends GalleryGroupBase> = ReturnType<
  typeof createGroupStore<TGroup>
>;
