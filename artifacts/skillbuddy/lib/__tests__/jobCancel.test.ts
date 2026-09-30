/**
 * Unit tests for Cancel Job (POST /api/v1/jobs/{job_id}/cancel, schema JobCancelRequest).
 *
 * Run through the project's own harness: `pnpm run test`. No React, no axios, no
 * network — only the rules that decide WHEN cancellation may be offered, WHAT BODY is
 * sent (field names, trimming, the 3–255 reason rule), how a failure is bucketed and
 * worded, and how a lost response is resolved.
 */
import {
  CANCEL_REASON_MAX_LENGTH,
  CANCEL_REASON_MIN_LENGTH,
  buildCancelRequest,
  canCancelJob,
  cancelJobErrorKey,
  cancelJobFailureMessage,
  cancelReasonFieldError,
  cancelResolvedAfterResync,
  classifyCancelJobFailure,
  isCancelNotAllowed,
  isCancelUnauthorized,
  isValidJobId,
  shouldResyncAfterCancelFailure,
  validateCancelReason,
} from '../jobCancel';
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

type CancellableJob = Parameters<typeof canCancelJob>[0];

const cancellable = {
  is_cancellable: true,
  cancelled_at: null as string | null,
  completed_at: null as string | null,
};
const job = (over: Partial<NonNullable<CancellableJob>>) =>
  ({ ...cancellable, ...over }) as CancellableJob;

/* --------------------------------------------------------- the reason contract */

eq('the minimum mirrors the schema', CANCEL_REASON_MIN_LENGTH, 3);
eq('the maximum mirrors the schema', CANCEL_REASON_MAX_LENGTH, 255);

eq('an empty reason is rejected as required', validateCancelReason(''), 'jobd_cancel_err_reason_required');
eq('a whitespace-only reason is rejected as required', validateCancelReason('   '), 'jobd_cancel_err_reason_required');
eq('null reason is rejected as required', validateCancelReason(null), 'jobd_cancel_err_reason_required');
eq('undefined reason is rejected as required', validateCancelReason(undefined), 'jobd_cancel_err_reason_required');
eq('one character is too short', validateCancelReason('x'), 'jobd_cancel_err_reason_short');
eq('two characters are too short', validateCancelReason('ab'), 'jobd_cancel_err_reason_short');
eq('padded text shorter than 3 after trimming is too short', validateCancelReason('  a  '), 'jobd_cancel_err_reason_short');
eq('three characters are accepted', validateCancelReason('abc'), null);
eq('a realistic reason is accepted', validateCancelReason('No longer need the work'), null);
eq('255 characters are accepted', validateCancelReason('r'.repeat(255)), null);
eq('256 characters are too long', validateCancelReason('r'.repeat(256)), 'jobd_cancel_err_reason_long');

/* ------------------------------------------------------------- the body itself */

const body = buildCancelRequest('  the client changed their mind  ', '  extra details  ');
eq('the body carries the contract field names (reason, notes)', Object.keys(body).join(','), 'reason,notes');
eq('reason is trimmed', body.reason, 'the client changed their mind');
eq('notes are kept when typed', body.notes, 'extra details');

eq('blank notes become null (the schema is nullable, not an empty string)', buildCancelRequest('long enough reason', '').notes, null);
eq('missing notes become null', buildCancelRequest('long enough reason').notes, null);
eq('whitespace-only notes become null', buildCancelRequest('long enough reason', '   ').notes, null);
eq('a reason alone still builds a body', buildCancelRequest('abc').reason, 'abc');
check(
  'the body never gains an invented field (no amount, no method, no status)',
  Object.keys(buildCancelRequest('abc', 'x')).every((key) => key === 'reason' || key === 'notes')
);

/* ------------------------------------------------------------------- gating */

eq('a cancellable job can be cancelled', canCancelJob(cancellable), true);
eq('a non-cancellable job cannot be cancelled', canCancelJob(job({ is_cancellable: false })), false);
eq('an already-cancelled job cannot be cancelled again', canCancelJob(job({ cancelled_at: '2026-09-29T10:00:00Z' })), false);
eq('a completed job cannot be cancelled', canCancelJob(job({ completed_at: '2026-09-29T10:00:00Z' })), false);
eq('null job cannot be cancelled', canCancelJob(null), false);
eq('undefined job cannot be cancelled', canCancelJob(undefined), false);
eq('a missing boolean flag is treated as not cancellable', canCancelJob({ ...cancellable, is_cancellable: undefined as any }), false);

/* ------------------------------------------------- failure classification */

const http = (status: number) => ({ isAxiosError: true, response: { status } });
const bucket = (status: number): JobActionFailureKind => classifyCancelJobFailure(http(status)).kind;

