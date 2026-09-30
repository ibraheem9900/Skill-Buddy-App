/**
 * Unit tests for Provider Cancel After Acceptance
 * (POST /api/v1/jobs/{job_id}/provider-cancel).
 *
 * Run through the project's own harness: `pnpm run test`. No React, no axios, no
 * network — only the rules that decide WHEN a provider may withdraw, how a failure is
 * bucketed and worded, how a lost response is resolved, and how the success toast
 * falls back to local copy when the backend sends no message.
 */
import {
  PROVIDER_CANCELLABLE_STATUS,
  canProviderCancelJob,
  classifyProviderCancelJobFailure,
  isJobInProviderCancellableState,
  isProviderCancelNotAllowed,
  isProviderCancelUnauthorized,
  isProviderCancellableStatus,
  isValidJobId,
  providerCancelErrorKey,
  providerCancelFailureMessage,
  providerCancelResolvedAfterResync,
  providerCancelSuccessMessage,
  shouldResyncAfterProviderCancelFailure,
} from '../providerCancel';
import type { JobActionFailureKind } from '../jobAction';
import type { JobApiStatus } from '../../types';

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

type CancellableJob = Parameters<typeof canProviderCancelJob>[0];

const assigned = {
  assigned_provider_id: 7 as number | null,
  cancelled_at: null as string | null,
  completed_at: null as string | null,
  status: 'IN_PROGRESS' as JobApiStatus,
};
const job = (over: Partial<NonNullable<CancellableJob>>) =>
  ({ ...assigned, ...over }) as CancellableJob;

/* ------------------------------------------------------------------- gating */

eq('the cancelling status is IN_PROGRESS (work started)', PROVIDER_CANCELLABLE_STATUS, 'IN_PROGRESS');
eq('the assigned provider may withdraw from an in-progress job', canProviderCancelJob(assigned, 'PROVIDER'), true);
eq('a job that is only PROVIDER_ASSIGNED is NOT cancellable (that is the DECLINE window)', canProviderCancelJob(job({ status: 'PROVIDER_ASSIGNED' }), 'PROVIDER'), false);
eq('a still-open bidding job is not cancellable', canProviderCancelJob(job({ status: 'OPEN', assigned_provider_id: null }), 'PROVIDER'), false);
eq('a paused job is not cancellable here (its own endpoint owns it)', canProviderCancelJob(job({ status: 'PAUSED_BY_CLIENT' }), 'PROVIDER'), false);
eq('a draft job is not cancellable', canProviderCancelJob(job({ status: 'DRAFT', assigned_provider_id: null }), 'PROVIDER'), false);
eq('IN_PROGRESS is the cancellable status', isProviderCancellableStatus({ status: 'IN_PROGRESS' }), true);
eq('PROVIDER_ASSIGNED is not the cancellable status', isProviderCancellableStatus({ status: 'PROVIDER_ASSIGNED' }), false);
eq('a missing job has no cancellable status', isProviderCancellableStatus(null), false);
eq('the CLIENT must never see this action', canProviderCancelJob(assigned, 'CLIENT'), false);
eq('a missing role never offers the action', canProviderCancelJob(assigned, null), false);
eq('a missing role never offers the action (undefined)', canProviderCancelJob(assigned, undefined), false);

eq('a job with no assigned provider cannot be withdrawn from', canProviderCancelJob(job({ assigned_provider_id: null }), 'PROVIDER'), false);
eq('a job with no assigned provider (undefined) cannot be withdrawn from', canProviderCancelJob(job({ assigned_provider_id: undefined as any }), 'PROVIDER'), false);
eq('provider id 0 is not a real assignment', canProviderCancelJob(job({ assigned_provider_id: 0 }), 'PROVIDER'), false);
eq('a float provider id is not a real assignment', canProviderCancelJob(job({ assigned_provider_id: 1.5 }), 'PROVIDER'), false);

