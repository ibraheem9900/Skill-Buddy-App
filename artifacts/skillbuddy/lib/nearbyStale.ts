/**
 * nearbyStale.ts
 *
 * "The provider's visibility inputs changed, so the nearby feed is stale."
 *
 * WHY A FLAG AND NOT A REFETCH: every write that can change what the feed shows
 * (adding/removing/re-activating a skill, saving or deleting the address) happens
 * on a DIFFERENT screen than the feed, and the feed is not mounted while that
 * screen is open. Firing a fetch from the writer would fetch for nobody.
 *
 * So the writer marks the flag and the feed consumes it on focus: the flag is
 * read at most once per focus, which is exactly one refresh per change, and a
 * screen the provider never returns to costs nothing.
 *
 * No React, no network: a boolean and its readers, unit-testable as is.
 */

let stale = false;

/** A change happened that the feed must re-read (skills, address). */
export function markNearbyStale(): void {
  stale = true;
}

/** Is a re-read owed? Does NOT clear it — see consumeNearbyStale. */
export function isNearbyStale(): boolean {
  return stale;
}

/** Read and clear in one step: true when a re-read is owed, and it is now spent. */
export function consumeNearbyStale(): boolean {
  const owed = stale;
  stale = false;
  return owed;
}

/** Drop the flag without acting (logout / account switch). */
export function resetNearbyStale(): void {
  stale = false;
}
