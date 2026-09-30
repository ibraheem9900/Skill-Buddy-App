/**
 * Unit tests for Pause By Client
 * (POST /api/v1/jobs/{job_id}/pause-by-client, schema JobDetailsRequest).
 *
 * Run through the project's own harness: `pnpm run test`. No React, no axios, no
 * network — only the rules that decide WHEN a pause may be offered, WHAT BODY is sent
 * (field name `details`, trimming, the 3–1000 rule), how a failure is bucketed and
 * worded, and how a lost response is resolved.
 */
import {
  PAUSABLE_JOB_STATUS,
  PAUSE_DETAILS_MAX_LENGTH,
  PAUSE_DETAILS_MIN_LENGTH,
  buildPauseRequest,
  canPauseJob,
  classifyPauseJobFailure,
  isJobInPausableState,
  isPausableStatus,
  isPauseNotAllowed,
  isPauseUnauthorized,
  isValidJobId,
  pauseDetailsFieldError,
  pauseJobErrorKey,
  pauseJobFailureMessage,
  pauseResolvedAfterResync,
  shouldResyncAfterPauseFailure,
  validatePauseDetails,
} from '../jobPause';
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

type PausableJob = Parameters<typeof canPauseJob>[0];

const inProgress = {
  assigned_provider_id: 7 as number | null,
  cancelled_at: null as string | null,
  completed_at: null as string | null,
  status: 'IN_PROGRESS' as JobApiStatus,
};
const job = (over: Partial<NonNullable<PausableJob>>) =>
  ({ ...inProgress, ...over }) as PausableJob;

/* --------------------------------------------------------- the details contract */

eq('the minimum mirrors the schema', PAUSE_DETAILS_MIN_LENGTH, 3);
eq('the maximum mirrors the schema', PAUSE_DETAILS_MAX_LENGTH, 1000);
eq('the pausable status is IN_PROGRESS', PAUSABLE_JOB_STATUS, 'IN_PROGRESS');

eq('an empty reason is rejected as required', validatePauseDetails(''), 'jobd_pause_err_details_required');
eq('a whitespace-only reason is rejected as required', validatePauseDetails('   '), 'jobd_pause_err_details_required');
eq('null reason is rejected as required', validatePauseDetails(null), 'jobd_pause_err_details_required');
eq('undefined reason is rejected as required', validatePauseDetails(undefined), 'jobd_pause_err_details_required');
eq('one character is too short', validatePauseDetails('x'), 'jobd_pause_err_details_short');
eq('two characters are too short', validatePauseDetails('ab'), 'jobd_pause_err_details_short');
eq('padded text shorter than 3 after trimming is too short', validatePauseDetails('  a  '), 'jobd_pause_err_details_short');
eq('three characters are accepted', validatePauseDetails('abc'), null);
eq('a realistic reason is accepted', validatePauseDetails('Waiting on parts'), null);
eq('1000 characters are accepted', validatePauseDetails('d'.repeat(1000)), null);
eq('1001 characters are too long', validatePauseDetails('d'.repeat(1001)), 'jobd_pause_err_details_long');

/* ------------------------------------------------------------- the body itself */

const body = buildPauseRequest('  Waiting for the new part  ');
eq('the body uses the exact contract field name (details, not reason/notes)', Object.keys(body).join(','), 'details');
eq('details are trimmed', body.details, 'Waiting for the new part');
check('the body never gains an invented field', Object.keys(buildPauseRequest('abc')).every((k) => k === 'details'));

/* ------------------------------------------------------------------- gating */

eq('the client may pause a job that is under way', canPauseJob(inProgress, 'CLIENT'), true);
eq('the PROVIDER must never see this action', canPauseJob(inProgress, 'PROVIDER'), false);
eq('an absent role is treated as the client side (the app default), never as the provider', canPauseJob(inProgress, undefined), true);

