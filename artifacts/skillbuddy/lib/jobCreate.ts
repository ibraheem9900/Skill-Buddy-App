/**
 * jobCreate.ts
 *
 * Pure helpers behind the Post-Job wizard (POST /api/v1/jobs):
 *
 *  1. buildCreateJobRequest — turns the wizard's raw form values into the EXACT
 *     JobCreate body: snake_case keys, integers as integers, ISO 8601 UTC dates,
 *     the booking_type that matches the wizard's step 2, and one milestone per
 *     booked day with a numeric expected_hours.
 *  2. mapValidationErrors — turns a FastAPI 422 body into per-field messages so
 *     each error can be shown under the input it belongs to.
 *
 * No React and no axios here, so every rule above is unit-testable.
 *
 * ── BOOKING_TYPE / MILESTONES AS THE LIVE OPENAPI DEFINES THEM ──────────────
 *   BookingType enum: "ONE_TIME" | "MULTI_DAY"
 *     "ONE_TIME  -> a single occurrence (one milestone).
 *      MULTI_DAY -> up to JobRequest.MAX_MILESTONES occurrences within
 *                   one week, each tracked as its own JobMilestone."
 *   JobMilestoneCreate: { scheduled_at (required), expected_hours }
 *   JobCreate.required: [service_id, title, milestones, address]
 *
 * So ONE_TIME ships exactly one milestone and MULTI_DAY ships one per booked
 * day (the wizard caps that at 7 — the "one week" the schema documents). The
 * day-by-day arithmetic lives in lib/jobBooking.ts; this module only maps the
 * wizard's values onto the wire contract.
 */

import { MAX_MILESTONE_DAYS, bookingTypeFor, clampExpectedHours } from '@/lib/jobBooking';
import { firstErrorMessage } from '@/lib/jobList';
import type {
  CreateJobRequest,
  JobAddressCreate,
  JobMilestoneCreate,
  JobRequestType,
  ValidationErrorDetail,
} from '@/types';

/* ── Description: the user's text plus the "Preferred time" line ────────────
 *
 * The job API has NO field for the END of a time window (`JobMilestoneCreate` is
 * just `scheduled_at` + `expected_hours`), so the window's end is carried at the
 * very END of the description as one fixed English line:
 *
 *     Preferred time: 8:00 AM - 11:00 AM
 *
 * It is STORED data a provider reads, so it is deliberately NOT translated (the
 * rest of the UI still is). It is never part of the user's text field and never
 * counted by that field's word counter: the wizard appends it when building the
 * payload and strips it again when a saved draft is loaded, so it can never be
 * duplicated or edited by hand.
 *
 * The LIVE backend enforces the word limit the app already shows (HTTP 422
 * "Description cannot exceed 500 words (got 1203)", captured 2026-10-20), so the
 * combined text — user words PLUS this line — must stay under it.
 */

/** The live backend's own description ceiling (words). */
export const DESC_WORD_MAX = 500;

/** Exact prefix of the stored line, at the very end of the description. */
export const PREFERRED_TIME_PREFIX = 'Preferred time:';

