/**
 * Unit tests for Pause By Provider
 * (POST /api/v1/jobs/{job_id}/pause-by-provider, schema JobDetailsRequest).
 *
 * Run through the project's own harness: `pnpm run test`. No React, no axios, no
 * network — only the rules that decide WHEN a provider may pause, WHAT BODY is sent
 * (field name `details`, trimming, the 3–1000 rule), how a failure is bucketed and
 * worded, how a lost response is resolved, and that the provider and client pause
 * actions can never both be offered for the same role.
 */
import {
  PROVIDER_PAUSABLE_STATUS,
  PROVIDER_PAUSE_DETAILS_MAX_LENGTH,
  PROVIDER_PAUSE_DETAILS_MIN_LENGTH,
  buildProviderPauseRequest,
  canProviderPauseJob,
  classifyProviderPauseJobFailure,
  isJobInProviderPausableState,
  isProviderPausableStatus,
  isProviderPauseNotAllowed,
  isProviderPauseUnauthorized,
  isValidJobId,
  providerPauseDetailsFieldError,
  providerPauseErrorKey,
  providerPauseFailureMessage,
  providerPauseResolvedAfterResync,
  shouldResyncAfterProviderPauseFailure,
  validateProviderPauseDetails,
} from '../providerPause';
import { canPauseJob } from '../jobPause';
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

type PausableJob = Parameters<typeof canProviderPauseJob>[0];

const inProgress = {
  assigned_provider_id: 7 as number | null,
  cancelled_at: null as string | null,
  completed_at: null as string | null,
  status: 'IN_PROGRESS' as JobApiStatus,
};
const job = (over: Partial<NonNullable<PausableJob>>) =>
  ({ ...inProgress, ...over }) as PausableJob;

/* --------------------------------------------------------- the details contract */

eq('the minimum mirrors the schema', PROVIDER_PAUSE_DETAILS_MIN_LENGTH, 3);
eq('the maximum mirrors the schema', PROVIDER_PAUSE_DETAILS_MAX_LENGTH, 1000);
eq('the provider-pausable status is IN_PROGRESS', PROVIDER_PAUSABLE_STATUS, 'IN_PROGRESS');
eq('the details field name is the shared JobDetailsRequest one (details)', Object.keys(buildProviderPauseRequest('abc')).join(','), 'details');

eq('an empty reason is rejected as required', validateProviderPauseDetails(''), 'jobd_ppause_err_details_required');
eq('a whitespace-only reason is rejected as required', validateProviderPauseDetails('   '), 'jobd_ppause_err_details_required');
eq('null reason is rejected as required', validateProviderPauseDetails(null), 'jobd_ppause_err_details_required');
eq('undefined reason is rejected as required', validateProviderPauseDetails(undefined), 'jobd_ppause_err_details_required');
eq('one character is too short', validateProviderPauseDetails('x'), 'jobd_ppause_err_details_short');
eq('two characters are too short', validateProviderPauseDetails('ab'), 'jobd_ppause_err_details_short');
eq('padded text shorter than 3 after trimming is too short', validateProviderPauseDetails('  a  '), 'jobd_ppause_err_details_short');
eq('three characters are accepted', validateProviderPauseDetails('abc'), null);
eq('a realistic reason is accepted', validateProviderPauseDetails('Waiting on materials'), null);
eq('1000 characters are accepted', validateProviderPauseDetails('d'.repeat(1000)), null);
eq('1001 characters are too long', validateProviderPauseDetails('d'.repeat(1001)), 'jobd_ppause_err_details_long');

/* --------------------------------------------------------------- the body */

const body = buildProviderPauseRequest('  Waiting on materials  ');
eq('the body uses the exact contract field name', Object.keys(body).join(','), 'details');
eq('details are trimmed', body.details, 'Waiting on materials');
check('the body never gains an invented field', Object.keys(buildProviderPauseRequest('abc')).every((k) => k === 'details'));

/* ------------------------------------------------------------------- gating */

eq('the assigned provider may pause a job that is under way', canProviderPauseJob(inProgress, 'PROVIDER'), true);
eq('the CLIENT must never see this action', canProviderPauseJob(inProgress, 'CLIENT'), false);
eq('an absent role never offers the provider action', canProviderPauseJob(inProgress, null), false);
eq('an absent role never offers the provider action (undefined)', canProviderPauseJob(inProgress, undefined), false);

