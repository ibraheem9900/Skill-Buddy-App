/**
 * Unit tests for Decline By Provider
 * (POST /api/v1/jobs/{job_id}/decline-by-provider, schema JobDetailsRequest).
 *
 * Run through the project's own harness: `pnpm run test`. No React, no axios, no
 * network — only the rules that decide WHEN a decline may be offered, WHAT BODY is
 * sent (field name `details`, trimming, the 3–1000 rule), how a failure is bucketed
 * and worded, and how a lost response is resolved.
 */
import {
  DECLINABLE_JOB_STATUS,
  DECLINE_DETAILS_MAX_LENGTH,
  DECLINE_DETAILS_MIN_LENGTH,
  buildDeclineRequest,
  canDeclineJob,
  classifyDeclineJobFailure,
  declineDetailsFieldError,
  declineJobErrorKey,
  declineJobFailureMessage,
  declineResolvedAfterResync,
  isDeclineNotAllowed,
  isDeclineUnauthorized,
  isDeclinableStatus,
  isJobInDeclinableState,
  isValidJobId,
  shouldResyncAfterDeclineFailure,
  validateDeclineDetails,
} from '../providerDecline';
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

type DeclinableJob = Parameters<typeof canDeclineJob>[0];

const assignable = {
  assigned_provider_id: 7 as number | null,
  cancelled_at: null as string | null,
  completed_at: null as string | null,
  status: 'PROVIDER_ASSIGNED' as JobApiStatus,
};
const job = (over: Partial<NonNullable<DeclinableJob>>) =>
  ({ ...assignable, ...over }) as DeclinableJob;

/* --------------------------------------------------------- the details contract */

eq('the minimum mirrors the schema', DECLINE_DETAILS_MIN_LENGTH, 3);
eq('the maximum mirrors the schema', DECLINE_DETAILS_MAX_LENGTH, 1000);
eq('the declinable status is PROVIDER_ASSIGNED', DECLINABLE_JOB_STATUS, 'PROVIDER_ASSIGNED');

eq('an empty reason is rejected as required', validateDeclineDetails(''), 'jobd_decline_err_details_required');
eq('a whitespace-only reason is rejected as required', validateDeclineDetails('   '), 'jobd_decline_err_details_required');
eq('null reason is rejected as required', validateDeclineDetails(null), 'jobd_decline_err_details_required');
eq('undefined reason is rejected as required', validateDeclineDetails(undefined), 'jobd_decline_err_details_required');
eq('one character is too short', validateDeclineDetails('x'), 'jobd_decline_err_details_short');
eq('two characters are too short', validateDeclineDetails('ab'), 'jobd_decline_err_details_short');
eq('padded text shorter than 3 after trimming is too short', validateDeclineDetails('  a  '), 'jobd_decline_err_details_short');
eq('three characters are accepted', validateDeclineDetails('abc'), null);
eq('a realistic reason is accepted', validateDeclineDetails('Not my trade, sorry'), null);
eq('1000 characters are accepted', validateDeclineDetails('d'.repeat(1000)), null);
eq('1001 characters are too long', validateDeclineDetails('d'.repeat(1001)), 'jobd_decline_err_details_long');

/* ------------------------------------------------------------- the body itself */

const body = buildDeclineRequest('  I cannot take this one  ');
eq('the body uses the exact contract field name (details, not reason/notes)', Object.keys(body).join(','), 'details');
eq('details are trimmed', body.details, 'I cannot take this one');
check('the body never gains an invented field', Object.keys(buildDeclineRequest('abc')).every((k) => k === 'details'));

/* ------------------------------------------------------------------- gating */

eq('the assigned provider may decline a job that has not started', canDeclineJob(assignable, 'PROVIDER'), true);
eq('the CLIENT must never see this action', canDeclineJob(assignable, 'CLIENT'), false);
eq('a missing role never offers the action', canDeclineJob(assignable, null), false);
eq('a missing role never offers the action (undefined)', canDeclineJob(assignable, undefined), false);

