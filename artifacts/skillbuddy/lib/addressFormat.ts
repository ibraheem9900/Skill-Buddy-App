/**
 * addressFormat.ts — ONE formatter for every address the app displays.
 *
 * THE BUG THIS FIXES (boss report + screenshot): the big card at the top of
 * "Address Details" showed "Akademia tee 7A 24, Tallinn, Harju, Estonia" — the
 * OLD address — while the "Address" section right below it showed the NEW
 * values (house_number "Akadeemia tee 11/2", street_address "36"). The top card
 * was rendering `formatted_address`, a legacy single-string field the server
 * stores and does NOT recompute on update; every screen that preferred it showed
 * stale text, and the two sources could disagree on the same screen.
 *
 * THE RULE: address text is composed from the CURRENT fields — house/building
 * number, street/office number, postal code, city, county, country — by this
 * formatter, everywhere. `formatted_address` is data, not truth: it is used ONLY
 * as a last resort when the row carries no field values at all (a legacy row),
 * so no address ever renders as nothing.
 *
 * The type below is structural: AddressResponse and JobAddressResponse have the
 * same shape for these fields, so both can be passed in without a cast.
 */

/** The fields an address display can be built from (all nullable on the wire). */
export interface AddressLike {
  house_number?: string | null;
  street_address?: string | null;
  postal_code?: string | null;
  landmark?: string | null;
  /** The legacy single-string field — a LAST RESORT, never the first choice. */
  formatted_address?: string | null;
  city?: { name?: string | null } | null;
  county?: { name?: string | null } | null;
  country?: { name?: string | null } | null;
}

/** Trim, mapping anything unusable to ''. */
function text(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

/** Join the non-empty parts with ', '. */
function joinParts(parts: Array<string | null | undefined>): string {
  return parts.filter((part) => typeof part === 'string' && part.length > 0).join(', ');
}

/** Join the non-empty parts with a single space (the two halves of one line). */
function joinSpace(parts: Array<string | null | undefined>): string {
  return parts.filter((part) => typeof part === 'string' && part.length > 0).join(' ');
}

/**
 * The street line: house/building number then street/office number.
 *
 * ORDER MATTERS AND IS THE FORM'S OWN: the address form labels house_number as
 * "House / Building Number" (what the user types their street + building into,
 * e.g. "Akadeemia tee 11/2") and street_address as "Apartment / Office Number"
 * (e.g. "36"), so the house part comes first.
 */
export function formatAddressStreet(address: AddressLike | null | undefined): string {
  return joinSpace([text(address?.house_number), text(address?.street_address)]);
}

/** Postal code + city, e.g. "12616 Tallinn" (or just the city when there is no code). */
export function formatAddressLocality(address: AddressLike | null | undefined): string {
  const code = text(address?.postal_code);
  const city = text(address?.city?.name);
  if (code.length > 0 && city.length > 0) return `${code} ${city}`;
  return code.length > 0 ? code : city;
}

/** City, county, country — the region line, e.g. "Tallinn, Harju, Estonia". */
export function formatAddressRegion(address: AddressLike | null | undefined): string {
  return joinParts([text(address?.city?.name), text(address?.county?.name), text(address?.country?.name)]);
}

/**
 * The full single-line address, composed from the current fields.
 *
 * "Akadeemia tee 11/2 36, 12616 Tallinn, Harju, Estonia"
 *
 * Falls back to the legacy `formatted_address` ONLY when every current field is
 * empty (the row has nothing else to show) — never as a preference.
 */
export function formatAddressLine(address: AddressLike | null | undefined): string {
  const line = joinParts([
    formatAddressStreet(address),
    formatAddressLocality(address),
    text(address?.county?.name),
    text(address?.country?.name),
  ]);
  if (line.length > 0) return line;
  return text(address?.formatted_address);
}

/**
 * The string to SEND as `formatted_address` when saving.
 *
 * The server keeps this legacy field as sent and does not recompute it, so the
 * client keeps it consistent with the current fields instead of re-sending a
 * stale copy. Returns null when there is nothing to compose (the field is
 * nullable server-side).
 */
export function composeFormattedAddressFromFields(
  address: AddressLike | null | undefined
): string | null {
  const composed = joinParts([
    formatAddressStreet(address),
    formatAddressLocality(address),
    text(address?.county?.name),
    text(address?.country?.name),
  ]);
  return composed.length > 0 ? composed : null;
}

/**
 * The `formatted_address` value to SEND when saving an edit.
 *
 * The stale-text bug had two halves: the UI preferred the stored legacy string,
 * and the edit form also RE-SENT it unchanged (it pre-fills the field from the
 * server), so the server's copy kept the old address forever. This rule breaks
 * the second half:
 *
 *   • the user typed their own text (it differs from the stored value) → keep it;
 *   • the field is untouched (equal to the stored value) or empty → replace it
 *     with the line composed from the CURRENT fields, so the legacy field can no
 *     longer disagree with the values next to it.
 */
export function resolveFormattedAddressForSave(params: {
  /** What the form holds now. */
  typed: string;
  /** What the server had (the pre-filled value), when editing. */
  storedLegacy?: string | null;
  /** The CURRENT field values the address is built from. */
  fields: AddressLike;
}): string | null {
  const typed = text(params.typed);
  const stored = text(params.storedLegacy);
  const composed = composeFormattedAddressFromFields(params.fields);

  if (typed.length === 0) return composed;
  if (stored.length > 0 && typed === stored) return composed ?? typed;
  return typed;
}

/** Does this row carry any of the current field values (vs only the legacy string)? */
export function hasAddressFieldValues(address: AddressLike | null | undefined): boolean {
  return (
    formatAddressStreet(address).length > 0 ||
    formatAddressLocality(address).length > 0 ||
    formatAddressRegion(address).length > 0
  );
}
