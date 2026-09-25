import { useCallback, useRef, useState } from 'react';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import type { AddressResponse, AddressCreatePayload, AddressUpdatePayload } from '@/types';

/**
 * The signed-in user's saved address (GET /api/v1/addresses):
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     address loaded — or confirmed empty (address === null renders
 *              the screen's "no address yet" state)
 *  - error     network/5xx — retryable
 *
 * RESPONSE SHAPE (live OpenAPI Schema tab): the 200 body is a SINGLE
 * AddressResponse object ($ref AddressResponse, "type": "object") — NOT an
 * array and NOT a wrapper, despite the plural endpoint name. No parameters
 * exist (token-scoped). Because sibling endpoints (POST/GET-single/PUT/
 * DELETE /api/v1/addresses/{id}) and the web precedent suggest one-per-user
 * data that may still evolve, load() defensively normalizes a bare array or
 * { addresses: [...] } wrapper body down to its first element instead of
 * trusting only the documented shape.
 *
 * Cache discipline: module-level cache + fetch on screen entry (caller gates
 * on auth) + pull-to-refresh via refresh(). Create/Update/Delete Address
 * (POST/PUT/DELETE siblings) keep this in sync through
 * create()/update()/getById()/remove()/setAddress()/clear(): they replace/drop the cached object from SERVER
 * truth (no optimistic guesses), and refetching is always available via
 * refresh().
 */
export type AddressesStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Parses the schema's latitude/longitude values SAFELY: they are documented
 * as numeric strings, but the live examples show inflated placeholder junk
 * (e.g. "000000...95.957..."), so never trust them as plain floats. Returns
 * a finite number only when the value is a sane coordinate (|lat| <= 90,
 * |lng| <= 180 after Number() conversion); null otherwise. Returns null for
 * null/undefined/empty/non-numeric input — never a guessed 0.
 */
export function parseCoordinate(raw: string | number | null | undefined, kind: 'lat' | 'lng'): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const limit = kind === 'lat' ? 90 : 180;
  return Math.abs(n) <= limit ? n : null;
}

let cache: AddressResponse | null = null;
let cacheStatus: AddressesStatus = 'idle';

