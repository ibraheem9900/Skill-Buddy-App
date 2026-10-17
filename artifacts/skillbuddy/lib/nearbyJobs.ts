/**
 * nearbyJobs.ts
 *
 * Pure logic behind the provider "Available jobs" feed
 * (GET /api/v1/providers/me/nearby-jobs). No React and no axios here, so every
 * rule below is unit-testable without a renderer or a live token.
 *
 * THE ITEM IS THE WHOLE ITEM. Live `NearbyJobResponse` (verified 2026-10-15):
 * `job_id, service_id, category_id, title, request_type, bidding_ends_at,
 * distance_km, matches_skill` — all eight REQUIRED, `distance_km` a NUMBER
 * (float km), `bidding_ends_at` a date-time string. There is no description,
 * price/rate, client snapshot or address text on the wire, so nothing here (or
 * in the card that renders it) invents one.
 *
 * The GET query is `radius_km` (number > 0 — it can only NARROW the provider's
 * own service radius, the server caps it), repeatable `service_id` (ints) and
 * `limit` (1..200, server default 50). Live confirmations: `limit=0` and
 * `limit=201` are 422 (`greater_than_equal 1` / `less_than_equal 200`),
 * `radius_km=0` is 422 (`greater_than 0`), `service_id=abc` is 422 — so the
 * builder below never sends a param that cannot be honoured.
 *
 * PATCH /providers/profile { service_radius } is an INTEGER in 1..30 (live:
 * 31 -> `less_than_equal 30`, 0 and -3 -> `greater_than_equal 1`, 7.5 ->
 * `int_from_float`), which is what SERVICE_RADIUS_MIN/MAX describe; the
 * default in the integration guide is 5.
 */

import type { RealtimeStatus } from '@/lib/realtime';

/** Query-parameter bounds, from the live OpenAPI schema. */
export const NEARBY_LIMIT_MIN = 1;
export const NEARBY_LIMIT_MAX = 200;
export const NEARBY_LIMIT_DEFAULT = 50;

/** Service radius (km) accepted by PATCH /providers/profile, from the live schema. */
export const SERVICE_RADIUS_MIN = 1;
export const SERVICE_RADIUS_MAX = 30;
/** The integration guide's documented default. */
export const SERVICE_RADIUS_DEFAULT = 5;

/**
 * How often the feed re-reads the list while the realtime socket is NOT open.
 * Events are never stored, so without a socket the list has to be polled; when
 * the socket IS open the events carry the changes and no polling happens.
 */
export const NEARBY_POLL_MS = 20_000;

/**
 * The backend's own visibility message, returned with HTTP 400 when the
 * provider is not visible for nearby jobs. Compared case-insensitively on the
 * distinctive part so small wording changes upstream do not turn an onboarding
 * state into a scary generic error.
 */
export const NEARBY_VISIBILITY_PHRASE = 'not visible for nearby jobs';

/** One item of GET /providers/me/nearby-jobs, exactly as the schema types it. */
export interface NearbyJob {
  job_id: number;
  service_id: number;
  category_id: number;
  title: string;
  request_type: string;
  bidding_ends_at: string;
  distance_km: number;
  matches_skill: boolean;
}

/** Only set parameters are sent; a missing optional param means "server default". */
export interface NearbyJobsQuery {
  /** Narrow the list (km). The server caps this at the provider's own radius. */
  radius_km?: number | null;
  /** Restrict to these services. Repeated in the query string, in order. */
  service_ids?: number[] | null;
  /** 1..200. Out-of-range values are dropped rather than sent as a 422. */
  limit?: number | null;
}

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isUsableServiceId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

/** Is this limit one the server would accept (and the app should send)? */
export function isValidNearbyLimit(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= NEARBY_LIMIT_MIN &&
    value <= NEARBY_LIMIT_MAX
  );
}

/**
 * Build the query string for GET /providers/me/nearby-jobs.
 *
 * Returns '' when nothing is set (the caller appends it to the path as-is).
 * `service_id` is repeated once per service so the array form the schema
 * documents (`?service_id=1&service_id=2`) is what goes out; empty/duplicate
 * entries are dropped.
 */
export function buildNearbyJobsQuery(query: NearbyJobsQuery = {}): string {
  const parts: string[] = [];

  const radius = query.radius_km;
  if (isPositiveNumber(radius)) parts.push(`radius_km=${radius}`);

  const services = query.service_ids;
  if (Array.isArray(services)) {
    const seen = new Set<number>();
    for (const serviceId of services) {
      if (!isUsableServiceId(serviceId) || seen.has(serviceId)) continue;
      seen.add(serviceId);
      parts.push(`service_id=${serviceId}`);
    }
  }

  const limit = query.limit;
  if (isValidNearbyLimit(limit)) parts.push(`limit=${limit}`);

  return parts.length ? `?${parts.join('&')}` : '';
}

