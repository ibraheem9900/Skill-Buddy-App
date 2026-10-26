import { useCallback, useEffect, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { withRetry } from '@/lib/fetchRetry';
import type { CategoryDetailResponse, CategoryResponse } from '@/types';

/**
 * Categories state (GET /api/v1/categories — PUBLIC per live verification):
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     list loaded (possibly EMPTY — a real server state)
 *  - error     network/5xx after retries — retryable
 *
 * CACHE DISCIPLINE: categories change rarely and the endpoint returns the
 * entire list in one call, so it is fetched ONCE per app session into a
 * module-level cache and shared across every consumer.
 *
 * SAME ROOT CAUSE + SAME FIX as useServices (see that file's long comment):
 * the old early-return on `cacheStatus === 'ready'` could leave a screen's
 * LOCAL state stuck at {null, 'idle'} — which rendered the Services tab's
 * category row (and its false "0 available" header count) as if nothing had
 * loaded. Now every instance ADOPTS the module cache on focus, an empty or
 * errored cache is re-fetched, one shared in-flight promise prevents racing
 * duplicate requests, a sequence guard keeps stale responses out, and
 * failures surface as `error` — never as a stored [].
 */
export type CategoriesStatus = 'idle' | 'loading' | 'ready' | 'error';

let cache: CategoryResponse[] | null = null;
let cacheStatus: CategoriesStatus = 'idle';
/** ONE shared in-flight fetch for the whole app (all hook instances await it). */
let inFlight: Promise<void> | null = null;
/** Sequence guard: only the newest started request may write the cache. */
let seq = 0;
/** Full DETAIL records by id — a list entry can never satisfy a detail
 * view (detail adds REQUIRED is_active/status/timestamps), so these are
 * cached separately and never back-filled from the list. */
const singleCache = new Map<number, CategoryDetailResponse>();

async function fetchCategories(): Promise<CategoryResponse[]> {
  const { data } = await authApi.getCategories();
  if (!Array.isArray(data)) {
    // A 200 with a non-array body is broken — an error, not an empty list.
    throw { response: { status: 500 }, __unexpectedPayload: typeof data };
  }
  return data as CategoryResponse[];
}

export function useCategories() {
  const [status, setStatus] = useState<CategoriesStatus>(cacheStatus);
  const [categories, setCategories] = useState<CategoryResponse[] | null>(cache);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const sync = useCallback(() => {
    if (!mounted.current) return;
    setCategories(cache);
    setStatus(cacheStatus);
  }, []);

  const load = useCallback(
    async (force = false): Promise<void> => {
      if (inFlight) {
        await inFlight;
        if (!force) {
          sync();
          return;
        }
      } else if (!force && cacheStatus === 'ready') {
        sync(); // adopt the module cache into THIS instance
        if (cache !== null && cache.length > 0) return;
        // Cached EMPTY → re-check the server on focus.
      }

      setStatus('loading');
      const mySeq = ++seq;
      const run = (async () => {
        try {
          const items = await withRetry(fetchCategories, { attempts: 3, baseDelayMs: 300 });
          if (mySeq !== seq) return; // superseded — ignore the stale answer
          cache = items;
          cacheStatus = 'ready';
        } catch (err: any) {
          if (mySeq !== seq) return;
          console.log(
            '[useCategories] GET /api/v1/categories failed',
            err?.response?.status,
            err?.response?.data ?? err?.message
          );
          cacheStatus = 'error'; // never stored as []
        }
        sync();
      })();
      inFlight = run;
      try {
        await run;
      } finally {
        if (inFlight === run) inFlight = null;
      }
    },
    [sync]
  );

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
