import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import type { AddressCountryResponse } from '@/types';

/**
 * Countries list state (GET /api/v1/countries/ — PUBLIC, no auth):
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     list loaded (possibly empty — the API's seed data currently
 *              holds 1 country (Estonia), but empty is handled gracefully)
 *  - error     network/5xx — retryable
 *
 * RESPONSE SHAPE (live OpenAPI): a BARE array of CountryResponse
 * { id, name, iso2, iso3?, phone_code? } — no parameters, no pagination.
 *
 * CACHE DISCIPLINE (per the task spec): countries rarely change and the
 * endpoint returns the ENTIRE list in one call, so it is fetched ONCE per
 * app session into a module-level cache and every consumer (Add Address,
 * Edit Address, future signup/onboarding pickers) shares it — no
 * re-fetching across screens. A manual refresh (force) exists for retry
 * after failure; nothing auto-refetches while `ready`.
 *
 * getCountry(id) resolves a single country from the cache synchronously;
 * getById(id) is the async cache-first counterpart that falls back to ONE
 * public GET /api/v1/countries/{country_id} call (result kept in a
 * separate single-item map — the list cache is never overwritten by lone
 * lookups). Per the task rules, neither fires when a nested country
 * object is already available (e.g. from Get Address by ID) — consumers
 * pass that object straight through.
 */
export type CountriesStatus = 'idle' | 'loading' | 'ready' | 'error';

let cache: AddressCountryResponse[] | null = null;
let cacheStatus: CountriesStatus = 'idle';
/** Single-item lookups resolved outside the list cache (a lone
 * GET-by-id must NOT overwrite/poison the shared full-list cache).
 * Primed from the list whenever it loads. */
const singleCache = new Map<number, AddressCountryResponse>();

export function useCountries() {
  const [status, setStatus] = useState<CountriesStatus>(cacheStatus);
  const [countries, setCountries] = useState<AddressCountryResponse[] | null>(cache);
  const inFlight = useRef(false);

  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (!force && cacheStatus === 'ready') return; // cached — no re-fetch
    inFlight.current = true;
    setStatus('loading');
    try {
      const { data } = await authApi.getCountries();
      cache = Array.isArray(data) ? data : [];
      // Prime the single-item map so later getById() calls for these ids
      // need zero network.
      for (const country of cache) singleCache.set(country.id, country);
      cacheStatus = 'ready';
      setCountries(cache);
      setStatus('ready');
    } catch {
      cacheStatus = 'error';
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }, []);

  /**
   * GET ONE country by id (GET /api/v1/countries/{country_id} — public).
   * CACHE-FIRST (per the single-item-lookup discipline):
   *  1. single-item map (primed by any prior list load) → zero network
   *  2. cached full list → zero network
   *  3. otherwise ONE network call, result stored in the single-item map
   *     (never overwriting the list cache).
   * Returns null for not-found: 404 {"detail":"Country not found."} and
   * 422 int_parsing both verified LIVE (public endpoint) and map to null —
   * callers render a graceful fallback. Unexpected failures rethrow.
   */
  const getById = useCallback(async (countryId: number): Promise<AddressCountryResponse | null> => {
    const known = singleCache.get(countryId) ?? cache?.find((x) => x.id === countryId) ?? null;
    if (known) return known; // cached — no network at all
    try {
      const { data } = await authApi.getCountry(countryId);
      singleCache.set(countryId, data);
      return data;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404 || status === 422) return null; // verified-live not-found shapes
      throw err;
    }
  }, []);

  /** Synchronous single-country lookup from cache only — zero network,
   * null when unknown. Prefer async getById() unless rendering already-
   * loaded data (e.g. the nested country of an address response). */
  const getCountry = useCallback(
    (id: number): AddressCountryResponse | null =>
      singleCache.get(id) ?? cache?.find((x) => x.id === id) ?? null,
    [],
  );

  return { status, countries, load, refresh: () => load(true), getById, getCountry };
}

export default useCountries;