eq('a PROVIDER_ASSIGNED job is NOT provider-pausable (that is the decline window)', canProviderPauseJob(job({ status: 'PROVIDER_ASSIGNED' }), 'PROVIDER'), false);
eq('an OPEN bidding job is not provider-pausable', canProviderPauseJob(job({ status: 'OPEN' }), 'PROVIDER'), false);
eq('a PAUSED_BY_PROVIDER job cannot be paused again', canProviderPauseJob(job({ status: 'PAUSED_BY_PROVIDER' }), 'PROVIDER'), false);
eq('a PAUSED_BY_CLIENT job cannot be paused by the provider either', canProviderPauseJob(job({ status: 'PAUSED_BY_CLIENT' }), 'PROVIDER'), false);
eq('a COMPLETED job is not provider-pausable', canProviderPauseJob(job({ status: 'COMPLETED' }), 'PROVIDER'), false);
eq('a DRAFT job is not provider-pausable', canProviderPauseJob(job({ status: 'DRAFT', assigned_provider_id: null }), 'PROVIDER'), false);

eq('a job with no assigned provider cannot be paused', canProviderPauseJob(job({ assigned_provider_id: null }), 'PROVIDER'), false);
eq('a job with no assigned provider (undefined) cannot be paused', canProviderPauseJob(job({ assigned_provider_id: undefined as any }), 'PROVIDER'), false);
eq('provider id 0 is not a real assignment', canProviderPauseJob(job({ assigned_provider_id: 0 }), 'PROVIDER'), false);

eq('an already-cancelled job cannot be paused', canProviderPauseJob(job({ cancelled_at: '2026-09-30T10:00:00Z' }), 'PROVIDER'), false);
eq('a CANCELLED status stops the action', canProviderPauseJob(job({ status: 'CANCELLED' }), 'PROVIDER'), false);
eq('a completed stamp stops the action', canProviderPauseJob(job({ completed_at: '2026-09-30T10:00:00Z' }), 'PROVIDER'), false);

eq('null job cannot be paused', canProviderPauseJob(null, 'PROVIDER'), false);
eq('undefined job cannot be paused', canProviderPauseJob(undefined, 'PROVIDER'), false);

eq('IN_PROGRESS is the provider-pausable status', isProviderPausableStatus({ status: 'IN_PROGRESS' }), true);
eq('PAUSED_BY_PROVIDER is not the provider-pausable status', isProviderPausableStatus({ status: 'PAUSED_BY_PROVIDER' }), false);
eq('the state helper ignores the role', isJobInProviderPausableState(inProgress), true);
eq('the state helper rejects a paused job', isJobInProviderPausableState(job({ status: 'PAUSED_BY_PROVIDER' })), false);
eq('the state helper rejects null', isJobInProviderPausableState(null), false);

/* ------------------------------------- the client and provider pauses never overlap */

eq(
  'for the PROVIDER role only the provider pause can be offered',
  canPauseJob(inProgress, 'PROVIDER') === false && canProviderPauseJob(inProgress, 'PROVIDER') === true,
  true
);
eq(
  'for the CLIENT role only the client pause can be offered',
  canPauseJob(inProgress, 'CLIENT') === true && canProviderPauseJob(inProgress, 'CLIENT') === false,
  true
);
for (const status of [
  'DRAFT',
  'OPEN',
  'PAYMENT_PENDING',
  'PROVIDER_ASSIGNED',
  'IN_PROGRESS',
  'DECLINED_BY_PROVIDER',
  'PAUSED_BY_CLIENT',
  'PAUSED_BY_PROVIDER',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
] as JobApiStatus[]) {
  const j = job({ status });
  check(
    `${status}: provider and client pause never render for the same role`,
    !(canPauseJob(j, 'PROVIDER') && canProviderPauseJob(j, 'PROVIDER')) &&
      !(canPauseJob(j, 'CLIENT') && canProviderPauseJob(j, 'CLIENT'))
  );
}

/* ------------------------------------------------- failure classification */

const http = (status: number) => ({ isAxiosError: true, response: { status } });
const bucket = (status: number): JobActionFailureKind => classifyProviderPauseJobFailure(http(status)).kind;
eq('400 → badrequest', bucket(400), 'badrequest');
eq('401 → unauthorized', bucket(401), 'unauthorized');
eq('403 → forbidden', bucket(403), 'forbidden');
eq('404 → notfound', bucket(404), 'notfound');
eq('409 → conflict', bucket(409), 'conflict');
eq('422 → invalid', bucket(422), 'invalid');
eq('500 → server', bucket(500), 'server');
eq('no response → network', classifyProviderPauseJobFailure(new Error('offline')).kind, 'network');
eq(
  'a plain {detail: "..."} message is carried through verbatim',
  classifyProviderPauseJobFailure({
    isAxiosError: true,
    response: { status: 403, data: { detail: 'Not the assigned provider' } },
  }).message,
  'Not the assigned provider'
);
eq('401 is the unauthorized bucket', isProviderPauseUnauthorized('unauthorized'), true);
eq('409 is not unauthorized', isProviderPauseUnauthorized('conflict'), false);

