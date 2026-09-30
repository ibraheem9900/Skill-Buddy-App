import { useCallback, useEffect, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import type { ServiceListItem } from '@/types';

/**
 * Services-in-one-category state
 * (GET /api/v1/categories/{category_id}/services — PUBLIC per live
 * verification: no auth header needed despite the docs' lock icon).
 *
 *  - idle      not started / no category id (local-slug mode)
 *  - loading   fetch in flight
 *  - ready     array loaded (possibly EMPTY — a real server state)
 *  - invalid   422 validation error (non-integer category_id). The FastAPI
 *              `detail` array is logged to the console for debugging and the
 *              UI shows a friendly message — NEVER the raw detail.
 *  - notfound  404 {"detail":"Category not found."} (verified live) — the
 *              category itself does not exist.
 *  - error     network/timeout/5xx — retryable, SEPARATE from 422/404.
 *
 * CACHE DISCIPLINE: the list for a category rarely changes and the endpoint
 * returns the whole array in one call, so results are cached per category id
 * at module level and shared across mounts; `refresh()` force-refetches.
 * A 404/422 is deliberately NOT cached (a later retry may succeed once the
 * backend seeds the category).
 *
 * GATING: callers pass `enabled: false` (e.g. an inactive category) so no
 * request is made for a category that must not be browsed.
 *
 * Price display lives in lib/servicePrice.ts (shared with the global
 * Services catalog, which returns the same `ServiceListResponse` schema).
 */
export type CategoryServicesStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'invalid'
  | 'notfound'
  | 'error';

/** Forced-status cache keyed by category id. */
const cache = new Map<number, ServiceListItem[]>();

export function useCategoryServices(categoryId: number | null, enabled = true) {
  const [status, setStatus] = useState<CategoryServicesStatus>('idle');
  const [services, setServices] = useState<ServiceListItem[] | null>(null);
  // Monotonic run token — a newer load (or unmount) invalidates older ones.
  const seq = useRef(0);

  const load = useCallback(
    async (force = false) => {
      if (categoryId == null) return;
      const run = ++seq.current;

      const cached = cache.get(categoryId);
      if (!force && cached) {
        setServices(cached);
        setStatus('ready');
        return;
      }

      setStatus('loading');
      try {
        const { data } = await authApi.getCategoryServices(categoryId);
        if (run !== seq.current) return; // superseded / unmounted
        const list = Array.isArray(data) ? data : [];
        cache.set(categoryId, list);
        setServices(list);
        setStatus('ready');
      } catch (err: any) {
        if (run !== seq.current) return;
        const httpStatus = err?.response?.status;
        if (httpStatus === 422) {
          // FastAPI validation error: log the detail array for debugging,
          // surface a friendly message (never the raw detail) to the user.
          const detail = err?.response?.data?.detail;
          console.log(
            `[useCategoryServices] 422 validation error for category_id=${categoryId}`,
            Array.isArray(detail) ? detail : err?.response?.data
          );
          setStatus('invalid');
        } else if (httpStatus === 404) {
          setStatus('notfound'); // verified live: {"detail":"Category not found."}
        } else {
          setStatus('error'); // network / timeout / 5xx
        }
      }
    },
    [categoryId]
  );

  useEffect(() => {
    if (categoryId == null || !enabled) {
      setStatus('idle');
      setServices(null);
      return;
    }
    load();
    return () => {
      seq.current++; // invalidate any in-flight result on unmount/dep change
    };
  }, [categoryId, enabled, load]);

  return { status, services, load, refresh: () => load(true) };
}

export default useCategoryServices;
