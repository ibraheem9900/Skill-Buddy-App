import { useCallback, useRef, useState } from 'react';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import { SERVICES } from '@/data/mockData';
import type { FavoriteItemResponse, Service } from '@/types';

/**
 * Client favorites state (GET /api/v1/clients/favorites):
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     list loaded (possibly empty — the screen renders the
 *              "no favorites yet" state for an empty array)
 *  - error     network/5xx — retryable
 *
 * READ-ONLY list, kept separate from every other cache. Each item carries
 * ONLY { id, service_id, notes?, created_at } per the OpenAPI schema — the
 * service's title/price/image are joined CLIENT-SIDE against the local
 * services catalog (SERVICES). No per-favorite "Get Service by ID" calls are
 * made (spec: avoid N individual calls when the list is available); a
 * favorite whose service_id has no catalog match renders a neutral fallback
 * row instead of being dropped.
 *
 * Cache discipline: module-level cache + fetch on screen entry (caller gates
 * on role/auth) + pull-to-refresh via refresh().
 */
export type ClientFavoritesStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Local-catalog id convention ('s12') → numeric backend service_id. */
export function catalogIdToServiceId(id: string): number | null {
  const n = Number(String(id).replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Join one favorite with its local-catalog service (may be null → fallback UI). */
export function joinFavoriteWithService(favorite: FavoriteItemResponse): {
  favorite: FavoriteItemResponse;
  service: Service | null;
} {
  const service =
    SERVICES.find((s) => catalogIdToServiceId(s.id) === favorite.service_id) ?? null;
  return { favorite, service };
}

let cache: FavoriteItemResponse[] = [];
let cachedTotal = 0;
let cacheStatus: ClientFavoritesStatus = 'idle';

export function useClientFavorites() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<ClientFavoritesStatus>(cacheStatus);
  const [favorites, setFavorites] = useState<FavoriteItemResponse[]>(cache);
  const [total, setTotal] = useState(cachedTotal);
  const [errorMessage, setErrorMessage] = useState<TranslationKey | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (!force && cacheStatus === 'ready') return; // cached — no re-fetch
    inFlight.current = true;
    setStatus('loading');
    try {
      const { data } = await authApi.getClientFavorites();
      cache = Array.isArray(data?.favorites) ? data.favorites : [];
      cachedTotal = typeof data?.total === 'number' ? data.total : cache.length;
      cacheStatus = 'ready';
      setFavorites(cache);
      setTotal(cachedTotal);
      setStatus('ready');
    } catch {
      cacheStatus = 'error';
      setStatus('error');
      setErrorMessage('cf_err_network');
    } finally {
      inFlight.current = false;
    }
  }, []);

  /**
   * POST /api/v1/clients/favorites — save a service. Dedupes against the
   * cached list first (a known-saved service never triggers a pointless
   * duplicate POST). The 200 response returns no favorite id, so on success
   * the list is re-fetched to learn real ids and stay in sync. Duplicate
   * adds that still slip through a stale cache are treated as success per
   * the web app's precedent (web treats "already/duplicate" as a no-op);
   * genuinely invalid service_id (422) and network failures rethrow so the
   * caller can revert its optimistic UI.
   */
  const addFavorite = useCallback(async (serviceId: number): Promise<void> => {
    if (cache.some((f) => f.service_id === serviceId)) return; // already saved
    try {
      await authApi.addClientFavorite(serviceId);
    } catch (err: any) {
      const body = JSON.stringify(err?.response?.data ?? '');
      const duplicate =
        err?.response?.status === 422 && /already|duplicate/i.test(body);
      if (!duplicate) throw err;
      console.warn('[favorites] duplicate add treated as saved:', serviceId);
    }
    await load(true); // re-sync list (learn the new entry's real id)
  }, [load]);

  /**
   * PATCH /api/v1/clients/favorites/{favorite_id} — update a favorite's
   * notes. The 200 response replaces the cached list item (source of truth,
   * not a local merge); if the list hasn't loaded this record yet, the
   * updated record is appended so both screens stay in sync. Rethrows so
   * the caller can show field-specific errors; no optimistic update — the
   * cache only changes after confirmed success.
   */
  const updateFavoriteNotes = useCallback(async (favoriteId: number, notes: string | null): Promise<FavoriteItemResponse> => {
    const { data } = await authApi.updateClientFavorite(favoriteId, notes);
    const idx = cache.findIndex((f) => f.id === data.id);
    const next = idx >= 0 ? cache.map((f) => (f.id === data.id ? data : f)) : [...cache, data];
    cache = next;
    cachedTotal = Math.max(cachedTotal, cache.length);
    cacheStatus = 'ready';
    setFavorites(cache);
    setTotal(cachedTotal);
    return data;
  }, []);

  /**
   * DELETE /api/v1/clients/favorites/{favorite_id} — remove a favorite.
   * No optimistic removal: the cache changes only after the confirmed 204
   * (or a 404, treated as already-removed per web precedent so stale rows
   * still clear). Rethrows everything else so the caller keeps the row and
   * can offer a retry.
   */
  const removeFavorite = useCallback(async (favoriteId: number): Promise<void> => {
    try {
      await authApi.deleteClientFavorite(favoriteId); // 204 — no body to parse
    } catch (err: any) {
      if (err?.response?.status !== 404) throw err; // 404 → already gone; sync below
    }
    cache = cache.filter((f) => f.id !== favoriteId);
    cachedTotal = Math.max(0, cachedTotal - 1);
    setFavorites(cache);
    setTotal(cachedTotal);
  }, []);

  return { status, favorites, total, errorMessage, load, refresh: () => load(true), addFavorite, updateFavoriteNotes, removeFavorite, t };
}

export default useClientFavorites;
