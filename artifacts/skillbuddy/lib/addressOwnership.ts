/**
 * addressOwnership.ts — the pure ownership rules behind the address cache.
 *
 * WHY (boss's bug report): "I changed this address to a different account
 * profile and it got changed in another email address." The address screens
 * looked an address up by id in a cache that was not tied to an account, so the
 * id being edited could belong to somebody else. These helpers make the three
 * checks explicit and unit-testable:
 *
 *   1. a cache entry is usable ONLY when it belongs to the signed-in account;
 *   2. an address id is usable ONLY when the CURRENT account's list contains it;
 *   3. an id that cannot be confirmed is NEVER written to — the caller refetches
 *      and, if the id still is not there, refuses the write.
 *
 * No React, no network, no storage: everything here is a plain function over
 * plain values, so lib/__tests__/addressOwnership.test.ts can prove the rules
 * without a device.
 */

import type { AddressResponse } from '@/types';

/** The account key a cache/storage entry is scoped to (null = signed out). */
export function addressOwnerId(userId: number | string | null | undefined): string | null {
  if (userId === null || userId === undefined) return null;
  const value = String(userId).trim();
  return value.length > 0 ? value : null;
}

/**
 * Does a cache stamped with `cacheOwnerId` belong to the signed-in account?
 * A signed-out session owns nothing, and neither does an unstamped cache.
 */
export function cacheBelongsToUser(
  cacheOwnerId: string | null | undefined,
  ownerId: string | null | undefined
): boolean {
  if (ownerId === null || ownerId === undefined || ownerId === '') return false;
  if (cacheOwnerId === null || cacheOwnerId === undefined || cacheOwnerId === '') return false;
  return cacheOwnerId === ownerId;
}

/**
 * THE guard the bug needed: is this cached address safe to show/edit for this
 * account and this id? False → the caller must refetch (and may refuse).
 */
export function isAddressUsable(
  cache: Pick<AddressResponse, 'id'> | null | undefined,
  cacheOwnerId: string | null | undefined,
  ownerId: string | null | undefined,
  addressId: number | null | undefined
): boolean {
  if (!cache || typeof cache.id !== 'number') return false;
  if (typeof addressId !== 'number' || !Number.isInteger(addressId) || addressId < 1) return false;
  if (!cacheBelongsToUser(cacheOwnerId, ownerId)) return false;
  return cache.id === addressId;
}

/**
 * Confirm an id against a FRESH server list for the current account. Returns the
 * confirmed id, or null when the server does not list it for this user.
 */
export function confirmedAddressId(
  list: readonly Pick<AddressResponse, 'id'>[] | null | undefined,
  addressId: number | null | undefined
): number | null {
  if (!Array.isArray(list)) return null;
  if (typeof addressId !== 'number' || !Number.isInteger(addressId) || addressId < 1) return null;
  const found = list.find((row) => !!row && row.id === addressId);
  return found ? addressId : null;
}

/**
 * A per-user storage key (`base_<id>`, `base_anon` when signed out). Used for
 * local, device-side lists that must never be shared between accounts — the
 * same convention as `hiddenJobsKey` in lib/jobRemoval.
 */
export function userScopedKey(base: string, userId: number | string | null | undefined): string {
  const owner = addressOwnerId(userId);
  return `${base}_${owner ?? 'anon'}`;
}