eq('an IN_PROGRESS job is NOT declinable (that is the provider-cancel window)', canDeclineJob(job({ status: 'IN_PROGRESS' }), 'PROVIDER'), false);
eq('an OPEN bidding job is not declinable', canDeclineJob(job({ status: 'OPEN' }), 'PROVIDER'), false);
eq('a PAUSED job is not declinable here', canDeclineJob(job({ status: 'PAUSED_BY_PROVIDER' }), 'PROVIDER'), false);
eq('a COMPLETED job is not declinable', canDeclineJob(job({ status: 'COMPLETED' }), 'PROVIDER'), false);
eq('an already DECLINED_BY_PROVIDER job is not declinable again', canDeclineJob(job({ status: 'DECLINED_BY_PROVIDER' }), 'PROVIDER'), false);

eq('a job with no assigned provider cannot be declined', canDeclineJob(job({ assigned_provider_id: null }), 'PROVIDER'), false);
eq('a job with no assigned provider (undefined) cannot be declined', canDeclineJob(job({ assigned_provider_id: undefined as any }), 'PROVIDER'), false);
eq('provider id 0 is not a real assignment', canDeclineJob(job({ assigned_provider_id: 0 }), 'PROVIDER'), false);

eq('an already-cancelled job cannot be declined', canDeclineJob(job({ cancelled_at: '2026-09-30T10:00:00Z' }), 'PROVIDER'), false);
eq('a CANCELLED status stops the action', canDeclineJob(job({ status: 'CANCELLED' }), 'PROVIDER'), false);
eq('a completed stamp stops the action', canDeclineJob(job({ completed_at: '2026-09-30T10:00:00Z' }), 'PROVIDER'), false);

eq('null job cannot be declined', canDeclineJob(null, 'PROVIDER'), false);
eq('undefined job cannot be declined', canDeclineJob(undefined, 'PROVIDER'), false);

eq('PROVIDER_ASSIGNED is the declinable status', isDeclinableStatus({ status: 'PROVIDER_ASSIGNED' }), true);
eq('IN_PROGRESS is not the declinable status', isDeclinableStatus({ status: 'IN_PROGRESS' }), false);
eq('the state helper ignores the role', isJobInDeclinableState(assignable), true);
eq('the state helper rejects a started job', isJobInDeclinableState(job({ status: 'IN_PROGRESS' })), false);
eq('the state helper rejects null', isJobInDeclinableState(null), false);

/* ------------------------------------------------- failure classification */

const http = (status: number) => ({ isAxiosError: true, response: { status } });
const bucket = (status: number): JobActionFailureKind => classifyDeclineJobFailure(http(status)).kind;
eq('400 → badrequest', bucket(400), 'badrequest');
eq('401 → unauthorized', bucket(401), 'unauthorized');
eq('403 → forbidden', bucket(403), 'forbidden');
eq('404 → notfound', bucket(404), 'notfound');
eq('409 → conflict', bucket(409), 'conflict');
eq('422 → invalid', bucket(422), 'invalid');
eq('500 → server', bucket(500), 'server');
eq('no response → network', classifyDeclineJobFailure(new Error('offline')).kind, 'network');
eq(
  'a plain {detail: "..."} message is carried through verbatim',
  classifyDeclineJobFailure({
    isAxiosError: true,
    response: { status: 409, data: { detail: 'Job is no longer declinable' } },
  }).message,
  'Job is no longer declinable'
);
eq('401 is the unauthorized bucket', isDeclineUnauthorized('unauthorized'), true);
eq('409 is not unauthorized', isDeclineUnauthorized('conflict'), false);

/* ------------------------------------------------------- refusal + re-sync */

eq('400 is a not-allowed bucket', isDeclineNotAllowed('badrequest'), true);
eq('409 is a not-allowed bucket', isDeclineNotAllowed('conflict'), true);
eq('404 is NOT the not-allowed bucket', isDeclineNotAllowed('notfound'), false);
eq('network is NOT a not-allowed bucket', isDeclineNotAllowed('network'), false);

