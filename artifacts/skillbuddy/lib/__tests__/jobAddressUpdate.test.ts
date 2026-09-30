/**
 * Unit tests for the Update Job Address helpers (PATCH /api/v1/jobs/{job_id}/address).
 *
 * There is no test runner in this workspace (no jest/vitest/tsx), so these tests are
 * compiled with the project's own TypeScript and executed with plain node:
 *
 *   pnpm run test          (from artifacts/skillbuddy)
 *   pnpm run test -- --verbose
 *
 * Only the pure rules are covered — what the app PRE-FILLS from the cached address and
 * what it SENDS in the full PATCH body. No React, no axios, no network.
 */
import {
  buildUpdateJobAddressRequest,
  canUpdateJobAddress,
  hydrateFromCachedAddress,
  mapJobAddressUpdateErrors,
  parseCoordinate,
  selectCity,
  selectCountry,
  selectCounty,
  validateJobAddressUpdate,
} from '../jobAddressUpdate';
import type { JobAddressUpdateValues } from '../jobAddressUpdate';

declare const console: { log: (msg: string) => void };

let passed = 0;
export const failures: string[] = [];

function check(label: string, condition: boolean): void {
  if (condition) {
    passed += 1;
  } else {
    failures.push(label);
  }
}

function eq(label: string, actual: unknown, expected: unknown): void {
  check(
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    actual === expected
  );
}

/* ---------------------------------------------------------------- fixtures */

/** A cached JobAddressResponse: coordinates come back as numeric STRINGS. */
const cached = {
  id: 7,
  job_id: 42,
  latitude: '41.0082',
  longitude: '28.9784',
  house_number: '12',
  street_address: '  Bağdat Caddesi  ',
  postal_code: '34710',
  landmark: 'Across from the mosque',
  formatted_address: 'Bağdat Caddesi 12, Kadıköy, İstanbul',
  country: { id: 1, name: 'Turkey', iso2: 'TR', iso3: 'TUR', phone_code: '+90' },
  county: { id: 34, name: 'İstanbul' },
  city: { id: 341, name: 'Kadıköy' },
  created_at: '2026-09-28T14:47:32.675Z',
  updated_at: '2026-09-28T14:47:32.675Z',
} as any;

const validValues: JobAddressUpdateValues = {
  countryId: 1,
  countyId: 34,
  cityId: 341,
  latitude: 41.0082,
  longitude: 28.9784,
  houseNumber: '12',
  streetAddress: 'Bağdat Caddesi',
  postalCode: '34710',
  landmark: 'Across from the mosque',
  formattedAddress: 'Bağdat Caddesi 12, Kadıköy, İstanbul',
};

/* ------------------------------------------------- parseCoordinate (lat/lng) */

eq('parseCoordinate numeric string (lat)', parseCoordinate('41.0082', 'lat'), 41.0082);
eq('parseCoordinate number (lng)', parseCoordinate(28.9784, 'lng'), 28.9784);
eq('parseCoordinate negative (lng)', parseCoordinate('-180', 'lng'), -180);
eq('parseCoordinate boundary lat 90', parseCoordinate('90', 'lat'), 90);
eq('parseCoordinate boundary lat -90', parseCoordinate(-90, 'lat'), -90);
eq('parseCoordinate boundary lng 180', parseCoordinate('180', 'lng'), 180);
eq('parseCoordinate lat 90.1 rejected', parseCoordinate('90.1', 'lat'), null);
eq('parseCoordinate lat 91 rejected', parseCoordinate('91', 'lat'), null);
eq('parseCoordinate lng 181 rejected', parseCoordinate('181', 'lng'), null);
eq('parseCoordinate junk rejected', parseCoordinate('not-a-number', 'lng'), null);
eq('parseCoordinate empty rejected', parseCoordinate('', 'lat'), null);
eq('parseCoordinate null rejected', parseCoordinate(null, 'lat'), null);
eq('parseCoordinate undefined rejected', parseCoordinate(undefined, 'lng'), null);

/* ----------------------------------------------- prefill from cached address */

const hydrated = hydrateFromCachedAddress(cached);
eq('prefill latitude parsed to number', hydrated.latitude, 41.0082);
eq('prefill longitude parsed to number', hydrated.longitude, 28.9784);
check(
  'prefill latitude is a NUMBER, not the response string',
  typeof hydrated.latitude === 'number'
);
eq('prefill country id from nested country.id', hydrated.countryId, 1);
eq('prefill county id from nested county.id', hydrated.countyId, 34);
eq('prefill city id from nested city.id', hydrated.cityId, 341);
eq('prefill street trimmed', hydrated.streetAddress, 'Bağdat Caddesi');
eq('prefill house number', hydrated.houseNumber, '12');
eq('prefill postal code', hydrated.postalCode, '34710');
eq('prefill landmark', hydrated.landmark, 'Across from the mosque');
eq(
  'prefill formatted_address kept verbatim',
  hydrated.formattedAddress,
  cached.formatted_address
);

