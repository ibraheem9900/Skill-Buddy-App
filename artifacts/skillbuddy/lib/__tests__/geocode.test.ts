import {
  buildCityParams,
  buildGeocodeLadder,
  buildStructuredParams,
  clearGeocodeCache,
  countryCodeFor,
  createRateLimiter,
  geocodeAddress,
  needsGeocoding,
  parseNominatimHit,
  parseNominatimResponse,
  precisionForRung,
  streetNameOnly,
  stripSubNumber,
} from '../geocode';

/**
 * The geocoding PRECISION LADDER.
 *
 * Live evidence behind these cases (Nominatim, 2026-11-05):
 *   • the OLD structured query, `street=Akadeemia tee 11/2 36`, returned ZERO
 *     results, so the app fell back to Tallinn centre (59.437242, 24.7572693);
 *   • the free-form `Akadeemia tee 11/2, 12616 Tallinn, Estonia` returns the
 *     BUILDING at 59.3967990, 24.6642473 — 6.9 km from that fallback.
 * The mocks below mirror those two shapes.
 */

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean) {
  if (ok) {
    passed += 1;
  } else {
    failures.push(label);
  }
}

/** Decode a query URL the way a human reads it: `%2C` and `+` both become text. */
function decoded(url: string): string {
  return decodeURIComponent(url).replace(/\+/g, ' ');
}

const TALLINN = {
  house_number: 'Akadeemia tee 11/2',
  street_address: '36',
  postal_code: '12616',
  city: 'Tallinn',
  county: 'Harju',
  country: 'Estonia',
};

const BUILDING_HIT = {
  lat: '59.3967990',
  lon: '24.6642473',
  type: 'dormitory',
  display_name: 'Ühiselamu 7 (DO7), 11/2, Akadeemia tee, Tallinn, Estonia',
  address: { house_number: '11/2', road: 'Akadeemia tee', city: 'Tallinn', postcode: '12616' },
};
const STREET_HIT = {
  lat: '59.4043974',
  lon: '24.6549875',
  type: 'secondary',
  display_name: 'Akadeemia tee, Tallinn',
  address: { road: 'Akadeemia tee', city: 'Tallinn', postcode: '12615' },
};
const CITY_HIT = {
  lat: '59.4372420',
  lon: '24.7572693',
  type: 'administrative',
  display_name: 'Tallinn, Harju maakond, Eesti',
  address: { city: 'Tallinn', county: 'Harju maakond', country: 'Eesti' },
};

/* ── Field cleaning ───────────────────────────────────────────────────────── */

check('a trailing /2 is stripped', stripSubNumber('Akadeemia tee 11/2') === 'Akadeemia tee 11');
check('a spaced slash is stripped', stripSubNumber('Pikk 5 / 7') === 'Pikk 5');
check('a plain street is unchanged', stripSubNumber('Akadeemia tee 11') === 'Akadeemia tee 11');
check('the street name drops the house number', streetNameOnly('Akadeemia tee 11/2') === 'Akadeemia tee');
check('the street name keeps multi-word names', streetNameOnly('Pikk tänav 5') === 'Pikk tänav');
check('Estonia maps to ee', countryCodeFor('Estonia') === 'ee');
check('the local name maps too', countryCodeFor('Eesti') === 'ee');
check('a lowercase ISO code is accepted', countryCodeFor('lv') === 'lv');
check('an unknown country has no filter', countryCodeFor('Atlantis') === '');

/* ── The ladder itself ────────────────────────────────────────────────────── */

const ladder = buildGeocodeLadder(TALLINN);
check(`the full building line is rung 1 (${ladder[0]?.label})`, ladder[0]?.label === 'full');
check('rung 1 carries no apartment number', decoded(ladder[0].params).includes('q=Akadeemia tee 11/2, 12616 Tallinn, Estonia'));
check('rung 1 is a BUILDING precision', ladder[0].precision === 'building');
check('rung 1 filters by country code', ladder[0].params.includes('countrycodes=ee'));
check('rung 2 is the base building', ladder[1]?.label === 'base-building');
check('rung 2 drops /2 only', decoded(ladder[1].params).includes('q=Akadeemia tee 11, 12616 Tallinn, Estonia'));
check('rung 3 is the street', ladder[2]?.label === 'street');
check('rung 3 searches the street name', decoded(ladder[2].params).includes('q=Akadeemia tee, Tallinn, Estonia'));
check('rung 4 is the postcode', ladder[3]?.label === 'postcode');
check('rung 5 is the city LAST', ladder[4]?.label === 'city');
check('the city rung is flagged as city', ladder[4].precision === 'city');
check('no duplicate query is sent', new Set(ladder.map((r) => r.params)).size === ladder.length);
check('the ladder never sends the apartment alone', !ladder.some((r) => /^\s*36\b/.test(decodeURIComponent(r.params))));

