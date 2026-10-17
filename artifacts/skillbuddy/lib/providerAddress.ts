/**
 * providerAddress.ts
 *
 * Pure logic behind the provider's own address — the other half of the
 * visibility prerequisite (guide §4.3): without a saved address WITH latitude
 * and longitude the provider is invisible to the nearby feed.
 *
 * LIVE-VERIFIED (2026-10-16, test provider id 3 / address id 2):
 *   GET    /addresses            200 a SINGLE AddressResponse (NOT an array);
 *                                latitude/longitude come back as decimal STRINGS
 *                                ("31.5300000")
 *   POST   /addresses            409 {"detail":"User already has an address."}
 *                                → ONE address per user; POST only for a user who
 *                                has none. A "second address" is impossible, which
 *                                is exactly why deleting the only one is the
 *                                destructive path this module warns about.
 *   PUT    /addresses            200 — PARTIAL update: sending {postal_code}
 *                                changed only that field and kept coordinates and
 *                                the country/county/city
 *   PUT    /addresses/{id}       200 — PARTIAL too (only {house_number} sent kept
 *                                everything else)
 *   PUT    lat/lng null          200, and GET /providers/me/nearby-jobs then answers
 *                                400 {"detail":"You are not visible for nearby jobs.
 *                                Save an address with coordinates, and make sure your
 *                                provider profile is active and approved."}
 *                                ← the real 400, recorded by nulling the coordinates
 *                                of the test address and restoring it (the address
 *                                row was never deleted: with POST refusing a second
 *                                address, a delete could not have been undone).
 *   DELETE /addresses            204 per the live schema (NOT probed: it would have
 *                                destroyed the only address — see the report)
 *
 * The coordinates are read through the SAME parser the address screens and the
 * job-address flow already use (`lib/jobAddressUpdate.parseCoordinate` — the
 * shared coordinates module this app gained with the address work), so a junk
 * string in the schema is null here for the same reasons it is null there.
 *
 * No React and no axios, so every rule below is unit-testable.
 */
import { parseCoordinate } from '@/lib/jobAddressUpdate';
import type { AddressResponse } from '@/types';

/** Live bounds, straight from AddressCreate/AddressUpdate (lat ±85.05112878). */
export const ADDRESS_LAT_LIMIT = 85.05112878;
export const ADDRESS_LNG_LIMIT = 180;

export interface AddressCoordinates {
  latitude: number;
  longitude: number;
}

/** A coordinate as the API may hand it over: the live AddressResponse sends a
 *  decimal STRING, but numbers (and null/undefined) must be just as safe — the
 *  shared parser is the same one the job-address flow uses. */
export type CoordinateInput = string | number | null | undefined;

/** Anything that carries a latitude/longitude pair (an AddressResponse, a
 *  cached row, or the form's own values). */
export interface CoordinatePairLike {
  latitude?: CoordinateInput;
  longitude?: CoordinateInput;
}

/**
 * The address's real coordinates, or null.
 *
 * BOTH must survive the strict parser: a provider with a latitude and no
 * longitude (or a junk string) is invisible to the feed, so "half a coordinate"
 * is not a location — it is the missing state, stated honestly.
 */
