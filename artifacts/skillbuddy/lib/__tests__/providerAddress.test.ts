/**
 * The provider's own address (GET/POST/PUT/DELETE /api/v1/addresses), unit-tested
 * against what the LIVE backend really did (2026-10-16, address id 2 of the test
 * provider): the 200 body carries latitude/longitude as decimal STRINGS
 * ("31.5300000"), a second POST answers 409 "User already has an address.", PUT
 * applies a partial update, and GET /providers/me/nearby-jobs answers 400 with
 * "You are not visible for nearby jobs..." once the coordinates are null.
 *
 * That 400 is the whole reason "Location saved / Location missing" is derived
 * from the REAL parsed pair and not from whether text fields look filled in, and
 * why the app insists on both coordinates together.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import {
  ADDRESS_DELETE_WARNING_KEY,
  ADDRESS_LAT_LIMIT,
  ADDRESS_LNG_LIMIT,
  ADDRESS_STATUS_MISSING_KEY,
  ADDRESS_STATUS_SAVED_KEY,
  addressCoordinateText,
  addressCoordinates,
  addressCoordinatesFromForm,
  addressFormFrom,
  addressLocationStatus,
  addressStatusKey,
  addressWriteMethod,
  buildAddressWriteBody,
  validateAddressCoordinates,
  validateAddressForm,
  type AddressFormValues,
} from '../providerAddress';
import type { AddressResponse } from '@/types';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(label);
}

function equal(label: string, actual: unknown, expected: unknown): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) failures.push(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  else passed += 1;
}

/** The live GET /api/v1/addresses body (verbatim, coordinates as strings). */
function liveAddress(overrides: Partial<AddressResponse> = {}): AddressResponse {
  return {
    id: 2,
    user_id: 2,
    latitude: '31.5300000',
    longitude: '74.3700000',
    house_number: null,
    street_address: null,
    postal_code: null,
    landmark: null,
    formatted_address: null,
    is_default: false,
    country: { id: 1, name: 'Estonia', iso2: 'EE', iso3: 'EST', phone_code: '+372' },
    county: { id: 1, name: 'Harju' },
    city: { id: 1, name: 'Tallinn' },
    created_at: '2026-10-07T12:00:00',
    updated_at: '2026-10-07T12:00:00',
    ...overrides,
  };
}

function form(overrides: Partial<AddressFormValues> = {}): AddressFormValues {
  return {
    countryId: 1,
    countyId: 1,
    cityId: 1,
    streetAddress: 'Main street',
    houseNumber: '5',
    postalCode: '',
    landmark: '',
    formattedAddress: '',
    latitude: '',
    longitude: '',
    ...overrides,
  };
}

/* ------------------------------------------------- location status (real) */

equal('the live decimal strings become numbers', addressCoordinates(liveAddress()), { latitude: 31.53, longitude: 74.37 });
equal('a numeric-string pair renders as text', addressCoordinateText(liveAddress()), '31.53000, 74.37000');
equal('numbers are accepted too', addressCoordinates({ latitude: 31.53, longitude: 74.37 }), { latitude: 31.53, longitude: 74.37 });
equal('the live address is a SAVED location', addressLocationStatus(liveAddress()), 'saved');
equal('its status key is the saved one', addressStatusKey(liveAddress()), ADDRESS_STATUS_SAVED_KEY);

// The failure mode this module exists for: an address row that exists but has
// no usable location is NOT "saved".
equal('null coordinates are the missing state', addressLocationStatus(liveAddress({ latitude: null, longitude: null })), 'missing');
equal('a missing status key is the missing one', addressStatusKey(liveAddress({ latitude: null, longitude: null })), ADDRESS_STATUS_MISSING_KEY);
equal('HALF a pair is the missing state, not saved', addressCoordinates(liveAddress({ longitude: null })), null);
equal('half a pair renders no coordinate text', addressCoordinateText(liveAddress({ longitude: null })), null);
equal('a junk string is the missing state', addressLocationStatus(liveAddress({ latitude: 'not-a-number' })), 'missing');
equal('the inflated placeholder junk is refused', addressLocationStatus(liveAddress({ latitude: '000000...95.957……' })), 'missing');
equal('a coordinate beyond ±90 is refused', addressCoordinates(liveAddress({ latitude: '95.5' })), null);
equal('an empty-string coordinate is refused', addressCoordinates(liveAddress({ latitude: '' })), null);
equal('no address at all is the missing state', addressLocationStatus(null), 'missing');
equal('the live bounds are the schema ones', `${ADDRESS_LAT_LIMIT}|${ADDRESS_LNG_LIMIT}`, '85.05112878|180');

/* ------------------------------------------------------ coordinate rules */