/** URGENT vs REGULAR, tolerant of case but never of a missing value. */
export function isUrgentRequest(requestType: string | null | undefined): boolean {
  return typeof requestType === 'string' && requestType.toUpperCase() === 'URGENT';
}

/** The feed's own two-state kind, used by the filter chips. */
export type NearbyJobKind = 'ALL' | 'URGENT' | 'REGULAR';

export interface NearbyJobFilters {
  kind: NearbyJobKind;
  /** Default OFF: the feed shows every open job in range, matching or not. */
  onlyMatchingSkills: boolean;
}

export const NEARBY_DEFAULT_FILTERS: NearbyJobFilters = {
  kind: 'ALL',
  onlyMatchingSkills: false,
};

/**
 * The API's own ordering, re-applied LOCALLY after every change so an upserted
 * or refreshed item cannot land in the wrong place: jobs matching the
 * provider's skills first, then closest first. `job_id` is the tie-break, which
 * makes the order deterministic for equal distances (and therefore stable
 * across re-sorts).
 */
export function sortNearbyJobs(jobs: readonly NearbyJob[]): NearbyJob[] {
  return [...jobs].sort((a, b) => {
    if (a.matches_skill !== b.matches_skill) return a.matches_skill ? -1 : 1;
    const aDistance = typeof a.distance_km === 'number' && Number.isFinite(a.distance_km)
      ? a.distance_km
      : Number.POSITIVE_INFINITY;
    const bDistance = typeof b.distance_km === 'number' && Number.isFinite(b.distance_km)
      ? b.distance_km
      : Number.POSITIVE_INFINITY;
    if (aDistance !== bDistance) return aDistance - bDistance;
    return a.job_id - b.job_id;
  });
}

/**
 * Insert or replace one item by `job_id` (the same operation both a REST
 * refetch merge and a `job.nearby_opened` frame need), then re-sort. A job
 * already in the list is REPLACED — its timer or details may have changed.
 */
export function upsertNearbyJob(
  jobs: readonly NearbyJob[],
  item: NearbyJob
): { jobs: NearbyJob[]; added: boolean } {
  const index = jobs.findIndex((job) => job.job_id === item.job_id);
  if (index === -1) return { jobs: sortNearbyJobs([...jobs, item]), added: true };
  const next = [...jobs];
  next[index] = item;
  return { jobs: sortNearbyJobs(next), added: false };
}

/**
 * Merge a freshly fetched list into the current one, de-duplicating by
 * `job_id` (the last occurrence wins) so a server page that repeats an item can
 * never render twice.
 */
export function dedupeNearbyJobs(jobs: readonly NearbyJob[]): NearbyJob[] {
  const byId = new Map<number, NearbyJob>();
  for (const job of jobs) {
    if (!job || typeof job.job_id !== 'number') continue;
    byId.set(job.job_id, job);
  }
  return sortNearbyJobs(Array.from(byId.values()));
}

/** Remove one job from the feed (`job.nearby_closed`, or a local expiry). */
export function removeNearbyJob(jobs: readonly NearbyJob[], jobId: number): NearbyJob[] {
  return jobs.filter((job) => job.job_id !== jobId);
}