export function addressCoordinates(
  address: CoordinatePairLike | null | undefined
): AddressCoordinates | null {
  const latitude = parseCoordinate(address?.latitude, 'lat');
  const longitude = parseCoordinate(address?.longitude, 'lng');
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

export type AddressLocationStatus = 'saved' | 'missing';

/** The status the screen shows: derived from the real numbers, never a guess. */
export function addressLocationStatus(
  address: CoordinatePairLike | null | undefined
): AddressLocationStatus {
  return addressCoordinates(address) === null ? 'missing' : 'saved';
}

/** "31.53000, 74.37000" for display, or null when there is nothing truthful. */
export function addressCoordinateText(
  address: CoordinatePairLike | null | undefined
): string | null {
  const coords = addressCoordinates(address);
  if (coords === null) return null;
  return `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
}

/* ──────────────────────────────────────────────────────── form payloads ── */

/** The form's own fields (strings, because they come from TextInputs). */
export interface AddressFormValues {
  countryId: number | null;
  countyId: number | null;
  cityId: number | null;
  streetAddress: string;
  houseNumber: string;
  postalCode: string;
  landmark: string;
  formattedAddress: string;
  latitude: string;
  longitude: string;
}

export type AddressField =
  | 'country_id'
  | 'county_id'
  | 'city_id'
  | 'street_address'
  | 'latitude'
  | 'longitude';

export type AddressErrorKey =
  | 'addr_c_err_required'
  | 'addr_u_invalid_coords'
  | 'addr_u_coords_together';

/**
 * Coordinate-only rules, split out because BOTH address forms need exactly
 * these and nothing else from `validateAddressForm` when the cascade rules have
 * already been applied:
 *   - one of the two filled in is a half-location: the backend would store it
 *     and the feed would then ignore the address, so it is refused;
 *   - a value outside the live bounds (±85.05112878 lat / ±180 lng) is a typo;
 *   - both empty is legal — an address without coordinates is still a valid
 *     address, it just does not make the provider visible for nearby jobs.
 * Returns keys, not messages, so the caller translates them.
 */
export function validateAddressCoordinates(
  latitudeText: string,
  longitudeText: string
): { latitude?: AddressErrorKey; longitude?: AddressErrorKey } {
  const latText = latitudeText.trim();
  const lngText = longitudeText.trim();
  const latGiven = latText.length > 0;
  const lngGiven = lngText.length > 0;
  const errors: { latitude?: AddressErrorKey; longitude?: AddressErrorKey } = {};

  if (latGiven !== lngGiven) {
    if (!latGiven) errors.latitude = 'addr_u_coords_together';
    if (!lngGiven) errors.longitude = 'addr_u_coords_together';
  } else if (latGiven && lngGiven) {
    if (parseCoordinate(latText, 'lat') === null) errors.latitude = 'addr_u_invalid_coords';
    if (parseCoordinate(lngText, 'lng') === null) errors.longitude = 'addr_u_invalid_coords';
  }
  return errors;
}

/**
 * The coordinate pair the form should send: both parsed numbers, or BOTH null.
 * Never `0,0` (that would drop the provider in the Gulf of Guinea) and never a
 * half pair — the caller has already been shown why a half pair is refused.
 */
export function addressCoordinatesFromForm(
  latitudeText: string,
  longitudeText: string
): { latitude: number | null; longitude: number | null } {
  const latitude = parseCoordinate(latitudeText, 'lat');
  const longitude = parseCoordinate(longitudeText, 'lng');
  return latitude !== null && longitude !== null
    ? { latitude, longitude }
    : { latitude: null, longitude: null };
}

/**
 * Validate the form.
 *
 * The product minimum is the same one the existing address screens enforce
 * (country/county/city + street) — the live schema requires nothing at all, so
 * this is a product rule, not a server rule, and it is stated as such.
 *
 * COORDINATES: both or neither. One of the two is a half-location the backend
 * would happily store and the feed would then ignore; and a value outside the
 * live bounds (±85.05112878 lat) is a typo, not a coordinate.
 */
export function validateAddressForm(values: AddressFormValues): {
  ok: boolean;
  fieldErrors: Partial<Record<AddressField, AddressErrorKey>>;
} {
  const fieldErrors: Partial<Record<AddressField, AddressErrorKey>> = {};

  if (!values.countryId || !Number.isInteger(values.countryId) || values.countryId < 1)
    fieldErrors.country_id = 'addr_c_err_required';
  if (!values.countyId || !Number.isInteger(values.countyId) || values.countyId < 1)
    fieldErrors.county_id = 'addr_c_err_required';
  if (!values.cityId || !Number.isInteger(values.cityId) || values.cityId < 1)
    fieldErrors.city_id = 'addr_c_err_required';
  if (!values.streetAddress.trim()) fieldErrors.street_address = 'addr_c_err_required';

  Object.assign(fieldErrors, validateAddressCoordinates(values.latitude, values.longitude));

  return { ok: Object.keys(fieldErrors).length === 0, fieldErrors };
}

/** What the form sends. PUT is partial on the live API, so every field we hold
 *  is sent explicitly — never a diff against a stale snapshot. */
export interface AddressWriteBody {
  country_id: number;
  county_id: number;
  city_id: number;
  street_address: string;
  house_number: string | null;
  postal_code: string | null;
  landmark: string | null;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
}

const emptyToNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

/**
 * Build the request body. Coordinates are included ONLY when both parse: a form
 * with no coordinates sends none (never `0,0`, which would put the provider in
 * the Gulf of Guinea), and the caller has already been told to fix a half pair.
 */
export function buildAddressWriteBody(
  values: AddressFormValues & { countryId: number; countyId: number; cityId: number }
): AddressWriteBody {
  const coords = addressCoordinatesFromForm(values.latitude, values.longitude);

  return {
    country_id: values.countryId,
    county_id: values.countyId,
    city_id: values.cityId,
    street_address: values.streetAddress.trim(),
    house_number: emptyToNull(values.houseNumber),
    postal_code: emptyToNull(values.postalCode),
    landmark: emptyToNull(values.landmark),
    formatted_address: emptyToNull(values.formattedAddress),
    latitude: coords.latitude,
    longitude: coords.longitude,
  };
}

/**
 * Prefill the form from the saved address.
 *
 * The stored coordinates are decimal STRINGS ("31.5300000"); they are parsed
 * once here (via the same shared parser) and re-rendered as trimmed text, so an
 * edit screen never has to guess and never sends a value it did not show.
 */
export function addressFormFrom(
  address: AddressResponse | null | undefined
): AddressFormValues {
  const coords = addressCoordinates(address);
  return {
    countryId: address?.country?.id ?? null,
    countyId: address?.county?.id ?? null,
    cityId: address?.city?.id ?? null,
    streetAddress: address?.street_address ?? '',
    houseNumber: address?.house_number ?? '',
    postalCode: address?.postal_code ?? '',
    landmark: address?.landmark ?? '',
    formattedAddress: address?.formatted_address ?? '',
    latitude: coords === null ? '' : String(coords.latitude),
    longitude: coords === null ? '' : String(coords.longitude),
  };
}

/**
 * Should the screen CREATE or UPDATE? The live backend allows exactly one
 * address per user and refuses a second POST with 409, so an existing address is
 * always a PUT — even for a user whose stored address has no coordinates.
 */
export function addressWriteMethod(hasExistingAddress: boolean): 'POST' | 'PUT' {
  return hasExistingAddress ? 'PUT' : 'POST';
}

/** The translated warning key shown before deleting the provider's address. */
export const ADDRESS_DELETE_WARNING_KEY = 'provider_addr_delete_warning';

/** The translated status keys. */
export const ADDRESS_STATUS_SAVED_KEY = 'provider_addr_location_saved';
export const ADDRESS_STATUS_MISSING_KEY = 'provider_addr_location_missing';

/** The status line's key for one address. */
export function addressStatusKey(address: AddressResponse | null | undefined): 'provider_addr_location_saved' | 'provider_addr_location_missing' {
  return addressLocationStatus(address) === 'saved' ? ADDRESS_STATUS_SAVED_KEY : ADDRESS_STATUS_MISSING_KEY;
}