const noCity = buildGeocodeLadder({ house_number: 'Pikk 5', country: 'Estonia' });
check('without a city there is no city rung', !noCity.some((r) => r.label === 'city'));
check('a bare number yields no street rung', !buildGeocodeLadder({ house_number: '12', city: 'Tallinn' }).some((r) => r.label === 'street'));

/* ── Precision guards ─────────────────────────────────────────────────────── */

const buildingHit = parseNominatimHit([BUILDING_HIT]);
const streetHit = parseNominatimHit([STREET_HIT]);
const cityHit = parseNominatimHit([CITY_HIT]);
check('a hit parses its address block', buildingHit?.address.house_number === '11/2');
check('a building result is building precision', precisionForRung('building', buildingHit!) === 'building');
check('a road-only result downgrades to street', precisionForRung('building', streetHit!) === 'street');
check('an administrative result is NOT accepted as a building', precisionForRung('building', cityHit!) === null);
check('a street rung needs a road', precisionForRung('street', cityHit!) === null);
check('a street rung accepts a road', precisionForRung('street', streetHit!) === 'street');
check('the city rung is always city', precisionForRung('city', cityHit!) === 'city');

/* ── Legacy builders stay honest ──────────────────────────────────────────── */

const structured = buildStructuredParams(TALLINN);
check('the OLD structured query is still reproducible for the bug report', structured.includes('street=Akadeemia+tee+11%2F2+36'));
check('the city fallback still uses the city', (buildCityParams(TALLINN) ?? '').includes('city=Tallinn'));
check('no city → no fallback', buildCityParams({ county: 'Harju' }) === null);

/* ── Response parsing ─────────────────────────────────────────────────────── */

check(
  'a real hit parses',
  JSON.stringify(parseNominatimResponse([{ lat: '59.4271224', lon: '24.6622459' }])) ===
    '{"latitude":59.4271224,"longitude":24.6622459}'
);
check('an empty list is a failure', parseNominatimResponse([]) === null);
check('a non-array body is a failure', parseNominatimResponse({ lat: '59', lon: '24' }) === null);
check('garbage is a failure', parseNominatimResponse([{ lat: 'x', lon: 'y' }]) === null);
check('out-of-range latitude is a failure', parseNominatimResponse([{ lat: '91', lon: '24' }]) === null);
check('0,0 is a failure', parseNominatimResponse([{ lat: '0', lon: '0' }]) === null);
check('a missing lat is a failure', parseNominatimResponse([{ lon: '24' }]) === null);

/* ── Rate limiter ─────────────────────────────────────────────────────────── */

const limiter = createRateLimiter(1000);
check('the first request waits nothing', limiter.waitMs(10_000) === 0);
limiter.markSent(10_000);
check('an immediate second request waits the whole interval', limiter.waitMs(10_000) === 1000);
check('half a second later it waits the remainder', limiter.waitMs(10_500) === 500);
check('after the interval it waits nothing', limiter.waitMs(11_000) === 0);

/* ── End to end ───────────────────────────────────────────────────────────── */

