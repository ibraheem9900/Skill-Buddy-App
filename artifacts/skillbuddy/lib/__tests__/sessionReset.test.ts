/**
 * The account-switch guard: `resetUserSession()` must run EVERY registered
 * user-scoped cache reset (logout, logout-all, session expiry, login/social
 * login), must never let one broken reset strand the others, and must be safe
 * to register twice (Fast Refresh).
 *
 * The boss's bug — editing an address in one account changed another account's
 * address — was possible because module-level caches survived a logout. These
 * checks pin the contract that makes that impossible.
 */
import {
  __clearSessionResetsForTests,
  registerSessionReset,
  registeredSessionResetCount,
  resetUserSession,
} from '../sessionReset';

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

/* ── Registration ─────────────────────────────────────────────────────────── */

__clearSessionResetsForTests();
eq('a fresh registry is empty', registeredSessionResetCount(), 0);

let addressCache: { id: number; owner: string } | null = { id: 2, owner: 'account-a' };
let profileCache: string | null = 'account-a';
let walletCache: number | null = 42;

const clearAddressCache = () => {
  addressCache = null;
};
registerSessionReset(clearAddressCache);
registerSessionReset(() => {
  profileCache = null;
});
registerSessionReset(() => {
  walletCache = null;
});
eq('every cache registers once', registeredSessionResetCount(), 3);

// Fast Refresh / a module evaluated twice re-runs the same registration; the
// registry must keep ONE entry for it, not run it twice per logout.
registerSessionReset(clearAddressCache);
eq('re-registering the same function is a no-op', registeredSessionResetCount(), 3);

/* ── Logout really clears the caches ──────────────────────────────────────── */

eq('the previous account still owns data before logout', addressCache?.owner, 'account-a');
const ran = resetUserSession();
eq('all three resets ran', ran, 3);
eq('the address cache is cleared', addressCache, null);
eq('the profile cache is cleared', profileCache, null);
eq('the wallet cache is cleared', walletCache, null);

// A second logout is harmless.
eq('resetting twice is safe', resetUserSession(), 3);

/* ── One broken reset must not strand the others ──────────────────────────── */

__clearSessionResetsForTests();
let first = false;
let third = false;
registerSessionReset(() => {
  first = true;
});
registerSessionReset(() => {
  throw new Error('this cache exploded');
});
registerSessionReset(() => {
  third = true;
});
eq('a throwing reset does not abort the run', resetUserSession(), 3);
check('the reset before the failure ran', first);
check('the reset after the failure still ran', third);

/* ── The registry is the ONLY entry point AuthContext calls ───────────────── */

__clearSessionResetsForTests();
eq('clearing the registry empties it', registeredSessionResetCount(), 0);
let called = 0;
registerSessionReset(() => {
  called += 1;
});
resetUserSession();
eq('a registered reset runs on the session boundary', called, 1);

console.log(`sessionReset: ${passed} checks, ${failures.length} failure(s)`);
if (failures.length > 0) {
  throw new Error(`${failures.length} sessionReset checks failed`);
}
