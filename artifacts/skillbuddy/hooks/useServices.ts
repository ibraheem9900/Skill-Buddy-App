import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import type { ServiceListItem } from '@/types';

/**
 * Global services catalog state (GET /api/v1/services):
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     array loaded (possibly EMPTY — the backend currently has no
 *              seeded services, so empty is a real server state here)
 *  - error     network/timeout/any non-200 — retryable
 *
 * PARAMETERS: this endpoint accepts NONE. Verified against the live OpenAPI:
 * the operation object has no `parameters` key at all (and the docs UI shows
 * "No parameters"), so there is no search/category/page/limit/sort to send —
 * every filter in the UI must be applied client-side.
 *
 * ERRORS: only a 200 response is documented (no 422, no 404), and a request
 * with no inputs cannot fail validation — so there is deliberately no
 * separate 422 state here, unlike the category-services endpoint. Any
 * non-2xx/network failure maps to the single retryable `error` state, with
 * the server detail logged to the console for debugging.
 *
 * CACHE DISCIPLINE: the catalog is fetched ONCE per app session into a
 * module-level cache and shared across consumers; `refresh()` force-refetches
 * for pull-to-refresh/retry. The Services tab falls back to the curated local
 * list while the API returns [] — the screen decides the fallback, this hook
 * only reports states (mirrors useCategories).
 */
export type ServicesStatus = 'idle' | 'loading' | 'ready' | 'error';

let cache: ServiceListItem[] | null = null;
let cacheStatus: ServicesStatus = 'idle';

export function useServices() {
  const [status, setStatus] = useState<ServicesStatus>(cacheStatus);
  const [services, setServices] = useState<ServiceListItem[] | null>(cache);
  const inFlight = useRef(false);

  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (!force && cacheStatus === 'ready') return; // cached — no re-fetch
    inFlight.current = true;
    setStatus('loading');
    try {
      const { data } = await authApi.getServices();
      cache = Array.isArray(data) ? data : [];
      cacheStatus = 'ready';
      setServices(cache);
      setStatus('ready');
    } catch (err: any) {
      console.log(
        '[useServices] GET /api/v1/services failed',
        err?.response?.status,
        err?.response?.data ?? err?.message
      );
      cacheStatus = 'error';
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }, []);

  return { status, services, load, refresh: () => load(true) };
}

export default useServices;
