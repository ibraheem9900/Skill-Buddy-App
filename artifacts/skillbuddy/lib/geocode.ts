/**
 * geocode.ts — the address → coordinates resolver used by EVERY address write.
 *
 * WHY THE LADDER (boss: "Both client and pilot has very short distance. Yet it
 * does 8km here."): the old lookup sent ONE structured query that glued the
 * apartment onto the building line (`street=Akadeemia tee 11/2 36`). Nominatim
 * answers that with ZERO results, so the app fell back to the CITY CENTRE
 * (59.437242, 24.7572693) — 6.9 km from the real building. Every distance then
 * measured from the wrong point.
 *
 * THE LADDER, most precise first (verified live against Nominatim):
 *   1. free-form "<house/building>, <postal code> <city>, <country>"
 *      → "Akadeemia tee 11/2, 12616 Tallinn, Estonia" = 59.396799, 24.6642473
 *        (building, 30 m from 11/1);
 *   2. the same without a trailing "/N" sub-number
 *      → "Akadeemia tee 11, ..." (the base building);
 *   3. street name only, numbers stripped, + city;
 *   4. postal code + country;
 *   5. city centre (the OLD fallback, now the LAST rung and flagged as such).
 *
 * The result carries `precision`, so a caller can tell the user "we only found
 * your city" without blocking the save. Results are cached per normalised
 * input, requests are queued at most one per second, an identifying
 * User-Agent is sent, and the device GPS is never consulted.
 *
 * The URL builders, the response parser, the cache and the rate limiter are
 * pure and unit-tested; the network call is injectable.
 */

/** The text fields a geocoding query can be built from. */
export interface GeocodeFields {
  house_number?: string | null;
  street_address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  county?: string | null;
  country?: string | null;
}

/** How exact the returned point is. `city` means "fallback only". */
export type GeocodePrecision = 'building' | 'street' | 'postcode' | 'city';

/** What a successful lookup yields — numbers plus the precision reached. */
export interface GeocodeResult {
  latitude: number;
  longitude: number;
  precision: GeocodePrecision;
}

export interface GeocodeOptions {
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected clock (ms). */
  now?: () => number;
  /** Injected sleep (ms). */
  sleep?: (ms: number) => Promise<void>;
  /** Hard cap on ONE request (the caller still saves on failure). */
  timeoutMs?: number;
}

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
/** Their usage policy: an identifying UA, and no more than one request a second. */
const USER_AGENT = 'SkillBuddy-Mobile/1.0 (address geocoding; contact: support@skillbuddy.ee)';
export const MIN_REQUEST_INTERVAL_MS = 1000;
export const DEFAULT_TIMEOUT_MS = 6000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Collapse whitespace so the cache key and the query are stable. */
function clean(value: unknown): string {
  return text(value).replace(/\s+/g, ' ');
}

/**
 * Country name → ISO 3166-1 alpha-2, for Nominatim's `countrycodes` filter.
 * Only the countries this app's address data actually uses are listed; an
 * unknown country simply omits the filter (the query still carries the name).
 */
const COUNTRY_CODES: Record<string, string> = {
  estonia: 'ee',
  eesti: 'ee',
  latvia: 'lv',
  latvija: 'lv',
  lithuania: 'lt',
  lietuva: 'lt',
  germany: 'de',
  deutschland: 'de',
  finland: 'fi',
  suomi: 'fi',
  russia: 'ru',
  poland: 'pl',
  sweden: 'se',
  norway: 'no',
  denmark: 'dk',
  ukraine: 'ua',
  belarus: 'by',
  'united kingdom': 'gb',
  'great britain': 'gb',
  england: 'gb',
  ireland: 'ie',
  france: 'fr',
  spain: 'es',
  italy: 'it',
  netherlands: 'nl',
  belgium: 'be',
  austria: 'at',
  'czech republic': 'cz',
  czechia: 'cz',
  portugal: 'pt',
  'united states': 'us',
  'united states of america': 'us',
  usa: 'us',
  canada: 'ca',
  turkey: 'tr',
  india: 'in',
  pakistan: 'pk',
};

