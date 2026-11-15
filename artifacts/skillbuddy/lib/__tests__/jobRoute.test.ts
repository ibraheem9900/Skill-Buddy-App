/**
 * The job-details route builder (ROUND 18 root-cause fix).
 * A card tap must always produce a route expo-router can resolve.
 */
import { jobDetailsRoute } from '../jobRoute';

let passed = 0;
const failures: string[] = [];

function eq(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed += 1;
  } else {
    failures.push(`${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
  }
}
function check(label: string, ok: boolean) {
  if (ok) passed += 1;
  else failures.push(label);
}

const plain = jobDetailsRoute({ id: 123 });
eq('a plain job uses the dynamic pathname', plain.pathname, '/job/[id]');
eq('the id is a STRING param', plain.params.id, '123');
eq('no distance key is invented', Object.keys(plain.params).sort(), ['id']);
check('the route never carries an href key', !('href' in (plain as unknown as Record<string, unknown>)));

const near = jobDetailsRoute({ id: 7, distance_km: 1.501 });
eq('a feed distance rides along as a string', near.params.distance, '1.501');

const urgent = jobDetailsRoute({ id: 9, distance_km: 0 });
eq('a zero distance is still a real number', urgent.params.distance, '0');

eq('NaN is never forwarded', jobDetailsRoute({ id: 2, distance_km: Number.NaN }).params.distance, undefined);
eq('Infinity is never forwarded', jobDetailsRoute({ id: 2, distance_km: Infinity }).params.distance, undefined);
eq('a negative distance is never forwarded', jobDetailsRoute({ id: 2, distance_km: -3 }).params.distance, undefined);
eq('a numeric STRING is not trusted', jobDetailsRoute({ id: 2, distance_km: '3.2' }).params.distance, undefined);
eq('null is not forwarded', jobDetailsRoute({ id: 2, distance_km: null }).params.distance, undefined);
eq('an object is not forwarded', jobDetailsRoute({ id: 2, distance_km: { km: 1 } }).params.distance, undefined);

// Every value in params must be a string (expo-router serialises them).
const allStringValues = [plain, near, urgent].every((route) =>
  Object.values(route.params).every((value) => typeof value === 'string')
);
check('every param value is a string', allStringValues);

console.log(`jobRoute: ${passed} checks, ${failures.length} failure(s)`);
for (const failure of failures) console.log('  FAIL', failure);
if (failures.length > 0) throw new Error(`${failures.length} jobRoute checks failed`);
