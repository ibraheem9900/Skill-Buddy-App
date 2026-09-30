/**
 * Unit tests for Start Job (POST /api/v1/jobs/{job_id}/start).
 *
 * Run through the project's own harness: `pnpm run test`. No React, no axios, no
 * network — only the rules that decide WHO may start a job and WHEN, how a failure is
 * bucketed and worded, and how a lost response is resolved.
 */
import {
  assignedProviderId,
  canStartJob,
  classifyStartJobFailure,
  isJobInStartableState,
  isProviderRole,
  isStartNotAllowed,
  isStartableStatus,
  isStartUnauthorized,
  isValidJobId,
  shouldResyncAfterStartFailure,
  startJobErrorKey,
  startJobFailureMessage,
  startResolvedAfterResync,
  STARTABLE_JOB_STATUS,
} from '../jobStart';
import type { JobActorRole } from '../jobStart';
import type { JobActionFailureKind } from '../jobAction';

// The role union mirrors ActiveRole (context/RoleContext) WITHOUT importing React into
// the pure layer; pinned here so the two cannot drift apart unnoticed.
const ROLES: JobActorRole[] = ['CLIENT', 'PROVIDER'];

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

type StartableJob = Parameters<typeof isJobInStartableState>[0];

const startable = {
  status: 'PROVIDER_ASSIGNED' as const,
  assigned_provider_id: 77,
  cancelled_at: null as string | null,
  completed_at: null as string | null,
};
const job = (over: Partial<NonNullable<StartableJob>>) =>
  ({ ...startable, ...over }) as StartableJob;

/* ------------------------------------------------------------------ the status */

eq('the startable status is PROVIDER_ASSIGNED', STARTABLE_JOB_STATUS, 'PROVIDER_ASSIGNED');
eq('PROVIDER_ASSIGNED is startable', isStartableStatus({ status: 'PROVIDER_ASSIGNED' }), true);
eq('IN_PROGRESS is not startable', isStartableStatus({ status: 'IN_PROGRESS' }), false);
eq('DRAFT is not startable', isStartableStatus({ status: 'DRAFT' }), false);
eq('OPEN is not startable', isStartableStatus({ status: 'OPEN' }), false);
eq('PAYMENT_PENDING is not startable', isStartableStatus({ status: 'PAYMENT_PENDING' }), false);
eq('COMPLETED is not startable', isStartableStatus({ status: 'COMPLETED' }), false);
eq('CANCELLED is not startable', isStartableStatus({ status: 'CANCELLED' }), false);
eq('null job is not startable', isStartableStatus(null), false);

/* ------------------------------------------------------- assigned provider id */

eq('a positive integer provider id is accepted', assignedProviderId({ assigned_provider_id: 5 }), 5);
eq('id 0 means unassigned (the schema placeholder)', assignedProviderId({ assigned_provider_id: 0 }), null);
eq('null means unassigned', assignedProviderId({ assigned_provider_id: null as any }), null);
eq('a float is refused', assignedProviderId({ assigned_provider_id: 1.5 }), null);
eq('a string is refused', assignedProviderId({ assigned_provider_id: '7' as any }), null);
eq('a missing job has no provider', assignedProviderId(null), null);

/* ------------------------------------------------------------ startable state */

eq('an assigned, paid, unstarted job is startable', isJobInStartableState(startable), true);
eq(
  'PROVIDER_ASSIGNED with nobody assigned is NOT startable',
  isJobInStartableState(job({ assigned_provider_id: null as any })),
  false
);
eq(
  'PROVIDER_ASSIGNED with placeholder id 0 is NOT startable',
  isJobInStartableState(job({ assigned_provider_id: 0 })),
  false
);
eq(
  'a started job is NOT startable',
  isJobInStartableState(job({ status: 'IN_PROGRESS' })),
  false
);
eq(
  'a cancelled job is NOT startable',
  isJobInStartableState(job({ cancelled_at: '2026-09-29T10:00:00Z' })),
  false
);
eq(
  'a completed job is NOT startable',
  isJobInStartableState(job({ completed_at: '2026-09-29T10:00:00Z' })),
  false
);
eq('null is not startable', isJobInStartableState(null), false);
eq('undefined is not startable', isJobInStartableState(undefined), false);
// The state rule says nothing about who is looking — the role is a separate half.
eq('the state rule ignores the role', isJobInStartableState(startable), true);

