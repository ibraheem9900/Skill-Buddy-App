/**
 * The ownership rules that make the cross-account address bug impossible:
 * a cached row is usable only for the account it was read for, an id is
 * writable only when the CURRENT account's fresh list contains it, and every
 * device-side key is scoped to the user id.
 */
import {
  addressOwnerId,
  cacheBelongsToUser,
  confirmedAddressId,
  isAddressUsable,
  userScopedKey,
} from '../addressOwnership';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean) {
  if (ok) {
    passed += 1;
  } else {
    failures.push(label);
    console.log(`FAIL ${label}`);
  }
}

function eq<T>(label: string, actual: T, expected: T) {
  check(`${label} (got ${String(actual)}, want ${String(expected)})`, actual === expected);
}

/* ── The account key ──────────────────────────────────────────────────────── */

eq('a numeric id becomes a string key', addressOwnerId(7), '7');
eq('a string id is trimmed', addressOwnerId(' 7 '), '7');
eq('a signed-out session has no owner', addressOwnerId(null), null);
eq('an undefined user has no owner', addressOwnerId(undefined), null);
eq('a blank id has no owner', addressOwnerId('   '), null);

/* ── Cache stamping (the leak) ────────────────────────────────────────────── */

check('account A can read its own cache', cacheBelongsToUser('1', '1'));
check('account B can NOT read the cache of account A', !cacheBelongsToUser('1', '2'));
check('an unstamped cache is never trusted', !cacheBelongsToUser(null, '2'));
check('nothing belongs to a signed-out session', !cacheBelongsToUser('1', null));

const rowA = { id: 2 };
check('the right id + owner is usable', isAddressUsable(rowA, '1', '1', 2));
check(
  'the same id from another account is NOT usable',
  !isAddressUsable(rowA, '1', '2', 2)
);
check('a different id is not usable', !isAddressUsable(rowA, '1', '1', 3));
check('a missing cache is not usable', !isAddressUsable(null, '1', '1', 2));
check('a non-numeric id is not usable', !isAddressUsable(rowA, '1', '1', 0));

/* ── Confirming an id against THIS account's fresh list ───────────────────── */

const freshList = [{ id: 2 }, { id: 9 }];
eq('a listed id is confirmed', confirmedAddressId(freshList, 2), 2);
eq('an unlisted id is refused', confirmedAddressId(freshList, 5), null);
eq('an id from another account can not be confirmed', confirmedAddressId([{ id: 9 }], 2), null);
eq('no list means no confirmation', confirmedAddressId(null, 2), null);
eq('an empty list means no confirmation', confirmedAddressId([], 2), null);

/* ── Device-side keys are per user ────────────────────────────────────────── */

eq('the address key is scoped to user 1', userScopedKey('sb_addresses', 1), 'sb_addresses_1');
eq(
  'user 2 never inherits the key of user 1',
  userScopedKey('sb_addresses', 1) !== userScopedKey('sb_addresses', 2),
  true
);
eq('signed out gets its own key', userScopedKey('sb_addresses', null), 'sb_addresses_anon');

console.log(`addressOwnership: ${passed} checks, ${failures.length} failure(s)`);
if (failures.length > 0) {
  throw new Error(`${failures.length} addressOwnership checks failed`);
}
