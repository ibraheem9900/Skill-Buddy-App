/**
 * Unit tests for Report Blocker (POST /api/v1/jobs/{job_id}/blocker, schema
 * JobDetailsRequest).
 *
 * Run through the project's own harness: `pnpm run test`. No React, no axios, no
 * network — only the rules that decide WHEN either party may report a blocker, WHAT
 * BODY is sent (field name `details`, trimming, the 3–1000 rule), how a failure is
 * bucketed and worded, and how a lost response is resolved.
 *
 * Report Blocker is the ONE job action the API does not split per role (there is no
 * blocker-by-client / blocker-by-provider pair), so the tests pin that the gate takes
 * NO role and behaves identically for both sides.
 */
import {
  BLOCKER_DETAILS_MAX_LENGTH,
  BLOCKER_DETAILS_MIN_LENGTH,
  BLOCKER_REPORTABLE_STATUSES,
  blockerDetailsFieldError,
  blockerErrorKey,
  blockerFailureMessage,
  blockerResolvedAfterResync,
  buildBlockerRequest,
  canReportBlocker,
  classifyBlockerJobFailure,
  isBlockerNotAllowed,
  isBlockerReportableStatus,
  isBlockerUnauthorized,
  isValidJobId,
  shouldResyncAfterBlockerFailure,
  validateBlockerDetails,
} from '../jobBlocker';
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

type ReportableJob = Parameters<typeof canReportBlocker>[0];

const active = {
  assigned_provider_id: 7 as number | null,
  cancelled_at: null as string | null,
  completed_at: null as string | null,
  status: 'IN_PROGRESS' as JobApiStatus,
};
const job = (over: Partial<NonNullable<ReportableJob>>) =>
  ({ ...active, ...over }) as ReportableJob;

/* --------------------------------------------------------- the details contract */
eq('the minimum mirrors the schema', BLOCKER_DETAILS_MIN_LENGTH, 3);
eq('the maximum mirrors the schema', BLOCKER_DETAILS_MAX_LENGTH, 1000);
eq(
  'the reportable window is PROVIDER_ASSIGNED then IN_PROGRESS',
  BLOCKER_REPORTABLE_STATUSES.join(','),
  'PROVIDER_ASSIGNED,IN_PROGRESS'
);
eq(
  'the body field name is the shared JobDetailsRequest one (details), never reason/notes',
  Object.keys(buildBlockerRequest('abc')).join(','),
  'details'
);
eq('an empty description is rejected as required', validateBlockerDetails(''), 'jobd_blocker_err_details_required');
eq('a whitespace-only description is rejected as required', validateBlockerDetails('   '), 'jobd_blocker_err_details_required');
eq('null is rejected as required', validateBlockerDetails(null), 'jobd_blocker_err_details_required');
eq('undefined is rejected as required', validateBlockerDetails(undefined), 'jobd_blocker_err_details_required');
eq('one character is too short', validateBlockerDetails('x'), 'jobd_blocker_err_details_short');
eq('two characters are too short', validateBlockerDetails('ab'), 'jobd_blocker_err_details_short');
eq('padding shorter than 3 after trimming is too short', validateBlockerDetails('  a  '), 'jobd_blocker_err_details_short');
eq('three characters are accepted', validateBlockerDetails('abc'), null);
eq('a realistic description is accepted', validateBlockerDetails('No access to the site'), null);
eq('1000 characters are accepted', validateBlockerDetails('d'.repeat(1000)), null);
eq('1001 characters are too long', validateBlockerDetails('d'.repeat(1001)), 'jobd_blocker_err_details_long');

/* --------------------------------------------------------------- the body */
const body = buildBlockerRequest('  Waiting on the client  ');
eq('the body uses the exact contract field name', Object.keys(body).join(','), 'details');
eq('details are trimmed', body.details, 'Waiting on the client');
check('the body never gains an invented field', Object.keys(buildBlockerRequest('abc')).every((k) => k === 'details'));

/* ------------------------------------------------------------------- gating */
/* Both roles are legitimate parties, so the gate takes no role at all: the same
   (job) call is what every call site uses, regardless of who is signed in. */