/* -------------------------------------------------------------------- the role */

eq('the role union is exactly CLIENT | PROVIDER', ROLES.length, 2);
eq('PROVIDER is the provider role', isProviderRole('PROVIDER'), true);
eq('CLIENT is not the provider role', isProviderRole('CLIENT'), false);
eq('null role is not the provider role', isProviderRole(null), false);

eq('the PROVIDER can start a startable job', canStartJob(startable, 'PROVIDER'), true);
eq('the CLIENT CANNOT start a startable job', canStartJob(startable, 'CLIENT'), false);
eq('an unknown role cannot start', canStartJob(startable, null), false);
eq('the PROVIDER cannot start a job that moved on', canStartJob(job({ status: 'IN_PROGRESS' }), 'PROVIDER'), false);
eq('the PROVIDER cannot start a DRAFT job', canStartJob(job({ status: 'DRAFT' }), 'PROVIDER'), false);
eq('the PROVIDER cannot start an unassigned job', canStartJob(job({ assigned_provider_id: 0 }), 'PROVIDER'), false);
eq('null job cannot be started by anyone', canStartJob(null, 'PROVIDER'), false);
// The two halves must agree: nothing is startable for the client, ever.
eq(
  'no status is startable for the CLIENT (exhaustive over the enum)',
  (
    [
      'DRAFT',
      'OPEN',
      'PAYMENT_PENDING',
      'PROVIDER_ASSIGNED',
      'IN_PROGRESS',
      'DECLINED_BY_PROVIDER',
      'DECLINED_BY_CLIENT',
      'PAUSED_BY_CLIENT',
      'PAUSED_BY_PROVIDER',
      'BLOCKED',
      'COMPLETED',
      'CANCELLED',
      'CANCELLED_BY_CLIENT',
      'CANCELLED_BY_PROVIDER',
    ] as const
  ).every((status) => canStartJob(job({ status }), 'CLIENT') === false),
  true
);
check(
  'exactly one status is startable for the PROVIDER (exhaustive over the enum)',
  JSON.stringify(
    (
      [
      'DRAFT',
      'OPEN',
      'PAYMENT_PENDING',
      'PROVIDER_ASSIGNED',
      'IN_PROGRESS',
      'DECLINED_BY_PROVIDER',
      'DECLINED_BY_CLIENT',
      'PAUSED_BY_CLIENT',
      'PAUSED_BY_PROVIDER',
      'BLOCKED',
      'COMPLETED',
      'CANCELLED',
      'CANCELLED_BY_CLIENT',
      'CANCELLED_BY_PROVIDER',
      ] as const
    ).filter((status) => canStartJob(job({ status }), 'PROVIDER'))
  ) === JSON.stringify(['PROVIDER_ASSIGNED'])
);

/* ------------------------------------------------- failure classification */

const http = (status: number) => ({ isAxiosError: true, response: { status } });
const bucket = (status: number): JobActionFailureKind => classifyStartJobFailure(http(status)).kind;

eq('400 → badrequest', bucket(400), 'badrequest');
eq('401 → unauthorized', bucket(401), 'unauthorized');
eq('403 → forbidden', bucket(403), 'forbidden');
eq('404 → notfound', bucket(404), 'notfound');
eq('409 → conflict', bucket(409), 'conflict');
eq('422 → invalid', bucket(422), 'invalid');
eq('500 → server', bucket(500), 'server');
eq('no response → network', classifyStartJobFailure(new Error('boom')).kind, 'network');
eq(
  'a plain {detail: "..."} message is carried through verbatim',
  classifyStartJobFailure({
    isAxiosError: true,
    response: { status: 403, data: { detail: 'Not the assigned provider' } },
  }).message,
  'Not the assigned provider'
);
eq(
  'a 422 detail array message is carried through verbatim',
  classifyStartJobFailure({
    isAxiosError: true,
    response: { status: 422, data: { detail: [{ loc: ['path', 'job_id'], msg: 'Invalid job id' }] } },
  }).message,
  'Invalid job id'
);

