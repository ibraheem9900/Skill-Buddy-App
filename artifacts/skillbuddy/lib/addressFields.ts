/**
 * addressFields.ts — the ONE place the address fields' keyboards/limits live.
 *
 * BOSS FEEDBACK: "It doesn't allow to write text." / "House / Building number
 * is always in text form. E.g. Akadeemia tee 11/2 is a building number.
 * Apartment / Office Number is most of the time in numeric form."
 *
 * WHAT THE FIELDS ARE (the app's own mapping, unchanged):
 *   house_number    → "House / Building Number"  — the building line, TEXT
 *                     ("Akadeemia tee 11/2", "12a-3", "Pikk 5/7").
 *   street_address  → "Apartment / Office Number" — mostly a number, so the
 *                     numeric keypad is the DEFAULT ("36", "12A").
 *   postal_code     → unchanged (numeric).
 *
 * RULES:
 *   • the keyboard is ONE constant per field — switch a field's keypad by
 *     editing `ADDRESS_FIELD_KEYBOARD` below, nowhere else;
 *   • validation stays PERMISSIVE: no digits-only parsing, no stripping —
 *     house_number/acpartment are plain strings end-to-end, so a pasted or
 *     legacy value ("Akadeemia tee 11/2", "12A") is never rejected or edited;
 *   • lengths are sane caps only (the API documents no max for these strings,
 *     but the old form capped the house at 20 which is too short for a full
 *     Estonian building line).
 *
 * NOTE ON THE KEYPAD: a numeric keypad cannot type letters. Apartment values
 * like "12A" therefore have to be pasted (or the constant switched to
 * 'default'), which is exactly why the keyboard is a single, documented
 * setting instead of being hardcoded at each TextInput.
 */

export type AddressTextField = 'house_number' | 'street_address' | 'postal_code';

/**
 * THE setting. Change one value to switch that field's keyboard app-wide
 * ('default' = full text keyboard, 'number-pad' = digits only).
 */
export const ADDRESS_FIELD_KEYBOARD: Record<AddressTextField, 'default' | 'number-pad'> = {
  house_number: 'default',
  street_address: 'number-pad',
  postal_code: 'number-pad',
};

/** Sane caps — long enough for real building lines, short enough for the API. */
export const ADDRESS_FIELD_MAX_LENGTH: Record<AddressTextField, number> = {
  house_number: 100,
  // Generous on purpose: "12A", "Office 4, 3rd floor" — the cap is only a
  // guardrail and must never reject a value that already exists on the server.
  street_address: 50,
  postal_code: 20,
};

/** Narrower: is this string one of the three fields this module governs? */
export function isAddressField(field: string): field is AddressTextField {
  return field === 'house_number' || field === 'street_address' || field === 'postal_code';
}

/** The keyboard type for a field (undefined → TextInput default). */
export function addressFieldKeyboard(field: AddressTextField): 'default' | 'number-pad' {
  return ADDRESS_FIELD_KEYBOARD[field] ?? 'default';
}

/** The TextInput `maxLength` for a field. */
export function addressFieldMaxLength(field: AddressTextField): number | undefined {
  return ADDRESS_FIELD_MAX_LENGTH[field];
}

/**
 * House / Building Number is FREE TEXT: only a length cap applies. Returns the
 * value unchanged when it fits, so the form never silently edits what the user
 * typed (or pasted) — a legacy "Akadeemia tee 11/2" round-trips exactly.
 */
export function normalizeHouseNumber(value: unknown, maxLength = ADDRESS_FIELD_MAX_LENGTH.house_number): string {
  if (typeof value !== 'string') return '';
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * Apartment / Office Number keeps letters ("12A") — it is only length-capped,
 * exactly like the house field. (The numeric KEYPAD is a convenience, never a
 * validation rule.)
 */
export function normalizeApartmentNumber(
  value: unknown,
  maxLength = ADDRESS_FIELD_MAX_LENGTH.street_address
): string {
  if (typeof value !== 'string') return '';
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/** Return-key order on every address form: House → Apartment → Postal. */
export function addressFieldReturnKey(
  field: AddressTextField
): 'next' | 'done' {
  return field === 'postal_code' ? 'done' : 'next';
}