equal('both empty is legal (an address without a location)', validateAddressCoordinates('', ''), {});
equal('both set is legal', validateAddressCoordinates('31.53', '74.37'), {});
equal(
  'a latitude without a longitude is refused',
  validateAddressCoordinates('31.53', ''),
  { longitude: 'addr_u_coords_together' }
);
equal(
  'a longitude without a latitude is refused',
  validateAddressCoordinates('', '74.37'),
  { latitude: 'addr_u_coords_together' }
);
equal(
  'a value outside the bounds is refused',
  validateAddressCoordinates('95.5', '74.37'),
  { latitude: 'addr_u_invalid_coords' }
);
equal(
  'a non-numeric value is refused',
  validateAddressCoordinates('31.53', 'east'),
  { longitude: 'addr_u_invalid_coords' }
);
equal(
  'whitespace only counts as empty',
  validateAddressCoordinates('   ', ''),
  {}
);

equal('the pair is sent together', addressCoordinatesFromForm('31.53', '74.37'), { latitude: 31.53, longitude: 74.37 });
equal('no coordinates sends none (never 0,0)', addressCoordinatesFromForm('', ''), { latitude: null, longitude: null });
equal('a half pair sends NEITHER (no Gulf-of-Guinea pin)', addressCoordinatesFromForm('31.53', ''), { latitude: null, longitude: null });
equal('junk sends none', addressCoordinatesFromForm('x', 'y'), { latitude: null, longitude: null });
equal(
  'a numeric-string coordinate is parsed the same way',
  addressCoordinatesFromForm(' 31.5300000 ', '74.3700000'),
  { latitude: 31.53, longitude: 74.37 }
);

/* --------------------------------------------------------------- the form */

const ok = validateAddressForm(form());
check('a complete form validates', ok.ok);
equal('a complete form has no field errors', ok.fieldErrors, {});
const noCascade = validateAddressForm(form({ countryId: null, countyId: null, cityId: null, streetAddress: '' }));
check('the cascade + street are required (the booking minimum)', !noCascade.ok);
equal('all four missing fields are reported', Object.keys(noCascade.fieldErrors).length, 4);
equal(
  'the required message key is the existing one',
  noCascade.fieldErrors.country_id,
  'addr_c_err_required'
);
const halfPair = validateAddressForm(form({ latitude: '31.53' }));
check('the form refuses a half coordinate pair', !halfPair.ok);
equal('the half-pair message key is the shared one', halfPair.fieldErrors.longitude, 'addr_u_coords_together');
check('a form with a bad coordinate is refused', !validateAddressForm(form({ latitude: '999', longitude: '1' })).ok);
check('coordinates alone are valid on top of a complete form', validateAddressForm(form({ latitude: '1', longitude: '2' })).ok);

const body = buildAddressWriteBody({ ...form({ latitude: '31.53', longitude: '74.37' }), countryId: 1, countyId: 1, cityId: 1 });
equal('the body carries the country id', body.country_id, 1);
equal('the body pairs the coordinates as NUMBERS', [body.latitude, body.longitude], [31.53, 74.37]);
equal('blank optional text becomes null', [body.postal_code, body.landmark], [null, null]);
equal(
  'an empty coordinate form sends nulls, never 0',
  buildAddressWriteBody({ ...form(), countryId: 1, countyId: 1, cityId: 1 }).latitude,
  null
);

const prefilled = addressFormFrom(liveAddress());
equal('prefill renders the stored coordinates as text', [prefilled.latitude, prefilled.longitude], ['31.53', '74.37']);
equal('prefill reads the nested geo ids', [prefilled.countryId, prefilled.countyId, prefilled.cityId], [1, 1, 1]);
equal('prefill of an address without coordinates is empty', addressFormFrom(liveAddress({ latitude: null, longitude: null })).latitude, '');
equal('prefill of null is all empty', addressFormFrom(null).streetAddress, '');

check('one address per user: an existing row is a PUT', addressWriteMethod(true) === 'PUT');
check('no address at all is a POST', addressWriteMethod(false) === 'POST');

/* ------------------------------------------------- destructive-path copy */

equal('the delete warning key is the provider one', ADDRESS_DELETE_WARNING_KEY, 'provider_addr_delete_warning');
equal('the saved status key', ADDRESS_STATUS_SAVED_KEY, 'provider_addr_location_saved');
equal('the missing status key', ADDRESS_STATUS_MISSING_KEY, 'provider_addr_location_missing');

/* ----------------------------------------------------------------- report */
for (const failure of failures) console.log(`  ✗ ${failure}`);
console.log(`providerAddress: ${passed}/${passed + failures.length} assertions passed`);