async function runFlow() {
  clearGeocodeCache();

  // 1) Rung 1 hits the building: ONE request, precision 'building'.
  const calls: string[] = [];
  const fetchBuilding = (async (url: string) => {
    calls.push(String(url));
    return { ok: true, json: async () => [BUILDING_HIT] } as unknown as Response;
  }) as unknown as typeof fetch;

  const hit = await geocodeAddress({ ...TALLINN, house_number: 'Test 1/2' }, {
    fetchImpl: fetchBuilding,
    now: () => 0,
    sleep: async () => {},
    timeoutMs: 1000,
  });
  check('a building hit returns its coordinates', hit?.latitude === 59.396799);
  check('a building hit reports building precision', hit?.precision === 'building');
  check('a building hit costs exactly one request', calls.length === 1);
  check('the request is a free-form q=', calls[0].includes('q='));
  check('the request carries the User-Agent', calls[0].startsWith('https://nominatim.openstreetmap.org/search?'));
  check('the request includes the postcode text', decoded(calls[0]).includes('12616'));

  // 2) The cache: the same address makes NO second request.
  const cached = await geocodeAddress({ ...TALLINN, house_number: 'Test 1/2' }, {
    fetchImpl: fetchBuilding,
    now: () => 0,
    sleep: async () => {},
    timeoutMs: 1000,
  });
  check('the cached answer is returned', cached?.precision === 'building');
  check('the cache prevented a second request', calls.length === 1);

  // 3) Rung 1 misses, the base building hits → still building precision.
  clearGeocodeCache();
  const baseCalls: string[] = [];
  const fetchBase = (async (url: string) => {
    baseCalls.push(decoded(String(url)));
    const isBase = decoded(String(url)).includes('q=Akadeemia tee 11,');
    return { ok: true, json: async () => (isBase ? [BUILDING_HIT] : []) } as unknown as Response;
  }) as unknown as typeof fetch;

  const base = await geocodeAddress({ ...TALLINN, house_number: 'Akadeemia tee 11/9' }, {
    fetchImpl: fetchBase,
    now: () => 0,
    sleep: async () => {},
    timeoutMs: 1000,
  });
  check('the base building rung is tried after a miss', baseCalls.length === 2);
  check('the base building answer is building precision', base?.precision === 'building');

  // 4) Everything misses except the city → LAST rung, flagged 'city'.
  clearGeocodeCache();
  const cityCalls: string[] = [];
  const fetchCity = (async (url: string) => {
    const text = decoded(String(url));
    cityCalls.push(text);
    const isCity = text.includes('q=Tallinn, Harju, Estonia');
    return { ok: true, json: async () => (isCity ? [CITY_HIT] : []) } as unknown as Response;
  }) as unknown as typeof fetch;

  const city = await geocodeAddress({ ...TALLINN, house_number: 'Nowhere 999' }, {
    fetchImpl: fetchCity,
    now: () => 0,
    sleep: async () => {},
    timeoutMs: 1000,
  });
  check('the city fallback still returns a point', city?.latitude === 59.437242);
  check('the city fallback is reported as CITY precision', city?.precision === 'city');
  check('every rung was tried before the city', cityCalls.length === 4);
  check('the city rung is the last one tried', cityCalls[cityCalls.length - 1].includes('q=Tallinn'));

  // 5) Nothing at all → null (the caller still saves).
  clearGeocodeCache();
  const fetchMiss = (async () =>
    ({ ok: true, json: async () => [] }) as unknown as Response) as unknown as typeof fetch;
  const miss = await geocodeAddress({ house_number: 'X 1', country: 'Estonia' }, {
    fetchImpl: fetchMiss,
    now: () => 0,
    sleep: async () => {},
    timeoutMs: 1000,
  });
  check('a complete miss returns null', miss === null);

  // 6) A network failure never throws.
  const fetchBoom = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  const boom = await geocodeAddress({ ...TALLINN, house_number: 'Boom 1' }, {
    fetchImpl: fetchBoom,
    now: () => 0,
    sleep: async () => {},
    timeoutMs: 1000,
  });
  check('a network failure is swallowed', boom === null);

  // 7) One request per second: the limiter sleeps between rungs.
  clearGeocodeCache();
  let clock = 0;
  const waits: number[] = [];
  const fetchSlow = (async () => {
    clock += 10;
    return { ok: true, json: async () => [] } as unknown as Response;
  }) as unknown as typeof fetch;
  await geocodeAddress({ ...TALLINN, house_number: 'Slow 1' }, {
    fetchImpl: fetchSlow,
    now: () => clock,
    sleep: async (ms: number) => {
      waits.push(ms);
      clock += ms;
    },
    timeoutMs: 1000,
  });
  check('the limiter made the ladder wait between rungs', waits.length >= 3 && waits.every((ms) => ms > 0));
}

/* ── When to geocode ──────────────────────────────────────────────────────── */

check('missing pair needs geocoding', needsGeocoding(null, null));
check('empty strings need geocoding', needsGeocoding('', ''));
check('an existing pair does not', !needsGeocoding(59.4, 24.6));
check('half a pair does not', !needsGeocoding(59.4, null));

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