/** The two-letter code for a country name/ISO code, or '' when unknown. */
export function countryCodeFor(country: string | null | undefined): string {
  const value = clean(country).toLowerCase();
  if (value.length === 0) return '';
  if (/^[a-z]{2}$/.test(value)) return value;
  return COUNTRY_CODES[value] ?? '';
}

/** Drop a trailing "/2" (or "/1A") sub-number from a building line. */
export function stripSubNumber(house: string): string {
  const value = clean(house);
  return value.replace(/\s*\/\s*[0-9A-Za-z-]+\s*$/, '').trim();
}

/**
 * The street NAME, with house numbers removed: "Akadeemia tee 11/2" →
 * "Akadeemia tee". A value that is only a number yields '' (nothing to search).
 */
export function streetNameOnly(house: string): string {
  const base = stripSubNumber(house);
  const withoutNumbers = base
    .replace(/\s+\d+[A-Za-z]?(?:\s*\/\s*[0-9A-Za-z-]+)?\s*$/, '')
    .replace(/\s+\d+[A-Za-z]?\s+/g, ' ')
    .replace(/^\s*\d+[A-Za-z]?(?:\s*\/\s*[0-9A-Za-z-]+)?\s*$/, '')
    .trim();
  return withoutNumbers.replace(/\s{2,}/g, ' ');
}

/** "12616 Tallinn" — the postcode+city part of a free-form address line. */
export function postalCityLine(fields: GeocodeFields): string {
  return [clean(fields.postal_code), clean(fields.city)]
    .filter((part) => part.length > 0)
    .join(' ');
}

export interface GeocodeRung {
  precision: GeocodePrecision;
  /** The query string for `GET /search?<params>`. */
  params: string;
  /** A stable label used by tests and logs. */
  label: 'full' | 'base-building' | 'street' | 'postcode' | 'city';
}

/**
 * Build the precision ladder for one address. Rungs that cannot be built (no
 * city, no street name, …) are omitted, and duplicates are dropped, so the same
 * query is never sent twice.
 */
export function buildGeocodeLadder(fields: GeocodeFields): GeocodeRung[] {
  const house = clean(fields.house_number);
  const baseHouse = stripSubNumber(house);
  const street = streetNameOnly(house);
  const postalCity = postalCityLine(fields);
  const postal = clean(fields.postal_code);
  const city = clean(fields.city);
  const county = clean(fields.county);
  const country = clean(fields.country);
  const countrycode = countryCodeFor(country);

  const rungs: GeocodeRung[] = [];
  const seen = new Set<string>();

  const push = (label: GeocodeRung['label'], precision: GeocodePrecision, parts: string[]) => {
    const q = parts.filter((part) => part.length > 0).join(', ');
    if (q.length === 0) return;
    const params = new URLSearchParams({ q, format: 'jsonv2', limit: '1', addressdetails: '1' });
    if (countrycode) params.set('countrycodes', countrycode);
    const key = params.toString();
    if (seen.has(key)) return;
    seen.add(key);
    rungs.push({ label, precision, params: key });
  };

  // 1. the complete building line, as the form collected it.
  push('full', 'building', [house, postalCity, country]);
  // 2. the base building without the "/2" sub-number.
  if (baseHouse && baseHouse !== house) push('base-building', 'building', [baseHouse, postalCity, country]);
  // 3. the street itself.
  if (street) push('street', 'street', [street, city || county, country]);
  // 4. the postcode.
  push('postcode', 'postcode', [postal, country]);
  // 5. the city — the LAST resort, and reported as such.
  push('city', 'city', [city, county, country]);

  return rungs;
}

/**
 * The old structured parameters, kept exported because it documents the query
 * that FAILED live (0 results for "Akadeemia tee 11/2 36"). Nothing calls it for
 * geocoding any more — the ladder above replaces it.
 */
export function buildStructuredParams(fields: GeocodeFields): string {
  const street = [text(fields.house_number), text(fields.street_address)]
    .filter((part) => part.length > 0)
    .join(' ');
  const params = new URLSearchParams();
  if (street.length > 0) params.set('street', street);
  const city = text(fields.city);
  if (city.length > 0) params.set('city', city);
  const county = text(fields.county);
  if (county.length > 0) params.set('county', county);
  const postal = text(fields.postal_code);
  if (postal.length > 0) params.set('postalcode', postal);
  const country = text(fields.country);
  if (country.length > 0) params.set('country', country);
  params.set('format', 'jsonv2');
  params.set('limit', '1');
  return params.toString();
}