eq('an already-cancelled job cannot be withdrawn from', canProviderCancelJob(job({ cancelled_at: '2026-09-30T10:00:00Z' }), 'PROVIDER'), false);
eq('a completed job cannot be withdrawn from', canProviderCancelJob(job({ completed_at: '2026-09-30T10:00:00Z' }), 'PROVIDER'), false);
eq('a CANCELLED status stops the action, with no stamp', canProviderCancelJob(job({ status: 'CANCELLED' }), 'PROVIDER'), false);
eq('a CANCELLED_BY_CLIENT status stops the action', canProviderCancelJob(job({ status: 'CANCELLED_BY_CLIENT' }), 'PROVIDER'), false);
eq('a CANCELLED_BY_PROVIDER status stops a repeat', canProviderCancelJob(job({ status: 'CANCELLED_BY_PROVIDER' }), 'PROVIDER'), false);

eq('null job cannot be withdrawn from', canProviderCancelJob(null, 'PROVIDER'), false);
eq('undefined job cannot be withdrawn from', canProviderCancelJob(undefined, 'PROVIDER'), false);

/* ------------------------------------------------ state helper (role-free) */

eq('the state helper ignores the role (in progress + assigned)', isJobInProviderCancellableState(assigned), true);
eq('the state helper rejects a merely-assigned job', isJobInProviderCancellableState(job({ status: 'PROVIDER_ASSIGNED' })), false);
eq('the state helper rejects an unassigned job', isJobInProviderCancellableState(job({ assigned_provider_id: null })), false);
eq('the state helper rejects a cancelled job', isJobInProviderCancellableState(job({ cancelled_at: '2026-09-30T10:00:00Z' })), false);
eq('the state helper rejects a completed job', isJobInProviderCancellableState(job({ completed_at: '2026-09-30T10:00:00Z' })), false);
eq('the state helper rejects null', isJobInProviderCancellableState(null), false);

/* ------------------------------------------------- failure classification */

const http = (status: number) => ({ isAxiosError: true, response: { status } });
const bucket = (status: number): JobActionFailureKind =>
  classifyProviderCancelJobFailure(http(status)).kind;
eq('400 → badrequest', bucket(400), 'badrequest');
eq('401 → unauthorized', bucket(401), 'unauthorized');
eq('403 → forbidden', bucket(403), 'forbidden');
eq('404 → notfound', bucket(404), 'notfound');
eq('409 → conflict', bucket(409), 'conflict');
eq('422 → invalid', bucket(422), 'invalid');
eq('500 → server', bucket(500), 'server');
eq('no response → network', classifyProviderCancelJobFailure(new Error('offline')).kind, 'network');
eq(
  'a plain {detail: "..."} message is carried through verbatim',
  classifyProviderCancelJobFailure({
    isAxiosError: true,
    response: { status: 403, data: { detail: 'Not the assigned provider' } },
  }).message,
  'Not the assigned provider'
);
eq('401 is the unauthorized bucket', isProviderCancelUnauthorized('unauthorized'), true);
eq('409 is not unauthorized', isProviderCancelUnauthorized('conflict'), false);

/* ------------------------------------------------------- refusal + re-sync */

eq('400 is a not-allowed bucket', isProviderCancelNotAllowed('badrequest'), true);
eq('409 is a not-allowed bucket', isProviderCancelNotAllowed('conflict'), true);
eq('404 is NOT the not-allowed bucket', isProviderCancelNotAllowed('notfound'), false);
eq('network is NOT a not-allowed bucket', isProviderCancelNotAllowed('network'), false);

eq('400 re-syncs the job', shouldResyncAfterProviderCancelFailure('badrequest'), true);
eq('409 re-syncs the job', shouldResyncAfterProviderCancelFailure('conflict'), true);
eq('403 re-syncs the job (stale ownership/state)', shouldResyncAfterProviderCancelFailure('forbidden'), true);
eq('404 re-syncs the job', shouldResyncAfterProviderCancelFailure('notfound'), true);
eq('422 does NOT re-sync (the path id was rejected — re-reading cannot fix it)', shouldResyncAfterProviderCancelFailure('invalid'), false);
eq('server does NOT re-sync', shouldResyncAfterProviderCancelFailure('server'), false);
eq('network does NOT re-sync here (handled separately)', shouldResyncAfterProviderCancelFailure('network'), false);

