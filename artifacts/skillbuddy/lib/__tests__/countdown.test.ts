import { formatCountdown, parseApiDeadlineMs } from '../countdown';

/**
 * The shared countdown formatter — the exact cases the product spec names:
 *   3h, 2h59m44s, 1h, 59m44s, 44s, 0, negative, more than 24h.
 *
 * Plus the timezone rule that caused the on-device mismatch: the backend's
 * `bidding_ends_at` has NO zone marker, so its digits are UTC. Read as device
 * local, the card counted down 2 hours short (Estonia, UTC+2) while Job Details
 * — which parses the same string as UTC — showed the full 2h 59m 44s.
 */

declare const console: { log: (msg: string) => void };
declare const process: { exitCode: number };

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean) {
  if (ok) {
    passed += 1;
  } else {
    failures.push(label);
  }
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* ── The named spec cases ─────────────────────────────────────────────────── */

check('3 hours', formatCountdown(3 * HOUR) === '3h 0m 0s');
check('2h 59m 44s', formatCountdown(2 * HOUR + 59 * MINUTE + 44 * SECOND) === '2h 59m 44s');
check('1 hour', formatCountdown(HOUR) === '1h 0m 0s');
check('59m 44s', formatCountdown(59 * MINUTE + 44 * SECOND) === '59m 44s');
check('44s', formatCountdown(44 * SECOND) === '44s');
check('0 → empty (caller shows Expired)', formatCountdown(0) === '');
check('negative → empty (never a minus sign)', formatCountdown(-5 * MINUTE) === '');
check('more than 24h → days', formatCountdown(DAY + 2 * HOUR + 5 * MINUTE) === '1d 2h 5m');
check('exactly 24h → days', formatCountdown(DAY) === '1d 0h 0m');
check('48h+ → 2d', formatCountdown(2 * DAY + 3 * HOUR + 9 * MINUTE) === '2d 3h 9m');

/* ── Boundaries ───────────────────────────────────────────────────────────── */

check('just under an hour stays in minutes', formatCountdown(HOUR - SECOND) === '59m 59s');
check('exactly one minute', formatCountdown(MINUTE) === '1m 0s');
check('just under a minute stays in seconds', formatCountdown(MINUTE - SECOND) === '59s');
check('exactly one second', formatCountdown(SECOND) === '1s');
check('sub-second → empty (no "0s" flicker claim)', formatCountdown(400) === '');
check('NaN → empty', formatCountdown(Number.NaN) === '');
check('Infinity → empty', formatCountdown(Number.POSITIVE_INFINITY) === '');
check('non-number → empty', formatCountdown('2h' as unknown as number) === '');

/* Never negative, never padded, never a raw ms value. */
const samples = [3 * HOUR, 2 * HOUR + 59 * MINUTE + 44 * SECOND, 59 * MINUTE, 44 * SECOND, 900];
check(
  'no negative output anywhere',
  samples.every((ms) => !formatCountdown(ms).includes('-'))
);
check(
  'no zero-padded units',
  samples.every((ms) => !/\b0\d/.test(formatCountdown(ms)))
);
check('a full countdown ticks to a different string one second later',
  formatCountdown(2 * HOUR + 59 * MINUTE + 44 * SECOND) !==
    formatCountdown(2 * HOUR + 59 * MINUTE + 43 * SECOND));

/* ── The UTC parse rule (the real on-device bug) ──────────────────────────── */

const MARKERLESS = '2026-10-27T18:00:00';
const parsed = parseApiDeadlineMs(MARKERLESS);
check('marker-less datetime parses', parsed !== null);
check(
  'marker-less datetime is read as UTC',
  parsed === Date.UTC(2026, 9, 27, 18, 0, 0)
);
check(
  'an explicit Z is respected',
  parseApiDeadlineMs(`${MARKERLESS}Z`) === Date.UTC(2026, 9, 27, 18, 0, 0)
);
check(
  'an explicit offset is respected',
  parseApiDeadlineMs('2026-10-27T20:00:00+02:00') === Date.UTC(2026, 9, 27, 18, 0, 0)
);
check('empty string → null', parseApiDeadlineMs('') === null);
check('null → null', parseApiDeadlineMs(null) === null);
check('undefined → null', parseApiDeadlineMs(undefined) === null);
check('garbage → null', parseApiDeadlineMs('not-a-date') === null);

/**
 * The regression itself, stated as an assertion: 2h 59m 44s left must format
 * with the hours — never as "59:44" (the card's old MM:SS shape).
 */
const remaining = 2 * HOUR + 59 * MINUTE + 44 * SECOND;
const cardText = formatCountdown(remaining);
check('the card shows the hours', cardText === '2h 59m 44s');
check('the card never shows bare MM:SS', !/^\d{2}:\d{2}$/.test(cardText));

if (failures.length > 0) {
  console.log(`countdown: ${passed} checks, ${failures.length} failure(s) — ${failures.join(', ')}`);
  throw new Error(`${failures.length} countdown check(s) failed`);
} else {
  console.log(`countdown: ${passed} checks, 0 failure(s)`);
}