eq('either party may report on a job that is under way', canReportBlocker(active), true);
eq('either party may report on an assigned-but-unstarted job', canReportBlocker(job({ status: 'PROVIDER_ASSIGNED' })), true);
eq('a job still open for bidding is not reportable (nobody is blocked yet)', canReportBlocker(job({ status: 'OPEN', assigned_provider_id: null })), false);
eq('a DRAFT job is not reportable', canReportBlocker(job({ status: 'DRAFT', assigned_provider_id: null })), false);
eq('a PAYMENT_PENDING job is not reportable', canReportBlocker(job({ status: 'PAYMENT_PENDING' })), false);
eq('an already BLOCKED job cannot re-report (no repeat loop)', canReportBlocker(job({ status: 'BLOCKED' })), false);
eq('a PAUSED_BY_CLIENT job is not reportable', canReportBlocker(job({ status: 'PAUSED_BY_CLIENT' })), false);
eq('a PAUSED_BY_PROVIDER job is not reportable', canReportBlocker(job({ status: 'PAUSED_BY_PROVIDER' })), false);
eq('a DECLINED_BY_PROVIDER job is not reportable', canReportBlocker(job({ status: 'DECLINED_BY_PROVIDER' })), false);
eq('a COMPLETED job is not reportable', canReportBlocker(job({ status: 'COMPLETED', completed_at: '2026-09-30T10:00:00Z' })), false);
eq('a completed stamp alone stops the action', canReportBlocker(job({ completed_at: '2026-09-30T10:00:00Z' })), false);
eq('a CANCELLED status stops the action', canReportBlocker(job({ status: 'CANCELLED' })), false);
eq('a cancelled stamp alone stops the action', canReportBlocker(job({ cancelled_at: '2026-09-30T10:00:00Z' })), false);
eq('a job with no assigned provider cannot be reported', canReportBlocker(job({ assigned_provider_id: null })), false);
eq('a job with no assigned provider (undefined) cannot be reported', canReportBlocker(job({ assigned_provider_id: undefined as any })), false);
eq('provider id 0 is not a real assignment', canReportBlocker(job({ assigned_provider_id: 0 })), false);
eq('null job cannot be reported', canReportBlocker(null), false);
eq('undefined job cannot be reported', canReportBlocker(undefined), false);
eq('IN_PROGRESS is a reportable status', isBlockerReportableStatus({ status: 'IN_PROGRESS' }), true);
eq('PROVIDER_ASSIGNED is a reportable status', isBlockerReportableStatus({ status: 'PROVIDER_ASSIGNED' }), true);
eq('BLOCKED is not a reportable status', isBlockerReportableStatus({ status: 'BLOCKED' }), false);
eq('the state helper rejects null', isBlockerReportableStatus(null), false);

/* The full status sweep: only the two active windows are reportable, and they are the
   same for both parties (the gate has no role parameter to disagree with itself). */
const reportableCount = (
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
  ] as JobApiStatus[]
).filter((status) => canReportBlocker(job({ status }))).length;
eq('exactly the two active windows are reportable', reportableCount, 2);

/* ------------------------------------------------- failure classification */
const http = (status: number) => ({ isAxiosError: true, response: { status } });
const bucket = (status: number): JobActionFailureKind => classifyBlockerJobFailure(http(status)).kind;
eq('400 → badrequest', bucket(400), 'badrequest');
eq('401 → unauthorized', bucket(401), 'unauthorized');
eq('403 → forbidden', bucket(403), 'forbidden');
eq('404 → notfound', bucket(404), 'notfound');
eq('409 → conflict', bucket(409), 'conflict');
eq('422 → invalid', bucket(422), 'invalid');
eq('500 → server', bucket(500), 'server');
eq('no response → network', classifyBlockerJobFailure(new Error('offline')).kind, 'network');
eq(
  'a plain {detail: "..."} message is carried through verbatim',
  classifyBlockerJobFailure({
    isAxiosError: true,
    response: { status: 409, data: { detail: 'Job is already blocked' } },
  }).message,
  'Job is already blocked'
);
eq('401 is the unauthorized bucket', isBlockerUnauthorized('unauthorized'), true);
eq('409 is not unauthorized', isBlockerUnauthorized('conflict'), false);

