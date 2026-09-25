import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import type { AddressRegionResponse } from '@/types';

/**
 * Counties state (List Counties + Get County by ID):
 *  - idle      not started for the requested country
 *  - loading   fetch in flight
 *  - ready     list loaded (possibly empty — handled gracefully)
 *  - error     network/5xx — retryable
 *
 * CACHE DISCIPLINE: counties are fetched PER COUNTRY (cascade pattern) and
 * cached in a module-level Map keyed by countryId, so re-opening a picker
 * for an already-loaded country needs zero network. A separate single-item
 * map serves Get-County-by-id lookups; it is primed by every list load and
 * never lets a lone lookup overwrite a list cache entry.
 *
 * CURRENTLY NO SCREEN CONSUMER (team decision documented on
 * services/api.ts getCounty): every county_id in the app already travels
 * with its name — from List Counties rows (picker selections) or the nested
 * AddressResponse.county object (address prefill). This hook is the
 * prepared-for-future layer for a bare-county_id-only scenario (e.g. a
 * deep-linked saved profile storing only the id). Its loadForCountry() is
 * also ready to replace the address screens' per-screen county state if a
 * later refactor wants a shared cache.
 */
export type CountiesStatus = 'idle' | 'loading' | 'ready' | 'error';

/** countryId → counties list (List Counties results, per-country). */
const listCache = new Map<number, AddressRegionResponse[]>();
/** countyId → county (single-item lookups; primed by list loads). */
const singleCache = new Map<number, AddressRegionResponse>();

export function useCounties() {
  const [status, setStatus] = useState<CountiesStatus>('idle');
  const [counties, setCounties] = useState<AddressRegionResponse[] | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const inFlight = useRef(false);

  /**
   * List Counties for a country (GET /api/v1/countries/{country_id}/counties
   * — public). Cached per country; only refetches on force (retry) or when
   * that country's list was never loaded this session.
   */
  const loadForCountry = useCallback(async (countryId: number, force = false) => {
    if (inFlight.current) return;
    const cached = listCache.get(countryId);
    if (!force && cached) {
      setCounties(cached);
      setLoadedFor(countryId);
      setStatus('ready');
      return;
    }
    inFlight.current = true;
    setStatus('loading');
    try {
      const { data } = await authApi.getCounties(countryId);
      const list = Array.isArray(data) ? data : [];
      listCache.set(countryId, list);
      for (const county of list) singleCache.set(county.id, county);
      setCounties(list);
      setLoadedFor(countryId);
      setStatus('ready');
    } catch {
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }, []);

  /**
   * GET ONE county by id (GET /api/v1/counties/{county_id} — public).
   * CACHE-FIRST: single-item map → per-country list caches → ONE network
   * call (stored in the single map only). Returns null for not-found —
   * 404 {"detail":"County not found."} and 422 int_parsing both verified
   * LIVE — so callers render a graceful fallback. Unexpected failures
   * rethrow.
   */
  const getById = useCallback(async (countyId: number): Promise<AddressRegionResponse | null> => {
    const known = singleCache.get(countyId);
    if (known) return known;
    for (const list of listCache.values()) {
      const hit = list.find((x) => x.id === countyId);
      if (hit) {
        singleCache.set(countyId, hit);
        return hit;
      }
    }
    try {
      const { data } = await authApi.getCounty(countyId);
      singleCache.set(countyId, data);
      return data;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404 || status === 422) return null; // verified-live shapes
      throw err;
    }
  }, []);

  /** Synchronous cache-only lookup — zero network, null when unknown. */
  const getCounty = useCallback(
    (id: number): AddressRegionResponse | null =>
      singleCache.get(id) ??
      [...listCache.values()].flatMap((l) => l).find((x) => x.id === id) ??
      null,
    [],
  );

  return { status, counties, loadedFor, loadForCountry, refresh: (countryId: number) => loadForCountry(countryId, true), getById, getCounty };
}

export default useCounties;
