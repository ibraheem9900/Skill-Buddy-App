/**
 * nearbyDetails.test.ts — the second step of the nearby feed.
 *
 * Pins:
 *   • details replace the location item's display fields;
 *   • a job whose details are not OPEN / bidding_open=false / past deadline is
 *     dropped from the feed;
 *   • distance priority is server distance_km, then haversine from API points
 *     (flagged approximate), then none;
 *   • the details loader caps concurrency, de-duplicates in-flight ids and
 *     honours its TTL cache;
 *   • a failed details call keeps a per-card retry state.
 */
import {
  createDetailsLoader,
  isOpenForBids,
  markNearbyDetailsFailed,
  mergeNearbyDetails,
  type NearbyJobDetail,
} from '../nearbyDetails';
import type { NearbyJob } from '../nearbyJobs';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean) {
  if (ok) passed += 1;
  else {
    failures.push(label);
    console.log(`FAIL ${label}`);
  }
}

function eq<T>(label: string, actual: T, expected: T) {
  check(`${label} (got ${String(actual)}, want ${String(expected)})`, actual === expected);
}

const NOW = Date.parse('2026-11-14T09:00:00Z');

const location = (overrides: Partial<NearbyJob> = {}): NearbyJob => ({
  job_id: 63,
  service_id: 23,
  category_id: 28,
  title: '',
  request_type: '',
  bidding_ends_at: '',
  distance_km: Number.NaN,
  matches_skill: false,
  latitude: 59.3821143,
  longitude: 24.6662758,
  ...overrides,
});

const detail = (overrides: Partial<NearbyJobDetail> = {}): NearbyJobDetail => ({
  id: 63,
  title: 'TEST-R13 A',
  status: 'OPEN',
  request_type: 'REGULAR',
  is_bidding_open: true,
  bidding_ends_at: '2026-11-14T11:31:08Z',
  expected_hours: '1.00',
  final_price: null,
  address: {
    latitude: '59.3821143',
    longitude: '24.6662758',
    formatted_address: 'Akadeemia Tee 7A, Tallinn',
  },
  ...overrides,
});

/* ------------------------------------------------------------ open filter */

check('an OPEN, bidding job is visible', isOpenForBids(detail(), NOW));
check('a missing detail is never visible', !isOpenForBids(null, NOW));
check('ASSIGNED is dropped', !isOpenForBids(detail({ status: 'ASSIGNED' }), NOW));
check('CANCELLED is dropped', !isOpenForBids(detail({ status: 'CANCELLED' }), NOW));
check('is_bidding_open=false is dropped', !isOpenForBids(detail({ is_bidding_open: false }), NOW));
check(
  'a past deadline is dropped even when status says OPEN',
  !isOpenForBids(detail({ bidding_ends_at: '2026-11-14T08:00:00Z' }), NOW)
);
check('a lowercase status still matches', isOpenForBids(detail({ status: 'open' }), NOW));

/* ---------------------------------------------------------------- merging */

const merged = mergeNearbyDetails(
  location(),
  detail(),
  { now: NOW, providerPoint: { latitude: 59.3821143, longitude: 24.6662758 } }
);
check('an open job merges', merged !== null);
eq('the title comes from details', merged?.title, 'TEST-R13 A');
eq('the request type comes from details', merged?.request_type, 'REGULAR');
eq('the deadline comes from details', merged?.bidding_ends_at, '2026-11-14T11:31:08Z');
eq('expected hours come from details', merged?.expected_hours, '1.00');
eq('the address text comes from details', merged?.address_text, 'Akadeemia Tee 7A, Tallinn');
eq('the job coordinates come from the details address', merged?.latitude, 59.3821143);
check('detailsLoaded is set', merged?.detailsLoaded === true);

eq(
  'no server distance + same point → haversine 0, flagged approximate',
  merged?.distance_km,
  0
);
check('a computed distance is approximate', merged?.distance_approximate === true);

const withServer = mergeNearbyDetails(location({ distance_km: 0.049 }), detail(), {
  now: NOW,
  providerPoint: { latitude: 59.3821143, longitude: 24.6662758 },
});
eq('the server distance wins over haversine', withServer?.distance_km, 0.049);
check('a server distance is NOT marked approximate', withServer?.distance_approximate === false);

const far = mergeNearbyDetails(location({ job_id: 64 }), detail({ id: 64 }), {
  now: NOW,
  providerPoint: { latitude: 59.3825, longitude: 24.6667 },
});
check('a few hundred metres computes as < 1 km', (far?.distance_km ?? 9) < 1);
check('the computed metres are not 8 km', (far?.distance_km ?? 9) < 0.5);

const noPoint = mergeNearbyDetails(location({ job_id: 65 }), detail({ id: 65 }), {
  now: NOW,
  providerPoint: null,
});
check('no distance source leaves distance unusable', Number.isNaN(noPoint?.distance_km));

check(
  'a closed job merges to null and disappears',
  mergeNearbyDetails(location(), detail({ status: 'EXPIRED' }), { now: NOW }) === null
);

const failed = markNearbyDetailsFailed(location({ title: 'TEST-R13 A' }));
check('a failure keeps the card', failed.title === 'TEST-R13 A');
check('a failure sets detailsError', failed.detailsError === true);
check('a failure clears detailsLoaded', failed.detailsLoaded === false);

/* ---------------------------------------------------------------- loader */

async function main(): Promise<void> {
  let now = NOW;
  let active = 0;
  let peak = 0;
  const calls: number[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const loader = createDetailsLoader({
    concurrency: 4,
    ttlMs: 60_000,
    now: () => now,
    fetchJob: async (id) => {
      calls.push(id);
      active += 1;
      peak = Math.max(peak, active);
      await gate;
      active -= 1;
      return detail({ id });
    },
  });

  // Ten ids, one gate: only the first four may start before it opens.
  const many = loader.getMany([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  await Promise.resolve();
  eq('the loader starts at most 4 requests', calls.length, 4);
  release();
  const result = await many;
  eq('every id resolves', result.size, 10);
  eq('peak concurrency is capped at 4', peak, 4);
  eq('each id is requested once', loader.requests, 10);

  // Cache: a fresh read inside the TTL makes no network call.
  await loader.get(1);
  eq('a cached id makes no extra call', loader.requests, 10);
  now += 61_000;
  const refreshed = loader.get(1);
  await refreshed;
  eq('an expired id is refetched', loader.requests, 11);

  // In-flight de-duplication: two callers of the same id share one request.
  let gate2: () => void = () => {};
  const shared = createDetailsLoader({
    fetchJob: (id) => {
      calls.push(id);
      return new Promise((resolve) => {
        gate2 = () => resolve(detail({ id }));
      });
    },
  });
  const first = shared.get(42);
  const second = shared.get(42);
  eq('two concurrent reads make one request', shared.requests, 1);
  gate2();
  const [a, b] = await Promise.all([first, second]);
  check('both callers get the same detail', a.id === 42 && b.id === 42);

  console.log(`nearbyDetails: ${passed} checks, ${failures.length} failure(s)`);
  if (failures.length > 0) throw new Error(`${failures.length} nearbyDetails check(s) failed`);
}

void main();
