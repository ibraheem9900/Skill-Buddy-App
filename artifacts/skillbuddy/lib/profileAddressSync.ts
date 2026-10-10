/**
 * profileAddressSync.ts
 *
 * Pure rules behind the wizard's Service Address step: is the address being
 * posted different from the one saved on the profile, and what exactly should
 * be written back when it is?
 *
 * ── WHICH ENDPOINTS (live OpenAPI, tag "Addresses") ────────────────────────
 *   GET  /api/v1/addresses      "Get My Address"    → AddressResponse
 *   PUT  /api/v1/addresses/{id} "Update Address"    → AddressResponse
 *   POST /api/v1/addresses      "Create Address"    → AddressResponse
 * All three take/return the same optional-field Address shape
 * (country_id, county_id, city_id, house_number, street_address, postal_code,
 * landmark, formatted_address, latitude, longitude, is_default), so a job
 * address and a profile address are the same shape and can be compared
 * field-for-field.
 *
 * latitude/longitude are deliberately NOT sent: the wizard has no map picker
 * and never captures coordinates, so writing any value (0 included) would be a
 * fabrication — the schema accepts null and both endpoints leave an absent
 * coordinate untouched.
 *
 * No React and no axios, so every rule here is unit-testable.
 */

import type { AddressCreatePayload, AddressResponse } from '@/types';

/** The address fields the wizard collects and compares. */
export interface ProfileAddressForm {
  countryId: number | null;
  countyId: number | null;
  cityId: number | null;
  streetAddress: string;
  houseNumber: string;
  postalCode: string;
  landmark: string;
}

/** Trimmed string, or '' — never null, so comparisons never throw. */
function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Text comparison is case-insensitive: "Main street 5" re-typed as
 * "Main Street 5" is the SAME address, and re-writing the profile for a
 * capitalisation change would be a pointless, surprising update.
 */
function sameText(saved: unknown, entered: unknown): boolean {
  return normalize(saved).toLowerCase() === normalize(entered).toLowerCase();
}

/** The id of a nested country/county/city object, or null. */
function nestedId(value: { id?: number } | null | undefined): number | null {
  return value && typeof value.id === 'number' ? value.id : null;
}

/**
 * Does the address being posted differ from the profile's saved address?
 *
 * `saved === null/undefined` means the profile has NO address yet, which is
 * always a difference (posting one saves it) — that is the "saved address was
 * empty, saving it counts the same way" case, not a false positive.
 * Every field is compared: country_id, county_id, city_id, street_address,
 * house_number, postal_code, landmark (normalised as described above).
 */
export function profileAddressDiffers(
  form: ProfileAddressForm,
  saved: AddressResponse | null | undefined
): boolean {
  if (!saved) return true;
  return (
    nestedId(saved.country) !== form.countryId ||
    nestedId(saved.county) !== form.countyId ||
    nestedId(saved.city) !== form.cityId ||
    !sameText(saved.street_address, form.streetAddress) ||
    !sameText(saved.house_number, form.houseNumber) ||
    !sameText(saved.postal_code, form.postalCode) ||
    !sameText(saved.landmark, form.landmark)
  );
}

/** Fallback `formatted_address` from street + house + postal, or null. */
export function composeProfileFormattedAddress(form: ProfileAddressForm): string | null {
  const parts = [normalize(form.streetAddress), normalize(form.houseNumber), normalize(form.postalCode)]
    .filter((part) => part.length > 0)
    .join(', ');
  return parts.length > 0 ? parts : null;
}

/**
 * The body both address endpoints accept (AddressCreate / AddressUpdate share
 * this shape). Ids are integers from the geo cascade, text fields are trimmed
 * with blank → null, and coordinates stay absent on purpose (see header).
 */
export function buildProfileAddressPayload(
  form: ProfileAddressForm,
  formattedAddress?: string | null
): AddressCreatePayload {
  const street = normalize(form.streetAddress);
  const house = normalize(form.houseNumber);
  const postal = normalize(form.postalCode);
  const landmark = normalize(form.landmark);
  const formatted = normalize(formattedAddress) || composeProfileFormattedAddress(form);

  return {
    country_id: form.countryId,
    county_id: form.countyId,
    city_id: form.cityId,
    house_number: house.length > 0 ? house : null,
    street_address: street.length > 0 ? street : null,
    postal_code: postal.length > 0 ? postal : null,
    landmark: landmark.length > 0 ? landmark : null,
    formatted_address: formatted,
  };
}