/** Words, counted the way the backend counts them (whitespace separated). */
export function countWords(text: string | null | undefined): number {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** The stored line for a `8:00 AM - 11:00 AM` window label, or null. */
export function buildPreferredTimeLine(windowLabel: string | null | undefined): string | null {
  const label = typeof windowLabel === 'string' ? windowLabel.trim() : '';
  return label.length > 0 ? `${PREFERRED_TIME_PREFIX} ${label}` : null;
}

/**
 * Remove a trailing "Preferred time: …" line from a stored description.
 * Only the EXACT prefix on the LAST line is removed, so user prose that happens
 * to contain the words "preferred time" is untouched.
 */
export function stripPreferredTimeLine(description: string | null | undefined): string {
  const text = typeof description === 'string' ? description : '';
  const trimmedEnd = text.replace(/\s+$/, '');
  const cut = trimmedEnd.lastIndexOf('\n');
  const lastLine = cut >= 0 ? trimmedEnd.slice(cut + 1) : trimmedEnd;
  if (!lastLine.trimStart().startsWith(PREFERRED_TIME_PREFIX)) return trimmedEnd;
  return cut >= 0 ? trimmedEnd.slice(0, cut).replace(/\s+$/, '') : '';
}

/**
 * The description to send: the user's own text, with any stale line removed, and
 * the current line appended once at the end. A null/empty result means "no
 * description", exactly as before.
 */
export function withPreferredTimeLine(
  userText: string | null | undefined,
  line: string | null | undefined
): string | null {
  const body = stripPreferredTimeLine(userText).trim();
  const suffix = typeof line === 'string' ? line.trim() : '';
  if (body.length === 0) return suffix.length > 0 ? suffix : null;
  if (suffix.length === 0) return body;
  return `${body}\n${suffix}`;
}

/** Words the description will actually contain (user text + the line). */
export function descriptionWordCount(
  userText: string | null | undefined,
  line: string | null | undefined
): number {
  return countWords(withPreferredTimeLine(userText, line));
}

/** Would the composed description break the backend's word limit? */
export function exceedsDescriptionLimit(
  userText: string | null | undefined,
  line: string | null | undefined
): boolean {
  return descriptionWordCount(userText, line) > DESC_WORD_MAX;
}

/** One booked day of a long-term job, as the wizard's form state holds it. */
export interface JobMilestoneInput {
  /** ISO 8601 UTC, composed from the local day + clock time. */
  scheduledAtIso: string;
  /** Per-day expected hours (the same value applies to every day). */
  expectedHours: number;
}

/** The Post-Job wizard's raw values (shared screen state). */
export interface JobFormValues {
  /** Selected SERVICE id from GET /api/v1/services — never invented. */
  serviceId: number | null;
  /** That service's own category_id (nullable in the API). */
  serviceCategoryId: number | null;
  title: string;
  description: string;
  /** Form uses 'urgent' | 'regular'; the API uses URGENT | REGULAR. */
  requestType: 'urgent' | 'regular';
  /** Form uses 'one_time' | 'multi_day'; the API uses ONE_TIME | MULTI_DAY. */
  bookingType: 'one_time' | 'multi_day';
  /**
   * ONE_TIME only: the single chosen instant as ISO 8601 UTC (the step-3
   * Today/Tomorrow choice combined with the clock-picker time).
   */
  scheduledAtIso?: string | null;
  /** MULTI_DAY only: one entry per booked day (1..7). */
  milestones?: JobMilestoneInput[];
  /** Expected hours — the single value for ONE_TIME, per day for MULTI_DAY. */
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
  /**
   * The `Preferred time: …` line for the chosen window (null for a plain slot
   * the provider does not need: only Anytime carries a custom window).
   */
  preferredTimeLine?: string | null;
}

/** Form error keys the wizard can render under an input. */
export type JobFormField =
  | 'title'
  | 'description'
  | 'service'
  | 'date'
  | 'time'
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

/* ── Title rules (JobCreate.title: minLength 3, maxLength 150) ─────────── */

/** The live schema's own bounds for JobCreate.title — verified 2026-10-14. */
export const JOB_TITLE_MIN = 3;
export const JOB_TITLE_MAX = 150;

/**
 * The title rule, in one testable place: TRIMMED length 3..150, exactly as the
 * live schema declares (`{minLength: 3, maxLength: 150}`). Returns the
 * translation key the wizard renders under the input, or null when the title is
 * acceptable. The wizard blocks submit on it and the builder refuses to build
 * around it, so an out-of-range title can never reach the API.
 */
export function validateJobTitle(title: string): 'post_err_title_min' | 'post_err_title_max' | null {
  const length = typeof title === 'string' ? title.trim().length : 0;
  if (length < JOB_TITLE_MIN) return 'post_err_title_min';
  if (length > JOB_TITLE_MAX) return 'post_err_title_max';
  return null;
}

/** A usable ISO instant, or null (rejects '' and Invalid Date). */
function isoInstant(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
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
 * The `milestones[]` array the request carries.
 *
 * ONE_TIME  → exactly one milestone from `scheduledAtIso` (the only schedule
 *             channel JobCreate offers; there is no top-level scheduled_at).
 * MULTI_DAY → one milestone per booked day, hardened against every invalid
 *             shape the LIVE backend was seen to reject (422s captured
 *             2026-10-14, see the report): duplicates are dropped, entries
 *             more than one week after the first are dropped, and the list is
 *             capped at 7 — "Multiple-day bookings cannot have more than 7
 *             milestones". When nothing usable remains the ONE_TIME instant is
 *             used as a last resort so the array is never empty.
 */
export function resolveMilestones(values: JobFormValues): JobMilestoneCreate[] {
  const hours = clampExpectedHours(values.expectedHours);
  const single = isoInstant(values.scheduledAtIso);

  if (values.bookingType === 'multi_day') {
    const seen = new Set<string>();
    const withinWeek: string[] = [];
    let first = Number.NaN;
    for (const entry of values.milestones ?? []) {
      const iso = isoInstant(entry?.scheduledAtIso);
      if (iso === null || seen.has(iso)) continue;
      const at = Date.parse(iso);
      if (!Number.isFinite(first)) first = at;
      // "Within one week of the first": the wizard books consecutive local
      // days at ONE clock time, so the allowed offset is exactly the first six
      // days (MAX_MILESTONE_DAYS entries on days 0..6).
      if (at - first > (MAX_MILESTONE_DAYS - 1) * 86_400_000) continue;
      seen.add(iso);
      withinWeek.push(iso);
      if (withinWeek.length === MAX_MILESTONE_DAYS) break;
    }
    if (withinWeek.length > 0) {
      return withinWeek.map((scheduled_at) => ({ scheduled_at, expected_hours: hours }));
    }
  }

  return single ? [{ scheduled_at: single, expected_hours: hours }] : [];
}

/**
 * Build the exact POST /api/v1/jobs body (schema JobCreate).
 *
 * The caller must have validated the REQUIRED selections first, which is why
 * `serviceId` / geo ids are narrowed to non-null here — the API requires
 * service_id and address, and the ids must be real server ids.
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
  }
): CreateJobRequest {
  const title = values.title.trim();
  // Defence in depth for the ONE rule the wizard cannot express in its types:
  // the live schema rejects anything outside 3..150 characters (verified live:
  // HTTP 422 `string_too_short` for a 2-character title), so the builder never
  // PRODUCES such a body — the wizard has already blocked submit by then, and a
  // caller that bypasses validation gets a thrown error, not a doomed request.
  if (validateJobTitle(title) !== null) {
    throw new Error(
      `buildCreateJobRequest: title must be ${JOB_TITLE_MIN}-${JOB_TITLE_MAX} characters (trimmed)`
    );
  }

  // MULTI_DAY is ALWAYS Regular. The live backend enforces this at create time
  // (HTTP 422 "Multiple-day bookings only support Regular bidding, not Urgent",
  // captured 2026-10-14), so the builder forces it regardless of what the form
  // state claimed — an Urgent + long-term body can never leave this function.
  const requestType: JobRequestType =
    values.bookingType === 'multi_day'
      ? 'REGULAR'
      : values.requestType === 'urgent'
        ? 'URGENT'
        : 'REGULAR';

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
    title,
    // The user's text plus the stored `Preferred time: …` line, appended once.
    description: withPreferredTimeLine(values.description, values.preferredTimeLine),
    request_type: requestType,
    booking_type: bookingTypeFor(values.bookingType),
    milestones: resolveMilestones(values),
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

/* ── Which wizard step owns each field ────────────────────────────────────── */

/**
 * The screen's four steps, by index:
 *   0 Job Details · 1 Booking Type · 2 Date & Time · 3 Service Address
 *
 * A 422 body names FIELDS, not steps, so a field on an earlier step would
 * otherwise leave the user looking at an error they cannot see. The request-type
 * cards (URGENT / REGULAR) live on the step-2 body, not on step 1.
 */
export const JOB_FIELD_STEPS: Record<JobFormField, number> = {
  service: 0,
  title: 0,
  description: 0,
  date: 2,
  time: 2,
  hours: 2,
  address: 3,
  country_id: 3,
  county_id: 3,
  city_id: 3,
  house_number: 3,
  street_address: 3,
  postal_code: 3,
  landmark: 3,
  formatted_address: 3,
};

/**
 * The EARLIEST step that carries a mapped field error, or null when nothing is
 * mapped. Errors are resolved top-down like the client-side validation is, so
 * the user is never sent past a step that is still wrong.
 */
export function firstErrorStep(
  fieldErrors: Partial<Record<JobFormField, string>>
): number | null {
  let lowest: number | null = null;
  for (const field of Object.keys(fieldErrors) as JobFormField[]) {
    if (!fieldErrors[field]) continue;
    const step = JOB_FIELD_STEPS[field];
    if (typeof step !== 'number') continue;
    if (lowest === null || step < lowest) lowest = step;
  }
  return lowest;
}

/* ── Why a createJob call failed ──────────────────────────────────────────── */

/**
 * Every way POST /api/v1/jobs can fail here, kept apart on purpose so the UI can
 * never again answer all of them with "check your connection".
 *
 *   network       no response at all — offline, DNS, connection refused. The
 *                 ONLY case that may claim a connectivity problem.
 *   timeout       the request was sent and never came back (axios
 *                 ECONNABORTED/ETIMEDOUT).
 *   unauthorized  401 that survived the shared client's refresh + single replay.
 *   invalid       422 — field-by-field; mapped, never shown as a dialog alone.
 *   badrequest    400 (undocumented).
 *   forbidden     403 (undocumented).
 *   notfound      404 (undocumented).
 *   conflict      409 (undocumented).
 *   server        5xx.
 *   unknown       anything else — including an exception thrown client-side
 *                 after a 201, which must NEVER masquerade as a connection
 *                 problem.
 */
export type CreateJobFailureKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'invalid'
  | 'badrequest'
  | 'forbidden'
  | 'notfound'
  | 'conflict'
  | 'server'
  | 'unknown';

export interface CreateJobFailure {
  kind: CreateJobFailureKind;
  /**
   * The backend's own readable text (a plain-string `detail`, or the first
   * `detail[].msg`), when it sent one. null when there is nothing usable.
   */
  message: string | null;
}

/** Axios' timeout shape, without importing axios into a pure module. */
const TIMEOUT_CODES = ['ECONNABORTED', 'ETIMEDOUT'];
/** Axios' transport-failure code: offline, DNS failure, refused, TLS. */
const NETWORK_CODE = 'ERR_NETWORK';
/** A request that was cancelled is not a connectivity problem. */
const CANCELED_CODE = 'ERR_CANCELED';

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

function isTimeout(err: unknown, code: string | undefined): boolean {
  if (typeof code === 'string' && TIMEOUT_CODES.includes(code)) return true;
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message.toLowerCase().includes('timeout');
}

/**
 * Is there POSITIVE evidence that the request went out and no HTTP response came
 * back? Only axios' own transport code, or an error axios itself produced,
 * counts. A bare `throw new Error(...)` from our own code must NOT qualify —
 * that is the whole point of this classifier: a client-side exception may never
 * be reported as "check your connection".
 */
function isTransportFailure(err: unknown, code: string | undefined): boolean {
  if (code === NETWORK_CODE) return true;
  const isAxiosError = (err as { isAxiosError?: unknown } | null | undefined)?.isAxiosError;
  return isAxiosError === true;
}

/**
 * Bucket a rejected createJob call. Never throws: a malformed error object
 * degrades to 'unknown' rather than crashing the screen, and a response-less
 * error is only called a connectivity failure when it really is one.
 */
export function classifyCreateJobFailure(err: unknown): CreateJobFailure {
  const anyErr = err as
    | { response?: { status?: number; data?: unknown }; code?: string }
    | null
    | undefined;
  const status = anyErr?.response?.status;
  const message = firstErrorMessage(anyErr?.response?.data);

  if (typeof status !== 'number') {
    // No HTTP response. Three very different situations live here, so they are
    // told apart rather than all being called "network".
    const code = errorCode(err);
    if (isTimeout(err, code)) return { kind: 'timeout', message };
    if (code === CANCELED_CODE) return { kind: 'unknown', message };
    if (isTransportFailure(err, code)) return { kind: 'network', message };
    return { kind: 'unknown', message };
  }

  if (status === 401) return { kind: 'unauthorized', message };
  if (status === 422) return { kind: 'invalid', message };
  if (status === 400) return { kind: 'badrequest', message };
  if (status === 403) return { kind: 'forbidden', message };
  if (status === 404) return { kind: 'notfound', message };
  if (status === 409) return { kind: 'conflict', message };
  if (status >= 500) return { kind: 'server', message };
  return { kind: 'unknown', message };
}

/**
 * The icon each bucket shows. A NARROW union (not Feather's whole glyph map) so
 * this module stays free of any React Native import — every value is a real
 * Feather name, which is all AppAlertConfig.icon accepts.
 */
export type CreateJobErrorIcon =
  | 'wifi-off'
  | 'clock'
  | 'lock'
  | 'alert-circle'
  | 'alert-triangle';

/** Translation keys for every bucket. */
export type CreateJobErrorKey =
  | 'post_err_network_title'
  | 'post_err_network_msg'
  | 'post_err_timeout_title'
  | 'post_err_timeout_msg'
  | 'post_err_session_title'
  | 'post_err_session_msg'
  | 'post_err_invalid_title'
  | 'post_err_invalid_msg'
  | 'post_err_rejected_title'
  | 'post_err_rejected_msg'
  | 'post_err_server_title'
  | 'post_err_server_msg'
  | 'post_err_unknown_title'
  | 'post_err_unknown_msg';

export interface CreateJobErrorCopy {
  titleKey: CreateJobErrorKey;
  messageKey: CreateJobErrorKey;
  icon: CreateJobErrorIcon;
  /**
   * true when the bucket should PREFER the backend's own message over the
   * translated one (the undocumented 4xx family, where the server knows more
   * than we do). Never true for 5xx or unknown — a stack trace or a raw server
   * string is not user copy.
   */
  preferServerMessage: boolean;
}

/**
 * The dialog copy for a bucket. 'network' keeps the ORIGINAL connection wording
 * and is the only bucket allowed to say it; 'invalid' and 'unauthorized' are
 * listed for totality even though the screen handles 422/401 before this.
 */
export function createJobErrorCopy(kind: CreateJobFailureKind): CreateJobErrorCopy {
  switch (kind) {
    case 'timeout':
      return {
        titleKey: 'post_err_timeout_title',
        messageKey: 'post_err_timeout_msg',
        icon: 'clock',
        preferServerMessage: false,
      };
    case 'unauthorized':
      return {
        titleKey: 'post_err_session_title',
        messageKey: 'post_err_session_msg',
        icon: 'lock',
        preferServerMessage: false,
      };
    case 'invalid':
      return {
        titleKey: 'post_err_invalid_title',
        messageKey: 'post_err_invalid_msg',
        icon: 'alert-circle',
        preferServerMessage: false,
      };
    case 'badrequest':
    case 'forbidden':
    case 'notfound':
    case 'conflict':
      return {
        titleKey: 'post_err_rejected_title',
        messageKey: 'post_err_rejected_msg',
        icon: 'alert-circle',
        preferServerMessage: true,
      };
    case 'server':
      return {
        titleKey: 'post_err_server_title',
        messageKey: 'post_err_server_msg',
        icon: 'alert-triangle',
        preferServerMessage: false,
      };
    case 'unknown':
      return {
        titleKey: 'post_err_unknown_title',
        messageKey: 'post_err_unknown_msg',
        icon: 'alert-triangle',
        preferServerMessage: false,
      };
    case 'network':
    default:
      return {
        titleKey: 'post_err_network_title',
        messageKey: 'post_err_network_msg',
        icon: 'wifi-off',
        preferServerMessage: false,
      };
  }
}
