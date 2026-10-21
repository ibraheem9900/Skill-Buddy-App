/**
 * Jobs screen rules + the global popup-animation rule.
 *
 *   • filter state → GET /api/v1/jobs query params (and back out of them);
 *   • the active-filter chips the Filters button shows;
 *   • one decision for "loading / list / empty / empty-with-filters / error", so
 *     a 200 with an empty array can never render an error;
 *   • the failure classifier: only a genuine connectivity failure is allowed to
 *     read like one, and "Client profile not found" is its own case;
 *   • a source scan proving no popup component animates with a slide/zoom/spring.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import {
  EMPTY_JOB_FILTERS,
  activeFilterCount,
  activeFilterIds,
  buildListJobsQuery,
  hasActiveFilters,
  isClientProfileMissing,
  removeFilter,
  resolveJobsViewState,
  type JobListFilters,
} from '../jobList';
import { classifyCreateJobFailure, createJobErrorCopy } from '../jobCreate';
import { POPUP_FADE_IN_MS, POPUP_FADE_OUT_MS } from '../motion';

declare const console: { log: (msg: string) => void };
declare function require(name: string): any;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean) {
  if (ok) {
    passed += 1;
  } else {
    failures.push(label);
    console.log(`FAIL ${label}`);
  }
}

function eq<T>(label: string, actual: T, expected: T) {
  check(`${label} (got ${String(actual)}, want ${String(expected)})`, actual === expected);
}

// ── Filter state → query params ──────────────────────────────────────────
const none = EMPTY_JOB_FILTERS;
eq('no filters produce no narrowing params', Object.keys(buildListJobsQuery({ limit: 20, offset: 0 })).join(','), 'limit,offset');
eq('only_actively_bidding=false is omitted (server default)', 'only_actively_bidding' in buildListJobsQuery({ only_actively_bidding: false }), false);
eq(
  'only_actively_bidding=true is sent as a string',
  buildListJobsQuery({ only_actively_bidding: true }).only_actively_bidding,
  'true'
);
eq('a status is sent verbatim', buildListJobsQuery({ status: 'PAYMENT_PENDING' }).status, 'PAYMENT_PENDING');
eq('a request type is sent verbatim', buildListJobsQuery({ request_type: 'URGENT' }).request_type, 'URGENT');
eq('offset 0 is explicit when asked for', buildListJobsQuery({ offset: 0 }).offset, '0');
eq('a negative offset is clamped', buildListJobsQuery({ offset: -5 }).offset, '0');
eq('limit above 100 is clamped', buildListJobsQuery({ limit: 500 }).limit, '100');
eq('null status is omitted', 'status' in buildListJobsQuery({ status: null }), false);

// ── Active filters + chips ───────────────────────────────────────────────
eq('no filters are active', hasActiveFilters(none), false);
eq('no badge when nothing is active', activeFilterCount(none), 0);
eq('no chips when nothing is active', activeFilterIds(none).length, 0);
eq('the dot-separator: only status is one', activeFilterCount({ ...none, status: 'OPEN' }), 1);
eq(
  'all three are counted',
  activeFilterCount({ status: 'OPEN', requestType: 'URGENT', onlyActivelyBidding: true }),
  3
);
eq(
  'chips are ordered status, type, bidding',
  activeFilterIds({ status: 'OPEN', requestType: 'REGULAR', onlyActivelyBidding: true }).join(','),
  'status,requestType,bidding'
);
const all: JobListFilters = { status: 'OPEN', requestType: 'URGENT', onlyActivelyBidding: true };
eq('removing status leaves the rest', JSON.stringify(removeFilter(all, 'status')), JSON.stringify({ status: null, requestType: 'URGENT', onlyActivelyBidding: true }));
eq('removing the type leaves the rest', removeFilter(all, 'requestType').requestType, null);
eq('removing bidding leaves the rest', removeFilter(all, 'bidding').onlyActivelyBidding, false);

// ── Empty vs error vs list ───────────────────────────────────────────────
eq(
  'a 200 with no jobs and no filters is an EMPTY state',
  resolveJobsViewState({ status: 'ready', jobCount: 0, hasFilters: false }),
  'empty'
);
eq(
  'a 200 with no jobs and filters is an EMPTY-WITH-FILTERS state',
  resolveJobsViewState({ status: 'ready', jobCount: 0, hasFilters: true }),
  'empty-filtered'
);
eq(
  'a 200 with jobs is the list',
  resolveJobsViewState({ status: 'ready', jobCount: 3, hasFilters: true }),
  'list'
);
eq('the first load shows the loader', resolveJobsViewState({ status: 'loading', jobCount: 0, hasFilters: false }), 'loading');
eq('idle shows the loader', resolveJobsViewState({ status: 'idle', jobCount: 0, hasFilters: false }), 'loading');
eq('a real failure with nothing on screen is an error', resolveJobsViewState({ status: 'error', jobCount: 0, hasFilters: false }), 'error');
eq('a 401 with nothing on screen is an error', resolveJobsViewState({ status: 'unauthorized', jobCount: 0, hasFilters: false }), 'error');
eq('a 422 with nothing on screen is an error', resolveJobsViewState({ status: 'invalid', jobCount: 0, hasFilters: false }), 'error');
eq(
  'a failure with rows already loaded keeps the list',
  resolveJobsViewState({ status: 'error', jobCount: 4, hasFilters: false }),
  'list'
);

// ── Failure classification ───────────────────────────────────────────────
const networkErr = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', isAxiosError: true });
const timeoutErr = Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED', isAxiosError: true });
const http = (status: number, data?: unknown) => ({ isAxiosError: true, response: { status, data } });

eq('an offline error is a network failure', classifyCreateJobFailure(networkErr).kind, 'network');
eq('a timeout is its own failure', classifyCreateJobFailure(timeoutErr).kind, 'timeout');
eq('a 401 is unauthorized', classifyCreateJobFailure(http(401, { detail: 'Not authenticated' })).kind, 'unauthorized');
eq('a 422 is invalid', classifyCreateJobFailure(http(422, { detail: [] })).kind, 'invalid');
eq('a 500 is a server failure', classifyCreateJobFailure(http(500)).kind, 'server');
eq('a 503 is a server failure', classifyCreateJobFailure(http(503)).kind, 'server');
eq('a 404 is a rejected request', classifyCreateJobFailure(http(404, { detail: 'x' })).kind, 'notfound');
eq('a 403 is a rejected request', classifyCreateJobFailure(http(403)).kind, 'forbidden');
eq(
  'a thrown client-side error is NOT a connection problem',
  classifyCreateJobFailure(new Error('boom')).kind,
  'unknown'
);
eq(
  'only the network bucket may mention the connection',
  createJobErrorCopy('network').messageKey,
  'post_err_network_msg'
);
eq(
  'a 5xx never quotes the server',
  createJobErrorCopy('server').preferServerMessage,
  false
);
eq('a 4xx prefers the server detail', createJobErrorCopy('notfound').preferServerMessage, true);

// ── "Client profile not found" ───────────────────────────────────────────
const profileFailure = classifyCreateJobFailure(http(404, { detail: 'Client profile not found.' }));
eq('the client-profile body keeps the server text', profileFailure.message, 'Client profile not found.');
eq('the body is recognised', isClientProfileMissing(profileFailure.message), true);
eq('a normal 404 is not the profile case', isClientProfileMissing('Job not found'), false);
eq('no message is not the profile case', isClientProfileMissing(null), false);
eq('case does not matter', isClientProfileMissing('client PROFILE Not Found'), true);

// ── One fade-only rule for every popup ───────────────────────────────────
eq('the fade-in is about 200 ms', POPUP_FADE_IN_MS, 200);
eq('the fade-out is about 150 ms', POPUP_FADE_OUT_MS, 150);

// Compiled output lives in lib/__tests__/.out/lib/__tests__, and the emitted
// directory depth is an implementation detail of the harness, so walk up to the
// folder that owns package.json instead of counting `..`.
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

/**
 * Drop // and block comments before scanning for animation props.
 *
 * The popups explain the rule in prose ("no translateY, no ZoomIn"), and prose
 * cannot animate — scanning it would fail every correctly-documented file.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Every popup surface an entrance animation could hide in. */
