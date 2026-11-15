/**
 * serverClock.ts
 *
 * The backend sends a `Date` response header on every call. Recording the
 * difference between that clock and the phone's clock lets the bidding
 * deadline resolver use SERVER time, so a device whose clock is wrong cannot
 * close a live window early or keep an expired one open.
 *
 * No React and no axios here; services/api.ts feeds the header in and the
 * status hook reads the corrected clock.
 */

let offsetMs = 0;
let lastSyncMs = 0;

/** Feed an HTTP `Date` header (and when the response reached us). */
export function recordServerDate(
  dateHeader: string | null | undefined,
  receivedAtMs: number = Date.now()
): void {
  if (typeof dateHeader !== 'string' || dateHeader.trim().length === 0) return;
  const serverMs = Date.parse(dateHeader);
  if (!Number.isFinite(serverMs)) return;
  offsetMs = serverMs - receivedAtMs;
  lastSyncMs = receivedAtMs;
}

/** Current server time in epoch ms (phone time + the last measured offset). */
export function serverNowMs(): number {
  return Date.now() + offsetMs;
}

/** The measured offset, exposed for diagnostics/tests. */
export function serverClockOffsetMs(): number {
  return offsetMs;
}

/** When the offset was last measured (0 when never). */
export function serverClockSyncedAtMs(): number {
  return lastSyncMs;
}

/** Reset for tests / a sign-out. */
export function resetServerClock(): void {
  offsetMs = 0;
  lastSyncMs = 0;
}
