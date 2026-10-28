/**
 * geocode.ts — the STOPGAP that gives a saved address real coordinates.
 *
 * THE PROBLEM (live evidence, see the report): the provider's address in Tallinn
 * carries the coordinates 31.53000, 74.37000 — Lahore, Pakistan — which is NOT
 * the device's location either: the app has never imported expo-location (no
 * capture code exists in this repo's history), and both clients only ever
 * re-sent the stored pair. The backend does not geocode for us, so the pair is
 * whatever was stored long ago, and the nearby feed (which ranks by these
 * coordinates) therefore shows a provider in Estonia nothing.
 *
 * THE FIX: when an address is saved WITHOUT coordinates, resolve them silently
 * from the address text itself, through OpenStreetMap Nominatim — a FREE public
 * service, called with plain fetch (no native module, nothing new in the APK).
 * The result is sent in the SAME `latitude`/`longitude` payload fields the app
 * already used, so no contract changes.
 *
 * RULES THAT KEEP IT POLITE AND SAFE:
 *   • at most ONE request per second from this device (Nomimatim's usage policy);
 *   • an identifying User-Agent is sent (their policy requires one);
 *   • a structured query is tried first (country/city/postcode/street), then the
 *     city centre as a fallback when the exact address is not found;
 *   • it NEVER blocks saving: the caller bounds the wait and saves without
 *     coordinates when geocoding fails — a failure is not an error the user sees.
 *
 * LONG-TERM: this belongs on the backend (one geocoding call per address write,
 * cached per city). The exact request to hand the backend developer is in the
 * delivery report; this module is the app-side stopgap only.
 *
 * The URL builders, the response parser and the rate limiter are pure and
 * unit-tested (the network call is injectable).
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

/** What a successful lookup yields — numbers, or null and never a guess. */
export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

export interface GeocodeOptions {
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected clock (ms). */
  now?: () => number;
  /** Injected sleep (ms). */
  sleep?: (ms: number) => Promise<void>;
  /** Hard cap on the whole operation (the caller still saves on failure). */
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

/**
 * The structured query for the exact address. Empty fields are omitted entirely
 * (an empty parameter changes Nominatim's behaviour and can return nothing).
 *
 * `street` combines the two street fields the way the address is written
 * (house/building number first — the form's own order).
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

/**
 * The fallback query: the CITY centre, for an address Nominatim cannot find
 * exactly. Returns null when there is not even a city to fall back to — a
 * country-level guess would be worse than no coordinates at all.
 */
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

/**
 * Read `[{lat, lon}]` (Nominatim's jsonv2 shape) into numbers.
 *
 * Returns null for anything unusable — an empty array, a non-array body, a
 * non-numeric or out-of-range pair — so a junk response can never become a pin.
 */
export function parseNominatimResponse(body: unknown): GeocodeResult | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const first = body[0] as { lat?: unknown; lon?: unknown } | null;
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
  return { latitude, longitude };
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
 * address) is worth a fallback query; "error" (the request never got an answer)
 * is not — the city centre would fail the same way, so the caller retries once
 * at the resolver level instead of burning a second request while offline.
 */
type QueryOutcome =
  | { status: 'hit'; result: GeocodeResult }
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
    const parsed = parseNominatimResponse(body);
    return parsed ? { status: 'hit', result: parsed } : { status: 'miss' };
  } catch {
    // Network failure, a JSON parse error, an aborted request: all the same.
    return { status: 'error' };
  }
}

/**
 * Resolve coordinates for an address, silently.
 *
 * Order: the exact address, then the city centre. Returns null when nothing
 * usable came back — the caller saves the address unchanged in that case.
 */
export async function geocodeAddress(
  fields: GeocodeFields,
  options: GeocodeOptions = {}
): Promise<GeocodeResult | null> {
  const fetchImpl =
    options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!fetchImpl) return null; // no fetch available on this runtime — save as is
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const attempts: string[] = [];
  const structured = buildStructuredParams(fields);
  if (structured.length > 0) attempts.push(structured);
  const cityCentre = buildCityParams(fields);
  if (cityCentre && cityCentre !== structured) attempts.push(cityCentre);

  for (const params of attempts) {
    // Respect the one-request-per-second policy before every attempt.
    const wait = limiter.waitMs(now());
    if (wait > 0) await sleep(wait);
    limiter.markSent(now());
    const outcome = await requestOnce(params, fetchImpl, timeoutMs);
    if (outcome.status === 'hit') return outcome.result;
    // A network-level failure ends the attempt here: the fallback query would
    // fail identically. The resolver retries the whole lookup once.
    if (outcome.status === 'error') return null;
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
