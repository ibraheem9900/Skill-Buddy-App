/**
 * Unit tests for Assign Provider (POST /api/v1/jobs/{job_id}/assign-provider).
 *
 * Run through the project's own harness: `pnpm run test`. No React, no axios, no
 * network — only the rules that decide whether the action may be offered, what body
 * is sent, and how a failure is bucketed and worded.
 */
import {
  assignedProviderId,
  assignProviderErrorKey,
  assignProviderFailureMessage,
  buildAssignProviderRequest,
  canAssignProvider,
  classifyAssignProviderFailure,
  isAssignNotAllowed,
  isAssignUnauthorized,
  isJobOpenForAssignment,
  isValidJobId,
  isValidProviderId,
  shouldResyncAfterAssignFailure,
} from '../jobAssign';
import type { JobActionFailureKind } from '../jobAction';

declare const console: { log: (msg: string) => void };

let passed = 0;
export const failures: string[] = [];

function check(label: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(label);
}

function eq(label: string, actual: unknown, expected: unknown): void {
  check(
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    actual === expected
  );
}

/* ------------------------------------------------------------- id validation */

check('a positive integer provider id is valid', isValidProviderId(12) === true);
check('provider id 1 is valid', isValidProviderId(1) === true);
check('provider id 0 is NOT valid', isValidProviderId(0) === false);
check('a negative provider id is NOT valid', isValidProviderId(-3) === false);
check('a float provider id is NOT valid', isValidProviderId(2.5) === false);
check('a numeric-string provider id is NOT valid', isValidProviderId('12') === false);
check('NaN is NOT a valid provider id', isValidProviderId(Number.NaN) === false);
check('Infinity is NOT a valid provider id', isValidProviderId(Infinity) === false);
check('null/undefined are NOT valid provider ids', [isValidProviderId(null), isValidProviderId(undefined)].every((v) => v === false));
check('a mock catalogue id (string) is NOT valid', isValidProviderId('p1') === false);

check('isValidJobId accepts a positive integer', isValidJobId(5) === true);
check('isValidJobId rejects 0/float/string/NaN', [isValidJobId(0), isValidJobId(3.5), isValidJobId('5'), isValidJobId(Number.NaN)].every((v) => v === false));

/* --------------------------------------------------------------- request body */

const body = buildAssignProviderRequest(42);
eq('the body carries provider_id', body.provider_id, 42);
check('the body has exactly one key (schema JobAssignProviderRequest)', JSON.stringify(Object.keys(body)) === JSON.stringify(['provider_id']));
check('provider_id is a NUMBER on the wire', typeof body.provider_id === 'number');
check(
  'the body serializes with a numeric provider_id',
  JSON.stringify(body) === '{"provider_id":42}'
);

/* ------------------------------------------------------------ assigned state */

eq('assignedProviderId reads a real id', assignedProviderId({ assigned_provider_id: 9 } as any), 9);
eq('assignedProviderId treats null as unassigned', assignedProviderId({ assigned_provider_id: null } as any), null);
eq('assignedProviderId treats undefined as unassigned', assignedProviderId({} as any), null);
eq('assignedProviderId treats 0 as unassigned (schema placeholder)', assignedProviderId({ assigned_provider_id: 0 } as any), null);
eq('assignedProviderId treats a negative id as unassigned', assignedProviderId({ assigned_provider_id: -1 } as any), null);
eq('assignedProviderId treats a float as unassigned', assignedProviderId({ assigned_provider_id: 1.5 } as any), null);
eq('assignedProviderId is null for a null job', assignedProviderId(null), null);

/* ------------------------------------------------------ open-for-assignment */

const openJob = {
  is_bidding_open: true,
  assigned_provider_id: null,
  cancelled_at: null,
  completed_at: null,
} as any;

check('an open job is open for assignment', isJobOpenForAssignment(openJob) === true);
check(
  'a job with closed bidding is NOT open for assignment',
  isJobOpenForAssignment({ ...openJob, is_bidding_open: false }) === false
);
check(
  'a DRAFT-like job (is_bidding_open absent) is NOT open for assignment',
  isJobOpenForAssignment({ assigned_provider_id: null, cancelled_at: null, completed_at: null } as any) === false
);
check(
  'a cancelled job is NOT open for assignment even if bidding looks open',
  isJobOpenForAssignment({ ...openJob, cancelled_at: '2026-09-29T15:00:00Z' }) === false
);
check(
  'a completed job is NOT open for assignment',
  isJobOpenForAssignment({ ...openJob, completed_at: '2026-09-29T15:00:00Z' }) === false
);
check('null/undefined jobs are not open for assignment', [isJobOpenForAssignment(null), isJobOpenForAssignment(undefined)].every((v) => v === false));

/* ------------------------------------------------------------ the gate rule */

