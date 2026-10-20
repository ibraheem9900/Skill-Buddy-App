/**
 * Empty-vs-error rules for the Home and Profile data sections.
 *
 *   • a 200 with zeros / an empty list is EMPTY — neutral, never a retry;
 *   • only a request that actually failed is an ERROR with a Retry;
 *   • "Client profile not found" is its own neutral `unavailable` state;
 *   • only a genuine connectivity failure may claim a connection problem;
 *   • source checks: the fake loaders are gone and the credit points come from
 *     the real wallet endpoint instead of a `?? 0` default.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import {
  classifyDataFailure,
  failureCopyKind,
  resolveDataViewState,
  showsRetry,
} from '../dataState';

declare const console: { log: (msg: string) => void };
declare function require(name: string): any;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');

let passed = 0;
const failures: string[] = [];

function eq<T>(label: string, actual: T, expected: T) {
  if (actual === expected) {
    passed += 1;
  } else {
    failures.push(label);
    console.log(`FAIL ${label} (got ${String(actual)}, want ${String(expected)})`);
  }
}

function ok(label: string, condition: boolean) {
  eq(label, condition, true);
}

const http = (status: number, data?: unknown) => ({ isAxiosError: true, response: { status, data } });
const offline = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
const timeout = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });

// ── Classification ─────────────────────────────────────────────────────────
const profile404 = classifyDataFailure(http(404, { detail: 'Client profile not found.' }));
eq('a 404 with the client-profile body is its own kind', profile404.kind, 'client-profile');
eq('its status is kept', profile404.status, 404);
eq('its server text is kept', profile404.message, 'Client profile not found.');

eq(
  'a different 404 stays a rejected request',
  classifyDataFailure(http(404, { detail: 'Job not found' })).kind,
  'notfound'
);
eq('a network failure is a network failure', classifyDataFailure(offline).kind, 'network');
eq('a timeout is its own kind', classifyDataFailure(timeout).kind, 'timeout');
eq('a 500 is a server failure', classifyDataFailure(http(500)).kind, 'server');
eq('a 401 is a session failure', classifyDataFailure(http(401)).kind, 'unauthorized');
eq('a transport failure has no HTTP status', classifyDataFailure(offline).status, null);

// ── The state machine ──────────────────────────────────────────────────────
eq(
  'a 200 WITH data is ready',
  resolveDataViewState({ status: 'ready', hasData: true, failure: null }),
  'ready'
);
eq(
  'a 200 with ZEROS / [] is empty, not an error',
  resolveDataViewState({ status: 'ready', hasData: false, failure: null }),
  'empty'
);
eq(
  'a first load shows the loader',
  resolveDataViewState({ status: 'loading', hasData: false, failure: null }),
  'loading'
);
eq(
  'idle shows the loader',
  resolveDataViewState({ status: 'idle', hasData: false, failure: null }),
  'loading'
);
eq(
  'a missing client profile is a neutral unavailable state',
  resolveDataViewState({ status: 'error', hasData: false, failure: profile404 }),
  'unavailable'
);
eq(
  'a real failure is an error',
  resolveDataViewState({
    status: 'error',
    hasData: false,
    failure: classifyDataFailure(http(503)),
  }),
  'error'
);
eq(
  'an offline failure is an error',
  resolveDataViewState({ status: 'error', hasData: false, failure: classifyDataFailure(offline) }),
  'error'
);
eq(
  '"empty" and "unavailable" never offer Retry',
  [showsRetry('empty'), showsRetry('unavailable'), showsRetry('ready'), showsRetry('loading')].join(','),
  'false,false,false,false'
);
eq('only an error offers Retry', showsRetry('error'), true);

// ── Failure copy ───────────────────────────────────────────────────────────
eq('network failure copy', failureCopyKind(classifyDataFailure(offline)), 'network');
eq('timeout failure copy', failureCopyKind(classifyDataFailure(timeout)), 'timeout');
eq('server failure copy', failureCopyKind(classifyDataFailure(http(500))), 'server');
eq('session failure copy', failureCopyKind(classifyDataFailure(http(401))), 'session');
eq('profile failure copy is generic (not a connection', failureCopyKind(profile404), 'generic');
eq('no failure is generic', failureCopyKind(null), 'generic');

// ── Source checks: the fix is in the state check, not the copy ─────────────
function projectRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.join(dir, '..');
  }
  throw new Error(`could not find the project root above ${from}`);
}
const root = projectRoot(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const home = read('app/(tabs)/index.tsx');
ok('Home takes credit points from the wallet hook', home.includes('useCreditWallet'));
ok('Home no longer defaults points to a fake 0', !/credit_points\s*\?\?\s*0/.test(home));
ok('Home reads the wallet balance', home.includes('creditWallet.balance'));
ok('Home decides its section state from the request', home.includes('resolveDataViewState'));
ok('Home no longer hides an empty list behind an error row', !/clientDash\.status === 'error'/.test(home));
ok('Home has no artificial 500 ms loading timer', !/setTimeout\(\(\) => setLoading\(false\), 500\)/.test(home));

const profile = read('app/(tabs)/profile.tsx');
ok('Profile decides its stats state from the request', profile.includes('resolveDataViewState'));
ok(
  'Profile only offers Retry for a real failure',
  profile.includes("statsState === 'error'") && !profile.includes('clientStats.status === \'error\'')
);
ok('Profile no longer defaults points to a fake 0', !/credit_points\s*\?\?\s*0/.test(profile));

const overlay = read('components/NavigationLoaderOverlay.tsx');
ok('the full-screen loader skips tab screens entirely', overlay.includes('isTabPath(pathname)'));
ok(
  'the tab check runs before the loader is shown',
  overlay.indexOf('isTabPath(pathname)') < overlay.indexOf('setVisible(true)')
);

console.log(`dataState: ${passed} checks, ${failures.length} failure(s)`);
if (failures.length > 0) throw new Error(`${failures.length} dataState check(s) failed`);
