import { composeFormattedAddress } from '@/lib/jobCreate';
import {
  selectCity,
  selectCountry,
  selectCounty,
  mapJobAddressErrors,
  type GeoCascade as GeoCascadeBase,
  type JobAddressField as JobAddressFieldBase,
} from '@/lib/jobAddress';
import type { JobAddressResponse, JobAddressUpdate, ValidationErrorDetail } from '@/types';

/**
 * jobAddressUpdate.ts — pure helpers behind the Update Job Address screen
 * (PATCH /api/v1/jobs/{job_id}/address, request schema JobAddressUpdate).
 *
 * EDIT-ONLY: acts on a job that ALREADY has an address. The form is pre-filled
 * from the cached JobAddressResponse (the "Get Job Address" payload), so the user
 * edits existing values rather than blank fields. latitude/longitude are sent as
 * NUMBERS; the cached response returns them as numeric strings, so they are
 * parseCoordinate'd before being handed to the map picker and before being sent.
 *
 * FULL BODY: the caller sends every field (partial bodies are NOT confirmed for
 * this endpoint), matching the task's full-body rule. The response (200) is the
 * source of truth — the cached job address is replaced whole.
 *
 * Reuses the same country → county → city cascade hooks and the same client-side
 * validation rules as "Create Job Address" (country/county/city required,
 * street_address required; house_number/postal_code/landmark optional). The
 * cascade reset rule is identical: changing country clears county and city;
 * changing county clears city.
 *
 * No React and no axios, so every rule below is unit-testable.
 */

/** Inputs that can receive a 422 message for the UPDATE schema (includes lat/lng). */
export type JobAddressUpdateField = JobAddressFieldBase | 'latitude' | 'longitude';

/** Error keys the screen can render for the update flow.
 *
 * The shared required/generic keys (addr_c_err_required, addr_c_err_generic,
 * addr_c_err_session, addr_c_err_network) are reused for the same reasons as the
 * create flow; only the update-specific keys are new.
 */
export type JobAddressUpdateErrorKey =
  | 'addr_c_err_required'
  | 'addr_c_err_generic'
  | 'addr_c_err_session'
  | 'addr_c_err_network'
  | 'addr_u_invalid_coords'
  | 'addr_u_err_generic';

/** The cascade state reused from create (same rule). */
export type GeoCascade = GeoCascadeBase;

/**
 * The form's client-side state, extended with parsed coordinates for the map
 * picker. When the form is pre-filled, lat/lng come from the cached response
 * strings parsed to finite numbers; when the user moves the map pin the screen
 * writes back into these fields.
 */
export interface JobAddressUpdateValues extends GeoCascade {
  latitude: number | null;
  longitude: number | null;
  houseNumber: string;
  streetAddress: string;
  postalCode: string;
  landmark: string;
  formattedAddress: string;
}

/**
 * Parse a coordinate the way the rest of the app does (see useAddresses.parseCoordinate):
 * accept a numeric string (the cached response) or a number, return a finite number
 * only when it is a sane coordinate (|lat| <= 90, |lng| <= 180), otherwise null.
 * Never returns a guessed 0.
 */
function parseCoordinate(
  raw: string | number | null | undefined,
  kind: 'lat' | 'lng'
): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const limit = kind === 'lat' ? 90 : 180;
  return Math.abs(n) <= limit ? n : null;
}

/**
 * Hydrate the update form from a cached JobAddressResponse.
 *
 * - lat/lng are parsed from the response strings (they may be strings, numbers or
 *   null); invalid/unavailable values become null so the map picker does not grab
 *   a junk pin.
 * - The geo ids are read from the nested country/county/city objects (real server
 *   ids, never invented).
 * - Text fields are trimmed; blank strings become '' so TextInputs render empty.
 * - formatted_address is kept verbatim when present; when absent it is left empty and
 *   the submit path will compose a fallback.
 */
export function hydrateFromCachedAddress(
  cached: JobAddressResponse | null | undefined
): JobAddressUpdateValues {
  const countryId =
    cached && cached.country ? cached.country.id : null;
  const countyId =
    cached && cached.county ? cached.county.id : null;
  const cityId =
    cached && cached.city ? cached.city.id : null;

  return {
    countryId,
    countyId,
    cityId,
    latitude: parseCoordinate(cached?.latitude, 'lat'),
    longitude: parseCoordinate(cached?.longitude, 'lng'),
    houseNumber: typeof cached?.house_number === 'string' ? cached.house_number.trim() : '',
    streetAddress:
      typeof cached?.street_address === 'string' ? cached.street_address.trim() : '',
    postalCode: typeof cached?.postal_code === 'string' ? cached.postal_code.trim() : '',
    landmark: typeof cached?.landmark === 'string' ? cached.landmark.trim() : '',
    formattedAddress:
      typeof cached?.formatted_address === 'string' ? cached.formatted_address : '',
  };
}

/** True when the job already carries an address (re-exported for the screen gate). */
export { jobHasAddress } from '@/lib/jobAddress';

/** Re-export the cascade helpers so the screen uses the identical rules. */
export { selectCountry, selectCounty, selectCity } from '@/lib/jobAddress';

/** Parse a coordinate the way the rest of the app does (see useAddresses.parseCoordinate):
 * accept a numeric string (the cached response) or a number, return a finite number
 * only when it is a sane coordinate (|lat| <= 90, |lng| <= 180), otherwise null.
 * Never returns a guessed 0.
 *
 * Exposed so the screen can reuse the same rule for the coordinate inputs and for
 * prefill from cached strings. */
export { parseCoordinate };