/* ------------------------------------------------------- refusal + re-sync */

eq('400 is a not-allowed bucket', isProviderPauseNotAllowed('badrequest'), true);
eq('409 is a not-allowed bucket', isProviderPauseNotAllowed('conflict'), true);
eq('404 is NOT the not-allowed bucket', isProviderPauseNotAllowed('notfound'), false);
eq('network is NOT a not-allowed bucket', isProviderPauseNotAllowed('network'), false);

eq('400 re-syncs the job', shouldResyncAfterProviderPauseFailure('badrequest'), true);
eq('409 re-syncs the job', shouldResyncAfterProviderPauseFailure('conflict'), true);
eq('403 re-syncs the job (stale ownership/state)', shouldResyncAfterProviderPauseFailure('forbidden'), true);
eq('404 re-syncs the job', shouldResyncAfterProviderPauseFailure('notfound'), true);
eq('422 does NOT re-sync (the TYPED details were rejected — re-reading cannot fix it)', shouldResyncAfterProviderPauseFailure('invalid'), false);
eq('server does NOT re-sync', shouldResyncAfterProviderPauseFailure('server'), false);
eq('network does NOT re-sync here (handled separately)', shouldResyncAfterProviderPauseFailure('network'), false);

/* --------------------------------------------- lost response after a timeout */

eq(
  'job already PAUSED_BY_PROVIDER after a lost response → no retry needed',
  providerPauseResolvedAfterResync(job({ status: 'PAUSED_BY_PROVIDER' })),
  true
);
eq(
  'job moved on to COMPLETED after a lost response → treat as carried out',
  providerPauseResolvedAfterResync(job({ status: 'COMPLETED' })),
  true
);
eq(
  'job still in progress after a lost response → the pause really failed',
  providerPauseResolvedAfterResync(inProgress),
  false
);
eq('a failed re-read claims nothing', providerPauseResolvedAfterResync(null), false);
eq('a failed re-read claims nothing (undefined)', providerPauseResolvedAfterResync(undefined), false);

/* ------------------------------------------------------------ 422 → the input */

eq(
  'a details-level 422 maps onto the details input',
  providerPauseDetailsFieldError([
    { loc: ['body', 'details'], msg: 'String should have at least 3 characters', type: 'string_too_short' },
  ]),
  'String should have at least 3 characters'
);
eq(
  'a message about another field does not land on details',
  providerPauseDetailsFieldError([{ loc: ['body', 'job_id'], msg: 'Input should be a valid integer', type: 'int_parsing' }]),
  null
);
eq('no detail array maps to nothing', providerPauseDetailsFieldError(null), null);
eq('a non-array detail maps to nothing', providerPauseDetailsFieldError({} as any), null);
eq('an entry without a message maps to nothing', providerPauseDetailsFieldError([{ loc: ['body', 'details'], msg: '', type: 'x' }]), null);

/* --------------------------------------------------------------------- copy */

eq('422 copy key', providerPauseErrorKey('invalid'), 'jobd_ppause_err_invalid');
eq('400 copy key', providerPauseErrorKey('badrequest'), 'jobd_ppause_err_notallowed');
eq('409 copy key', providerPauseErrorKey('conflict'), 'jobd_ppause_err_notallowed');
eq('403 copy key', providerPauseErrorKey('forbidden'), 'jobd_ppause_err_forbidden');
eq('404 copy key', providerPauseErrorKey('notfound'), 'jobd_ppause_err_notfound');
eq('500 copy key', providerPauseErrorKey('server'), 'jobd_ppause_err_server');
eq('network copy key', providerPauseErrorKey('network'), 'jobd_ppause_err_network');

const fake = (key: string) => `<${key}>`;
eq(
  "the backend's own message always wins",
  providerPauseFailureMessage({ kind: 'conflict', message: 'Already paused' }, fake as any),
  'Already paused'
);
eq(
  'no server message → the bucket copy',
  providerPauseFailureMessage({ kind: 'conflict', message: null }, fake as any),
  '<jobd_ppause_err_notallowed>'
);
eq(
  '403 with no server message → the not-the-provider copy',
  providerPauseFailureMessage({ kind: 'forbidden', message: null }, fake as any),
  '<jobd_ppause_err_forbidden>'
);
eq(
  'network with no server message → the network copy',
  providerPauseFailureMessage({ kind: 'network', message: null }, fake as any),
  '<jobd_ppause_err_network>'
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
console.log(`providerPause: ${summary.passed}/${summary.total} assertions passed`);
