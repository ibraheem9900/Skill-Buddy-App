/**
 * ONE coordinate resolver for every address write (Fix 2):
 *   • a stored pair is reused with NO network;
 *   • a missing pair is geocoded from the address's own text;
 *   • one retry on failure, then null (callers decide);
 *   • the device GPS is never consulted;
 *   • haversineKm gives the distance the 5 km provider radius is about.
 */
import {
  existingCoordinates,
  haversineKm,
  needsCoordinates,
  parseCoordinateValue,
  resolveCoordinates,
} from '../coordinates';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean) {
  if (ok) {
    passed += 1;
  } else {
    failures.push(label);
    console.log(`FAIL ${label}`);
  }
}

function eq<T>(label: string, actual: T, expected: T) {
  check(`${label} (got ${String(actual)}, want ${String(expected)})`, actual === expected);
}

const TALLINN = {
  house_number: 'Akadeemia tee 11/2',
  street_address: '36',
  postal_code: '12616',
  city: 'Tallinn',
  county: 'Harju',
  country: 'Estonia',
};

/* ── Coordinate parsing ───────────────────────────────────────────────────── */

eq('a numeric string parses', parseCoordinateValue('59.43', 'lat'), 59.43);
eq('a number parses', parseCoordinateValue(24.75, 'lng'), 24.75);
eq('blank is missing', parseCoordinateValue('  ', 'lat'), null);
eq('null is missing', parseCoordinateValue(null, 'lat'), null);
eq('out-of-range latitude is rejected', parseCoordinateValue('91', 'lat'), null);
eq('out-of-range longitude is rejected', parseCoordinateValue('181', 'lng'), null);
eq('0/0 counts as a missing pair', parseCoordinateValue(0, 'lat'), null);
eq('garbage is rejected', parseCoordinateValue('abc', 'lng'), null);

const pair = existingCoordinates({ latitude: '59.4372', longitude: '24.7573' });
eq('a stored pair is reused', pair?.latitude, 59.4372);
eq('both halves come together', pair?.longitude, 24.7573);
eq('a half pair is no pair', existingCoordinates({ latitude: '59.4', longitude: null }), null);
eq('no source is no pair', existingCoordinates(null), null);

check('a stored pair needs no lookup', !needsCoordinates({ latitude: '59.4', longitude: '24.7' }));
check('an empty address needs a lookup', needsCoordinates({}));
check(
  'a half pair needs a lookup',
  needsCoordinates({ latitude: '59.4', longitude: '' })
);

/* ── Reuse never touches the network ──────────────────────────────────────── */

async function runAsyncChecks() {
  let calls = 0;
  const fakeFetch = (async () => {
    calls += 1;
    return { ok: true, json: async () => [{ lat: '59.4', lon: '24.7' }] } as any;
  }) as unknown as typeof fetch;

  const reused = await resolveCoordinates(
    { ...TALLINN, latitude: '59.4372', longitude: '24.7573' },
    { fetchImpl: fakeFetch }
  );
  eq('the stored coordinates are returned', reused?.latitude, 59.4372);
  eq('and no request was made', calls, 0);

  /* ── Geocoding a new address ────────────────────────────────────────────── */

  const requests: { url: string; ua: string }[] = [];
  const geocodingFetch = (async (url: string, init?: any) => {
    requests.push({ url: String(url), ua: String(init?.headers?.['User-Agent'] ?? '') });
    return { ok: true, json: async () => [{ lat: '59.4271224', lon: '24.6622459' }] } as any;
  }) as unknown as typeof fetch;

  const resolved = await resolveCoordinates(TALLINN, { fetchImpl: geocodingFetch });
  eq('the geocoded latitude is returned', resolved?.latitude, 59.4271224);
  eq('the geocoded longitude is returned', resolved?.longitude, 24.6622459);
  eq('one request was made', requests.length, 1);
  check('the address text was sent', requests[0].url.includes('city=Tallinn'));
  check('the postal code was sent', requests[0].url.includes('postalcode=12616'));
  check('the identifying User-Agent was sent', requests[0].ua.includes('SkillBuddy-Mobile'));

  /* ── One retry, then give up cleanly ────────────────────────────────────── */

  let attempts = 0;
  const flakyFetch = (async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('offline');
    return { ok: true, json: async () => [{ lat: '59.43', lon: '24.75' }] } as any;
  }) as unknown as typeof fetch;

  const retried = await resolveCoordinates(TALLINN, {
    fetchImpl: flakyFetch,
    retryDelayMs: 0,
    now: () => 0,
    sleep: async () => undefined,
  });
  eq('a failed first attempt is retried', attempts, 2);
  eq('and the retry succeeds', retried?.latitude, 59.43);

  let alwaysFails = 0;
  const downFetch = (async () => {
    alwaysFails += 1;
    throw new Error('still offline');
  }) as unknown as typeof fetch;
  const missing = await resolveCoordinates(TALLINN, {
    fetchImpl: downFetch,
    retryDelayMs: 0,
    now: () => 0,
    sleep: async () => undefined,
  });
  eq('two failed queries give up', alwaysFails, 2);
  eq('and return null instead of a guess', missing, null);
}

/* ── Distance (the 5 km radius) ───────────────────────────────────────────── */

const tallinn = { latitude: 59.437, longitude: 24.757 };
const samePlace = haversineKm(tallinn, tallinn);
check('the same point is zero km', samePlace < 0.001);

const fiveKmNorth = { latitude: 59.482, longitude: 24.757 };
const five = haversineKm(tallinn, fiveKmNorth);
check(`~5 km north is about five km (${five.toFixed(2)})`, five > 4.6 && five < 5.4);

const lahore = { latitude: 31.53, longitude: 74.37 };
const far = haversineKm(tallinn, lahore);
check(`Tallinn → Lahore is thousands of km (${Math.round(far)})`, far > 4000 && far < 6000);

eq(
  'distance is symmetric',
  Math.round(haversineKm(tallinn, lahore)),
  Math.round(haversineKm(lahore, tallinn))
);

void (async () => {
  try {
    await runAsyncChecks();
  } catch (error) {
    failures.push(`flow threw: ${(error as Error).message}`);
  }
  console.log(`coordinates: ${passed} checks, ${failures.length} failure(s)`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} coordinates checks failed`);
  }
})();
