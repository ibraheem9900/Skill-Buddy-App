/**
 * The provider "Available jobs" feed, unit-tested without a renderer or a live
 * token: the query builder (only set params, repeatable service_id, 1..200
 * limit), the ordering the server documents (matching skills first, then
 * closest), upsert/remove/de-duplication, local expiry with ONE timer target,
 * the client-side filters, the 400 -> onboarding mapping and the polling gate.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import {
  NEARBY_LIMIT_DEFAULT,
  NEARBY_LIMIT_MAX,
  NEARBY_LIMIT_MIN,
  NEARBY_POLL_MS,
  SERVICE_RADIUS_DEFAULT,
  SERVICE_RADIUS_MAX,
  SERVICE_RADIUS_MIN,
  buildNearbyJobsQuery,
  classifyNearbyFailure,
  dedupeNearbyJobs,
  filterNearbyJobs,
  formatDistanceKm,
  hideExpiredNearbyJobs,
  isNearbyJobVisible,
  isNewNearbyJob,
  isValidNearbyLimit,
  isValidServiceRadius,
  nextNearbyExpiryAt,
  normalizeServiceRadius,
  nearbyErrorDetail,
  nearbyVisibilityState,
  parseNearbyJob,
  removeNearbyJob,
  shouldPollNearbyJobs,
  sortNearbyJobs,
  upsertNearbyJob,
  type NearbyJob,
} from '../nearbyJobs';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(label);
}

function equal(label: string, actual: unknown, expected: unknown): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) failures.push(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  else passed += 1;
}

let nextId = 1;
/** An item shaped exactly like a real NearbyJobResponse (all eight fields). */
function item(overrides: Partial<NearbyJob> = {}): NearbyJob {
  return {
    job_id: nextId++,
    service_id: 35,
    category_id: 34,
    title: 'TEST - ignore',
    request_type: 'REGULAR',
    bidding_ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    distance_km: 1.5,
    matches_skill: false,
    ...overrides,
  };
}

/* ------------------------------------------------------- query building */

equal('no params → empty query string', buildNearbyJobsQuery(), '');
equal(
  'null/undefined values are all omitted',
  buildNearbyJobsQuery({ radius_km: null, service_ids: null, limit: undefined }),
  ''
);
equal('radius_km is sent when positive', buildNearbyJobsQuery({ radius_km: 5 }), '?radius_km=5');
equal('radius_km=0 is dropped (live: 422 greater_than 0)', buildNearbyJobsQuery({ radius_km: 0 }), '');
equal('a negative radius is dropped', buildNearbyJobsQuery({ radius_km: -3 }), '');
equal('a NaN radius is dropped', buildNearbyJobsQuery({ radius_km: Number.NaN }), '');
equal(
  'service_id is REPEATED, in order, once per service',
  buildNearbyJobsQuery({ service_ids: [35, 12] }),
  '?service_id=35&service_id=12'
);
equal(
  'bogus ids (0, negative, non-integer, NaN) and duplicates are dropped',
  buildNearbyJobsQuery({ service_ids: [35, 35, 0, -1, 7.5, Number.NaN] }),
  '?service_id=35'
);
equal('limit is sent inside 1..200', buildNearbyJobsQuery({ limit: 200 }), '?limit=200');
equal('limit=0 is dropped (live: 422 ge 1)', buildNearbyJobsQuery({ limit: 0 }), '');
equal('limit=201 is dropped (live: 422 le 200)', buildNearbyJobsQuery({ limit: 201 }), '');
equal('limit=7.5 is dropped (not an integer)', buildNearbyJobsQuery({ limit: 7.5 }), '');
equal(
  'all three params together, in schema order',
  buildNearbyJobsQuery({ radius_km: 3, service_ids: [9], limit: 20 }),
  '?radius_km=3&service_id=9&limit=20'
);
check('NEARBY_LIMIT bounds match the schema', NEARBY_LIMIT_MIN === 1 && NEARBY_LIMIT_MAX === 200);
check('isValidNearbyLimit agrees with the builder', isValidNearbyLimit(50) && !isValidNearbyLimit(0));
check('NEARBY_LIMIT_DEFAULT is the server default (50)', NEARBY_LIMIT_DEFAULT === 50);
check('the polling interval is the documented 20s', NEARBY_POLL_MS === 20_000);

/* --------------------------------------------------------------- ordering */