/** Epoch ms of the item's deadline, or null when the server sent something unusable. */
export function nearbyDeadline(item: NearbyJob): number | null {
  const parsed = typeof item?.bidding_ends_at === 'string' ? Date.parse(item.bidding_ends_at) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Is the job's bidding window still open?
 *
 * An item whose deadline is missing/unparseable is KEPT: hiding a job the app
 * cannot read would silently drop real work, while the server's own
 * `job.nearby_closed` / the next refetch decide a genuinely finished job.
 */
export function isNearbyJobVisible(item: NearbyJob, now: number): boolean {
  const deadline = nearbyDeadline(item);
  if (deadline === null) return true;
  return deadline > now;
}

/** Hide every item whose window has ended — no waiting for a server event. */
export function hideExpiredNearbyJobs(jobs: readonly NearbyJob[], now: number): NearbyJob[] {
  return jobs.filter((job) => isNearbyJobVisible(job, now));
}

/**
 * When the feed's next local expiry happens: the earliest FUTURE deadline of
 * the jobs on screen, or null when nothing can expire.
 *
 * This is what lets the screen run ONE shared timer that fires exactly when the
 * next card must disappear, instead of an interval per card.
 */
export function nextNearbyExpiryAt(jobs: readonly NearbyJob[], now: number): number | null {
  let next: number | null = null;
  for (const job of jobs) {
    const deadline = nearbyDeadline(job);
    if (deadline === null || deadline <= now) continue;
    if (next === null || deadline < next) next = deadline;
  }
  return next;
}

/** Client-side All / Urgent / Regular + "Only my skills" filtering. */
export function filterNearbyJobs(
  jobs: readonly NearbyJob[],
  filters: NearbyJobFilters
): NearbyJob[] {
  const kind = filters.kind ?? 'ALL';
  return jobs.filter((job) => {
    if (filters.onlyMatchingSkills && !job.matches_skill) return false;
    if (kind === 'ALL') return true;
    return isUrgentRequest(job.request_type) === (kind === 'URGENT');
  });
}

/* ------------------------------------------------------- failure mapping */

export type NearbyFailureKind =
  /** 400 + the visibility message: an onboarding state, not an error. */
  | 'onboarding'
  /** The account has no provider role (a client hit a provider endpoint). */
  | 'forbidden'
  /** Anything else — show the backend's detail when it sent one. */
  | 'error';

export interface NearbyFailure {
  kind: NearbyFailureKind;
  /** The backend's own detail text, when it sent one. */
  detail: string | null;
}

/** Pull a human-readable detail out of a FastAPI error body. */
export function nearbyErrorDetail(body: unknown): string | null {
  const detail = (body as { detail?: unknown } | null | undefined)?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const first = detail.find((entry) => typeof (entry as { msg?: unknown })?.msg === 'string');
    const msg = first ? String((first as { msg: string }).msg) : '';
    if (msg.trim()) return msg.trim();
  }
  return null;
}

/**
 * Classify a failed GET /providers/me/nearby-jobs.
 *
 * 400 + the visibility phrase is the ONLY case that becomes onboarding; every
 * other failure stays an error (with the server's own text), so a genuine
 * problem is never dressed up as a checklist.
 */
export function classifyNearbyFailure(status: number, body: unknown): NearbyFailure {
  const detail = nearbyErrorDetail(body);
  if (status === 400) {
    const haystack = (detail ?? '').toLowerCase();
    if (haystack.includes(NEARBY_VISIBILITY_PHRASE)) return { kind: 'onboarding', detail };
    return { kind: 'error', detail };
  }
  if (status === 403) return { kind: 'forbidden', detail };
  return { kind: 'error', detail };
}

/* --------------------------------------------------- visibility checklist */

export type NearbyChecklistKey = 'address' | 'approval' | 'skills';

export interface NearbyChecklistItem {
  key: NearbyChecklistKey;
  done: boolean;
  /** Route the row opens, or null for an informational row (no control). */
  cta: 'address' | 'skills' | null;
}

export interface NearbyVisibilityState {
  /** Every requirement the backend documents, in its own order. */
  items: NearbyChecklistItem[];
  /** Which requirement is the reason for the 400 (best effort). */
  cause: 'address' | 'approval' | 'unknown';
  /** Address saved WITH coordinates — without these the provider is invisible. */
  hasCoordinates: boolean;
  /** current_status.status === 'APPROVED' (or the profile's own snapshot). */
  approved: boolean;
  /** The profile's is_active flag — READ ONLY, and never written by the app. */
  active: boolean;
  /** At least one active skill (recommended for matching, not required). */
  hasActiveSkills: boolean;
}

interface AddressLike {
  latitude?: string | number | null;
  longitude?: string | number | null;
}

interface ProviderProfileLike {
  is_active?: boolean | null;
  current_status?: { status?: string | null } | null;
  service_radius?: number | null;
}

/**
 * Build the onboarding checklist from the three read-only sources the backend
 * documents as the visibility requirements: the saved address (with
 * coordinates), the provider status and the profile's active flag, plus the
 * RECOMMENDED skills row.
 *
 * `is_active` is only ever READ here: activation is an admin decision, so the
 * checklist has no control for it and the app never PATCHes it.
 */
