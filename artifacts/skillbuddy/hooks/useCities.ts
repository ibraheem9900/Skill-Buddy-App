import { useCallback, useState } from 'react';
import { authApi } from '@/services/api';
import type { AddressRegionResponse } from '@/types';

/**
 * Cities state (Get City by ID — prepared-for-future helper):
 *
 * CURRENTLY NO SCREEN CONSUMER (decision documented on services/api.ts
 * getCity): every city_id in the app already travels with its name — from
 * List Cities rows (picker selections) or the nested AddressResponse.city
 * object (address prefill). This hook is the prepared-for-future layer for
 * a bare-city_id-only scenario (e.g. a deep-linked saved profile storing
 * only the id).
 *
 * CACHE DISCIPLINE (mirrors useCounties): a per-county Map caches List
 * Cities results; a separate single-item map serves by-id lookups, primed
 * by any list load and never overwriting a list cache entry.
 *
 * getById(id) is CACHE-FIRST: single-item map → per-county list caches →
 * ONE public network call (result stored outside the list caches). Returns
 * null for not-found — 404 {"detail":"City not found."} and 422
 * int_parsing both verified LIVE (public endpoint) — so future callers
 * render a graceful fallback. Unexpected failures rethrow.
 */
const listCache = new Map<number, AddressRegionResponse[]>();
const singleCache = new Map<number, AddressRegionResponse>();

export function useCities() {
  /** Cities of the county the caller last requested (null = none). */
  const [cities, setCities] = useState<AddressRegionResponse[] | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  /** List Cities for a county (GET /api/v1/counties/{county_id}/cities —
   * public), served from the per-county cache when known. The address
   * screens manage their own cascade state today; this exists for future
   * consumers that want a shared cache. */
  const loadForCounty = useCallback(async (countyId: number) => {
    const cached = listCache.get(countyId);
    if (cached) {
      setCities(cached);
      setLoadedFor(countyId);
      return;
    }
    const { data } = await authApi.getCities(countyId);
    const list = Array.isArray(data) ? data : [];
    listCache.set(countyId, list);
    for (const city of list) singleCache.set(city.id, city);
    setCities(list);
    setLoadedFor(countyId);
  }, []);

  /** GET ONE city by id (public) — cache-first, null on 404/422 (verified
   * live), rethrows unexpected failures. */
  const getById = useCallback(async (cityId: number): Promise<AddressRegionResponse | null> => {
    const known = singleCache.get(cityId);
    if (known) return known;
    for (const list of listCache.values()) {
      const hit = list.find((x) => x.id === cityId);
      if (hit) {
        singleCache.set(cityId, hit);
        return hit;
      }
    }
    try {
      const { data } = await authApi.getCity(cityId);
      singleCache.set(cityId, data);
      return data;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404 || status === 422) return null; // verified-live shapes
      throw err;
    }
  }, []);

  /** Synchronous cache-only lookup — zero network, null when unknown. */
  const getCity = useCallback(
    (id: number): AddressRegionResponse | null =>
      singleCache.get(id) ??
      [...listCache.values()].flatMap((l) => l).find((x) => x.id === id) ??
      null,
    [],
  );

  return { cities, loadedFor, loadForCounty, getById, getCity };
}

export default useCities;