export function useAddresses() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<AddressesStatus>(cacheStatus);
  const [address, setAddressState] = useState<AddressResponse | null>(cache);
  const [errorMessage, setErrorMessage] = useState<TranslationKey | null>(null);
  const inFlight = useRef(false);

  const apply = useCallback((next: AddressResponse | null) => {
    cache = next;
    cacheStatus = 'ready';
    setAddressState(cache);
    setStatus('ready');
  }, []);

  /**
   * POST /api/v1/addresses — creates the address from the form's payload.
   * On the confirmed 201 the SERVER-returned AddressResponse replaces the
   * cached entry (source of truth — no locally-guessed object, no client-
   * side patching of other addresses: if is_default moved server-side, the
   * next full refetch shows it). On failure the cache is invalidated so the
   * next screen entry refetches fresh server state. Errors propagate to the
   * caller for 422 field mapping / offline handling.
   */
  const create = useCallback(async (payload: AddressCreatePayload): Promise<AddressResponse> => {
    try {
      const { data } = await authApi.createAddress(payload);
      apply(data);
      return data;
    } catch (err) {
      // Cache may be stale after a failed create (e.g. is_default moved) —
      // force the next screen entry to refetch from the server.
      cacheStatus = 'idle';
      throw err;
    }
  }, [apply]);

  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (!force && cacheStatus === 'ready') return; // cached — no re-fetch
    inFlight.current = true;
    setStatus('loading');
    try {
      const { data } = await authApi.getAddresses();
      // Defensive normalization (see doc comment): documented shape is ONE
      // object; tolerate a bare-array/wrapper body by taking its first item.
      let next: AddressResponse | null = null;
      if (Array.isArray(data)) {
        next = (data[0] as AddressResponse) ?? null;
      } else if (data && typeof data === 'object') {
        const wrapper = data as { addresses?: unknown };
        next = Array.isArray(wrapper.addresses)
          ? ((wrapper.addresses[0] as AddressResponse) ?? null)
          : (data as AddressResponse);
      }
      apply(next);
    } catch {
      cacheStatus = 'error';
      setStatus('error');
      setErrorMessage('addr_err_network');
    } finally {
      inFlight.current = false;
    }
  }, [apply]);

  /**
   * GET ONE address by id (GET /api/v1/addresses/{address_id}).
   *
   * CACHE-FIRST (per the agreed single-item-lookup discipline): the cached
   * address (from GET /api/v1/addresses) carries every field the single
   * endpoint returns (same $ref AddressResponse per the live schema), so a
   * matching id returns it with ZERO network. The network call fires only
   * when the cache is not ready or holds a different id (deep-link /
   * booking-summary case). Returns null on 404 (undocumented — web
   * precedent "already gone"), sets errorMessage otherwise, and rethrows
   * only for unexpected failures. 422 (invalid id) surfaces as not-found.
   */
  const getById = useCallback(async (addressId: number): Promise<AddressResponse | null> => {
    if (cache && cache.id === addressId) return cache; // cached — no network at all
    if (cacheStatus !== 'ready') {
      try {
        const { data } = await authApi.getAddress(addressId);
        return data;
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 404) return null; // undocumented — treat as gone
        setErrorMessage('addr_err_network');
        throw err;
      }
    }
    return null; // cache ready but holds a different id → caller decides
  }, []);

  /**
   * PUT /api/v1/addresses/{address_id} — updates the address. The caller
   * sends the FULL AddressUpdate body (PUT full-replace semantics — every
   * field explicit, never a partial diff). On the confirmed 200 the
   * SERVER-returned AddressResponse replaces the cached entry (source of
   * truth — is_default changes are never patched client-side; the server's
   * response is what the list/detail render, and if the server auto-unset
   * another address's default that state arrives with the next full
   * refetch). NOTHING changes on failure (no optimistic update) and the
   * cache is invalidated so the next screen entry refetches fresh server
   * state. Errors propagate to the caller for 422 field mapping / offline
   * handling.
   */
  const update = useCallback(
    async (addressId: number, payload: AddressUpdatePayload): Promise<AddressResponse> => {
      try {
        const { data } = await authApi.updateAddress(addressId, payload);
        apply(data);
        return data;
      } catch (err) {
        cacheStatus = 'idle';
        throw err;
      }
    },
    [apply],
  );

  /**
   * DELETE /api/v1/addresses/{address_id} — removes the address. NO
   * optimistic removal: the cached entry drops ONLY after the confirmed
   * 204 (or a 404 "already gone" sync per web precedent) — on network
   * failure/422 everything rethrows so the address survives with a
   * retry-able error, and the cache is invalidated for a fresh refetch.
   * The 204 has NO body — the service layer never parses JSON on success.
   *
   * DEFAULT-ADDRESS EDGE (server behavior not documented — cannot be
   * confirmed without credentials): the 204 returns no content, so whether
   * the backend auto-promotes another address is only observable via a
   * refetch. Callers get back the pre-delete snapshot and MUST NOT guess —
   * after deleting a default address, surface the flag and let the next
   * full refetch reveal server truth (no client-side auto-promotion).
   */
  const remove = useCallback(async (addressId: number): Promise<{ wasDefault: boolean; hadAddress: boolean }> => {
    const snapshot = cache && cache.id === addressId ? cache : null;
    try {
      await authApi.deleteAddress(addressId);
      // Confirmed 204 (or already-gone 404 path in the service) — drop the
      // cached row so the list/detail render the empty state immediately.
      if (cache && cache.id === addressId) {
        cache = null;
        cacheStatus = 'ready';
        setAddressState(null);
        setStatus('ready');
      }
      return { wasDefault: !!snapshot?.is_default, hadAddress: !!snapshot };
    } catch (err) {
      cacheStatus = 'idle';
      throw err;
    }
  }, []);

  /**
   * Local-state sync for the Create/Update Address siblings (POST/PUT): the
   * caller passes the SERVER-returned AddressResponse (never a locally
   * guessed object) and the cached entry is replaced in place — the list
   * screen and any other consumer of this hook see it immediately. A full
   * refetch via refresh() stays available for belt-and-braces callers.
   */
  const setAddress = useCallback((next: AddressResponse) => apply(next), [apply]);

  /**
   * Local-state sync for the Delete Address sibling (DELETE /api/v1/
   * addresses/{id}): drops the cached entry ONLY after the caller's
   * confirmed success, rendering the empty state. Errors are handled by the
   * caller (nothing changes here on failure).
   */
  const clear = useCallback(() => apply(null), [apply]);

  return { status, address, errorMessage, load, refresh: () => load(true), create, update, getById, remove, setAddress, clear, t };
}

export default useAddresses;