const inflated = hydrateFromCachedAddress({
  ...cached,
  latitude:
    '-0.0000000000000000000000000000000000303042468818594956779191612452582705543667732684871159553572906940816083262031823975047175937676412820',
  longitude: '355601325393085389777',
} as any);
check('inflated in-range-ish lat is not a guessed 0', inflated.latitude !== 0);
eq('inflated out-of-range longitude rejected', inflated.longitude, null);

const empty = hydrateFromCachedAddress(null);
eq('prefill(null) latitude', empty.latitude, null);
eq('prefill(null) longitude', empty.longitude, null);
eq('prefill(null) countryId', empty.countryId, null);
eq('prefill(null) streetAddress', empty.streetAddress, '');
eq('prefill(null) formattedAddress', empty.formattedAddress, '');

const missingGeo = hydrateFromCachedAddress({
  ...cached,
  country: null,
  county: null,
  city: null,
} as any);
eq('prefill missing country object → null id', missingGeo.countryId, null);
eq('prefill missing county object → null id', missingGeo.countyId, null);
eq('prefill missing city object → null id', missingGeo.cityId, null);

/* ------------------------------------------------------------ client-side rules */

const emptyValidation = validateJobAddressUpdate({
  ...validValues,
  countryId: null,
  countyId: null,
  cityId: null,
  streetAddress: '',
  latitude: null,
  longitude: null,
});
check('empty form is invalid', emptyValidation.ok === false);
eq('empty form country required', emptyValidation.fieldErrors.country_id, 'addr_c_err_required');
eq('empty form county required', emptyValidation.fieldErrors.county_id, 'addr_c_err_required');
eq('empty form city required', emptyValidation.fieldErrors.city_id, 'addr_c_err_required');
eq(
  'empty form street required',
  emptyValidation.fieldErrors.street_address,
  'addr_c_err_required'
);
eq('empty form lat flagged', emptyValidation.fieldErrors.latitude, 'addr_u_invalid_coords');
eq('empty form lng flagged', emptyValidation.fieldErrors.longitude, 'addr_u_invalid_coords');

const okValidation = validateJobAddressUpdate(validValues);
check('complete form is valid', okValidation.ok === true);
check(
  'complete form has no field errors',
  Object.keys(okValidation.fieldErrors).length === 0
);

const badLat = validateJobAddressUpdate({ ...validValues, latitude: 91 });
check('lat 91 invalid', badLat.ok === false);
eq('lat 91 flagged on latitude only', badLat.fieldErrors.latitude, 'addr_u_invalid_coords');
eq('lat 91 leaves longitude clean', badLat.fieldErrors.longitude, undefined);

const badLng = validateJobAddressUpdate({ ...validValues, longitude: 181 });
check('lng 181 invalid', badLng.ok === false);
eq('lng 181 flagged on longitude only', badLng.fieldErrors.longitude, 'addr_u_invalid_coords');

const blankStreet = validateJobAddressUpdate({ ...validValues, streetAddress: '   ' });
eq(
  'whitespace-only street is required',
  blankStreet.fieldErrors.street_address,
  'addr_c_err_required'
);

/* ----------------------------------------------------------------- the PATCH body */

const payload = buildUpdateJobAddressRequest(validValues as any);

check(
  'body has exactly the 10 documented schema fields',
  JSON.stringify(Object.keys(payload).sort()) ===
    JSON.stringify(
      [
        'city_id',
        'country_id',
        'county_id',
        'formatted_address',
        'house_number',
        'landmark',
        'latitude',
        'longitude',
        'postal_code',
        'street_address',
      ].sort()
    )
);
check('body latitude is a NUMBER on the wire', typeof payload.latitude === 'number');
check('body longitude is a NUMBER on the wire', typeof payload.longitude === 'number');
eq('body latitude value', payload.latitude, 41.0082);
eq('body longitude value', payload.longitude, 28.9784);
check('body country_id is an integer', Number.isInteger(payload.country_id));
check('body county_id is an integer', Number.isInteger(payload.county_id));
check('body city_id is an integer', Number.isInteger(payload.city_id));
eq('body country_id', payload.country_id, 1);
eq('body county_id', payload.county_id, 34);
eq('body city_id', payload.city_id, 341);
eq('body house_number', payload.house_number, '12');
eq('body street_address', payload.street_address, 'Bağdat Caddesi');
eq('body postal_code', payload.postal_code, '34710');
eq('body landmark', payload.landmark, 'Across from the mosque');
eq(
  'body formatted_address kept when the user supplied one',
  payload.formatted_address,
  'Bağdat Caddesi 12, Kadıköy, İstanbul'
);

