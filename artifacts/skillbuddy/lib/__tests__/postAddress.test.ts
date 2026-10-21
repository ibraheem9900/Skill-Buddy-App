/**
 * Step-4 address rules:
 *
 *   • whatever GET /api/v1/addresses returns (one object per the live schema,
 *     an array or a wrapper defensively) always becomes one clean list;
 *   • which address is pre-selected, and which ones can be posted to;
 *   • the job/address values taken from the chosen card;
 *   • FastAPI 422 details mapped onto the Add/Edit form's inputs.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import {
  addressFormFrom,
  addressLine,
  defaultAddressId,
  isAddressPostable,
  jobAddressFrom,
  mapAddressValidationErrors,
  normalizeAddressList,
  regionLine,
} from '../postAddress';
import type { AddressResponse } from '../../types';

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

const address = (over: Partial<AddressResponse> = {}): AddressResponse => ({
  id: 7,
  user_id: 1,
  latitude: null,
  longitude: null,
  house_number: '12',
  street_address: 'Main street',
  postal_code: '10111',
  landmark: 'Blue door',
  formatted_address: null,
  country: { id: 1, name: 'Estonia', iso2: 'EE' },
  county: { id: 2, name: 'Harju' },
  city: { id: 3, name: 'Tallinn' },
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z',
  ...over,
});

// ── Normalising the response ──────────────────────────────────────────────
eq('a single documented object becomes a one-item list', normalizeAddressList(address()).length, 1);
eq('a bare array is accepted', normalizeAddressList([address(), address({ id: 8 })]).length, 2);
eq(
  'an { addresses: [...] } wrapper is accepted',
  normalizeAddressList({ addresses: [address({ id: 9 })] })[0].id,
  9
);
eq('null becomes an empty list', normalizeAddressList(null).length, 0);
eq('a garbage body becomes an empty list', normalizeAddressList({ detail: 'nope' }).length, 0);
eq(
  'rows without an id are dropped',
  normalizeAddressList([address(), { street_address: 'x' } as unknown as AddressResponse]).length,
  1
);

// ── Which address starts selected ─────────────────────────────────────────
eq('nothing saved → nothing selected', defaultAddressId([]), null);
eq('a single saved address is the default', defaultAddressId([address()]), 7);
eq(
  'a flagged default wins when several exist',
  defaultAddressId([address({ id: 7 }), address({ id: 8, is_default: true })]),
  8
);
eq(
  'without a flag the first row is used',
  defaultAddressId([address({ id: 7 }), address({ id: 8 })]),
  7
);

// ── Postable = real country/county/city ids ───────────────────────────────
check('a full address can be posted to', isAddressPostable(address()));
check('a missing city cannot', !isAddressPostable(address({ city: null })));
check('a missing country cannot', !isAddressPostable(address({ country: null })));
check('no address cannot', !isAddressPostable(null));

// ── Job values taken from the card ────────────────────────────────────────
const values = jobAddressFrom(address());
eq('country id comes from the nested object', values.countryId, 1);
eq('county id comes from the nested object', values.countyId, 2);
eq('city id comes from the nested object', values.cityId, 3);
eq('text fields are carried as trimmed strings', values.streetAddress, 'Main street');
eq('a null formatted address becomes an empty string', values.formattedAddress, '');

eq('the card line falls back to house + street', addressLine(address()), '12 Main street');
eq(
  'the saved formatted address wins when present',
  addressLine(address({ formatted_address: '12 Main street, 10111 Tallinn' })),
  '12 Main street, 10111 Tallinn'
);
eq(
  'with no text at all it falls back to the city',
  addressLine(
    address({ formatted_address: '  ', house_number: null, street_address: null, city: { id: 3, name: 'Tallinn' } })
  ),
  'Tallinn'
);
eq('the region line joins city, county, country', regionLine(address()), 'Tallinn, Harju, Estonia');
eq('missing nested regions are skipped', regionLine(address({ county: null })), 'Tallinn, Estonia');

const form = addressFormFrom(address());
eq('the edit form starts from the saved country', form.countryId, 1);
eq('the edit form starts from the saved street', form.streetAddress, 'Main street');
eq('the edit form never invents coordinates', 'latitude' in form, false);
eq('the edit form has no name field to fabricate', 'name' in form, false);

// ── 422 → the input that owns it ──────────────────────────────────────────
const mapped = mapAddressValidationErrors([
  {
    loc: ['body', 'postal_code'],
    msg: 'String should have at most 20 characters',
    type: 'string_too_long',
  },
  { loc: ['body', 'city_id'], msg: 'Input should be a valid integer', type: 'int_parsing' },
  { loc: ['body'], msg: 'A completely different problem', type: 'value_error' },
]);
eq(
  'a postal-code error lands on the postal-code field',
  mapped.fieldErrors.postal_code,
  'String should have at most 20 characters'
);
eq(
  'a city error lands on the city picker',
  mapped.fieldErrors.city_id,
  'Input should be a valid integer'
);
eq('an unmapped detail becomes a form message', mapped.formErrors.length, 1);

const stringDetail = mapAddressValidationErrors('Address limit reached');
eq('a plain-string detail is a form message', stringDetail.formErrors[0], 'Address limit reached');
eq('and not a field error', Object.keys(stringDetail.fieldErrors).length, 0);
eq('no detail at all maps to nothing', mapAddressValidationErrors(null).formErrors.length, 0);

console.log(`postAddress: ${passed} checks, ${failures.length} failure(s)`);
if (failures.length > 0) throw new Error(`${failures.length} postAddress check(s) failed`);