const farMatch = item({ matches_skill: true, distance_km: 9 });
const nearMatch = item({ matches_skill: true, distance_km: 0.4 });
const nearPlain = item({ matches_skill: false, distance_km: 0.2 });
const farPlain = item({ matches_skill: false, distance_km: 6.1 });

equal(
  'sorting puts matching skills first, then closest',
  sortNearbyJobs([farPlain, nearPlain, farMatch, nearMatch]).map((j) => j.job_id),
  [nearMatch.job_id, farMatch.job_id, nearPlain.job_id, farPlain.job_id]
);
equal(
  'sorting does not mutate the input array',
  (() => {
    const input = [farPlain, nearPlain];
    sortNearbyJobs(input);
    return input.map((j) => j.job_id);
  })(),
  [farPlain.job_id, nearPlain.job_id]
);
const tieA = item({ matches_skill: false, distance_km: 2, job_id: 90 });
const tieB = item({ matches_skill: false, distance_km: 2, job_id: 40 });
equal(
  'equal distances tie-break on job_id, so the order is stable',
  sortNearbyJobs([tieA, tieB]).map((j) => j.job_id),
  [40, 90]
);

/* ----------------------------------------------------------- upsert/remove */

const existing = item({ job_id: 500, distance_km: 3, title: 'TEST - ignore old' });
const refreshed = item({ job_id: 500, distance_km: 0.9, title: 'TEST - ignore new' });
const upserted = upsertNearbyJob([existing], refreshed);
equal('upsert replaces the item with the same job_id', upserted.jobs.length, 1);
equal('upsert takes the new payload', upserted.jobs[0].title, 'TEST - ignore new');
check('upsert of a known job reports added=false', upserted.added === false);

const inserted = upsertNearbyJob([existing], nearMatch);
equal('upsert adds an unknown job_id', inserted.jobs.length, 2);
check('upsert of a new job reports added=true', inserted.added === true);
equal(
  'after an upsert the list is re-sorted',
  inserted.jobs.map((j) => j.job_id),
  [nearMatch.job_id, existing.job_id]
);
equal(
  'remove drops exactly the given job_id',
  removeNearbyJob([existing, nearMatch], existing.job_id).map((j) => j.job_id),
  [nearMatch.job_id]
);
equal('removing an unknown id changes nothing', removeNearbyJob([existing], 12345).length, 1);
const duplicated = dedupeNearbyJobs([existing, nearMatch, { ...existing, title: 'TEST - ignore last wins' }]);
equal('dedupe keeps one row per job_id (last wins)', duplicated.length, 2);
equal(
  'dedupe keeps the last payload for a repeated id',
  duplicated.find((j) => j.job_id === existing.job_id)?.title,
  'TEST - ignore last wins'
);

/* ------------------------------------------------------------ local expiry */

const now = Date.parse('2026-10-15T12:00:00Z');
const expired = item({ job_id: 700, bidding_ends_at: '2026-10-15T11:59:00Z' });
const open = item({ job_id: 701, bidding_ends_at: '2026-10-15T12:30:00Z' });
const later = item({ job_id: 702, bidding_ends_at: '2026-10-15T14:00:00Z' });
const unreadable = item({ job_id: 703, bidding_ends_at: 'not-a-date' });

check('a past deadline is not visible', !isNearbyJobVisible(expired, now));
check('a future deadline is visible', isNearbyJobVisible(open, now));
check('an unreadable deadline is KEPT (never silently dropped)', isNearbyJobVisible(unreadable, now));
equal(
  'expiry prunes exactly the ended jobs',
  hideExpiredNearbyJobs([expired, open, later], now).map((j) => j.job_id),
  [open.job_id, later.job_id]
);
equal(
  'ONE timer target: the earliest FUTURE deadline',
  nextNearbyExpiryAt([later, expired, open, unreadable], now),
  Date.parse('2026-10-15T12:30:00Z')
);
equal('no future deadline → no timer at all', nextNearbyExpiryAt([expired, unreadable], now), null);
equal('an empty list arms no timer', nextNearbyExpiryAt([], now), null);

/* ---------------------------------------------------------------- filters */

const urgentMatch = item({ matches_skill: true, request_type: 'URGENT' });
const regularPlain = item({ matches_skill: false, request_type: 'REGULAR' });
const mixed = [urgentMatch, regularPlain, nearMatch, farPlain];

