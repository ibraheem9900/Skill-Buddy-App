/**
 * The address field keyboards (Fix 4):
 *   • House / Building Number = TEXT (letters, digits, "/" …), never numeric;
 *   • Apartment / Office Number = numeric keypad by DEFAULT, one constant away
 *     from text, and still a plain string in validation ("12A" survives);
 *   • return order House → Apartment → Postal.
 */
import {
  ADDRESS_FIELD_KEYBOARD,
  ADDRESS_FIELD_MAX_LENGTH,
  addressFieldKeyboard,
  addressFieldMaxLength,
  addressFieldReturnKey,
  isAddressField,
  normalizeApartmentNumber,
  normalizeHouseNumber,
} from '../addressFields';

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

/* ── Keyboard types ───────────────────────────────────────────────────────── */

eq('House / Building Number is TEXT', addressFieldKeyboard('house_number'), 'default');
eq('Apartment / Office Number is numeric', addressFieldKeyboard('street_address'), 'number-pad');
eq('Postal code stays numeric', addressFieldKeyboard('postal_code'), 'number-pad');
eq(
  'one constant is the only place the setting lives',
  ADDRESS_FIELD_KEYBOARD.house_number,
  'default'
);

check('house_number is a governed field', isAddressField('house_number'));
check('street_address is governed', isAddressField('street_address'));
check('postal_code is governed', isAddressField('postal_code'));
check('landmark is not governed', !isAddressField('landmark'));

/* ── Length caps (never numeric parsing) ──────────────────────────────────── */

eq('House accepts a long building line', addressFieldMaxLength('house_number'), 100);
eq('Apartment has a generous cap', addressFieldMaxLength('street_address'), 50);
eq('Postal keeps its short cap', addressFieldMaxLength('postal_code'), 20);

/* ── The values survive unchanged ─────────────────────────────────────────── */

const LEGACY = 'Akadeemia tee 11/2';
eq('a legacy house value round-trips exactly', normalizeHouseNumber(LEGACY), LEGACY);
eq('letters, digits and "/" are kept', normalizeHouseNumber('Pikk 5/7-3'), 'Pikk 5/7-3');
eq('apartment letters are kept', normalizeApartmentNumber('12A'), '12A');
eq('apartment punctuation is kept', normalizeApartmentNumber('12 A / 3'), '12 A / 3');
eq('a non-string becomes empty (never "NaN")', normalizeHouseNumber(undefined), '');
eq('a number is not parsed', normalizeHouseNumber(12 as unknown as string), '');

const tooLong = 'a'.repeat(120);
eq('an over-long house line is capped, not rejected', normalizeHouseNumber(tooLong).length, 100);
eq(
  'an over-long apartment is capped at its own limit',
  normalizeApartmentNumber('b'.repeat(80)).length,
  ADDRESS_FIELD_MAX_LENGTH.street_address
);

/* ── Return-key order ─────────────────────────────────────────────────────── */

eq('House → next', addressFieldReturnKey('house_number'), 'next');
eq('Apartment → next', addressFieldReturnKey('street_address'), 'next');
eq('Postal → done', addressFieldReturnKey('postal_code'), 'done');

console.log(`addressFields: ${passed} checks, ${failures.length} failure(s)`);
if (failures.length > 0) {
  throw new Error(`${failures.length} addressFields checks failed`);
}
