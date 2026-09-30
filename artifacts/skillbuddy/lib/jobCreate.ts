/**
 * jobCreate.ts
 *
 * Pure helpers behind the Post-Job form (POST /api/v1/jobs):
 *
 *  1. buildCreateJobRequest — turns raw form values into the EXACT JobCreate
 *     body: snake_case keys, integers as integers, ISO 8601 UTC dates, an
 *     array of milestones with a numeric expected_hours, and `is_draft`
 *     true/false.
 *  2. resolveScheduledAt — converts the form's date chip + time chip into an
 *     ISO 8601 UTC string.
 *  3. mapValidationErrors — turns a FastAPI 422 body into per-field messages
 *     so each error can be shown under the input it belongs to.
 *
 * No React and no axios here, so every rule above is unit-testable without a
 * renderer or a live token.
 */

import type {
  CreateJobRequest,
  JobAddressCreate,
  JobRequestType,
  ValidationErrorDetail,
} from '@/types';

/** The Post-Job form's raw values (screen state). */
export interface JobFormValues {
  /** Selected SERVICE id from GET /api/v1/services — never invented. */
  serviceId: number | null;
  /** That service's own category_id (nullable in the API). */
  serviceCategoryId: number | null;
  title: string;
  description: string;
  /** Form uses 'urgent' | 'regular'; the API uses URGENT | REGULAR. */
  requestType: 'urgent' | 'regular';
  /** Which date chip is selected. */
  dateKey: 'today' | 'tomorrow' | 'weekend';
  /** Which time chip is selected, e.g. '11:00 AM'. */
  timeSlot: string;
  expectedHours: number;
  /** Numeric ids from the PUBLIC geo endpoints. */
  countryId: number | null;
  countyId: number | null;
  cityId: number | null;
  houseNumber: string;
  streetAddress: string;
  postalCode: string;
  landmark: string;
  formattedAddress: string;
  /** true → draft (Save as draft); false → publish straight away. */
  isDraft: boolean;
}

/** Form error keys the screen can render under an input. */
export type JobFormField =
  | 'title'
  | 'description'
  | 'service'
  | 'date'
  | 'hours'
  | 'address'
  | 'country_id'
  | 'county_id'
  | 'city_id'
  | 'house_number'
  | 'street_address'
  | 'postal_code'
  | 'landmark'
  | 'formatted_address';

export interface MappedValidationErrors {
  fieldErrors: Partial<Record<JobFormField, string>>;
  /** Details whose field could not be resolved — show these as a toast. */
  formErrors: string[];
}

/** Address sub-fields that can receive an error under their own input. */
const ADDRESS_SUBFIELDS: JobFormField[] = [
  'country_id',
  'county_id',
  'city_id',
  'house_number',
  'street_address',
  'postal_code',
  'landmark',
  'formatted_address',
];

/** Trim a value, returning null for empty strings (so we never send ""). */
function text(value: string): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

/** '9:00 AM' / '1:00 PM' / '12:30 PM' → { h, m }. Returns null if unreadable. */
export function parseTimeSlot(slot: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(slot ?? '').trim());
  if (!match) return null;

  const hour12 = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hour12 < 1 || hour12 > 12 || minutes > 59) return null;

  let hours = hour12 % 12;
  if (/PM/i.test(match[3])) hours += 12;
  return { h: hours, m: minutes };
}

/**
 * Resolve the form's date + time chips into an ISO 8601 UTC string.
 *
 * DATE CHIPS (deterministic — the app has no date-picker dependency):
 *   today    → today
 *   tomorrow → +1 day
 *   weekend  → the next Saturday on or after that date (Sunday rolls a week)
 * The chip is applied in the device's LOCAL time zone, then serialised with
 * toISOString() so the API always receives UTC ("...Z").
 */
export function resolveScheduledAt(
  dateKey: JobFormValues['dateKey'],
  timeSlot: string,
  now: Date = new Date()
): string {
  const time = parseTimeSlot(timeSlot) ?? { h: 9, m: 0 };

  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (dateKey === 'tomorrow') {
    target.setDate(target.getDate() + 1);
  } else if (dateKey === 'weekend') {
    // getDay(): 0 = Sunday, 6 = Saturday. Next Saturday on/after today.
    const delta = (6 - target.getDay() + 7) % 7;
    target.setDate(target.getDate() + delta);
  }

  target.setHours(time.h, time.m, 0, 0);
  return target.toISOString();
}

/** Compose a human-readable address line when the user left it blank. */
export function composeFormattedAddress(
  parts: Array<string | null | undefined>
): string | null {
  const joined = parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
    .join(', ');
  return joined.length > 0 ? joined : null;
}

