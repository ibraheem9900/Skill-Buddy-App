/**
 * countdown.ts — the ONE countdown formatter for the whole app.
 *
 * WHY IT EXISTS: the job card used to render `MM:SS` for anything under an hour
 * and a local, differently-shaped string above it, so a job with 2h 59m 44s left
 * showed "59:44" on the card while Job Details showed "2h 59m 44s". One formatter
 * (this file) is now the single source for every surface: the client job card,
 * Job Details, the bid screen and the bids screen — they all read the timer
 * through components/CountdownTimer, which formats here.
 *
 * SPEC (product decision, matches the two screens' agreed shape):
 *   ≥ 1 day     "1d 2h 5m"      (seconds are noise at this distance)
 *   ≥ 1 hour    "2h 59m 44s"
 *   ≥ 1 minute  "59m 44s"
 *   < 1 minute  "44s"
 *   ≤ 0         ''             — the caller renders its existing "Expired" state
 *
 * It NEVER returns a negative value and never pads with leading zeros, so the
 * chip stays compact on a card.
 *
 * No React and no Date.now(): pure, so every rule below is unit-testable.
 */

/** Seconds in a day — named so the arithmetic below reads as intent, not magic. */
const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_MINUTE = 60;

/**
 * Format a remaining duration (milliseconds) for display.
 *
 * Returns '' when there is nothing meaningful left (zero, negative, NaN,
 * Infinity) — an empty string is deliberate: it cannot be mistaken for "0s
 * left", and every caller already owns an explicit expired branch.
 */
export function formatCountdown(ms: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';

  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds <= 0) return '';

  const days = Math.floor(totalSeconds / SECONDS_PER_DAY);
  const hours = Math.floor((totalSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * The countdown deadline as epoch ms from a bare API datetime string.
 *
 * WHY THIS LIVES HERE: both the list card and Job Details need a deadline, and
 * the backend returns `bidding_ends_at` WITHOUT a timezone marker. Reading those
 * digits as device-local (what `Date.parse` does) moved the deadline by the whole
 * UTC offset — in Estonia (UTC+2) the card counted down 2 hours short, which is
 * exactly the "59:44" vs "2h 59m 44s" mismatch. The digits ARE UTC, so 'Z' is
 * appended before parsing; a string that is already explicit is respected as is.
 */
export function parseApiDeadlineMs(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const parsed = Date.parse(hasZone ? trimmed : `${trimmed}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}
