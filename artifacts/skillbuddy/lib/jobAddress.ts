import { composeFormattedAddress } from '@/lib/jobCreate';
import type { JobAddressCreate, JobResponse, ValidationErrorDetail } from '@/types';

/**
 * jobAddress.ts — pure helpers behind the Job Address screen
 * (POST /api/v1/jobs/{job_id}/address, schema JobAddressCreate).
 *
 * Verified against the live OpenAPI:
 *   - the body has NO required properties (every field is nullable), so the
 *     "country/county/city + street" minimum enforced below is a PRODUCT
 *     decision matching the existing Add Address screen, not a server rule
 *   - country_id / county_id / city_id are integers from the public geo
 *     endpoints — never names, never invented client-side
 *   - latitude/longitude are accepted as number | numeric-string | null, and
 *     are OMITTED here: this app has no map picker, no map library and never
 *     captures coordinates, so zero-filling them would be a fabrication. The
 *     schema allows their absence (same rule the existing address screens use).
 *   - 201 → JobAddressResponse; documented errors are 422 only.
 *
 * No React and no axios, so every rule is unit-testable.
 */

/** Inputs that can receive a 422 message. */
export type JobAddressField =
  | 'country_id'
  | 'county_id'
  | 'city_id'
  | 'house_number'
  | 'street_address'
  | 'postal_code'
  | 'landmark'
  | 'formatted_address';

export type JobAddressErrorKey =
  | 'addr_c_err_required'
  | 'addr_c_err_generic';

/** The cascade's own state. */
export interface GeoCascade {
  countryId: number | null;
  countyId: number | null;
  cityId: number | null;
}

/** The whole form's state. */
export interface JobAddressValues extends GeoCascade {
  houseNumber: string;
  streetAddress: string;
  postalCode: string;
  landmark: string;
  formattedAddress: string;
}

export interface MappedAddressErrors {
  fieldErrors: Partial<Record<JobAddressField, string>>;
  formErrors: string[];
}

/**
 * Pick a country. Changing the parent CLEARS county and city, because the old
 * selections belong to a different country and would be invalid ids to send.
 * Re-picking the same value returns the SAME object so a redundant tap does
 * not trigger a state update (and cannot wipe child selections).
 */
export function selectCountry(current: GeoCascade, countryId: number | null): GeoCascade {
  if (current.countryId === countryId) return current;
  return { countryId, countyId: null, cityId: null };
}

/** Pick a county. Changing it CLEARS the city for the same reason. */
export function selectCounty(current: GeoCascade, countyId: number | null): GeoCascade {
  if (current.countyId === countyId) return current;
  return { ...current, countyId, cityId: null };
}

/** Pick a city — a leaf, so nothing below it to clear. */
export function selectCity(current: GeoCascade, cityId: number | null): GeoCascade {
  if (current.cityId === cityId) return current;
  return { ...current, cityId };
}

/** Trim, mapping blank strings to null so we never send "". */
function text(value: string): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

/**
 * Client-side rules, run BEFORE any request:
 *   - country_id / county_id / city_id must all be selected (product rule)
 *   - street_address is required (product rule)
 * house_number / postal_code / landmark stay optional, matching Add Address.
 */
export function validateJobAddress(
  values: JobAddressValues
): { ok: boolean; fieldErrors: Partial<Record<JobAddressField, JobAddressErrorKey>> } {
  const fieldErrors: Partial<Record<JobAddressField, JobAddressErrorKey>> = {};
  if (!isId(values.countryId)) fieldErrors.country_id = 'addr_c_err_required';
  if (!isId(values.countyId)) fieldErrors.county_id = 'addr_c_err_required';
  if (!isId(values.cityId)) fieldErrors.city_id = 'addr_c_err_required';
  if (!text(values.streetAddress)) fieldErrors.street_address = 'addr_c_err_required';
  return { ok: Object.keys(fieldErrors).length === 0, fieldErrors };
}

/**
 * Build the POST body.
 *
 * The ids are integers from the cascade. `formatted_address` falls back to a
 * composed line when the user left it blank, so the address is always
 * describable. latitude/longitude are deliberately absent (see the file
 * header) — `Object.keys` therefore never contains them.
 */
export function buildCreateJobAddressRequest(
  values: JobAddressValues & {
    countryId: number;
    countyId: number;
    cityId: number;
  }
): JobAddressCreate {
  const street = text(values.streetAddress);
  const house = text(values.houseNumber);
  const postal = text(values.postalCode);

  return {
    country_id: values.countryId,
    county_id: values.countyId,
    city_id: values.cityId,
    house_number: house,
    street_address: street,
    postal_code: postal,
    landmark: text(values.landmark),
    formatted_address:
      text(values.formattedAddress) ?? composeFormattedAddress([street, house, postal]),
  };
}

const ADDRESS_FIELDS: JobAddressField[] = [
  'country_id',
  'county_id',
  'city_id',
  'house_number',
  'street_address',
  'postal_code',
  'landmark',
  'formatted_address',
];

/**
 * Map a FastAPI 422 body onto the inputs. loc is normally ["body","<field>"];
 * the location prefix is stripped. Anything that does not name one of the
 * fields is surfaced as a form-level message instead of being dropped. The
 * first message per field wins.
 */
export function mapJobAddressErrors(
  detail: ValidationErrorDetail[] | null | undefined
): MappedAddressErrors {
  const fieldErrors: Partial<Record<JobAddressField, string>> = {};
  const formErrors: string[] = [];

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
    if ((ADDRESS_FIELDS as string[]).includes(head)) {
      const field = head as JobAddressField;
      if (!fieldErrors[field]) fieldErrors[field] = message;
    } else {
      formErrors.push(message);
    }
  }

  return { fieldErrors, formErrors };
}

/** True when the job already carries an address, so the UI must not POST. */
export function jobHasAddress(job: Pick<JobResponse, 'address'> | null | undefined): boolean {
  return !!job && job.address !== null && job.address !== undefined;
}

/**
 * Whether the "Add address" entry point should be offered: the job must be
 * editable and must not already have an address. This is create-only — an
 * existing address is changed through Update Job Address (a separate task),
 * so no "edit" affordance is offered here.
 */
export function canAddJobAddress(
  job: Pick<JobResponse, 'is_editable' | 'address'> | null | undefined
): boolean {
  return !!job && job.is_editable === true && !jobHasAddress(job);
}
