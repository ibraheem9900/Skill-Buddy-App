/**
 * Unit tests for Complete Job (POST /api/v1/jobs/{job_id}/complete).
 *
 * Run through the project's own harness: `pnpm run test`. No React, no axios, no
 * network — only the rules that decide WHO may complete a job and WHEN, how a failure
 * is bucketed and worded, and how a lost response is resolved.
 */
import {
  COMPLETABLE_JOB_STATUS,
  canCompleteJob,
  classifyCompleteJobFailure,
  completeJobErrorKey,
  completeJobFailureMessage,
  completeResolvedAfterResync,
  isCompletableStatus,
  isCompleteNotAllowed,
  isCompleteUnauthorized,
  isJobInCompletableState,
  isProviderRole,
  isValidJobId,
  shouldResyncAfterCompleteFailure,
} from '../jobComplete';
import { isProviderRole as startIsProviderRole } from '../jobStart';
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

type CompletableJob = Parameters<typeof isJobInCompletableState>[0];

const inProgress = {
  status: 'IN_PROGRESS' as const,
  assigned_provider_id: 77,
  cancelled_at: null as string | null,
  completed_at: null as string | null,
};
const job = (over: Partial<NonNullable<CompletableJob>>) =>
  ({ ...inProgress, ...over }) as CompletableJob;

/* ------------------------------------------------------------------ the status */

eq('the completable status is IN_PROGRESS', COMPLETABLE_JOB_STATUS, 'IN_PROGRESS');
eq('IN_PROGRESS is completable', isCompletableStatus({ status: 'IN_PROGRESS' }), true);
eq('PROVIDER_ASSIGNED is not completable (not started yet)', isCompletableStatus({ status: 'PROVIDER_ASSIGNED' }), false);
eq('COMPLETED is not completable', isCompletableStatus({ status: 'COMPLETED' }), false);
eq('DRAFT is not completable', isCompletableStatus({ status: 'DRAFT' }), false);
eq('OPEN is not completable', isCompletableStatus({ status: 'OPEN' }), false);
eq('PAYMENT_PENDING is not completable', isCompletableStatus({ status: 'PAYMENT_PENDING' }), false);
eq('CANCELLED is not completable', isCompletableStatus({ status: 'CANCELLED' }), false);
eq('PAUSED_BY_PROVIDER is not completable', isCompletableStatus({ status: 'PAUSED_BY_PROVIDER' }), false);
eq('null job is not completable', isCompletableStatus(null), false);

/* ---------------------------------------------------------- completable state */

eq('an assigned, in-progress job is completable', isJobInCompletableState(inProgress), true);
eq(
  'IN_PROGRESS with nobody assigned is NOT completable',
  isJobInCompletableState(job({ assigned_provider_id: null as any })),
  false
);
eq(
  'IN_PROGRESS with placeholder id 0 is NOT completable',
  isJobInCompletableState(job({ assigned_provider_id: 0 })),
  false
);
eq(
  'a completed_at already set by another path is NOT completable',
  isJobInCompletableState(job({ completed_at: '2026-09-29T10:00:00Z' })),
  false
);
eq(
  'a cancelled job is NOT completable',
  isJobInCompletableState(job({ cancelled_at: '2026-09-29T10:00:00Z' })),
  false
);
eq(
  'a not-yet-started job is NOT completable',
  isJobInCompletableState(job({ status: 'PROVIDER_ASSIGNED' })),
  false
);
eq('null is not completable', isJobInCompletableState(null), false);
eq('undefined is not completable', isJobInCompletableState(undefined), false);
// The state rule says nothing about who is looking — the role is a separate half.
eq('the state rule ignores the role', isJobInCompletableState(inProgress), true);

/* -------------------------------------------------------------------- the role */

eq('the role rule is shared with Start Job (single authority)', isProviderRole, startIsProviderRole);
eq('PROVIDER is the provider role', isProviderRole('PROVIDER'), true);
eq('CLIENT is not the provider role', isProviderRole('CLIENT'), false);
eq('null role is not the provider role', isProviderRole(null), false);

eq('the PROVIDER can complete an in-progress job', canCompleteJob(inProgress, 'PROVIDER'), true);
eq('the CLIENT CANNOT complete a job', canCompleteJob(inProgress, 'CLIENT'), false);
eq('an unknown role cannot complete', canCompleteJob(inProgress, null), false);
eq(
  'the PROVIDER cannot complete a job that is not started',
  canCompleteJob(job({ status: 'PROVIDER_ASSIGNED' }), 'PROVIDER'),
  false
);
eq('the PROVIDER cannot complete an already-completed job', canCompleteJob(job({ status: 'COMPLETED' }), 'PROVIDER'), false);
eq('the PROVIDER cannot complete a cancelled job', canCompleteJob(job({ status: 'CANCELLED' }), 'PROVIDER'), false);
eq('null job cannot be completed by anyone', canCompleteJob(null, 'PROVIDER'), false);

// The two halves must agree: nothing is completable for the client, ever.
const ALL_STATUSES = [
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
] as const;

