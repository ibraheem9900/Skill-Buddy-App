import {
  buildCityParams,
  buildStructuredParams,
  createRateLimiter,
  geocodeAddress,
  needsGeocoding,
  parseNominatimResponse,
} from '../geocode';

/**
 * The geocoding stopgap: what gets sent to Nominatim, what comes back, and the
 * one-request-per-second gate. The network is injected, so the whole flow is
 * tested without touching the internet.
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

const TALLINN = {
  house_number: 'Akadeemia tee 11/2',
  street_address: '36',
  postal_code: '12616',
  city: 'Tallinn',
  county: 'Harju',
  country: 'Estonia',
};

/* ── The structured query ─────────────────────────────────────────────────── */

const structured = buildStructuredParams(TALLINN);
check('street combines house + street, house first', structured.includes('street=Akadeemia+tee+11%2F2+36'));
check('city is sent', structured.includes('city=Tallinn'));
check('county is sent', structured.includes('county=Harju'));
check('postal code is sent', structured.includes('postalcode=12616'));
check('country is sent', structured.includes('country=Estonia'));
check('jsonv2 output is requested', structured.includes('format=jsonv2'));
check('only the best hit is asked for', structured.includes('limit=1'));

const cityOnly = buildStructuredParams({ city: 'Tallinn' });
check('a missing street omits the parameter entirely', !cityOnly.includes('street='));
check('a missing postcode omits the parameter entirely', !cityOnly.includes('postalcode='));
check('a missing country omits the parameter entirely', !cityOnly.includes('country='));
check('a blank city is omitted, not sent empty', !buildStructuredParams({ city: '   ' }).includes('city='));

/* ── The city-centre fallback ─────────────────────────────────────────────── */

const fallback = buildCityParams(TALLINN);
check('fallback uses the city', fallback !== null && fallback.includes('city=Tallinn'));
check('fallback keeps the county', fallback !== null && fallback.includes('county=Harju'));
check('fallback keeps the country', fallback !== null && fallback.includes('country=Estonia'));
check('fallback never sends the street', fallback !== null && !fallback.includes('street='));
check('no city → no fallback at all', buildCityParams({ county: 'Harju', country: 'Estonia' }) === null);
check('blank city → no fallback at all', buildCityParams({ city: '  ' }) === null);

/* ── The response parser ──────────────────────────────────────────────────── */

check(
  'a real Nominatim hit parses',
  JSON.stringify(parseNominatimResponse([{ lat: '59.4271224', lon: '24.6622459' }])) ===
    '{"latitude":59.4271224,"longitude":24.6622459}'
);
check(
  'numeric lat/lon also parses',
  JSON.stringify(parseNominatimResponse([{ lat: 59.4, lon: 24.6 }])) === '{"latitude":59.4,"longitude":24.6}'
);
check('an empty list is a failure', parseNominatimResponse([]) === null);
check('a non-array body is a failure', parseNominatimResponse({ lat: '59', lon: '24' }) === null);
check('null is a failure', parseNominatimResponse(null) === null);
check('garbage coordinates are a failure', parseNominatimResponse([{ lat: 'x', lon: 'y' }]) === null);
check('out-of-range latitude is a failure', parseNominatimResponse([{ lat: '91', lon: '24' }]) === null);
check('out-of-range longitude is a failure', parseNominatimResponse([{ lat: '59', lon: '200' }]) === null);
check('0,0 is treated as a failed lookup', parseNominatimResponse([{ lat: '0', lon: '0' }]) === null);
check('a missing lat is a failure', parseNominatimResponse([{ lon: '24' }]) === null);

/* ── The rate limiter ─────────────────────────────────────────────────────── */

const limiter = createRateLimiter(1000);
check('the first request waits nothing', limiter.waitMs(10_000) === 0);
limiter.markSent(10_000);
check('an immediate second request waits the whole interval', limiter.waitMs(10_000) === 1000);
check('half a second later it waits the remainder', limiter.waitMs(10_500) === 500);
check('after the interval it waits nothing', limiter.waitMs(11_000) === 0);
limiter.reset();
check('reset clears the gate', limiter.waitMs(11_000) === 0);