eq('401 is the unauthorized bucket', isStartUnauthorized('unauthorized'), true);
eq('403 is not unauthorized', isStartUnauthorized('forbidden'), false);

/* ------------------------------------------------------- refusal + re-sync */

eq('400 is a not-allowed bucket', isStartNotAllowed('badrequest'), true);
eq('409 is a not-allowed bucket', isStartNotAllowed('conflict'), true);
eq('403 is NOT the "no longer startable" bucket', isStartNotAllowed('forbidden'), false);
eq('network is NOT a not-allowed bucket', isStartNotAllowed('network'), false);

eq('400 re-syncs the job', shouldResyncAfterStartFailure('badrequest'), true);
eq('409 re-syncs the job', shouldResyncAfterStartFailure('conflict'), true);
eq('403 re-syncs the job (stale ownership/state)', shouldResyncAfterStartFailure('forbidden'), true);
eq('404 re-syncs the job', shouldResyncAfterStartFailure('notfound'), true);
eq('422 does NOT re-sync (the path id was rejected)', shouldResyncAfterStartFailure('invalid'), false);
eq('server does NOT re-sync', shouldResyncAfterStartFailure('server'), false);
eq('network does NOT re-sync here (handled separately)', shouldResyncAfterStartFailure('network'), false);

/* ------------------------------------------- lost response after a timeout */

eq(
  'job moved to IN_PROGRESS after a lost response → already carried out',
  startResolvedAfterResync({ ...startable, status: 'IN_PROGRESS' } as any),
  true
);
eq(
  'job still PROVIDER_ASSIGNED after a lost response → not carried out',
  startResolvedAfterResync(startable as any),
  false
);
eq('a failed re-read claims nothing', startResolvedAfterResync(null), false);
eq('a failed re-read claims nothing (undefined)', startResolvedAfterResync(undefined), false);
eq(
  'a job cancelled during the lost request counts as resolved',
  startResolvedAfterResync({ ...startable, cancelled_at: '2026-09-29T10:00:00Z' } as any),
  true
);

/* ---------------------------------------------------------------------- copy */

eq('422 copy key', startJobErrorKey('invalid'), 'jobd_start_err_invalid');
eq('400 copy key', startJobErrorKey('badrequest'), 'jobd_start_err_notallowed');
eq('409 copy key', startJobErrorKey('conflict'), 'jobd_start_err_notallowed');
eq('403 copy key', startJobErrorKey('forbidden'), 'jobd_start_err_forbidden');
eq('404 copy key', startJobErrorKey('notfound'), 'jobd_start_err_notfound');
eq('500 copy key', startJobErrorKey('server'), 'jobd_start_err_server');
eq('network copy key', startJobErrorKey('network'), 'jobd_start_err_network');

const fake = (key: string) => `<${key}>`;
eq(
  "the backend's own message always wins",
  startJobFailureMessage({ kind: 'conflict', message: 'Job already started' }, fake as any),
  'Job already started'
);
eq(
  'no server message → the bucket copy',
  startJobFailureMessage({ kind: 'conflict', message: null }, fake as any),
  '<jobd_start_err_notallowed>'
);
eq(
  '403 with no server message → the forbidden copy (only the assigned provider may start)',
  startJobFailureMessage({ kind: 'forbidden', message: null }, fake as any),
  '<jobd_start_err_forbidden>'
);

/* ------------------------------------------------------------- path id guard */

eq('accepts a real job id', isValidJobId(42), true);
eq('rejects 0', isValidJobId(0), false);
eq('rejects a float', isValidJobId(1.5), false);
eq('rejects NaN', isValidJobId(Number.NaN), false);
eq('rejects a string id', isValidJobId('7' as unknown as number), false);

/* ------------------------------------------------------------------------ report */

export const summary = { passed, total: passed + failures.length };
for (const failure of failures) console.log(`  ✗ ${failure}`);
console.log(`jobStart: ${summary.passed}/${summary.total} assertions passed`);
