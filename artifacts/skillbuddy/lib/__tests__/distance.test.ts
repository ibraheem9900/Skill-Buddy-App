import { distanceDiffersByMoreThan, formatDistance } from '../distance';
import { haversineKm } from '../coordinates';

/**
 * ONE distance formatter (boss: "8.0 km" on the feed vs "8 km" on a bid card for
 * the same accounts):
 *   < 1 km   metres, rounded to 10 m
 *   1–10 km  one decimal
 *   >= 10 km no decimals
 * plus the >10% server/client check and the haversine behind it.
 */

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function eq<T>(label: string, actual: T, expected: T) {
  if (actual === expected) passed += 1;
  else failures.push(`${label} (got ${String(actual)}, want ${String(expected)})`);
}

/* ── Metres ───────────────────────────────────────────────────────────────── */

eq('450 m', formatDistance(0.45, 'en'), '450 m');
eq('50 m', formatDistance(0.05, 'en'), '50 m');
eq('a tiny positive never becomes 0 m', formatDistance(0.004, 'en'), '10 m');
eq('a true zero is 0 m', formatDistance(0, 'en'), '0 m');
eq('metres keep the locale unit', formatDistance(0.45, 'de', { metres: 'm', kilometres: 'km' }), '450 m');

/* ── Kilometres ───────────────────────────────────────────────────────────── */

eq('1 km has one decimal', formatDistance(1, 'en'), '1.0 km');
eq('1.84 → 1.8', formatDistance(1.84, 'en'), '1.8 km');
eq('8 → 8.0 (the boss card)', formatDistance(8, 'en'), '8.0 km');
eq('a comma locale', formatDistance(8, 'et'), '8,0 km');
eq('9.99 stays one decimal', formatDistance(9.99, 'en'), '10.0 km');
eq('10 has no decimal', formatDistance(10, 'en'), '10 km');
eq('12.25 rounds to 12', formatDistance(12.25, 'en'), '12 km');
eq('1234 km is grouped', formatDistance(1234, 'en'), '1,234 km');

/* ── Missing / junk ───────────────────────────────────────────────────────── */

eq('null is empty', formatDistance(null, 'en'), '');
eq('undefined is empty', formatDistance(undefined, 'en'), '');
eq('an empty string is empty', formatDistance('', 'en'), '');
eq('NaN is empty', formatDistance(Number.NaN, 'en'), '');
eq('a negative is empty', formatDistance(-1, 'en'), '');
eq('a numeric string works', formatDistance('8', 'en'), '8.0 km');

/* ── The >10% check ───────────────────────────────────────────────────────── */

check('10% exactly is not flagged', !distanceDiffersByMoreThan(8.8, 8.0));
check('11% is flagged', distanceDiffersByMoreThan(8.9, 8.0));
check('a zero own distance flags any server value', distanceDiffersByMoreThan(0.5, 0));
check('missing values never flag', !distanceDiffersByMoreThan(null, 8));

function check(label: string, ok: boolean) {
  if (ok) passed += 1;
  else failures.push(label);
}

/* ── Haversine (the two Tallinn addresses) ────────────────────────────────── */

// Live Nominatim: 11/2 → 59.3967990, 24.6642473; 11/1 → 59.3967200, 24.6647623
const a1 = { latitude: 59.396799, longitude: 24.6642473 };
const a2 = { latitude: 59.39672, longitude: 24.6647623 };
const centre = { latitude: 59.437242, longitude: 24.7572693 };

const between = haversineKm(a1, a2);
check(`the two buildings are ~30 m apart (${Math.round(between * 1000)} m)`, between > 0.02 && between < 0.05);

const toCentre = haversineKm(centre, a1);
check(`Tallinn centre → the building is ~6.9 km (${toCentre.toFixed(2)})`, toCentre > 6.8 && toCentre < 7.0);

if (failures.length > 0) {
  console.log(`distance: ${passed} checks, ${failures.length} failure(s) — ${failures.join(', ')}`);
  throw new Error(`${failures.length} distance check(s) failed`);
}
console.log(`distance: ${passed} checks, 0 failure(s)`);
