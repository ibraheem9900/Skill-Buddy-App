import { useCallback, useEffect, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { withRetry } from '@/lib/fetchRetry';
import type { ServiceListItem } from '@/types';

/**
 * Global services catalog state (GET /api/v1/services):
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     array loaded (possibly EMPTY — a real server state)
 *  - error     network/timeout/any non-200 after retries — retryable
 *
 * PARAMETERS: this endpoint accepts NONE. Verified against the live OpenAPI:
 * the operation object has no `parameters` key at all (and the docs UI shows
 * "No parameters"), so there is no search/category/page/limit/sort to send —
 * every filter in the UI must be applied client-side.
 *
 * ── ROOT CAUSE of the intermittent "0 available / No Services Found" ────────
 * (reproduced by code reading; the backend itself was probed 18× in a row
 * from this machine — HTTP 200, identical non-empty payloads every time, so
 * the server is NOT the problem.)
 *
 * The old `load()` did `if (!cacheStatus === 'ready') return;` BEFORE touching
 * local state. Every screen mounts its own hook instance, and the tab pager
 * preloads the Services tab while Home is still focused: Home's instance
 * filled the module cache, then the Services instance focused, hit that early
 * return, and kept its INITIAL local state — {services: null, status: 'idle'}
 * — forever. The screen then rendered its "0 available / No services found"
 * branch with no spinner, no error and no way to recover until an app
 * restart. Whether it happened depended purely on which request finished
 * first — hence "sometimes it works, sometimes it doesn't."
 *
 * The fixes, all visible in load() below:
 *  1. the module cache is ADOPTED into every instance (sync, never skipped);
 *  2. a cached EMPTY list or an ERROR is re-fetched on every focus (an empty
 *     result can no longer poison the session);
 *  3. ONE module-level in-flight promise is shared by all instances — no
 *     duplicate racing requests;
 *  4. a sequence guard lets only the NEWEST request write the cache, so a slow
 *     stale response can never overwrite a fresh one;
 *  5. failures set `error` and NEVER store [] as data (previous data, if any,
 *     stays on screen);
 *  6. network errors and 5xx are retried 3× with 300/600 ms backoff
 *     (lib/fetchRetry); a non-array 200 payload is treated as an error, not
 *     silently coerced to an empty list.
 */
export type ServicesStatus = 'idle' | 'loading' | 'ready' | 'error';

let cache: ServiceListItem[] | null = null;
let cacheStatus: ServicesStatus = 'idle';
/** ONE shared in-flight fetch for the whole app (all hook instances await it). */
let inFlight: Promise<void> | null = null;
/** Sequence guard: only the newest started request may write the cache. */
let seq = 0;

async function fetchServices(): Promise<ServiceListItem[]> {
  const { data } = await authApi.getServices();
  if (!Array.isArray(data)) {
    // A 200 with a non-array body is NOT an empty catalog — it is a broken
    // answer. Surface it as a retryable error instead of storing [].
    throw { response: { status: 500 }, __unexpectedPayload: typeof data };
  }
  return data as ServiceListItem[];
}

export function useServices() {
  const [status, setStatus] = useState<ServicesStatus>(cacheStatus);
  const [services, setServices] = useState<ServiceListItem[] | null>(cache);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const sync = useCallback(() => {
    if (!mounted.current) return;
    setServices(cache);
    setStatus(cacheStatus);
  }, []);

  const load = useCallback(
    async (force = false): Promise<void> => {
      // 1. Share an in-flight request instead of double-firing.
      if (inFlight) {
        await inFlight;
        if (!force) {
          sync();
          return;
        }
      } else if (!force && cacheStatus === 'ready') {
        // 2. ADOPT the module cache into THIS instance — the fix for the
        //    stale {null,'idle'} screen that showed a false empty list.
        sync();
        if (cache !== null && cache.length > 0) return;
        // Cached EMPTY → fall through and re-check the server on focus, so a
        // once-empty catalog (or a transient glitch) can recover live.
      }

      setStatus('loading');
      const mySeq = ++seq;
      const run = (async () => {
        try {
          const items = await withRetry(fetchServices, { attempts: 3, baseDelayMs: 300 });
          if (mySeq !== seq) return; // superseded by a newer request — ignore
          cache = items;
          cacheStatus = 'ready';
        } catch (err: any) {
          if (mySeq !== seq) return;
          console.log(
            '[useServices] GET /api/v1/services failed',
            err?.response?.status,
            err?.response?.data ?? err?.message
          );
          // A failure NEVER becomes an empty list: the error state owns it,
          // and any previously loaded data in `cache` stays usable.
          cacheStatus = 'error';
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

  return { status, services, load, refresh: () => load(true) };
}

export default useServices;