eq('a PROVIDER_ASSIGNED job is NOT pausable (work has not started)', canPauseJob(job({ status: 'PROVIDER_ASSIGNED' }), 'CLIENT'), false);
eq('an OPEN bidding job is not pausable', canPauseJob(job({ status: 'OPEN' }), 'CLIENT'), false);
eq('a PAUSED_BY_CLIENT job cannot be paused again', canPauseJob(job({ status: 'PAUSED_BY_CLIENT' }), 'CLIENT'), false);
eq('a PAUSED_BY_PROVIDER job cannot be paused by the client', canPauseJob(job({ status: 'PAUSED_BY_PROVIDER' }), 'CLIENT'), false);
eq('a COMPLETED job is not pausable', canPauseJob(job({ status: 'COMPLETED' }), 'CLIENT'), false);
eq('a DRAFT job is not pausable', canPauseJob(job({ status: 'DRAFT', assigned_provider_id: null }), 'CLIENT'), false);

eq('a job with no assigned provider cannot be paused', canPauseJob(job({ assigned_provider_id: null }), 'CLIENT'), false);
eq('a job with no assigned provider (undefined) cannot be paused', canPauseJob(job({ assigned_provider_id: undefined as any }), 'CLIENT'), false);
eq('provider id 0 is not a real assignment', canPauseJob(job({ assigned_provider_id: 0 }), 'CLIENT'), false);

eq('an already-cancelled job cannot be paused', canPauseJob(job({ cancelled_at: '2026-09-30T10:00:00Z' }), 'CLIENT'), false);
eq('a CANCELLED status stops the action', canPauseJob(job({ status: 'CANCELLED' }), 'CLIENT'), false);
eq('a completed stamp stops the action', canPauseJob(job({ completed_at: '2026-09-30T10:00:00Z' }), 'CLIENT'), false);

eq('null job cannot be paused', canPauseJob(null, 'CLIENT'), false);
eq('undefined job cannot be paused', canPauseJob(undefined, 'CLIENT'), false);

eq('IN_PROGRESS is the pausable status', isPausableStatus({ status: 'IN_PROGRESS' }), true);
eq('PAUSED_BY_CLIENT is not the pausable status', isPausableStatus({ status: 'PAUSED_BY_CLIENT' }), false);
eq('the state helper ignores the role', isJobInPausableState(inProgress), true);
eq('the state helper rejects a paused job', isJobInPausableState(job({ status: 'PAUSED_BY_CLIENT' })), false);
eq('the state helper rejects null', isJobInPausableState(null), false);

/* ------------------------------------------------- failure classification */

const http = (status: number) => ({ isAxiosError: true, response: { status } });
const bucket = (status: number): JobActionFailureKind => classifyPauseJobFailure(http(status)).kind;
eq('400 → badrequest', bucket(400), 'badrequest');
eq('401 → unauthorized', bucket(401), 'unauthorized');
eq('403 → forbidden', bucket(403), 'forbidden');
eq('404 → notfound', bucket(404), 'notfound');
eq('409 → conflict', bucket(409), 'conflict');
eq('422 → invalid', bucket(422), 'invalid');
eq('500 → server', bucket(500), 'server');
eq('no response → network', classifyPauseJobFailure(new Error('offline')).kind, 'network');
eq(
  'a plain {detail: "..."} message is carried through verbatim',
  classifyPauseJobFailure({
    isAxiosError: true,
    response: { status: 409, data: { detail: 'Job is already paused' } },
  }).message,
  'Job is already paused'
);
eq('401 is the unauthorized bucket', isPauseUnauthorized('unauthorized'), true);
eq('409 is not unauthorized', isPauseUnauthorized('conflict'), false);

/* ------------------------------------------------------- refusal + re-sync */

eq('400 is a not-allowed bucket', isPauseNotAllowed('badrequest'), true);
eq('409 is a not-allowed bucket', isPauseNotAllowed('conflict'), true);
eq('404 is NOT the not-allowed bucket', isPauseNotAllowed('notfound'), false);
eq('network is NOT a not-allowed bucket', isPauseNotAllowed('network'), false);

