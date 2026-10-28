/**
 * sessionReset.ts — the ONE place every user-scoped in-memory cache is cleared.
 *
 * THE BUG THIS EXISTS FOR (reported by the boss): editing an address in one
 * account changed the address of ANOTHER account. The app keeps its fetched
 * user data in module-level caches (there is no react-query here), and those
 * caches outlive a logout: `hooks/useAddresses` held `{ id: 2, … }` for account
 * A, the next account opened "Address Details" for id 2, the cache answered,
 * and the PUT went to A's row with B's token.
 *
 * FIX: every module that caches user-scoped data exports a reset and REGISTERS
 * it here at import time. `AuthContext.clearSession()` (logout, logout-all,
 * session expiry, realtime auth failure) and `login()`/`socialLogin()` call
 * `resetUserSession()`, so a new session can never read the previous one's
 * cache. AuthContext imports only this module — never the hooks — which keeps
 * the provider free of import cycles.
 *
 * One failing reset must never keep the others from running: a stale cache is
 * exactly what we are here to prevent, so each reset is isolated.
 */

export type SessionReset = () => void;

const resets: SessionReset[] = [];

/**
 * Register a cache reset. Called once, at module load, by every module that
 * owns user-scoped module state (see the `registerSessionReset` call sites).
 * Re-registering the same function is a no-op (Fast Refresh safe).
 */
export function registerSessionReset(reset: SessionReset): void {
  if (typeof reset !== 'function') return;
  if (resets.indexOf(reset) !== -1) return;
  resets.push(reset);
}

/**
 * Run every registered reset. Returns how many ran (tests assert on it), and
 * swallows individual failures so one broken cache cannot leave the rest of the
 * previous account's data behind.
 */
export function resetUserSession(): number {
  const snapshot = resets.slice();
  let ran = 0;
  for (const reset of snapshot) {
    // Counted as run even if it throws: it was attempted, and the rest must
    // still run so no cache of the previous account survives the switch.
    ran += 1;
    try {
      reset();
    } catch {
      // Isolated on purpose — one broken cache cannot strand the others.
    }
  }
  return ran;
}

/** How many resets are registered (used by the session test). */
export function registeredSessionResetCount(): number {
  return resets.length;
}

/** Test-only: forget every registration (the harness re-imports modules). */
export function __clearSessionResetsForTests(): void {
  resets.length = 0;
}
