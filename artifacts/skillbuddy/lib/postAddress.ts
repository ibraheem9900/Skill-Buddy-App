/**
 * postAddress.ts
 *
 * Pure rules behind the wizard's rebuilt Service Address step.
 *
 * ── WHAT THE LIVE OPENAPI ACTUALLY OFFERS (re-read 2026-10-21) ─────────────
 *   GET    /api/v1/addresses                "Get My Address"  → AddressResponse (ONE object)
 *   POST   /api/v1/addresses                "Create Address" → 201 AddressResponse
 *   GET    /api/v1/addresses/{address_id}   → AddressResponse
 *   PUT    /api/v1/addresses/{address_id}   → AddressResponse
 *   DELETE /api/v1/addresses/{address_id}   → 204 (no body)
 *
 * The documented body (AddressCreate / AddressUpdate / AddressResponse) has
 * exactly these fields: latitude, longitude, country_id, county_id, city_id,
 * house_number, street_address, postal_code, landmark, formatted_address.
 *
 *   ✗ NO `name` field anywhere in the spec.
 *   ✗ NO `phone` field anywhere in the spec.
 *   ✗ NO `is_default` field in the 2026-10-21 schemas either (the mobile type
 *     still declared it; every helper here treats a missing flag as false).
 *   ✗ NO "list all my addresses" endpoint — GET returns one AddressResponse.
 *
 * So the UI shows the account's name/phone READ-ONLY (GET /api/v1/users/me) next
 * to an address, edits only the documented fields, and reports the gaps instead
 * of inventing fields the backend would reject. Deleting the only address is a
 * real 204; the list then refetches and shows its empty state.
 */

import type { AddressResponse, ValidationErrorDetail } from '@/types';
import { formatAddressLine, formatAddressRegion } from '@/lib/addressFormat';

/** The address fields the wizard collects and sends. */
export interface PostAddressForm {
  countryId: number | null;
  countyId: number | null;
  cityId: number | null;
  /** Mapped onto the documented `street_address` (see the Add form's label). */
  streetAddress: string;
  houseNumber: string;
  postalCode: string;
  landmark: string;
  formattedAddress: string;
}

/** The subset of a job address taken from the chosen saved address. */
export interface JobAddressValues {
  countryId: number | null;
  countyId: number | null;
  cityId: number | null;
  houseNumber: string;
  streetAddress: string;
  postalCode: string;
  landmark: string;
  formattedAddress: string;
}

/** Trimmed string, or ''. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Nested geo id, or null (the schema allows a null country/county/city). */
function nestedId(value: { id?: number } | null | undefined): number | null {
  return value && typeof value.id === 'number' ? value.id : null;
}

/**
 * Normalise whatever GET /api/v1/addresses returned. The schema documents ONE
 * object; a bare array or `{ addresses: [...] }` wrapper is tolerated so a
 * future multi-address backend needs no client change.
 */
export function normalizeAddressList(data: unknown): AddressResponse[] {
  if (!data) return [];
  if (Array.isArray(data)) return data.filter(isAddress);
  const wrapper = data as { addresses?: unknown };
  if (Array.isArray(wrapper.addresses)) return wrapper.addresses.filter(isAddress);
  return isAddress(data) ? [data] : [];
}

/** A row that has at least an id (everything else is nullable). */
export function isAddress(value: unknown): value is AddressResponse {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'number';
}

/**
 * The address a post should start with: the default one when the backend flags
 * it, otherwise the first saved address (with a single documented address that
 * IS the default).
 */
export function defaultAddressId(list: AddressResponse[]): number | null {
  if (list.length === 0) return null;
  const flagged = list.find((row) => row.is_default === true);
  return (flagged ?? list[0]).id;
}

/** Real ids only — a job can only be posted to a resolved country/county/city. */
export function isAddressPostable(address: AddressResponse | null | undefined): boolean {
  if (!address) return false;
  return (
    nestedId(address.country) !== null &&
    nestedId(address.county) !== null &&
    nestedId(address.city) !== null
  );
}

/** The saved address mapped onto the job's address values. */
export function jobAddressFrom(address: AddressResponse): JobAddressValues {
  return {
    countryId: nestedId(address.country),
    countyId: nestedId(address.county),
    cityId: nestedId(address.city),
    houseNumber: text(address.house_number),
    streetAddress: text(address.street_address),
    postalCode: text(address.postal_code),
    landmark: text(address.landmark),
    formattedAddress: text(address.formatted_address),
  };
}

/**
 * The card's main line: the saved `formatted_address`, else house+street, else
 * the city — never an empty card. The Full address field is OPTIONAL, so this
 * fallback is the normal path, not an error path.
 */
export function addressLine(address: AddressResponse): string {
  // FIX (stale address): built from the CURRENT fields by the ONE shared
  // formatter, never from `formatted_address` — the server keeps that legacy
  // string as it was last sent, so preferring it showed the OLD address next to
  // the new field values on the same screen. See lib/addressFormat.
  return formatAddressLine(address);
}

/** `City, County, Country` — the muted second line. */
export function regionLine(address: AddressResponse): string {
  // The shared region line (city, county, country) — same formatter the address
  // screens use, so every surface renders an address the same way.
  return formatAddressRegion(address);
}

/** The editable form opened by Edit (everything documented, nothing invented). */
export function addressFormFrom(address: AddressResponse): PostAddressForm {
  const values = jobAddressFrom(address);
  return {
    countryId: values.countryId,
    countyId: values.countyId,
    cityId: values.cityId,
    streetAddress: values.streetAddress,
    houseNumber: values.houseNumber,
    postalCode: values.postalCode,
    landmark: values.landmark,
    formattedAddress: values.formattedAddress,
  };
}

/* ── 422 → field errors ──────────────────────────────────────────────────── */

export type AddressField =
  | 'country_id'
  | 'county_id'
  | 'city_id'
  | 'house_number'
  | 'street_address'
  | 'postal_code'
  | 'landmark'
  | 'formatted_address';

const ADDRESS_FIELDS: AddressField[] = [
  'country_id',
  'county_id',
  'city_id',
  'house_number',
  'street_address',
  'postal_code',
  'landmark',
  'formatted_address',
];

export interface MappedAddressErrors {
  fieldErrors: Partial<Record<AddressField, string>>;
  formErrors: string[];
}

/**
 * Map a FastAPI 422 body onto the Add/Edit form's own inputs, so a rejected
 * field (e.g. postal_code over 20 characters) is reported UNDER that input.
 * Anything unresolved becomes a form-level message instead of being dropped.
 */
export function mapAddressValidationErrors(
  detail: ValidationErrorDetail[] | string | null | undefined
): MappedAddressErrors {
  const fieldErrors: Partial<Record<AddressField, string>> = {};
  const formErrors: string[] = [];

  if (typeof detail === 'string' && detail.trim().length > 0) {
    return { fieldErrors, formErrors: [detail.trim()] };
  }
  if (!Array.isArray(detail)) return { fieldErrors, formErrors };

  for (const item of detail) {
    const message = item && typeof item.msg === 'string' ? item.msg : '';
    if (!message) continue;
    const loc = Array.isArray(item.loc) ? item.loc.map((part) => String(part)) : [];
    const field = loc.find((part) => (ADDRESS_FIELDS as string[]).includes(part)) as
      | AddressField
      | undefined;
    if (field) {
      if (!fieldErrors[field]) fieldErrors[field] = message;
    } else {
      formErrors.push(message);
    }
  }

  return { fieldErrors, formErrors };
}