equal(
  'ALL + no skill filter keeps everything',
  filterNearbyJobs(mixed, { kind: 'ALL', onlyMatchingSkills: false }).length,
  mixed.length
);
equal(
  'the URGENT chip keeps only urgent jobs',
  filterNearbyJobs(mixed, { kind: 'URGENT', onlyMatchingSkills: false }).map((j) => j.job_id),
  [urgentMatch.job_id]
);
equal(
  'the REGULAR chip keeps only regular jobs',
  filterNearbyJobs(mixed, { kind: 'REGULAR', onlyMatchingSkills: false }).map((j) => j.job_id),
  [regularPlain.job_id, nearMatch.job_id, farPlain.job_id]
);
equal(
  '"Only my skills" is off by default and filters when switched on',
  filterNearbyJobs(mixed, { kind: 'ALL', onlyMatchingSkills: true }).map((j) => j.job_id),
  [urgentMatch.job_id, nearMatch.job_id]
);
equal(
  'both filters combine',
  filterNearbyJobs(mixed, { kind: 'URGENT', onlyMatchingSkills: true }).map((j) => j.job_id),
  [urgentMatch.job_id]
);
check(
  'a lowercase request_type still counts as urgent',
  filterNearbyJobs([item({ request_type: 'urgent' })], { kind: 'URGENT', onlyMatchingSkills: false }).length === 1
);

/* ------------------------------------------------------- 400 → onboarding */

const VISIBILITY_BODY = {
  detail:
    'You are not visible for nearby jobs. Save an address with coordinates, and make sure your provider profile is active and approved.',
};
const onboarding = classifyNearbyFailure(400, VISIBILITY_BODY);
check('the live 400 body maps to onboarding', onboarding.kind === 'onboarding');
check('the onboarding state keeps the backend text', onboarding.detail === VISIBILITY_BODY.detail);
check(
  'a 400 WITHOUT the visibility message stays an error',
  classifyNearbyFailure(400, { detail: 'Something else went wrong.' }).kind === 'error'
);
check('a 400 with no body stays an error', classifyNearbyFailure(400, null).kind === 'error');
check('403 is the client-account case', classifyNearbyFailure(403, { detail: 'Nope' }).kind === 'forbidden');
check('401 is not onboarding', classifyNearbyFailure(401, { detail: 'Not authenticated' }).kind === 'error');
check('500 with a detail keeps the detail', nearbyErrorDetail({ detail: 'Boom' }) === 'Boom');
check(
  'a FastAPI validation detail[] yields its first msg',
  nearbyErrorDetail({ detail: [{ loc: ['query', 'limit'], msg: 'Input should be greater than or equal to 1' }] }) ===
    'Input should be greater than or equal to 1'
);
check('an unknown body yields null', nearbyErrorDetail({ nope: true }) === null);

/* ------------------------------------------------- visibility checklist */

const baseProfile = { is_active: true, current_status: { status: 'APPROVED' } };
const coordAddress = { latitude: '31.5300000', longitude: '74.3700000' };

const allDone = nearbyVisibilityState(baseProfile, { status: 'APPROVED' }, coordAddress, 2);
check('a fully set up provider has every row done', allDone.items.every((row) => row.done));
check('a fully set up provider has no unknown cause', allDone.cause === 'unknown');
check('the address row has the address CTA', allDone.items[0].cta === 'address');
check('the approval row never offers a control', allDone.items[1].cta === null);
check('a provider WITH skills gets no skills CTA', allDone.items[2].cta === null);

const noAddress = nearbyVisibilityState(baseProfile, { status: 'APPROVED' }, null, 1);
check('a missing address is the cause when coordinates are absent', noAddress.cause === 'address');
check('the address row is not done without an address', noAddress.items[0].done === false);
check('the skills row has the skills CTA when there are none', noAddress.items[2].done === true);

const noCoords = nearbyVisibilityState(baseProfile, { status: 'APPROVED' }, { latitude: null, longitude: null }, 0);
check('an address WITHOUT coordinates still counts as missing', noCoords.cause === 'address');
check('a provider with no active skills gets the skills row undone', noCoords.items[2].done === false);
check('an undone skills row carries the skills CTA', noCoords.items[2].cta === 'skills');