const POPUPS = [
  'components/BottomSheet.tsx',
  // The clock face and the 7-day calendar sheet were REMOVED from the wizard;
  // their replacements are audited here instead.
  'components/TimeRangeSheet.tsx',
  'components/TaskEditSheet.tsx',
  'components/AddressFormModal.tsx',
  'components/JobsFilterSheet.tsx',
  'components/ServicePickerSheet.tsx',
  'components/AcceptBidSheet.tsx',
  'components/RejectBidSheet.tsx',
  'context/AlertModalContext.tsx',
  'components/ErrorFallback.tsx',
  // Banners are toasts, not modals, but they obey the same rule.
  'components/BidResultBanner.tsx',
  'components/MoneyEventBanner.tsx',
  'components/UpdateBanner.tsx',
];

for (const file of POPUPS) {
  const source = code(read(file));
  check(`${file}: no slide/zoom entrance`, !/SlideIn|ZoomIn|springify|animationType="slide"/.test(source));
  check(`${file}: no vertical movement`, !/translateY/.test(source));
}

const sheet = read('components/BottomSheet.tsx');
check('the shared sheet fades in with the shared duration', sheet.includes('POPUP_FADE_IN_MS'));
check('the shared sheet fades out with the shared duration', sheet.includes('POPUP_FADE_OUT_MS'));

const alert = read('context/AlertModalContext.tsx');
check('the app alert fades in and out', alert.includes('FadeIn.duration(POPUP_FADE_IN_MS)') && alert.includes('FadeOut.duration(POPUP_FADE_OUT_MS)'));

// The address pickers are bottom sheets inside a Modal: their Modal must fade.
for (const file of [
  'app/profile/add-address.tsx',
  'app/profile/edit-address.tsx',
  'app/job/[id]/address.tsx',
  'app/job/[id]/edit-address.tsx',
]) {
  const source = code(read(file));
  check(`${file}: its picker Modal fades`, !/animationType="slide"/.test(source));
}

const layout = read('app/_layout.tsx');
check('the filter popup screen fades instead of sliding', /name="filter"[\s\S]{0,200}animation: 'fade'/.test(layout));

console.log(`jobFilters: ${passed} checks, ${failures.length} failure(s)`);
if (failures.length > 0) throw new Error(`${failures.length} jobFilters check(s) failed`);
