/**
 * nearbyDetails.ts — the SECOND step of the nearby feed.
 *
 * GET /providers/me/nearby-jobs is being reduced to the LOCATION feed: which
 * open jobs are near the pilot (job_id, optionally a coordinate pair / the
 * server's distance). Everything a card renders comes from the normal job
 * details endpoint. There is no batch endpoint in the live OpenAPI spec, so the
 * app fetches details per id with a small concurrency cap, a short TTL cache and
 * de-duplication of in-flight requests.
 *
 * This module is pure except for the injected `fetchJob`, so the merge rules,
 * the closed-job filter and the loader can be unit-tested without a network.
 */

import { haversineKm } from '@/lib/coordinates';
import { parseApiIsoUtc } from '@/lib/jobDetail';
import type { NearbyJob } from '@/lib/nearbyJobs';

/** The subset of JobResponse the feed needs. */
export interface NearbyJobDetail {
  id: number;
  title?: string | null;
  status?: string | null;
  request_type?: string | null;
  is_bidding_open?: boolean | null;
  bidding_ends_at?: string | null;
  expected_hours?: string | number | null;
  final_price?: string | number | null;
  address?: {
    latitude?: string | number | null;
    longitude?: string | number | null;
    formatted_address?: string | null;
    city?: { name?: string | null } | null;
  } | null;
}

export interface LatLngLike {
  latitude: number;
  longitude: number;
}

function parsePoint(
  latitude: unknown,
  longitude: unknown
): LatLngLike | null {
  if (latitude === null || latitude === undefined || latitude === '') return null;
  if (longitude === null || longitude === undefined || longitude === '') return null;
  const lat = typeof latitude === 'number' ? latitude : Number(latitude);
  const lng = typeof longitude === 'number' ? longitude : Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { latitude: lat, longitude: lng };
}

/**
 * A job is feed-visible only while its details say bidding is still open.
 * A missing status is treated as NOT visible — the feed must never promise a
 * job the pilot cannot bid on. A missing deadline is kept when everything else
 * says open (an older response may omit it); the next refresh decides.
 */
export function isOpenForBids(detail: NearbyJobDetail | null | undefined, now: number): boolean {
  if (!detail) return false;
  const status = typeof detail.status === 'string' ? detail.status.toUpperCase() : '';
  if (status !== 'OPEN') return false;
  if (detail.is_bidding_open === false) return false;
  // GET /jobs/{id} sends bidding_ends_at WITHOUT a zone marker ("…T13:20:18"),
  // which is UTC. Date.parse would read it as DEVICE-LOCAL — two hours in the
  // past in Tallinn — and drop every fresh job a second after it appears.
  const deadline = parseApiIsoUtc(detail.bidding_ends_at);
  if (deadline && deadline.getTime() <= now) return false;
  return true;
}

/**
 * Merge the location item with its details. Returns null when the job is no
 * longer open for bids, which is how a stale nearby list stops showing it.
 *
 * Distance priority: the server's `distance_km`, then haversine between the
 * pilot's API-provided point and the job address's API-provided coordinates.
 * A computed value is flagged so the UI can print "~".
 */
export function mergeNearbyDetails(
  item: NearbyJob,
  detail: NearbyJobDetail,
  options: { now?: number; providerPoint?: LatLngLike | null } = {}
): NearbyJob | null {
  const now = options.now ?? Date.now();
  if (!isOpenForBids(detail, now)) return null;

  const jobPoint = parsePoint(detail.address?.latitude, detail.address?.longitude);
  let distance = typeof item.distance_km === 'number' && Number.isFinite(item.distance_km)
    ? item.distance_km
    : Number.NaN;
  let approximate = false;
  if (!Number.isFinite(distance) && jobPoint && options.providerPoint) {
    distance = haversineKm(options.providerPoint, jobPoint);
    approximate = true;
  }

  return {
    ...item,
    title: typeof detail.title === 'string' && detail.title.trim() ? detail.title : item.title,
    request_type:
      typeof detail.request_type === 'string' && detail.request_type
        ? detail.request_type
        : item.request_type,
    bidding_ends_at:
      typeof detail.bidding_ends_at === 'string' && detail.bidding_ends_at
        ? detail.bidding_ends_at
        : item.bidding_ends_at,
    distance_km: distance,
    distance_approximate: approximate,
    latitude: item.latitude ?? jobPoint?.latitude,
    longitude: item.longitude ?? jobPoint?.longitude,
    address_text: detail.address?.formatted_address ?? null,
    expected_hours:
      detail.expected_hours === null || detail.expected_hours === undefined
        ? null
        : String(detail.expected_hours),
    final_price:
      detail.final_price === null || detail.final_price === undefined
        ? null
        : String(detail.final_price),
    detailsLoaded: true,
    detailsError: false,
  };
}

/** The state a card shows when its details call failed. */
export function markNearbyDetailsFailed(item: NearbyJob): NearbyJob {
  return { ...item, detailsLoaded: false, detailsError: true };
}

/* ------------------------------------------------------------------ loader */

export interface DetailsLoaderOptions {
  fetchJob: (id: number) => Promise<NearbyJobDetail>;
  /** How long a successful detail is reused (default 60 s). */
  ttlMs?: number;
  /** Parallel detail requests (default 4). */
  concurrency?: number;
  now?: () => number;
}

export interface DetailsLoader {
  /** Cached or fresh detail, de-duplicating concurrent calls for the same id. */
  get(id: number): Promise<NearbyJobDetail>;
  /** Fetch many ids with the concurrency cap, preserving order. */
  getMany(ids: readonly number[]): Promise<Map<number, NearbyJobDetail>>;
  /** Drop one id (per-card retry) or everything. */
  invalidate(id?: number): void;
  /** Number of network calls made so far — used by tests and the report. */
  readonly requests: number;
}

export function createDetailsLoader(options: DetailsLoaderOptions): DetailsLoader {
  const ttlMs = options.ttlMs ?? 60_000;
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const now = options.now ?? (() => Date.now());
  const cache = new Map<number, { detail: NearbyJobDetail; at: number }>();
  const inFlight = new Map<number, Promise<NearbyJobDetail>>();
  let requests = 0;

  const get = (id: number): Promise<NearbyJobDetail> => {
    const cached = cache.get(id);
    if (cached && now() - cached.at < ttlMs) return Promise.resolve(cached.detail);
    const pending = inFlight.get(id);
    if (pending) return pending;
    requests += 1;
    const promise = options
      .fetchJob(id)
      .then((detail) => {
        cache.set(id, { detail, at: now() });
        return detail;
      })
      .finally(() => {
        inFlight.delete(id);
      });
    inFlight.set(id, promise);
    return promise;
  };

  const getMany = async (ids: readonly number[]) => {
    const unique = Array.from(new Set(ids.filter((id) => Number.isInteger(id))));
    const result = new Map<number, NearbyJobDetail>();
    let cursor = 0;
    const worker = async () => {
      while (cursor < unique.length) {
        const id = unique[cursor];
        cursor += 1;
        try {
          result.set(id, await get(id));
        } catch {
          // The caller marks that card as failed; one bad id never stops the rest.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
    return result;
  };

  return {
    get,
    getMany,
    invalidate: (id?: number) => {
      if (typeof id === 'number') {
        cache.delete(id);
        inFlight.delete(id);
        return;
      }
      cache.clear();
      inFlight.clear();
    },
    get requests() {
      return requests;
    },
  };
}