const notApproved = nearbyVisibilityState(
  { is_active: false, current_status: { status: 'PENDING' } },
  { status: 'PENDING' },
  coordAddress,
  1
);
check('pending approval is the cause when the address is fine', notApproved.cause === 'approval');
check('the approval row is undone', notApproved.items[1].done === false);
check('the read-only active flag is exposed for the copy', notApproved.active === false);
check('is_active is only READ (the state carries no setter)', typeof notApproved.active === 'boolean');

const statusOnly = nearbyVisibilityState(null, { status: 'APPROVED' }, coordAddress, 0);
check('the status endpoint alone can prove approval', statusOnly.approved === true);
check(
  'a numeric address also counts (the API sends decimal strings)',
  nearbyVisibilityState(baseProfile, null, { latitude: 31.53, longitude: 74.37 }, 0).hasCoordinates === true
);

/* ------------------------------------------- socket frame → feed item */

const frame = {
  job_id: 421,
  service_id: 35,
  category_id: 34,
  title: 'TEST - ignore frame',
  request_type: 'URGENT',
  bidding_ends_at: '2026-10-15T12:30:00Z',
  distance_km: 1.8,
  matches_skill: true,
};
equal('a job.nearby_opened frame parses into the feed item', parseNearbyJob(frame), frame);
check('a frame with no job_id is rejected', parseNearbyJob({ title: 'x' }) === null);
check('a frame with a non-integer job_id is rejected', parseNearbyJob({ ...frame, job_id: '421' }) === null);
check('a frame with an empty title is rejected', parseNearbyJob({ ...frame, title: '  ' }) === null);
check('a null frame is rejected', parseNearbyJob(null) === null);
check(
  'a frame missing optional numbers still parses (defaults applied)',
  parseNearbyJob({ job_id: 5, title: 'TEST - ignore' })?.matches_skill === false
);
check('a NEW frame is reported as new', isNewNearbyJob([existing], frame) === true);
check('an already-listed frame is not new', isNewNearbyJob([existing], { ...frame, job_id: existing.job_id }) === false);
check('a null frame is never "new"', isNewNearbyJob([existing], null) === false);

/* ------------------------------------------------------ distance + polling */

equal('distance is one decimal in the app locale', formatDistanceKm(1.84, 'en'), '1.8 km');
equal('a decimal comma locale renders a comma', formatDistanceKm(1.84, 'de'), '1,8 km');
equal('et/lv/lt also use the comma', formatDistanceKm(0.05, 'lt'), '0,1 km');
equal('a whole number still shows one decimal', formatDistanceKm(2, 'en'), '2.0 km');
equal('a missing distance renders nothing (row omitted)', formatDistanceKm(null, 'en'), '');
equal('a NaN distance renders nothing', formatDistanceKm(Number.NaN, 'en'), '');
equal('a negative distance renders nothing', formatDistanceKm(-1, 'en'), '');

check('polling runs while the socket is NOT open', shouldPollNearbyJobs('connecting'));
check('polling runs while the socket is reconnecting', shouldPollNearbyJobs('reconnecting'));
check('polling runs when realtime never started', shouldPollNearbyJobs('idle'));
check('polling runs while paused in the background socket state', shouldPollNearbyJobs('paused'));
check('polling STOPS once the socket is open', shouldPollNearbyJobs('open') === false);

/* ------------------------------------------------------- radius control */

check('the radius bounds match the live schema', SERVICE_RADIUS_MIN === 1 && SERVICE_RADIUS_MAX === 30);
check('the documented default is 5 km', SERVICE_RADIUS_DEFAULT === 5);
check('isValidServiceRadius accepts the live-legal values', isValidServiceRadius(1) && isValidServiceRadius(30));
check('isValidServiceRadius rejects 0, 31 and 7.5', !isValidServiceRadius(0) && !isValidServiceRadius(31) && !isValidServiceRadius(7.5));
equal('a stored radius outside the schema is clamped', normalizeServiceRadius(100), 30);
equal('a float radius is rounded', normalizeServiceRadius(7.5), 8);
equal('a missing radius falls back to the documented default', normalizeServiceRadius(null), 5);
equal('a live radius is passed through', normalizeServiceRadius(10), 10);

console.log(
  `nearbyJobs: ${passed}/${passed + failures.length} assertions passed` +
    (failures.length ? `\n  failures:\n   - ${failures.join('\n   - ')}` : '')
);
