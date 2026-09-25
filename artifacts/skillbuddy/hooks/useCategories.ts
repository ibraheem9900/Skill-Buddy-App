import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import type { CategoryDetailResponse, CategoryResponse } from '@/types';

/**
 * Categories state (GET /api/v1/categories — PUBLIC per live verification):
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     list loaded (possibly EMPTY — the backend currently has no
 *              seeded categories; empty is a real server state here)
 *  - error     network/5xx — retryable
 *
 * CACHE DISCIPLINE: categories change rarely and the endpoint returns the
 * entire list in one call, so it is fetched ONCE per app session into a
 * module-level cache and shared across every consumer — no re-fetching
 * across screens; refresh() exists for pull-to-refresh / retry.
 *
 * EMPTY-LIST FALLBACK: while the API returns [], the categories screen
 * renders the curated local grid (mockData CATEGORIES) so the product
 * keeps working; server data replaces it the moment the backend seeds
 * categories. The screen decides the fallback — the hook reports states.
 */
export type CategoriesStatus = 'idle' | 'loading' | 'ready' | 'error';

let cache: CategoryResponse[] | null = null;
let cacheStatus: CategoriesStatus = 'idle';
/** Full DETAIL records by id — a list entry can never satisfy a detail
 * view (detail adds REQUIRED is_active/status/timestamps), so these are
 * cached separately and never back-filled from the list. */
const singleCache = new Map<number, CategoryDetailResponse>();

export function useCategories() {
  const [status, setStatus] = useState<CategoriesStatus>(cacheStatus);
  const [categories, setCategories] = useState<CategoryResponse[] | null>(cache);
  const inFlight = useRef(false);

  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (!force && cacheStatus === 'ready') return; // cached — no re-fetch
    inFlight.current = true;
    setStatus('loading');
    try {
      const { data } = await authApi.getCategories();
      cache = Array.isArray(data) ? data : [];
      cacheStatus = 'ready';
      setCategories(cache);
      setStatus('ready');
    } catch {
      cacheStatus = 'error';
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }, []);

  /**
   * GET ONE category by id (GET /api/v1/categories/{category_id} — public).
   * CACHE-FIRST over full detail records ONLY: singleCache → ONE network
   * call → stored in singleCache. The list cache is deliberately NOT used
   * to answer detail lookups (its items lack the required is_active/status
   * gating fields). Returns null for not-found — 404
   * {"detail":"Category not found."} and 422 int_parsing both verified
   * LIVE — so callers render a graceful not-found/fallback. Unexpected
   * failures rethrow.
   */
  const getById = useCallback(async (categoryId: number): Promise<CategoryDetailResponse | null> => {
    const known = singleCache.get(categoryId);
    if (known) return known; // cached — no network at all
    try {
      const { data } = await authApi.getCategory(categoryId);
      singleCache.set(categoryId, data);
      return data;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404 || status === 422) return null; // verified-live shapes
      throw err;
    }
  }, []);

  return { status, categories, load, refresh: () => load(true), getById };
}

export default useCategories;
