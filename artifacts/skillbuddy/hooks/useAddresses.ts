import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { authApi } from '@/services/api';
import type { AddressResponse, AddressCreatePayload, AddressUpdatePayload } from '@/types';
import { normalizeAddressList } from '@/lib/postAddress';
import {
  addressOwnerId,
  cacheBelongsToUser,
  confirmedAddressId,
  isAddressUsable,
} from '@/lib/addressOwnership';
import { registerSessionReset } from '@/lib/sessionReset';

/**
 * The signed-in user's saved address (GET /api/v1/addresses):
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     address loaded — or confirmed empty (address === null renders
 *              the screen's "no address yet" state)
 *  - error     network/5xx — retryable
 *
 * ── ACCOUNT SAFETY (the cross-account address bug) ────────────────────────
 * The cache is MODULE-LEVEL (there is no react-query in this app), so it used
 * to outlive a logout: account A's address — including its id — was still
 * "ready" when account B opened Address Details, and the PUT then wrote A's row
 * with B's token. Three rules now make that impossible:
 *
 *   1. every cached entry is STAMPED with the account it was read for
 *      (`cacheOwnerId`); an entry that does not belong to the signed-in account
 *      is treated as absent, never rendered, never written to;
 *   2. `update()` / `remove()` confirm the id against the CURRENT account's own
 *      server list before touching it (refetch once when the cache cannot
 *      confirm it) and throw `AddressOwnershipError` when it is not there;
 *   3. `registerSessionReset` clears the cache on logout / login / account
 *      switch (see lib/sessionReset and AuthContext.clearSession).
 *
 * RESPONSE SHAPE (live OpenAPI Schema tab): the 200 body is a SINGLE
 * AddressResponse object ($ref AddressResponse, "type": "object") — NOT an
 * array and NOT a wrapper, despite the plural endpoint name. No parameters
 * exist (token-scoped). lib/postAddress.normalizeAddressList tolerates a bare
 * array / wrapper too, and this hook keeps the first entry, so a future
 * multi-address backend needs no change here.
 *
 * Cache discipline: fetch on screen entry (caller gates on auth) +
 * pull-to-refresh via refresh(). Create/Update/Delete keep this in sync from
 * SERVER truth (no optimistic guesses) and invalidate the cache on failure.
 */
export type AddressesStatus = 'idle' | 'loading' | 'ready' | 'error';

/** A write that was refused because the id is not this account's address. */
export class AddressOwnershipError extends Error {
  reason: 'signed-out' | 'unverified' | 'not-owned';
  constructor(reason: 'signed-out' | 'unverified' | 'not-owned') {
    super(`Address not owned by the signed-in account (${reason})`);
    this.name = 'AddressOwnershipError';
    this.reason = reason;
  }
}

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
/** The account the cached row was read for (`String(user.id)`), never shared. */
let cacheOwnerId: string | null = null;
let cacheStatus: AddressesStatus = 'idle';

function clearCache(): void {
  cache = null;
  cacheOwnerId = null;
  cacheStatus = 'idle';
}

registerSessionReset(clearCache);

/** First row of whatever GET /addresses returned (see the shape note above). */
function normalizeSingle(data: unknown): AddressResponse | null {
  return normalizeAddressList(data)[0] ?? null;
}