export function nearbyVisibilityState(
  profile: ProviderProfileLike | null | undefined,
  status: { status?: string | null } | null | undefined,
  address: AddressLike | null | undefined,
  activeSkillCount: number
): NearbyVisibilityState {
  const latitude = address?.latitude;
  const longitude = address?.longitude;
  const hasCoordinates =
    latitude !== null &&
    latitude !== undefined &&
    longitude !== null &&
    longitude !== undefined &&
    Number.isFinite(Number(latitude)) &&
    Number.isFinite(Number(longitude)) &&
    String(latitude).trim() !== '' &&
    String(longitude).trim() !== '';

  const statusValue = status?.status ?? profile?.current_status?.status ?? null;
  const approved = typeof statusValue === 'string' && statusValue.toUpperCase() === 'APPROVED';
  const active = profile?.is_active === true;
  const hasActiveSkills = activeSkillCount > 0;

  const items: NearbyChecklistItem[] = [
    { key: 'address', done: hasCoordinates, cta: 'address' },
    { key: 'approval', done: approved && active, cta: null },
    { key: 'skills', done: hasActiveSkills, cta: hasActiveSkills ? null : 'skills' },
  ];

  const cause: NearbyVisibilityState['cause'] = !hasCoordinates
    ? 'address'
    : !approved || !active
      ? 'approval'
      : 'unknown';

  return { items, cause, hasCoordinates, approved, active, hasActiveSkills };
}

/* ------------------------------------------------------------------ misc */

/** Locales that write a decimal comma (the app's five languages minus English). */
const COMMA_DECIMAL_LANGUAGES = new Set(['de', 'et', 'lv', 'lt']);

/**
 * Distance in the app's locale, one decimal place: '1.8 km' in English,
 * '1,8 km' in de/et/lv/lt. A distance the server did not send a number for
 * renders nothing (''), so the card omits the row instead of printing '- km'.
 */
export function formatDistanceKm(distanceKm: number | null | undefined, language: string): string {
  // A MISSING distance is not 0: null/undefined/'' must render nothing, or the
  // card would claim the job is on the provider's doorstep.
  if (distanceKm === null || distanceKm === undefined || (distanceKm as unknown) === '') return '';
  const value = typeof distanceKm === 'number' ? distanceKm : Number(distanceKm);
  if (!Number.isFinite(value) || value < 0) return '';
  const fixed = value.toFixed(1);
  const text = COMMA_DECIMAL_LANGUAGES.has(language) ? fixed.replace('.', ',') : fixed;
  return `${text} km`;
}

/**
 * Read a `job.nearby_opened` frame as a feed item. The event carries EXACTLY the
 * list item's fields (integration guide), so one parser serves both the REST
 * array and the socket frame. Returns null for a frame without a usable job id
 * or title — a malformed frame must never add a nameless card to the feed.
 */
export function parseNearbyJob(data: unknown): NearbyJob | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  const jobId = raw.job_id;
  if (typeof jobId !== 'number' || !Number.isInteger(jobId)) return null;
  const title = typeof raw.title === 'string' ? raw.title : '';
  if (!title.trim()) return null;

  const numberOr = (value: unknown, fallback: number): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    job_id: jobId,
    service_id: numberOr(raw.service_id, 0),
    category_id: numberOr(raw.category_id, 0),
    title,
    request_type: typeof raw.request_type === 'string' ? raw.request_type : '',
    bidding_ends_at: typeof raw.bidding_ends_at === 'string' ? raw.bidding_ends_at : '',
    distance_km: numberOr(raw.distance_km, Number.NaN),
    matches_skill: raw.matches_skill === true,
  };
}

/** Would this frame be a job the provider has not seen in this list yet? */
export function isNewNearbyJob(jobs: readonly NearbyJob[], item: NearbyJob | null | undefined): boolean {
  if (!item || typeof item.job_id !== 'number') return false;
  return !jobs.some((job) => job.job_id === item.job_id);
}

/**
 * Should the feed poll? Only while the realtime socket is NOT open ('open' is
 * the one state where events carry the changes). 'idle' counts as polling on
 * purpose: the feed is on screen and realtime is not carrying it.
 */
export function shouldPollNearbyJobs(status: RealtimeStatus | null | undefined): boolean {
  return status !== 'open';
}

/** The radius value the profile screen should show/edit, clamped to the schema. */
export function normalizeServiceRadius(value: unknown): number {
  // An ABSENT radius is the documented default (5), not a coerced 0 that would
  // clamp up to the minimum.
  if (value === null || value === undefined || value === '') return SERVICE_RADIUS_DEFAULT;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return SERVICE_RADIUS_DEFAULT;
  return Math.min(SERVICE_RADIUS_MAX, Math.max(SERVICE_RADIUS_MIN, Math.round(number)));
}

/** Does PATCH /providers/profile accept this radius? (live: integer 1..30) */
export function isValidServiceRadius(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= SERVICE_RADIUS_MIN &&
    value <= SERVICE_RADIUS_MAX
  );
}