/* --------------------------------------------- lost response after a timeout */

eq(
  'job already cancelled after a lost response → no retry needed',
  providerCancelResolvedAfterResync({ ...assigned, cancelled_at: '2026-09-30T10:00:00Z' }),
  true
);
eq(
  'job already CANCELLED_BY_PROVIDER after a lost response → no retry needed',
  providerCancelResolvedAfterResync({ ...assigned, status: 'CANCELLED_BY_PROVIDER' }),
  true
);
eq(
  'job no longer assigned after a lost response → the withdrawal really happened',
  providerCancelResolvedAfterResync({ ...assigned, assigned_provider_id: null }),
  true
);
eq(
  'job still assigned and unfinished after a lost response → the cancel really failed',
  providerCancelResolvedAfterResync(assigned),
  false
);
eq('a failed re-read claims nothing', providerCancelResolvedAfterResync(null), false);
eq('a failed re-read claims nothing (undefined)', providerCancelResolvedAfterResync(undefined), false);

/* --------------------------------------------------------------------- copy */

eq('422 copy key', providerCancelErrorKey('invalid'), 'jobd_pcancel_err_invalid');
eq('400 copy key', providerCancelErrorKey('badrequest'), 'jobd_pcancel_err_notallowed');
eq('409 copy key', providerCancelErrorKey('conflict'), 'jobd_pcancel_err_notallowed');
eq('403 copy key', providerCancelErrorKey('forbidden'), 'jobd_pcancel_err_forbidden');
eq('404 copy key', providerCancelErrorKey('notfound'), 'jobd_pcancel_err_notfound');
eq('500 copy key', providerCancelErrorKey('server'), 'jobd_pcancel_err_server');
eq('network copy key', providerCancelErrorKey('network'), 'jobd_pcancel_err_network');

const fake = (key: string) => `<${key}>`;
eq(
  "the backend's own message always wins",
  providerCancelFailureMessage({ kind: 'conflict', message: 'Already cancelled' }, fake as any),
  'Already cancelled'
);
eq(
  'no server message → the bucket copy',
  providerCancelFailureMessage({ kind: 'conflict', message: null }, fake as any),
  '<jobd_pcancel_err_notallowed>'
);
eq(
  '403 with no server message → the not-the-provider copy',
  providerCancelFailureMessage({ kind: 'forbidden', message: null }, fake as any),
  '<jobd_pcancel_err_forbidden>'
);
eq(
  'network with no server message → the network copy',
  providerCancelFailureMessage({ kind: 'network', message: null }, fake as any),
  '<jobd_pcancel_err_network>'
);

/* --------------------------------------------------------- success message */

eq(
  "the backend's own success message is used when sent",
  providerCancelSuccessMessage('You withdrew from this job', fake as any),
  'You withdrew from this job'
);
eq(
  'a blank success message falls back to the local default',
  providerCancelSuccessMessage('', fake as any),
  '<jobd_pcancel_success_msg>'
);
eq(
  'a whitespace-only success message falls back to the local default',
  providerCancelSuccessMessage('   ', fake as any),
  '<jobd_pcancel_success_msg>'
);
eq(
  'a missing success message falls back to the local default',
  providerCancelSuccessMessage(null, fake as any),
  '<jobd_pcancel_success_msg>'
);

/* -------------------------------------------------------------- path id guard */

eq('accepts a real job id', isValidJobId(42), true);
eq('rejects 0', isValidJobId(0), false);
eq('rejects a float', isValidJobId(1.5), false);
eq('rejects NaN', isValidJobId(Number.NaN), false);
eq('rejects a string id', isValidJobId('7' as unknown as number), false);

/* -------------------------------------------------------------------- report */

export const summary = { passed, total: passed + failures.length };
for (const failure of failures) console.log(`  ✗ ${failure}`);
console.log(`providerCancel: ${summary.passed}/${summary.total} assertions passed`);