export function useAddresses() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const ownerId = addressOwnerId(user?.id);
  const [status, setStatus] = useState<AddressesStatus>(() =>
    cacheBelongsToUser(cacheOwnerId, ownerId) ? cacheStatus : 'idle'
  );
  const [address, setAddressState] = useState<AddressResponse | null>(() =>
    cacheBelongsToUser(cacheOwnerId, ownerId) ? cache : null
  );
  const [errorMessage, setErrorMessage] = useState<TranslationKey | null>(null);
  const inFlight = useRef(false);

  /**
   * The cache is cleared on logout by lib/sessionReset, but an account SWITCH
   * inside the same process (logout is optional in some flows) can also land
   * here: as soon as the signed-in account changes, the old row is useless.
   */
  useEffect(() => {
    if (cacheBelongsToUser(cacheOwnerId, ownerId)) return;
    clearCache();
    setAddressState(null);
    setStatus('idle');
    setErrorMessage(null);
  }, [ownerId]);

  const apply = useCallback(
    (next: AddressResponse | null) => {
      cache = next;
      cacheOwnerId = ownerId;
      cacheStatus = 'ready';
      setAddressState(next);
      setStatus('ready');
    },
    [ownerId]
  );

  /**
   * POST /api/v1/addresses — creates the address from the form's payload.
   * On the confirmed 201 the SERVER-returned AddressResponse replaces the
   * cached entry (source of truth — no locally-guessed object, no client-
   * side patching: if is_default moved server-side, the next full refetch
   * shows it). On failure the cache is invalidated so the next screen entry
   * refetches fresh server state. Errors propagate to the caller for 422 field
   * mapping / offline handling.
   */
  const create = useCallback(
    async (payload: AddressCreatePayload): Promise<AddressResponse> => {
      if (!ownerId) throw new AddressOwnershipError('signed-out');
      try {
        const { data } = await authApi.createAddress(payload);
        apply(data);
        return data;
      } catch (err) {
        cacheStatus = 'idle';
        throw err;
      }
    },
    [apply, ownerId]
  );

  const load = useCallback(
    async (force = false) => {
      if (inFlight.current) return;
      if (!ownerId) {
        clearCache();
        setAddressState(null);
        setStatus('idle');
        return;
      }
      // Never serve (or extend) a row that belongs to another account.
      if (!cacheBelongsToUser(cacheOwnerId, ownerId)) {
        cache = null;
        cacheOwnerId = null;
        setAddressState(null);
      }
      if (!force && cacheStatus === 'ready' && cacheBelongsToUser(cacheOwnerId, ownerId)) return;
      inFlight.current = true;
      setStatus('loading');
      try {
        const { data } = await authApi.getAddresses();
        // The account can change while this request is in flight; discard the
        // reply rather than stamping it with the wrong owner.
        if (!cacheBelongsToUser(cacheOwnerId, ownerId) && cacheOwnerId !== null) return;
        apply(normalizeSingle(data));
      } catch {
        cacheStatus = 'error';
        setStatus('error');
        setErrorMessage('addr_err_network');
      } finally {
        inFlight.current = false;
      }
    },
    [apply, ownerId]
  );

  /**
   * GET ONE address by id (GET /api/v1/addresses/{address_id}).
   *
   * OWNERSHIP-FIRST: the cached row answers only when it is THIS account's and
   * its id matches. Otherwise the server is asked and its answer is accepted
   * only when the returned id is the requested one — a foreign id can never be
   * adopted into the cache. Returns null on 404 / mismatch (nothing to show for
   * this account), sets errorMessage on a network failure and rethrows only for
   * unexpected failures. 422 (invalid id) surfaces as not-found.
   */
  const getById = useCallback(
    async (addressId: number): Promise<AddressResponse | null> => {
      if (!ownerId) return null;
      if (isAddressUsable(cache, cacheOwnerId, ownerId, addressId)) return cache;
      try {
        const { data } = await authApi.getAddress(addressId);
        const fresh = data ?? null;
        // Refuse a row that is not the requested id (or not an address at all).
        if (!fresh || fresh.id !== addressId) return null;
        cache = fresh;
        cacheOwnerId = ownerId;
        cacheStatus = 'ready';
        return fresh;
      } catch (err: any) {
        const httpStatus = err?.response?.status;
        if (httpStatus === 404 || httpStatus === 403 || httpStatus === 422) return null;
        setErrorMessage('addr_err_network');
        throw err;
      }
    },
    [ownerId]
  );

  /**
   * Resolve the address a write may target: the cached row when it is this
   * account's and matches, otherwise ONE fresh read of this account's own list.
   * Returns null when the list does not contain the id — the caller refuses.
   */
  const confirmOwnership = useCallback(
    async (addressId: number): Promise<AddressResponse | null> => {
      if (!ownerId) throw new AddressOwnershipError('signed-out');
      if (isAddressUsable(cache, cacheOwnerId, ownerId, addressId)) return cache;
      let fresh: AddressResponse[];
      try {
        const { data } = await authApi.getAddresses();
        fresh = normalizeAddressList(data);
      } catch {
        throw new AddressOwnershipError('unverified');
      }
      if (confirmedAddressId(fresh, addressId) === null) {
        // Keep only what this account actually owns.
        cache = fresh[0] ?? null;
        cacheOwnerId = ownerId;
        cacheStatus = 'ready';
        setAddressState(cache);
        throw new AddressOwnershipError('not-owned');
      }
      const owned = fresh.find((row) => row.id === addressId) ?? null;
      cache = owned;
      cacheOwnerId = ownerId;
      cacheStatus = 'ready';
      setAddressState(owned);
      return owned;
    },
    [ownerId]
  );

  /**
   * PUT /api/v1/addresses/{address_id} — updates the address. The caller sends
   * the FULL AddressUpdate body (PUT full-replace semantics — every field
   * explicit, never a partial diff).
   *
   * The id must be confirmed against THIS account's list first (see
   * confirmOwnership): an id that cannot be confirmed is never written to, so a
   * stale id from the previous account throws `AddressOwnershipError` instead
   * of changing somebody else's address. On the confirmed 200 the SERVER
   * response replaces the cache; nothing changes on failure (no optimistic
   * update) and the cache is invalidated so the next entry refetches.
   */
  const update = useCallback(
    async (addressId: number, payload: AddressUpdatePayload): Promise<AddressResponse> => {
      await confirmOwnership(addressId);
      try {
        const { data } = await authApi.updateAddress(addressId, payload);
        apply(data);
        return data;
      } catch (err) {
        cacheStatus = 'idle';
        throw err;
      }
    },
    [apply, confirmOwnership]
  );

  /**
   * DELETE /api/v1/addresses/{address_id} — removes the address. NO optimistic
   * removal: the cached entry drops ONLY after the confirmed 204 (or a 404
   * "already gone" sync per web precedent). The id is ownership-confirmed first,
   * exactly like update().
   *
   * DEFAULT-ADDRESS EDGE (server behavior not documented — cannot be confirmed
   * without credentials): the 204 returns no content, so whether the backend
   * auto-promotes another address is only observable via a refetch. Callers get
   * back the pre-delete snapshot and MUST NOT guess — after deleting a default
   * address, let the next full refetch reveal server truth.
   */
  const remove = useCallback(
    async (addressId: number): Promise<{ wasDefault: boolean; hadAddress: boolean }> => {
      const snapshot = await confirmOwnership(addressId);
      try {
        await authApi.deleteAddress(addressId);
        if (cache && cache.id === addressId) {
          cache = null;
          cacheOwnerId = ownerId;
          cacheStatus = 'ready';
          setAddressState(null);
          setStatus('ready');
        }
        return { wasDefault: !!snapshot?.is_default, hadAddress: !!snapshot };
      } catch (err) {
        cacheStatus = 'idle';
        throw err;
      }
    },
    [confirmOwnership, ownerId]
  );

  /**
   * Local-state sync for Create/Update: the caller passes the SERVER-returned
   * AddressResponse (never a locally guessed object) and the cache is replaced
   * in place. A full refetch via refresh() stays available.
   */
  const setAddress = useCallback((next: AddressResponse) => apply(next), [apply]);

  /**
   * Local-state sync for Delete: drops the cached entry ONLY after the caller's
   * confirmed success, rendering the empty state.
   */
  const clear = useCallback(() => apply(null), [apply]);

  return {
    status,
    address,
    errorMessage,
    load,
    refresh: () => load(true),
    create,
    update,
    getById,
    remove,
    setAddress,
    clear,
    t,
  };
}

export default useAddresses;