const serialized = JSON.parse(JSON.stringify(payload));
check(
  'coordinates are numbers in the serialized JSON too',
  typeof serialized.latitude === 'number' && typeof serialized.longitude === 'number'
);
check(
  'coordinates are NOT strings in the serialized JSON',
  serialized.latitude !== '41.0082' && serialized.longitude !== '28.9784'
);

const blankOptionals = buildUpdateJobAddressRequest({
  ...validValues,
  houseNumber: '   ',
  postalCode: '',
  landmark: '  ',
} as any);
eq('blank house_number → null', blankOptionals.house_number, null);
eq('blank postal_code → null', blankOptionals.postal_code, null);
eq('blank landmark → null', blankOptionals.landmark, null);

const composed = buildUpdateJobAddressRequest({
  ...validValues,
  streetAddress: 'Main Street',
  houseNumber: '5',
  postalCode: '11111',
  formattedAddress: '   ',
} as any);
eq(
  'blank formatted_address falls back to a composed line',
  composed.formatted_address,
  'Main Street, 5, 11111'
);

/* ------------------------------------------------------------- 422 field mapping */

const mapped = mapJobAddressUpdateErrors([
  { loc: ['body', 'latitude'], msg: 'Input should be a valid number', type: 'x', input: 'a' },
  { loc: ['body', 'city_id'], msg: 'City does not exist', type: 'x', input: 9 },
  { loc: ['body', 'street_address'], msg: 'Street is required', type: 'x', input: '' },
  { loc: ['body'], msg: 'Something else went wrong', type: 'x', input: null },
] as any);
eq(
  '422 latitude lands on the latitude input',
  mapped.fieldErrors.latitude,
  'Input should be a valid number'
);
eq('422 city_id lands on the city picker', mapped.fieldErrors.city_id, 'City does not exist');
eq(
  '422 street_address lands on the street input',
  mapped.fieldErrors.street_address,
  'Street is required'
);
check(
  'unknown 422 item surfaces as a form-level message',
  mapped.formErrors.includes('Something else went wrong')
);

const prefixed = mapJobAddressUpdateErrors([
  { loc: ['latitude'], msg: 'no body prefix' },
] as any);
eq('422 loc without the body prefix still routes', prefixed.fieldErrors.latitude, 'no body prefix');

const noDetail = mapJobAddressUpdateErrors(undefined);
check('422 with no detail yields no field errors', Object.keys(noDetail.fieldErrors).length === 0);
check('422 with no detail yields no form errors', noDetail.formErrors.length === 0);

const firstWins = mapJobAddressUpdateErrors([
  { loc: ['body', 'longitude'], msg: 'first' },
  { loc: ['body', 'longitude'], msg: 'second' },
] as any);
eq('first 422 message per field wins', firstWins.fieldErrors.longitude, 'first');

/* ------------------------------------------------------------------ cascade rules */

const base = { countryId: 1, countyId: 34, cityId: 341 };
const afterCountry = selectCountry(base, 2);
eq('country change keeps the new country', afterCountry.countryId, 2);
eq('country change clears county', afterCountry.countyId, null);
eq('country change clears city', afterCountry.cityId, null);
check('re-picking the same country returns the same object', selectCountry(base, 1) === base);

const afterCounty = selectCounty(base, 35);
eq('county change keeps country', afterCounty.countryId, 1);
eq('county change keeps the new county', afterCounty.countyId, 35);
eq('county change clears city', afterCounty.cityId, null);

const afterCity = selectCity(base, 342);
eq('city change keeps country', afterCity.countryId, 1);
eq('city change keeps county', afterCity.countyId, 34);
eq('city change sets city', afterCity.cityId, 342);

/* ------------------------------------------------------------------ edit-only gate */

check(
  'canUpdateJobAddress true only for an editable job WITH an address',
  canUpdateJobAddress({ is_editable: true, address: cached }) === true
);
check(
  'canUpdateJobAddress false when the job is not editable',
  canUpdateJobAddress({ is_editable: false, address: cached }) === false
);
check(
  'canUpdateJobAddress false when the job has no address (that is POST, not PATCH)',
  canUpdateJobAddress({ is_editable: true, address: null }) === false
);
check('canUpdateJobAddress false for null job', canUpdateJobAddress(null) === false);
check('canUpdateJobAddress false for undefined job', canUpdateJobAddress(undefined) === false);

/* ------------------------------------------------------------------------- report */

export const summary = { passed, total: passed + failures.length };
console.log(`jobAddressUpdate: ${summary.passed}/${summary.total} assertions passed`);