/* ── End to end, with the network injected ────────────────────────────────── */

async function runFlow() {
  // 1) The exact address resolves: ONE request, no fallback.
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => [{ lat: '59.4271224', lon: '24.6622459' }],
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const hit = await geocodeAddress(TALLINN, {
    fetchImpl,
    now: () => 0,
    sleep: async () => {},
    timeoutMs: 1000,
  });
  check('exact lookup returns coordinates', hit !== null && hit.latitude === 59.4271224);
  check('exact lookup sends exactly one request', calls.length === 1);
  check('the request goes to Nominatim', calls[0].startsWith('https://nominatim.openstreetmap.org/search?'));

  // 2) The exact address misses → the CITY centre is tried as the fallback.
  const fallbackCalls: string[] = [];
  const fetchFallback = (async (url: string) => {
    fallbackCalls.push(String(url));
    const isCityAttempt = String(url).includes('city=Tallinn') && !String(url).includes('street=');
    return {
      ok: true,
      json: async () => (isCityAttempt ? [{ lat: '59.437', lon: '24.7536' }] : []),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const fallbackHit = await geocodeAddress(
    { ...TALLINN, city: 'Tallinn' },
    { fetchImpl: fetchFallback, now: () => 0, sleep: async () => {}, timeoutMs: 1000 }
  );
  check('the city centre is used when the exact address misses', fallbackHit !== null && fallbackHit.latitude === 59.437);
  check('both attempts were made', fallbackCalls.length === 2);
  check('the second attempt drops the street', !fallbackCalls[1].includes('street='));

  // 3) Nothing found, no city to fall back to → null, and the caller still saves.
  const fetchMiss = (async () =>
    ({ ok: true, json: async () => [] }) as unknown as Response) as unknown as typeof fetch;
  const miss = await geocodeAddress(
    { house_number: 'X 1', country: 'Estonia' },
    { fetchImpl: fetchMiss, now: () => 0, sleep: async () => {}, timeoutMs: 1000 }
  );
  check('a miss returns null (the save continues without coordinates)', miss === null);

  // 4) A network/HTTP failure is swallowed the same way.
  const fetchBoom = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  const boom = await geocodeAddress(TALLINN, {
    fetchImpl: fetchBoom,
    now: () => 0,
    sleep: async () => {},
    timeoutMs: 1000,
  });
  check('a network failure never throws', boom === null);

  // 5) A non-OK response is a miss, not an error.
  const fetch500 = (async () =>
    ({ ok: false, status: 500, json: async () => [] }) as unknown as Response) as unknown as typeof fetch;
  const err500 = await geocodeAddress(TALLINN, {
    fetchImpl: fetch500,
    now: () => 0,
    sleep: async () => {},
    timeoutMs: 1000,
  });
  check('an HTTP error is a miss', err500 === null);
}

/* ── When to geocode ──────────────────────────────────────────────────────── */

check('missing pair needs geocoding', needsGeocoding(null, null));
check('empty strings need geocoding', needsGeocoding('', ''));
check('undefined needs geocoding', needsGeocoding(undefined, undefined));
check('an existing pair does not', !needsGeocoding(59.4, 24.6));
check('a stored string pair does not', !needsGeocoding('59.427', '24.662'));
check('half a pair does not (an update keeps what is there)', !needsGeocoding(59.4, null));

void (async () => {
  try {
    await runFlow();
  } catch (error) {
    failures.push(`flow threw: ${(error as Error).message}`);
  }
  if (failures.length > 0) {
    console.log(`geocode: ${passed} checks, ${failures.length} failure(s) — ${failures.join(', ')}`);
    throw new Error(`${failures.length} geocode check(s) failed`);
  }
  console.log(`geocode: ${passed} checks, 0 failure(s)`);
})();