check('assign is offered on an open, unassigned job', canAssignProvider(openJob) === true);
check(
  'assign is NOT offered once a provider is assigned',
  canAssignProvider({ ...openJob, assigned_provider_id: 7 }) === false
);
check(
  'assign is NOT offered when assigned_provider_id is 0 but bidding is closed',
  canAssignProvider({ ...openJob, is_bidding_open: false }) === false
);
check(
  'assign is NOT offered on a cancelled job',
  canAssignProvider({ ...openJob, cancelled_at: '2026-09-29T15:00:00Z' }) === false
);
check(
  'assign is NOT offered on a completed job',
  canAssignProvider({ ...openJob, completed_at: '2026-09-29T15:00:00Z' }) === false
);
check('assign is NOT offered for a null/undefined job', [canAssignProvider(null), canAssignProvider(undefined)].every((v) => v === false));

/* ------------------------------------------------------------ failure buckets */

type Case = [unknown, JobActionFailureKind, string | null];
const cases: Case[] = [
  [{ response: { status: 422, data: { detail: [{ loc: ['body', 'provider_id'], msg: 'Provider not found' }] } } }, 'invalid', 'Provider not found'],
  [{ response: { status: 400, data: { detail: 'job is not open for assignment' } } }, 'badrequest', 'job is not open for assignment'],
  [{ response: { status: 401, data: { detail: 'Not authenticated' } } }, 'unauthorized', 'Not authenticated'],
  [{ response: { status: 409, data: { detail: 'already assigned' } } }, 'conflict', 'already assigned'],
  [{ response: { status: 403, data: null } }, 'forbidden', null],
  [{ response: { status: 404, data: null } }, 'notfound', null],
  [{ response: { status: 500, data: null } }, 'server', null],
  [{ response: { status: 418, data: null } }, 'unknown', null],
  [new Error('Network Error'), 'network', null],
  [undefined, 'network', null],
];

for (const [err, kind, message] of cases) {
  const result = classifyAssignProviderFailure(err);
  eq(`classify ${JSON.stringify(err)} → kind`, result.kind, kind);
  eq(`classify ${kind} → message`, result.message, message);
}
eq(
  'a malformed error degrades to the network bucket instead of throwing',
  classifyAssignProviderFailure({ response: { status: 'oops' } } as any).kind,
  'network'
);

/* -------------------------------------------------------- refusal predicates */

check('400 counts as "no longer assignable"', isAssignNotAllowed('badrequest') === true);
check('409 counts as "no longer assignable"', isAssignNotAllowed('conflict') === true);
check('422 does NOT count as "no longer assignable"', isAssignNotAllowed('invalid') === false);
check('network does NOT count as "no longer assignable"', isAssignNotAllowed('network') === false);
check('401 IS the unauthorized bucket', isAssignUnauthorized('unauthorized') === true);
check('a generic error is not the unauthorized bucket', isAssignUnauthorized('server') === false);

/* ---------------------------------------------------------------- re-sync rule */

check('re-sync after 400 (state was stale)', shouldResyncAfterAssignFailure('badrequest') === true);
check('re-sync after 409 (already assigned)', shouldResyncAfterAssignFailure('conflict') === true);
check('re-sync after 403 (flags were stale)', shouldResyncAfterAssignFailure('forbidden') === true);
check('re-sync after 404 (the job is gone)', shouldResyncAfterAssignFailure('notfound') === true);
check(
  'NO re-sync after 422 — an invalid provider_id is not stale job data',
  shouldResyncAfterAssignFailure('invalid') === false
);
check('no re-sync after a network failure', shouldResyncAfterAssignFailure('network') === false);
check('no re-sync after a 5xx', shouldResyncAfterAssignFailure('server') === false);
check('no re-sync after an unknown status', shouldResyncAfterAssignFailure('unknown') === false);

/* ------------------------------------------------------------------ copy keys */

eq('422 → its own copy key', assignProviderErrorKey('invalid'), 'jobd_assign_err_invalid');
eq('400 → the "no longer assignable" copy', assignProviderErrorKey('badrequest'), 'jobd_assign_err_notallowed');
eq('409 → the "no longer assignable" copy', assignProviderErrorKey('conflict'), 'jobd_assign_err_notallowed');
eq('403 → its own copy key', assignProviderErrorKey('forbidden'), 'jobd_assign_err_forbidden');
eq('404 → its own copy key', assignProviderErrorKey('notfound'), 'jobd_assign_err_notfound');
eq('network → its own copy key', assignProviderErrorKey('network'), 'jobd_assign_err_network');
eq('5xx → the generic copy', assignProviderErrorKey('server'), 'jobd_assign_err_server');
eq('unknown → the generic copy', assignProviderErrorKey('unknown'), 'jobd_assign_err_server');
eq(
  '401 → the generic copy (never rendered; the caller routes to login)',
  assignProviderErrorKey('unauthorized'),
  'jobd_assign_err_server'
);

const fakeTranslate = (key: string) => `t:${key}`;
eq(
  'the backend 422 message (e.g. an unknown provider) is shown verbatim',
  assignProviderFailureMessage({ kind: 'invalid', message: 'Provider not found' } as any, fakeTranslate as any),
  'Provider not found'
);
eq(
  'without a backend message the translated bucket copy is used',
  assignProviderFailureMessage({ kind: 'conflict', message: null } as any, fakeTranslate as any),
  't:jobd_assign_err_notallowed'
);

/* ------------------------------------------------------------------------ report */

export const summary = { passed, total: passed + failures.length };
console.log(`jobAssign: ${summary.passed}/${summary.total} assertions passed`);