/** The city-centre query (still exported for the old callers/tests). */
export function buildCityParams(fields: GeocodeFields): string | null {
  const city = text(fields.city);
  if (city.length === 0) return null;
  const params = new URLSearchParams();
  params.set('city', city);
  const county = text(fields.county);
  if (county.length > 0) params.set('county', county);
  const country = text(fields.country);
  if (country.length > 0) params.set('country', country);
  params.set('format', 'jsonv2');
  params.set('limit', '1');
  return params.toString();
}

/** The first hit of a Nominatim body, with the address block precision needs. */
export interface NominatimHit {
  latitude: number;
  longitude: number;
  address: Record<string, unknown>;
  type: string;
  displayName: string;
}

/**
 * Read `[{lat, lon, address}]` (Nominatim's jsonv2 shape).
 *
 * Returns null for anything unusable — an empty array, a non-array body, a
 * non-numeric or out-of-range pair — so a junk response can never become a pin.
 */
export function parseNominatimHit(body: unknown): NominatimHit | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const first = body[0] as {
    lat?: unknown;
    lon?: unknown;
    address?: unknown;
    type?: unknown;
    display_name?: unknown;
  };
  if (!first || typeof first !== 'object') return null;

  // Both values must be PRESENT and numeric: Number('') is 0, so a missing
  // field would otherwise parse as the equator/meridian and look valid.
  const latValue = first.lat;
  const lonValue = first.lon;
  const hasLat = typeof latValue === 'number' || text(latValue).length > 0;
  const hasLon = typeof lonValue === 'number' || text(lonValue).length > 0;
  if (!hasLat || !hasLon) return null;

  const latitude = typeof latValue === 'number' ? latValue : Number(text(latValue));
  const longitude = typeof lonValue === 'number' ? lonValue : Number(text(lonValue));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null; // "null island" is a failed lookup

  const address =
    first.address && typeof first.address === 'object'
      ? (first.address as Record<string, unknown>)
      : {};

  return {
    latitude,
    longitude,
    address,
    type: text(first.type),
    displayName: text(first.display_name),
  };
}

/** Backwards-compatible pair-only parser. */
export function parseNominatimResponse(body: unknown): { latitude: number; longitude: number } | null {
  const hit = parseNominatimHit(body);
  return hit ? { latitude: hit.latitude, longitude: hit.longitude } : null;
}

/**
 * Did this rung actually reach the precision it claims?
 *
 * The guards matter: Nominatim happily answers a made-up street with the CITY,
 * which would silently restore the exact bug this ladder exists to fix. A rung
 * that comes back coarse is treated as a miss, and the next rung runs.
 */
export function precisionForRung(rung: GeocodePrecision, hit: NominatimHit): GeocodePrecision | null {
  const address = hit.address;
  const hasHouse = text(address.house_number).length > 0 || text(address.building).length > 0;
  const hasRoad = text(address.road).length > 0;

  if (rung === 'building') {
    if (hit.type === 'administrative' && !hasHouse && !hasRoad) return null;
    if (hasHouse) return 'building';
    if (hasRoad) return 'street';
    return null;
  }
  if (rung === 'street') {
    if (!hasRoad) return null;
    return 'street';
  }
  if (rung === 'postcode') {
    if (!text(address.postcode) && hit.type !== 'postcode') return null;
    return 'postcode';
  }
  return 'city';
}

/**
 * A one-request-per-second gate.
 *
 * `waitMs(nowMs)` returns how long the caller must wait before its request may
 * go out; the next call after a request must wait the remainder of the interval.
 */
export function createRateLimiter(minIntervalMs: number = MIN_REQUEST_INTERVAL_MS) {
  let lastRequestAt: number | null = null;
  return {
    waitMs(nowMs: number): number {
      if (lastRequestAt === null) return 0;
      return Math.max(0, minIntervalMs - (nowMs - lastRequestAt));
    },
    markSent(nowMs: number) {
      lastRequestAt = nowMs;
    },
    reset() {
      lastRequestAt = null;
    },
  };
}

