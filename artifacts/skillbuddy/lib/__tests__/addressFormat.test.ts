import {
  composeFormattedAddressFromFields,
  formatAddressLine,
  formatAddressLocality,
  formatAddressRegion,
  formatAddressStreet,
  hasAddressFieldValues,
  resolveFormattedAddressForSave,
} from '../addressFormat';

/**
 * The shared address formatter.
 *
 * The regression it must never reintroduce: the top card preferred the server's
 * legacy `formatted_address` (never recomputed on update) while the section below
 * showed the current fields — two different addresses on one screen. Current
 * fields win, always; the legacy string is only a last resort for a row that has
 * nothing else.
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

/* The boss's exact case: the legacy string is the OLD address, the fields are NEW. */
const STALE_ROW = {
  house_number: 'Akadeemia tee 11/2',
  street_address: '36',
  postal_code: '12616',
  formatted_address: 'Akademia tee 7A 24, Tallinn, Harju, Estonia',
  city: { name: 'Tallinn' },
  county: { name: 'Harju' },
  country: { name: 'Estonia' },
};

check('street line uses the CURRENT fields', formatAddressStreet(STALE_ROW) === 'Akadeemia tee 11/2 36');
check('locality carries the postal code + city', formatAddressLocality(STALE_ROW) === '12616 Tallinn');
check('region line is city, county, country', formatAddressRegion(STALE_ROW) === 'Tallinn, Harju, Estonia');
check(
  'full line is composed from the current fields',
  formatAddressLine(STALE_ROW) === 'Akadeemia tee 11/2 36, 12616 Tallinn, Harju, Estonia'
);
check(
  'the stale legacy string is NOT in the rendered line',
  !formatAddressLine(STALE_ROW).includes('Akademia tee 7A')
);
check('the row has real field values', hasAddressFieldValues(STALE_ROW));

/* A legacy-only row (no field values at all) still renders something. */
const LEGACY_ONLY = { formatted_address: 'Akademia tee 7A 24, Tallinn, Harju, Estonia' };
check('legacy-only row falls back to the stored string', formatAddressLine(LEGACY_ONLY) === 'Akademia tee 7A 24, Tallinn, Harju, Estonia');
check('legacy-only row has no field values', !hasAddressFieldValues(LEGACY_ONLY));
check('street of a legacy-only row is empty', formatAddressStreet(LEGACY_ONLY) === '');

/* Partial rows: whatever exists is used, in the fixed order. */
check(
  'city + country only',
  formatAddressLine({ city: { name: 'Tallinn' }, country: { name: 'Estonia' } }) === 'Tallinn, Estonia'
);
check('postal code without a city', formatAddressLocality({ postal_code: '12616' }) === '12616');
check('city without a postal code', formatAddressLocality({ city: { name: 'Tallinn' } }) === 'Tallinn');
check('street only', formatAddressLine({ house_number: 'Akadeemia tee 11/2' }) === 'Akadeemia tee 11/2');
check(
  'office number without a house number still shows',
  formatAddressStreet({ street_address: '36' }) === '36'
);

/* Whitespace and nulls never produce empty commas. */
check('no stray commas on a blank row', formatAddressLine({}) === '');
check('no stray commas with blank strings', formatAddressLine({ house_number: '   ', city: { name: '' } }) === '');
check('null address is empty', formatAddressLine(null) === '');
check('undefined address is empty', formatAddressLine(undefined) === '');
check('null city object is tolerated', formatAddressLine({ city: null, postal_code: '12616' }) === '12616');
check('trimmed parts', formatAddressStreet({ house_number: '  A 1  ', street_address: ' 2 ' }) === 'A 1 2');

/* The write-side composer: the legacy field is kept in sync with the fields. */
check(
  'compose keeps formatted_address consistent',
  composeFormattedAddressFromFields(STALE_ROW) === 'Akadeemia tee 11/2 36, 12616 Tallinn, Harju, Estonia'
);
check('compose of a blank row is null (the field is nullable server-side)', composeFormattedAddressFromFields({}) === null);

/*
 * The WRITE-side rule — the other half of the stale-text bug: the edit form
 * pre-fills the legacy string from the server and used to re-send it unchanged,
 * freezing the old address forever.
 */
check(
  'an UNTOUCHED legacy value is replaced by the composed current fields',
  resolveFormattedAddressForSave({
    typed: 'Akademia tee 7A 24, Tallinn, Harju, Estonia',
    storedLegacy: 'Akademia tee 7A 24, Tallinn, Harju, Estonia',
    fields: STALE_ROW,
  }) === 'Akadeemia tee 11/2 36, 12616 Tallinn, Harju, Estonia'
);
check(
  'a value the user typed is kept',
  resolveFormattedAddressForSave({
    typed: 'My own label',
    storedLegacy: 'Akademia tee 7A 24, Tallinn, Harju, Estonia',
    fields: STALE_ROW,
  }) === 'My own label'
);
check(
  'an empty field composes from the current fields',
  resolveFormattedAddressForSave({ typed: '', storedLegacy: null, fields: STALE_ROW }) ===
    'Akadeemia tee 11/2 36, 12616 Tallinn, Harju, Estonia'
);
check(
  'an empty field with no field values sends nothing',
  resolveFormattedAddressForSave({ typed: '   ', storedLegacy: 'old', fields: {} }) === null
);
check(
  'a legacy value with no field values survives (nothing better to send)',
  resolveFormattedAddressForSave({
    typed: 'Akademia tee 7A 24, Tallinn, Harju, Estonia',
    storedLegacy: 'Akademia tee 7A 24, Tallinn, Harju, Estonia',
    fields: {},
  }) === 'Akademia tee 7A 24, Tallinn, Harju, Estonia'
);

if (failures.length > 0) {
  console.log(`addressFormat: ${passed} checks, ${failures.length} failure(s) — ${failures.join(', ')}`);
  throw new Error(`${failures.length} addressFormat check(s) failed`);
} else {
  console.log(`addressFormat: ${passed} checks, 0 failure(s)`);
}