eq('400 → badrequest', bucket(400), 'badrequest');
eq('401 → unauthorized', bucket(401), 'unauthorized');
eq('403 → forbidden', bucket(403), 'forbidden');
eq('404 → notfound', bucket(404), 'notfound');
eq('409 → conflict', bucket(409), 'conflict');
eq('422 → invalid', bucket(422), 'invalid');
eq('500 → server', bucket(500), 'server');
eq('no response → network', classifyCancelJobFailure(new Error('offline')).kind, 'network');
eq(
  'a plain {detail: "..."} message is carried through verbatim',
  classifyCancelJobFailure({
    isAxiosError: true,
    response: { status: 409, data: { detail: 'Job is no longer cancellable' } },
  }).message,
  'Job is no longer cancellable'
);

eq('401 is the unauthorized bucket', isCancelUnauthorized('unauthorized'), true);
eq('409 is not unauthorized', isCancelUnauthorized('conflict'), false);

/* ------------------------------------------------------- refusal + re-sync */

eq('400 is a not-allowed bucket', isCancelNotAllowed('badrequest'), true);
eq('409 is a not-allowed bucket', isCancelNotAllowed('conflict'), true);
eq('404 is NOT the not-allowed bucket', isCancelNotAllowed('notfound'), false);
eq('network is NOT a not-allowed bucket', isCancelNotAllowed('network'), false);

eq('400 re-syncs the job', shouldResyncAfterCancelFailure('badrequest'), true);
eq('409 re-syncs the job', shouldResyncAfterCancelFailure('conflict'), true);
eq('403 re-syncs the job (stale ownership/state)', shouldResyncAfterCancelFailure('forbidden'), true);
eq('404 re-syncs the job', shouldResyncAfterCancelFailure('notfound'), true);
eq('422 does NOT re-sync (the TYPED reason was rejected — re-reading cannot fix it)', shouldResyncAfterCancelFailure('invalid'), false);
eq('server does NOT re-sync', shouldResyncAfterCancelFailure('server'), false);
eq('network does NOT re-sync here (handled separately)', shouldResyncAfterCancelFailure('network'), false);

/* --------------------------------------------- lost response after a timeout */

eq(
  'job already cancelled after a lost response → no retry needed',
  cancelResolvedAfterResync({ cancelled_at: '2026-09-29T10:00:00Z', status: 'CANCELLED' }),
  true
);
eq(
  'job not cancelled after a lost response → the cancel really failed',
  cancelResolvedAfterResync({ cancelled_at: null, status: 'OPEN' }),
  false
);
eq('a failed re-read claims nothing', cancelResolvedAfterResync(null), false);
eq('a failed re-read claims nothing (undefined)', cancelResolvedAfterResync(undefined), false);

/* ------------------------------------------------------------ 422 → the input */

eq(
  'a reason-level 422 maps onto the reason input',
  cancelReasonFieldError([
    { loc: ['body', 'reason'], msg: 'String should have at least 3 characters', type: 'string_too_short' },
  ]),
  'String should have at least 3 characters'
);
eq(
  'a notes-level 422 does not land on the reason input',
  cancelReasonFieldError([{ loc: ['body', 'notes'], msg: 'Input should be a valid string', type: 'string_type' }]),
  null
);
eq('no detail array maps to nothing', cancelReasonFieldError(null), null);
eq('a non-array detail maps to nothing', cancelReasonFieldError({} as any), null);
eq('an entry without a message maps to nothing', cancelReasonFieldError([{ loc: ['body', 'reason'], msg: '', type: 'x' }]), null);

/* --------------------------------------------------------------------- copy */

eq('422 copy key', cancelJobErrorKey('invalid'), 'jobd_cancel_err_invalid');
eq('400 copy key', cancelJobErrorKey('badrequest'), 'jobd_cancel_err_notallowed');
eq('409 copy key', cancelJobErrorKey('conflict'), 'jobd_cancel_err_notallowed');
eq('403 copy key', cancelJobErrorKey('forbidden'), 'jobd_cancel_err_forbidden');
eq('404 copy key', cancelJobErrorKey('notfound'), 'jobd_cancel_err_notfound');
eq('500 copy key', cancelJobErrorKey('server'), 'jobd_cancel_err_server');
eq('network copy key', cancelJobErrorKey('network'), 'jobd_cancel_err_network');

const fake = (key: string) => `<${key}>`;
eq(
  "the backend's own message always wins",
  cancelJobFailureMessage({ kind: 'conflict', message: 'Already cancelled' }, fake as any),
  'Already cancelled'
);
eq(
  'no server message → the bucket copy',
  cancelJobFailureMessage({ kind: 'conflict', message: null }, fake as any),
  '<jobd_cancel_err_notallowed>'
);
eq(
  'network with no server message → the network copy',
  cancelJobFailureMessage({ kind: 'network', message: null }, fake as any),
  '<jobd_cancel_err_network>'
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
console.log(`jobCancel: ${summary.passed}/${summary.total} assertions passed`);