/** The module's shared gate — one per app process, as the policy intends. */
const limiter = createRateLimiter();

/** Per-input cache: the same address is never geocoded twice in a session. */
const resultCache = new Map<string, GeocodeResult>();
const MAX_CACHE_ENTRIES = 200;

/** Cleared by tests; also usable after a sign-out if a caller wants a clean map. */
export function clearGeocodeCache(): void {
  resultCache.clear();
}

/** The cache key: every query-relevant field, normalised. */
export function geocodeCacheKey(fields: GeocodeFields): string {
  return JSON.stringify([
    clean(fields.house_number),
    clean(fields.street_address),
    clean(fields.postal_code),
    clean(fields.city),
    clean(fields.county),
    clean(fields.country),
  ]);
}

/** Run `promise`, resolving to null after `timeoutMs` instead of hanging. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * One query's outcome. "miss" (the server answered, it just does not know this
 * address) is worth the next rung; "error" (the request never got an answer) is
 * not — every rung would fail the same way, so the caller retries the whole
 * lookup once instead of burning five requests while offline.
 */
type QueryOutcome =
  | { status: 'hit'; hit: NominatimHit }
  | { status: 'miss' }
  | { status: 'error' };

async function requestOnce(
  params: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<QueryOutcome> {
  try {
    const response = await withTimeout(
      fetchImpl(`${NOMINATIM_SEARCH_URL}?${params}`, {
        method: 'GET',
        headers: {
          // Nominatim's policy requires an identifying User-Agent.
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
      }),
      timeoutMs
    );
    if (!response) return { status: 'error' };
    if (!response.ok) return { status: 'error' };
    const body = await response.json();
    const hit = parseNominatimHit(body);
    return hit ? { status: 'hit', hit } : { status: 'miss' };
  } catch {
    // Network failure, a JSON parse error, an aborted request: all the same.
    return { status: 'error' };
  }
}

/**
 * Resolve coordinates for an address through the precision ladder, silently.
 *
 * Returns null when nothing usable came back — the caller decides whether that
 * blocks a job (it does) or merely leaves a profile address without a pin.
 */
export async function geocodeAddress(
  fields: GeocodeFields,
  options: GeocodeOptions = {}
): Promise<GeocodeResult | null> {
  const key = geocodeCacheKey(fields);
  const cached = resultCache.get(key);
  if (cached) return cached;

  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!fetchImpl) return null; // no fetch available on this runtime — save as is
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (const rung of buildGeocodeLadder(fields)) {
    // Respect the one-request-per-second policy before every attempt.
    const wait = limiter.waitMs(now());
    if (wait > 0) await sleep(wait);
    limiter.markSent(now());
    const outcome = await requestOnce(rung.params, fetchImpl, timeoutMs);
    // A network-level failure ends the whole lookup here: the next rung would
    // fail identically. The resolver retries the ladder once.
    if (outcome.status === 'error') return null;
    if (outcome.status === 'miss') continue;
    const precision = precisionForRung(rung.precision, outcome.hit);
    if (!precision) continue; // the rung answered, but not at this precision
    const result: GeocodeResult = {
      latitude: outcome.hit.latitude,
      longitude: outcome.hit.longitude,
      precision,
    };
    if (resultCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = resultCache.keys().next().value;
      if (oldest !== undefined) resultCache.delete(oldest);
    }
    resultCache.set(key, result);
    return result;
  }
  return null;
}

/**
 * True when BOTH coordinates are missing, so there is nothing to preserve and
 * geocoding should be attempted. A half pair (or any usable value) is left
 * alone: an update must never silently move a pin the user can see.
 */
export function needsGeocoding(
  latitude: number | string | null | undefined,
  longitude: number | string | null | undefined
): boolean {
  return !hasCoordinate(latitude) && !hasCoordinate(longitude);
}

/** A value that could be a real coordinate (a finite number or a non-blank string). */
function hasCoordinate(value: number | string | null | undefined): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return text(value).length > 0;
}