eq('400 re-syncs the job', shouldResyncAfterPauseFailure('badrequest'), true);
eq('409 re-syncs the job', shouldResyncAfterPauseFailure('conflict'), true);
eq('403 re-syncs the job (stale ownership/state)', shouldResyncAfterPauseFailure('forbidden'), true);
eq('404 re-syncs the job', shouldResyncAfterPauseFailure('notfound'), true);
eq('422 does NOT re-sync (the TYPED details were rejected — re-reading cannot fix it)', shouldResyncAfterPauseFailure('invalid'), false);
eq('server does NOT re-sync', shouldResyncAfterPauseFailure('server'), false);
eq('network does NOT re-sync here (handled separately)', shouldResyncAfterPauseFailure('network'), false);

/* --------------------------------------------- lost response after a timeout */

eq(
  'job already PAUSED_BY_CLIENT after a lost response → no retry needed',
  pauseResolvedAfterResync(job({ status: 'PAUSED_BY_CLIENT' })),
  true
);
eq(
  'job already PAUSED_BY_PROVIDER after a lost response → no retry needed',
  pauseResolvedAfterResync(job({ status: 'PAUSED_BY_PROVIDER' })),
  true
);
eq(
  'job moved on to COMPLETED after a lost response → treat as carried out',
  pauseResolvedAfterResync(job({ status: 'COMPLETED' })),
  true
);
eq(
  'job still in progress after a lost response → the pause really failed',
  pauseResolvedAfterResync(inProgress),
  false
);
eq('a failed re-read claims nothing', pauseResolvedAfterResync(null), false);
eq('a failed re-read claims nothing (undefined)', pauseResolvedAfterResync(undefined), false);

/* ------------------------------------------------------------ 422 → the input */

eq(
  'a details-level 422 maps onto the details input',
  pauseDetailsFieldError([
    { loc: ['body', 'details'], msg: 'String should have at least 3 characters', type: 'string_too_short' },
  ]),
  'String should have at least 3 characters'
);
eq(
  'a message about another field does not land on details',
  pauseDetailsFieldError([{ loc: ['body', 'job_id'], msg: 'Input should be a valid integer', type: 'int_parsing' }]),
  null
);
eq('no detail array maps to nothing', pauseDetailsFieldError(null), null);
eq('a non-array detail maps to nothing', pauseDetailsFieldError({} as any), null);
eq('an entry without a message maps to nothing', pauseDetailsFieldError([{ loc: ['body', 'details'], msg: '', type: 'x' }]), null);

/* --------------------------------------------------------------------- copy */

eq('422 copy key', pauseJobErrorKey('invalid'), 'jobd_pause_err_invalid');
eq('400 copy key', pauseJobErrorKey('badrequest'), 'jobd_pause_err_notallowed');
eq('409 copy key', pauseJobErrorKey('conflict'), 'jobd_pause_err_notallowed');
eq('403 copy key', pauseJobErrorKey('forbidden'), 'jobd_pause_err_forbidden');
eq('404 copy key', pauseJobErrorKey('notfound'), 'jobd_pause_err_notfound');
eq('500 copy key', pauseJobErrorKey('server'), 'jobd_pause_err_server');
eq('network copy key', pauseJobErrorKey('network'), 'jobd_pause_err_network');

const fake = (key: string) => `<${key}>`;
eq(
  "the backend's own message always wins",
  pauseJobFailureMessage({ kind: 'conflict', message: 'Already paused' }, fake as any),
  'Already paused'
);
eq(
  'no server message → the bucket copy',
  pauseJobFailureMessage({ kind: 'conflict', message: null }, fake as any),
  '<jobd_pause_err_notallowed>'
);
eq(
  'network with no server message → the network copy',
  pauseJobFailureMessage({ kind: 'network', message: null }, fake as any),
  '<jobd_pause_err_network>'
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
console.log(`jobPause: ${summary.passed}/${summary.total} assertions passed`);