/**
 * Build the exact POST /api/v1/jobs body (schema JobCreate).
 *
 * The caller must have validated the REQUIRED selections first, which is why
 * `serviceId` / geo ids are narrowed to non-null here — the API requires
 * service_id and address, and the ids must be real server ids.
 *
 * ONE_TIME only: the existing form schedules a single visit, so booking_type
 * is always ONE_TIME and exactly one milestone is sent. That is also the only
 * channel for the schedule — JobCreate exposes no top-level scheduled_at /
 * expected_hours (see the createJob doc comment).
 *
 * latitude/longitude are OMITTED (there is no map picker in the app) rather
 * than zero-filled, matching the address screens' rule.
 */
export function buildCreateJobRequest(
  values: JobFormValues & {
    serviceId: number;
    countryId: number;
    countyId: number;
    cityId: number;
  },
  now: Date = new Date()
): CreateJobRequest {
  const requestType: JobRequestType =
    values.requestType === 'urgent' ? 'URGENT' : 'REGULAR';

  const scheduledAt = resolveScheduledAt(values.dateKey, values.timeSlot, now);

  const address: JobAddressCreate = {
    country_id: values.countryId,
    county_id: values.countyId,
    city_id: values.cityId,
    house_number: text(values.houseNumber),
    street_address: text(values.streetAddress),
    postal_code: text(values.postalCode),
    landmark: text(values.landmark),
    formatted_address:
      text(values.formattedAddress) ??
      composeFormattedAddress([
        text(values.streetAddress),
        text(values.houseNumber),
        text(values.postalCode),
      ]),
  };

  return {
    service_id: values.serviceId,
    category_id: values.serviceCategoryId,
    title: values.title.trim(),
    description: text(values.description),
    request_type: requestType,
    booking_type: 'ONE_TIME',
    milestones: [
      {
        scheduled_at: scheduledAt,
        expected_hours: values.expectedHours,
      },
    ],
    address,
    is_draft: values.isDraft,
  };
}

/**
 * Map a FastAPI 422 body ({detail:[{loc,msg,type,...}]}) onto form fields.
 *
 * FastAPI prefixes body paths with "body", so loc is usually
 * ["body", "<field>", ...] — the prefix is stripped. Nested paths are routed
 * to the closest UI input:
 *   ["body","address","city_id"]        → city_id
 *   ["body","milestones",0,"scheduled_at"] → date
 *   ["body","milestones",0,"expected_hours"] → hours
 *   ["body","service_id" | "category_id"]  → service
 *   ["body","request_type" | "booking_type" | "is_draft"] → toast
 * Anything unrecognised becomes a toast entry instead of being dropped.
 * The first message per field wins (later duplicates add no information).
 */
export function mapValidationErrors(
  detail: ValidationErrorDetail[] | null | undefined
): MappedValidationErrors {
  const fieldErrors: Partial<Record<JobFormField, string>> = {};
  const formErrors: string[] = [];

  if (!Array.isArray(detail)) return { fieldErrors, formErrors };

  for (const item of detail) {
    const message =
      item && typeof item.msg === 'string' && item.msg.length > 0 ? item.msg : null;
    if (!message) continue;

    const raw = Array.isArray(item.loc) ? item.loc : [];
    const loc = raw.map((part) => String(part));
    // Drop the FastAPI location prefix ("body" / "path" / "query").
    if (loc.length > 0 && ['body', 'path', 'query', 'header', 'cookie'].includes(loc[0])) {
      loc.shift();
    }

    const head = loc[0];
    let field: JobFormField | null = null;

    if (head === 'service_id' || head === 'category_id') {
      field = 'service';
    } else if (head === 'title') {
      field = 'title';
    } else if (head === 'description') {
      field = 'description';
    } else if (head === 'milestones') {
      // FastAPI puts the ARRAY INDEX before the field name for nested models
      // (["body","milestones",0,"expected_hours"]), so scan the tail rather
      // than trusting a fixed position.
      field = loc.includes('expected_hours') ? 'hours' : 'date';
    } else if (head === 'address') {
      // Same index caveat; find whichever address sub-field was named.
      const sub = loc.find((part) => (ADDRESS_SUBFIELDS as string[]).includes(part));
      field = sub ? (sub as JobFormField) : 'address';
    }

    if (field) {
      if (!fieldErrors[field]) fieldErrors[field] = message;
    } else {
      formErrors.push(message);
    }
  }

  return { fieldErrors, formErrors };
}