eq('400 re-syncs the job', shouldResyncAfterDeclineFailure('badrequest'), true);
eq('409 re-syncs the job', shouldResyncAfterDeclineFailure('conflict'), true);
eq('403 re-syncs the job (stale ownership/state)', shouldResyncAfterDeclineFailure('forbidden'), true);
eq('404 re-syncs the job', shouldResyncAfterDeclineFailure('notfound'), true);
eq('422 does NOT re-sync (the TYPED details were rejected — re-reading cannot fix it)', shouldResyncAfterDeclineFailure('invalid'), false);
eq('server does NOT re-sync', shouldResyncAfterDeclineFailure('server'), false);
eq('network does NOT re-sync here (handled separately)', shouldResyncAfterDeclineFailure('network'), false);

/* --------------------------------------------- lost response after a timeout */

eq(
  'job already DECLINED_BY_PROVIDER after a lost response → no retry needed',
  declineResolvedAfterResync(job({ status: 'DECLINED_BY_PROVIDER' })),
  true
);
eq(
  'job no longer assigned after a lost response → the decline really happened',
  declineResolvedAfterResync(job({ assigned_provider_id: null })),
  true
);
eq(
  'job moved on to IN_PROGRESS after a lost response → treat as carried out',
  declineResolvedAfterResync(job({ status: 'IN_PROGRESS' })),
  true
);
eq(
  'job still assigned and not started after a lost response → the decline really failed',
  declineResolvedAfterResync(assignable),
  false
);
eq('a failed re-read claims nothing', declineResolvedAfterResync(null), false);
eq('a failed re-read claims nothing (undefined)', declineResolvedAfterResync(undefined), false);

/* ------------------------------------------------------------ 422 → the input */

eq(
  'a details-level 422 maps onto the details input',
  declineDetailsFieldError([
    { loc: ['body', 'details'], msg: 'String should have at least 3 characters', type: 'string_too_short' },
  ]),
  'String should have at least 3 characters'
);
eq(
  'a message about another field does not land on details',
  declineDetailsFieldError([{ loc: ['body', 'job_id'], msg: 'Input should be a valid integer', type: 'int_parsing' }]),
  null
);
eq('no detail array maps to nothing', declineDetailsFieldError(null), null);
eq('a non-array detail maps to nothing', declineDetailsFieldError({} as any), null);
eq('an entry without a message maps to nothing', declineDetailsFieldError([{ loc: ['body', 'details'], msg: '', type: 'x' }]), null);

/* --------------------------------------------------------------------- copy */

eq('422 copy key', declineJobErrorKey('invalid'), 'jobd_decline_err_invalid');
eq('400 copy key', declineJobErrorKey('badrequest'), 'jobd_decline_err_notallowed');
eq('409 copy key', declineJobErrorKey('conflict'), 'jobd_decline_err_notallowed');
eq('403 copy key', declineJobErrorKey('forbidden'), 'jobd_decline_err_forbidden');
eq('404 copy key', declineJobErrorKey('notfound'), 'jobd_decline_err_notfound');
eq('500 copy key', declineJobErrorKey('server'), 'jobd_decline_err_server');
eq('network copy key', declineJobErrorKey('network'), 'jobd_decline_err_network');

const fake = (key: string) => `<${key}>`;
eq(
  "the backend's own message always wins",
  declineJobFailureMessage({ kind: 'conflict', message: 'Already declined' }, fake as any),
  'Already declined'
);
eq(
  'no server message → the bucket copy',
  declineJobFailureMessage({ kind: 'conflict', message: null }, fake as any),
  '<jobd_decline_err_notallowed>'
);
eq(
  'network with no server message → the network copy',
  declineJobFailureMessage({ kind: 'network', message: null }, fake as any),
  '<jobd_decline_err_network>'
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
console.log(`providerDecline: ${summary.passed}/${summary.total} assertions passed`);
