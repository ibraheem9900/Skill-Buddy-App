/**
 * coordinates.ts — ONE resolver for "what are this address's coordinates?".
 *
 * WHY (boss: "Unable to see the recently posted jobs here. However the addresses
 * are the same."): the provider feed is matched server-side by DISTANCE, and a
 * job posted from this app carried NO coordinates at all — `lib/jobCreate`
 * omitted them, `lib/jobAddress` omitted them, and only the profile address
 * forms ran the geocoding stopgap. A job without a point can never be "within
 * 5 km" of anybody, so the provider's Available jobs stayed empty even though
 * both accounts had the same address text.
 *
 * THE RULE, applied to EVERY address write (profile add/edit, the Post-a-Job
 * address modal, Create Job Address, Update Job Address, and the job itself):
 *
 *   (a) the address already has a usable pair            → REUSE it, no network;
 *   (b) otherwise                                        → geocode its own text
 *       with the existing free OpenStreetMap Nominatim stopgap (lib/geocode:
 *       structured query first, city centre as the fallback, identifying
 *       User-Agent, max 1 request/second);
 *   (c) network failure                                  → retry ONCE;
 *   (d) still nothing                                    → return null and let
 *       the caller decide (profile saves still succeed without coordinates; a
 *       JOB refuses to be posted invisible — the screens show a retryable
 *       error instead).
 *
 * The device GPS is NEVER used: these are the coordinates of the ADDRESS, not
 * of the phone (that mismatch is exactly how a Tallinn address ended up with
 * Lahore coordinates earlier).
 *
 * Everything here is pure except `resolveCoordinates`, whose network is
 * injectable, so distance and reuse are unit-tested in plain node.
 */

import {
  geocodeAddress,
  type GeocodeFields,
  type GeocodeOptions,
  type GeocodeResult,
} from '@/lib/geocode';

/** An address-shaped source: optionally carries a stored pair, plus its text. */
export interface CoordinateSource extends GeocodeFields {
  latitude?: string | number | null;
  longitude?: string | number | null;
}

/** A real point. Never produced from a guess. */
export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Parse ONE coordinate value; null unless it is a sane number. */
export function parseCoordinateValue(
  raw: string | number | null | undefined,
  kind: 'lat' | 'lng'
): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const limit = kind === 'lat' ? 90 : 180;
  if (Math.abs(n) > limit) return null;
  if (n === 0) return null; // 0/0 is "null island": a missing pair, never a pin
  return n;
}

/**
 * The stored pair, when BOTH values are usable. A half pair is treated as no
 * pair (the same rule the address forms already use) so we never invent the
 * missing half.
 */
export function existingCoordinates(source: CoordinateSource | null | undefined): LatLng | null {
  if (!source) return null;
  const latitude = parseCoordinateValue(source.latitude, 'lat');
  const longitude = parseCoordinateValue(source.longitude, 'lng');
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

/**
 * True when this address needs a lookup — i.e. there is no USABLE pair (both
 * halves, sane range, not 0/0). A half pair counts as needing one: the resolver
 * cannot build a point from it, and a job carrying it would be invisible.
 */
export function needsCoordinates(source: CoordinateSource | null | undefined): boolean {
  return existingCoordinates(source) === null;
}

/** Only the geocodable text fields (the stored pair is not sent to Nominatim). */
export function geocodeFieldsOf(source: CoordinateSource): GeocodeFields {
  return {
    house_number: source.house_number,
    street_address: source.street_address,
    postal_code: source.postal_code,
    city: source.city,
    county: source.county,
    country: source.country,
  };
}

export interface ResolveOptions extends GeocodeOptions {
  /** Attempts after the first one failed (default 1 → a single retry). */
  retries?: number;
  /** Pause before a retry, ms (default 800; the 1 req/s limiter still applies). */
  retryDelayMs?: number;
}

/**
 * Reuse-or-geocode, never throwing. Returns null when no coordinates could be
 * established — the caller decides whether that is fatal (job writes) or not
 * (profile saves).
 */
export async function resolveCoordinates(
  source: CoordinateSource,
  options: ResolveOptions = {}
): Promise<LatLng | null> {
  const existing = existingCoordinates(source);
  if (existing) return existing;

  const fields = geocodeFieldsOf(source);
  const retries = typeof options.retries === 'number' && options.retries >= 0 ? options.retries : 1;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retryDelayMs = typeof options.retryDelayMs === 'number' ? options.retryDelayMs : 800;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0 && retryDelayMs > 0) await sleep(retryDelayMs);
    const result = await geocodeAddress(fields, options);
    if (result) return toLatLng(result);
  }
  return null;
}

function toLatLng(result: GeocodeResult): LatLng | null {
  const latitude = parseCoordinateValue(result.latitude, 'lat');
  const longitude = parseCoordinateValue(result.longitude, 'lng');
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

/** Earth's mean radius, km (IUGG). */
const EARTH_RADIUS_KM = 6371.0088;

/**
 * Great-circle distance between two points, km. Used by the verification helper
 * and available to any "is this job within the provider's radius?" check the
 * app wants to show; the server remains the authority for the feed itself.
 */
export function haversineKm(from: LatLng, to: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