/* ------------------------------------------------------- refusal + re-sync */
eq('400 is a not-allowed bucket', isBlockerNotAllowed('badrequest'), true);
eq('409 is a not-allowed bucket', isBlockerNotAllowed('conflict'), true);
eq('404 is NOT the not-allowed bucket', isBlockerNotAllowed('notfound'), false);
eq('network is NOT a not-allowed bucket', isBlockerNotAllowed('network'), false);
eq('400 re-syncs the job', shouldResyncAfterBlockerFailure('badrequest'), true);
eq('409 re-syncs the job', shouldResyncAfterBlockerFailure('conflict'), true);
eq('403 re-syncs the job (stale ownership/state)', shouldResyncAfterBlockerFailure('forbidden'), true);
eq('404 re-syncs the job', shouldResyncAfterBlockerFailure('notfound'), true);
eq('422 does NOT re-sync (the TYPED details were rejected — re-reading cannot fix it)', shouldResyncAfterBlockerFailure('invalid'), false);
eq('server does NOT re-sync', shouldResyncAfterBlockerFailure('server'), false);
eq('network does NOT re-sync here (handled separately)', shouldResyncAfterBlockerFailure('network'), false);

/* --------------------------------------------- lost response after a timeout */
eq(
  'job already BLOCKED after a lost response → no retry needed',
  blockerResolvedAfterResync(job({ status: 'BLOCKED' })),
  true
);
eq(
  'job moved on to COMPLETED after a lost response → treat as carried out',
  blockerResolvedAfterResync(job({ status: 'COMPLETED' })),
  true
);
eq(
  'job still in the active window after a lost response → the report really failed',
  blockerResolvedAfterResync(active),
  false
);
eq('a failed re-read claims nothing', blockerResolvedAfterResync(null), false);
eq('a failed re-read claims nothing (undefined)', blockerResolvedAfterResync(undefined), false);

/* ------------------------------------------------------------ 422 → the input */
eq(
  'a details-level 422 maps onto the details input',
  blockerDetailsFieldError([
    { loc: ['body', 'details'], msg: 'String should have at least 3 characters', type: 'string_too_short' },
  ]),
  'String should have at least 3 characters'
);
eq(
  'the singular error key `detail` is not mistaken for the request field `details`',
  blockerDetailsFieldError([{ loc: ['body', 'detail'], msg: 'Nope', type: 'x' }]),
  null
);
eq(
  'a message about another field does not land on details',
  blockerDetailsFieldError([{ loc: ['body', 'job_id'], msg: 'Input should be a valid integer', type: 'int_parsing' }]),
  null
);
eq('no detail array maps to nothing', blockerDetailsFieldError(null), null);
eq('a non-array detail maps to nothing', blockerDetailsFieldError({} as any), null);
eq('an entry without a message maps to nothing', blockerDetailsFieldError([{ loc: ['body', 'details'], msg: '', type: 'x' }]), null);

/* --------------------------------------------------------------------- copy */
eq('422 copy key', blockerErrorKey('invalid'), 'jobd_blocker_err_invalid');
eq('400 copy key', blockerErrorKey('badrequest'), 'jobd_blocker_err_notallowed');
eq('409 copy key', blockerErrorKey('conflict'), 'jobd_blocker_err_notallowed');
eq('403 copy key', blockerErrorKey('forbidden'), 'jobd_blocker_err_forbidden');
eq('404 copy key', blockerErrorKey('notfound'), 'jobd_blocker_err_notfound');
eq('500 copy key', blockerErrorKey('server'), 'jobd_blocker_err_server');
eq('network copy key', blockerErrorKey('network'), 'jobd_blocker_err_network');

const fake = (key: string) => `<${key}>`;
eq(
  "the backend's own message always wins",
  blockerFailureMessage({ kind: 'conflict', message: 'Already blocked' }, fake as any),
  'Already blocked'
);
eq(
  'no server message → the bucket copy',
  blockerFailureMessage({ kind: 'conflict', message: null }, fake as any),
  '<jobd_blocker_err_notallowed>'
);
eq(
  '403 with no server message → the not-allowed-to-report copy',
  blockerFailureMessage({ kind: 'forbidden', message: null }, fake as any),
  '<jobd_blocker_err_forbidden>'
);
eq(
  'network with no server message → the network copy',
  blockerFailureMessage({ kind: 'network', message: null }, fake as any),
  '<jobd_blocker_err_network>'
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
console.log(`jobBlocker: ${summary.passed}/${summary.total} assertions passed`);