/**
 * Client-side rules for the update form, run BEFORE any request.
 *
 * Same minimum as create (country/county/city required, street_address required),
 * plus coordinates must be present and sane (a map-picker-aware screen cannot
 * submit a junk pin). house_number/postal_code/landmark stay optional.
 */
export function validateJobAddressUpdate(
  values: JobAddressUpdateValues
): { ok: boolean; fieldErrors: Partial<Record<JobAddressUpdateField, JobAddressUpdateErrorKey>> } {
  const fieldErrors: Partial<Record<JobAddressUpdateField, JobAddressUpdateErrorKey>> = {};

  if (!values.countryId || !Number.isInteger(values.countryId) || values.countryId < 1)
    fieldErrors.country_id = 'addr_c_err_required';
  if (!values.countyId || !Number.isInteger(values.countyId) || values.countyId < 1)
    fieldErrors.county_id = 'addr_c_err_required';
  if (!values.cityId || !Number.isInteger(values.cityId) || values.cityId < 1)
    fieldErrors.city_id = 'addr_c_err_required';
  if (!values.streetAddress.trim())
    fieldErrors.street_address = 'addr_c_err_required';

  if (values.latitude === null || values.longitude === null) {
    fieldErrors.latitude = 'addr_u_invalid_coords';
    fieldErrors.longitude = 'addr_u_invalid_coords';
  } else {
    if (Math.abs(values.latitude) > 90) fieldErrors.latitude = 'addr_u_invalid_coords';
    if (Math.abs(values.longitude) > 180) fieldErrors.longitude = 'addr_u_invalid_coords';
  }

  return { ok: Object.keys(fieldErrors).length === 0, fieldErrors };
}

/**
 * Build the full PATCH body (schema JobAddressUpdate).
 *
 * Every field is explicit. The geo ids are integers from the cascade (non-null once
 * validated). latitude/longitude are sent as NUMBERS (the response returns them as
 * strings — callers must not Number()-ify the response for caching; they should treat
 * the response strings as the truth, same rule as the existing address screens).
 *
 * formatted_address is kept when the user supplied one; otherwise it is composed from
 * street + house + postal so the address is always describable and stays consistent
 * with the edited text/location. Unlike create, lat/lng are ALWAYS present here (the
 * update schema requires them and the screen has a map picker).
 */
export function buildUpdateJobAddressRequest(
  values: JobAddressUpdateValues & {
    countryId: number;
    countyId: number;
    cityId: number;
    latitude: number;
    longitude: number;
  }
): JobAddressUpdate {
  const street = values.streetAddress.trim();
  const house = values.houseNumber.trim();
  const postal = values.postalCode.trim();

  return {
    latitude: values.latitude,
    longitude: values.longitude,
    country_id: values.countryId,
    county_id: values.countyId,
    city_id: values.cityId,
    house_number: house.length > 0 ? house : null,
    street_address: street.length > 0 ? street : null,
    postal_code: postal.length > 0 ? postal : null,
    landmark: values.landmark.trim().length > 0 ? values.landmark.trim() : null,
    formatted_address:
      values.formattedAddress.trim().length > 0
        ? values.formattedAddress.trim()
        : composeFormattedAddress([street || null, house || null, postal || null]),
  };
}

const UPDATE_ADDRESS_FIELDS: JobAddressUpdateField[] = [
  'country_id',
  'county_id',
  'city_id',
  'house_number',
  'street_address',
  'postal_code',
  'landmark',
  'formatted_address',
  'latitude',
  'longitude',
];

/**
 * Map a FastAPI 422 body onto the update form inputs.
 *
 * Reuses the same loc-normalization logic as mapJobAddressErrors (strip the "body"/
 * "path"/... prefix, route nested address subfields, surface unknown items as
 * form-level messages). Adds handling for latitude/longitude so a coordinate
 * validation error lands on the matching inputs rather than as a generic message.
 */
export function mapJobAddressUpdateErrors(
  detail: ValidationErrorDetail[] | null | undefined
): {
  fieldErrors: Partial<Record<JobAddressUpdateField, string>>;
  formErrors: string[];
} {
  const base = mapJobAddressErrors(detail);
  const fieldErrors: Partial<Record<JobAddressUpdateField, string>> = { ...base.fieldErrors };
  const formErrors = base.formErrors;

  if (!Array.isArray(detail)) return { fieldErrors, formErrors };

  for (const item of detail) {
    const message =
      item && typeof item.msg === 'string' && item.msg.length > 0 ? item.msg : null;
    if (!message) continue;

    const raw = Array.isArray(item.loc) ? item.loc : [];
    const loc = raw.map((part) => String(part));
    if (loc.length > 0 && ['body', 'path', 'query', 'header', 'cookie'].includes(loc[0])) {
      loc.shift();
    }

    const head = loc[0];
    if (head === 'latitude' || head === 'longitude') {
      const field = head as JobAddressUpdateField;
      if (!fieldErrors[field]) fieldErrors[field] = message;
      continue;
    }

    // Anything already handled by mapJobAddressErrors is left alone; anything that
    // names an update field but wasn't caught above is also routed here.
    if ((UPDATE_ADDRESS_FIELDS as string[]).includes(head)) {
      const field = head as JobAddressUpdateField;
      if (!fieldErrors[field]) fieldErrors[field] = message;
    }
  }

  return { fieldErrors, formErrors };
}

/** Same minimum gate as create, but explicitly edit-only. */
export function canUpdateJobAddress(
  job: { is_editable?: boolean | null; address?: JobAddressResponse | null } | null | undefined
): boolean {
  return !!(job && job.is_editable === true && job.address);
}