/**
 * distance.ts — ONE formatter for every distance the app shows.
 *
 * Boss (screenshot): the provider's Available jobs card read "8.0 km" while the
 * client's bid card read "8 km" for the same pair of accounts. Both numbers come
 * from the SERVER (`distance_km`); neither screen computed anything, but the two
 * screens formatted the same field differently (one always showed a decimal, the
 * other dropped `.0`). One helper, one rule:
 *
 *   under 1 km  → metres, rounded to 10 m      "450 m"
 *   1–10 km     → one decimal                 "1.8 km"
 *   10 km+      → no decimals                  "12 km"
 *
 * The decimal separator follows the app's language ("," in de/et/lv/lt). The
 * units are passed in so they can be translated; SI symbols are the defaults.
 *
 * A missing distance is NOT zero: null/''/NaN renders '' and the card omits the
 * row rather than claiming the job is on the doorstep.
 */

/** Languages that write a decimal comma (the app's five languages minus English). */
const COMMA_DECIMAL_LANGUAGES = new Set(['de', 'et', 'lv', 'lt']);

export interface DistanceUnits {
  metres: string;
  kilometres: string;
}

export const SI_DISTANCE_UNITS: DistanceUnits = { metres: 'm', kilometres: 'km' };

/** Group thousands with a thin, locale-appropriate separator (12 → "12"). */
function groupThousands(whole: string, language: string): string {
  if (whole.length <= 3) return whole;
  const sep = language === 'en' ? ',' : ' ';
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/**
 * The one distance formatter.
 *
 * Returns '' for a value that is not a usable, non-negative number — never
 * "NaN km" and never a fabricated 0.
 */
export function formatDistance(
  distanceKm: number | string | null | undefined,
  language: string,
  units: DistanceUnits = SI_DISTANCE_UNITS
): string {
  if (distanceKm === null || distanceKm === undefined) return '';
  if (typeof distanceKm === 'string' && distanceKm.trim() === '') return '';
  const value = typeof distanceKm === 'number' ? distanceKm : Number(distanceKm);
  if (!Number.isFinite(value) || value < 0) return '';

  // Under one kilometre: metres, rounded to the nearest 10, so "0.45 km" reads
  // "450 m". A real but tiny positive distance never becomes "0 m".
  if (value < 1) {
    // A true zero stays 0 m; a real but tiny positive distance never rounds to 0.
    const rounded = Math.round(value * 100) * 10;
    const metres = value === 0 ? 0 : Math.max(10, rounded);
    return `${metres} ${units.metres}`;
  }

  const oneDecimal = value < 10;
  const rounded = oneDecimal ? Math.round(value * 10) / 10 : Math.round(value);
  // The ROUNDED value decides the format: 9.96 km rounds to 10.0, which is
  // already in the "10 km or more" band, so it must print "10 km" rather than
  // "10.0 km" while 9.94 prints "9.9 km".
  const keepDecimal = oneDecimal && rounded < 10;
  const fixed = keepDecimal ? rounded.toFixed(1) : String(rounded);
  const [whole, fraction] = fixed.split('.');
  const decimal = COMMA_DECIMAL_LANGUAGES.has(language) ? ',' : '.';
  const text = fraction
    ? `${groupThousands(whole, language)}${decimal}${fraction}`
    : groupThousands(whole, language);
  return `${text} ${units.kilometres}`;
}

/**
 * Does the server's number disagree with our own haversine by more than 10%?
 *
 * Used by the delivery check to flag a server/client mismatch. A zero own
 * distance only differs when the server reports a non-zero one.
 */
export function distanceDiffersByMoreThan(
  serverKm: number | null | undefined,
  ownKm: number | null | undefined,
  tolerance = 0.1
): boolean {
  if (typeof serverKm !== 'number' || !Number.isFinite(serverKm) || serverKm < 0) return false;
  if (typeof ownKm !== 'number' || !Number.isFinite(ownKm) || ownKm < 0) return false;
  if (ownKm === 0) return serverKm > 0;
  // A tiny epsilon: 8.0 → 8.8 is arithmetically 10%, but floating point can
  // make it 10.000000000000009% and flag a difference that is exactly at the
  // tolerance. The threshold itself must not wobble.
  return Math.abs(serverKm - ownKm) / ownKm > tolerance + 1e-9;
}

/** The human-readable form of that difference, for a report or a log line. */
export function describeDistanceDeviation(
  serverKm: number | null | undefined,
  ownKm: number | null | undefined
): string {
  if (typeof serverKm !== 'number' || typeof ownKm !== 'number' || !Number.isFinite(ownKm) || ownKm === 0) {
    return '';
  }
  const percent = Math.round((Math.abs(serverKm - ownKm) / ownKm) * 100);
  return `${serverKm.toFixed(2)} km vs ${ownKm.toFixed(2)} km (${percent}%)`;
}