eq(
  'no status is completable for the CLIENT (exhaustive over the enum)',
  ALL_STATUSES.every((status) => canCompleteJob(job({ status }), 'CLIENT') === false),
  true
);
check(
  'exactly one status is completable for the PROVIDER (exhaustive over the enum)',
  JSON.stringify(ALL_STATUSES.filter((status) => canCompleteJob(job({ status }), 'PROVIDER'))) ===
    JSON.stringify(['IN_PROGRESS'])
);

/* ------------------------------------------------- failure classification */

const http = (status: number) => ({ isAxiosError: true, response: { status } });
const bucket = (status: number): JobActionFailureKind => classifyCompleteJobFailure(http(status)).kind;

eq('400 → badrequest', bucket(400), 'badrequest');
eq('401 → unauthorized', bucket(401), 'unauthorized');
eq('403 → forbidden', bucket(403), 'forbidden');
eq('404 → notfound', bucket(404), 'notfound');
eq('409 → conflict', bucket(409), 'conflict');
eq('422 → invalid', bucket(422), 'invalid');
eq('500 → server', bucket(500), 'server');
eq('no response → network', classifyCompleteJobFailure(new Error('boom')).kind, 'network');
eq(
  'a plain {detail: "..."} message is carried through verbatim',
  classifyCompleteJobFailure({
    isAxiosError: true,
    response: { status: 409, data: { detail: 'Job already completed' } },
  }).message,
  'Job already completed'
);
eq(
  'a 422 detail array message is carried through verbatim',
  classifyCompleteJobFailure({
    isAxiosError: true,
    response: { status: 422, data: { detail: [{ loc: ['path', 'job_id'], msg: 'Invalid job id' }] } },
  }).message,
  'Invalid job id'
);

eq('401 is the unauthorized bucket', isCompleteUnauthorized('unauthorized'), true);
eq('403 is not unauthorized', isCompleteUnauthorized('forbidden'), false);

/* ------------------------------------------------------- refusal + re-sync */

eq('400 is a not-allowed bucket', isCompleteNotAllowed('badrequest'), true);
eq('409 is a not-allowed bucket', isCompleteNotAllowed('conflict'), true);
eq('403 is NOT the "no longer completable" bucket', isCompleteNotAllowed('forbidden'), false);
eq('network is NOT a not-allowed bucket', isCompleteNotAllowed('network'), false);

eq('400 re-syncs the job', shouldResyncAfterCompleteFailure('badrequest'), true);
eq('409 re-syncs the job', shouldResyncAfterCompleteFailure('conflict'), true);
eq('403 re-syncs the job (stale ownership/state)', shouldResyncAfterCompleteFailure('forbidden'), true);
eq('404 re-syncs the job', shouldResyncAfterCompleteFailure('notfound'), true);
eq('422 does NOT re-sync (the path id was rejected)', shouldResyncAfterCompleteFailure('invalid'), false);
eq('server does NOT re-sync', shouldResyncAfterCompleteFailure('server'), false);
eq('network does NOT re-sync here (handled separately)', shouldResyncAfterCompleteFailure('network'), false);

/* ------------------------------------------- lost response after a timeout */

eq(
  'job left the in-progress state after a lost response → already carried out',
  completeResolvedAfterResync(job({ status: 'COMPLETED' })),
  true
);
eq(
  'job still IN_PROGRESS after a lost response → not carried out',
  completeResolvedAfterResync(inProgress),
  false
);
eq('a failed re-read claims nothing', completeResolvedAfterResync(null), false);
eq('a failed re-read claims nothing (undefined)', completeResolvedAfterResync(undefined), false);
eq(
  'a job cancelled during the lost request counts as resolved',
  completeResolvedAfterResync(job({ cancelled_at: '2026-09-29T10:00:00Z' })),
  true
);

/* ---------------------------------------------------------------------- copy */

eq('422 copy key', completeJobErrorKey('invalid'), 'jobd_complete_err_invalid');
eq('400 copy key', completeJobErrorKey('badrequest'), 'jobd_complete_err_notallowed');
eq('409 copy key', completeJobErrorKey('conflict'), 'jobd_complete_err_notallowed');
eq('403 copy key', completeJobErrorKey('forbidden'), 'jobd_complete_err_forbidden');
eq('404 copy key', completeJobErrorKey('notfound'), 'jobd_complete_err_notfound');
eq('500 copy key', completeJobErrorKey('server'), 'jobd_complete_err_server');
eq('network copy key', completeJobErrorKey('network'), 'jobd_complete_err_network');

const fake = (key: string) => `<${key}>`;
eq(
  "the backend's own message always wins",
  completeJobFailureMessage({ kind: 'conflict', message: 'Job already completed' }, fake as any),
  'Job already completed'
);
eq(
  'no server message → the bucket copy',
  completeJobFailureMessage({ kind: 'conflict', message: null }, fake as any),
  '<jobd_complete_err_notallowed>'
);
eq(
  '403 with no server message → the forbidden copy (only the assigned provider may complete)',
  completeJobFailureMessage({ kind: 'forbidden', message: null }, fake as any),
  '<jobd_complete_err_forbidden>'
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
console.log(`jobComplete: ${summary.passed}/${summary.total} assertions passed`);
