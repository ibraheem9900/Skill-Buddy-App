/**
 * The "the provider's visibility inputs changed, so the nearby feed is stale"
 * flag (lib/nearbyStale.ts) — the bridge between the skills/address screens and
 * the feed they change. Unit-tested here because its whole contract is the
 * read-once rule: one write must cost exactly one refetch, a second focus must
 * not refetch again, and a logout must not leave a mark behind for the next
 * account.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import {
  consumeNearbyStale,
  isNearbyStale,
  markNearbyStale,
  resetNearbyStale,
} from '../nearbyStale';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(label);
}

// A fresh module starts clean.
resetNearbyStale();
check('a fresh flag is not stale', isNearbyStale() === false);
check('consuming a clean flag reports nothing owed', consumeNearbyStale() === false);

// One write → one owed re-read.
markNearbyStale();
check('a write marks the feed stale', isNearbyStale() === true);
check('the feed sees a re-read is owed', consumeNearbyStale() === true);
check('reading it once spends it (no refetch storm)', consumeNearbyStale() === false);

// Reading must not clear the flag by itself: the feed peeks before it decides.
markNearbyStale();
check('isNearbyStale reports the mark', isNearbyStale() === true);
check('isNearbyStale does NOT clear the mark', isNearbyStale() === true);
check('the mark is still owed after peeking', consumeNearbyStale() === true);

// Several writes before the feed returns cost ONE refetch.
markNearbyStale();
markNearbyStale();
markNearbyStale();
check('repeated writes still cost one refetch', consumeNearbyStale() === true);
check('and nothing after that', consumeNearbyStale() === false);

// Logout / account switch.
markNearbyStale();
resetNearbyStale();
check('a logout drops the mark without acting on it', isNearbyStale() === false);
check('the next account owes nothing', consumeNearbyStale() === false);
markNearbyStale();
check('the flag works again after a reset', consumeNearbyStale() === true);

/* ----------------------------------------------------------------- report */
for (const failure of failures) console.log(`  ✗ ${failure}`);
console.log(`nearbyStale: ${passed}/${passed + failures.length} assertions passed`);
