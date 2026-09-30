/**
 * Unit tests for Convert to Regular (POST /api/v1/jobs/{job_id}/convert-to-regular)
 * and the shared job-action failure core it is built on.
 *
 * Run through the project's own harness: `pnpm run test`. No React, no axios, no
 * network — only the rules that decide whether the action may be offered, how a
 * failure is bucketed, and when the cached job must be re-read.
 */
import {
  canConvertJobToRegular,
  canConvertJobToUrgent,
  classifyConvertToRegularFailure,
  classifyConvertToUrgentFailure,
  convertToRegularErrorKey,
  convertToRegularFailureMessage,
  convertToUrgentErrorKey,
  convertToUrgentFailureMessage,
  isConvertNotAllowed,
  isConvertUnauthorized,
  isRegularJob,
  isUrgentJob,
  isValidJobId,
  shouldResyncAfterConvertFailure,
} from '../jobConvert';
import {
  classifyJobActionFailure,
  isJobActionRefused,
  isJobActionUnauthorized,
} from '../jobAction';
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

/* ---------------------------------------------------------------- urgency */

check('isUrgentJob true from the boolean', isUrgentJob({ is_urgent: true } as any) === true);
check(
  'isUrgentJob true from the request_type enum alone',
  isUrgentJob({ is_urgent: false, request_type: 'URGENT' } as any) === true
);
check(
  'isUrgentJob false when the enum says REGULAR',
  isUrgentJob({ is_urgent: false, request_type: 'REGULAR' } as any) === false
);
check(
  'isUrgentJob false for a regular job',
  isUrgentJob({ is_urgent: false, request_type: 'REGULAR' } as any) === false
);
check('isUrgentJob false for null/undefined', isUrgentJob(null) === false);
check('isUrgentJob false for undefined', isUrgentJob(undefined) === false);
check(
  'isUrgentJob does not accept a truthy non-boolean',
  isUrgentJob({ is_urgent: 1 } as any) === false
);

/* ------------------------------------------------- the can_convert_to_regular gate */

const urgentConvertible = {
  can_convert_to_regular: true,
  is_urgent: true,
  request_type: 'URGENT',
} as any;

check(
  'offered for an urgent job the backend marked convertible',
  canConvertJobToRegular(urgentConvertible) === true
);
check(
  'NOT offered when the backend says it cannot be converted (its flag decides)',
  canConvertJobToRegular({ ...urgentConvertible, can_convert_to_regular: false }) === false
);
check(
  'NOT offered on a job that is already regular, even if the flag is stale-true',
  canConvertJobToRegular({ can_convert_to_regular: true, is_urgent: false, request_type: 'REGULAR' }) === false
);
check(
  'NOT offered when the flag is missing (unexpected payload)',
  canConvertJobToRegular({ is_urgent: true, request_type: 'URGENT' } as any) === false
);
check(
  'NOT offered when the flag is a truthy non-boolean',
  canConvertJobToRegular({ can_convert_to_regular: 'yes', is_urgent: true } as any) === false
);
check('NOT offered for null/undefined job', canConvertJobToRegular(null) === false);
check('NOT offered for undefined job', canConvertJobToRegular(undefined) === false);

/* ------------------------------------------------------------ id guard */

check('isValidJobId accepts a positive integer', isValidJobId(7) === true);
check('isValidJobId rejects 0 / float / string / NaN', [
  isValidJobId(0),
  isValidJobId(2.5),
  isValidJobId('7'),
  isValidJobId(Number.NaN),
].every((v) => v === false));

/* ------------------------------------------------- shared classifier buckets */

type Case = [unknown, JobActionFailureKind, string | null];
const cases: Case[] = [
  [{ response: { status: 422, data: { detail: [{ loc: ['path', 'job_id'], msg: 'id is invalid' }] } } }, 'invalid', 'id is invalid'],
  [{ response: { status: 400, data: { detail: 'cannot convert' } } }, 'badrequest', 'cannot convert'],
  [{ response: { status: 401, data: { detail: 'Not authenticated' } } }, 'unauthorized', 'Not authenticated'],
  [{ response: { status: 409, data: { detail: 'already regular' } } }, 'conflict', 'already regular'],
  [{ response: { status: 403, data: null } }, 'forbidden', null],
  [{ response: { status: 404, data: null } }, 'notfound', null],
  [{ response: { status: 500, data: null } }, 'server', null],
  [{ response: { status: 502, data: null } }, 'server', null],
  [{ response: { status: 418, data: null } }, 'unknown', null],
  [new Error('Network Error'), 'network', null],
  [undefined, 'network', null],
];

for (const [err, kind, message] of cases) {
  const result = classifyJobActionFailure(err);
  eq(`classifyJobActionFailure ${JSON.stringify(err)} → kind`, result.kind, kind);
  eq(`classifyJobActionFailure ${kind} → message`, result.message, message);
  // The convert wrapper must agree with the core for everything but 409 wording,
  // which it shares a bucket with 400 anyway.
  eq(
    `classifyConvertToRegularFailure agrees on kind (${kind})`,
    classifyConvertToRegularFailure(err).kind,
    kind
  );
}
eq(
  'a malformed error degrades to the network bucket instead of throwing',
  classifyJobActionFailure({ response: { status: 'oops' } } as any).kind,
  'network'
);

/* -------------------------------------------------------- refusal predicates */

check('409 is a refusal (stale flags)', isJobActionRefused('conflict') === true);
check('403 is a refusal (stale flags)', isJobActionRefused('forbidden') === true);
check('404 is a refusal (the job is gone)', isJobActionRefused('notfound') === true);
check('422 is NOT a refusal bucket', isJobActionRefused('invalid') === false);
check('network is NOT a refusal bucket', isJobActionRefused('network') === false);

check('400 counts as "conversion not allowed"', isConvertNotAllowed('badrequest') === true);
check('409 counts as "conversion not allowed"', isConvertNotAllowed('conflict') === true);
check('422 does NOT count as "conversion not allowed"', isConvertNotAllowed('invalid') === false);
check('network does NOT count as "conversion not allowed"', isConvertNotAllowed('network') === false);
check('401 IS the unauthorized bucket', isConvertUnauthorized('unauthorized') === true);
check('a generic error is not the unauthorized bucket', isConvertUnauthorized('server') === false);

/* -------------------------------------------------------------- re-sync rule */

check('re-sync after 400 (flags were stale)', shouldResyncAfterConvertFailure('badrequest') === true);
check('re-sync after 409 (flags were stale)', shouldResyncAfterConvertFailure('conflict') === true);
check('re-sync after 403 (flags were stale)', shouldResyncAfterConvertFailure('forbidden') === true);
check('re-sync after 404 (the job is gone)', shouldResyncAfterConvertFailure('notfound') === true);
check('no re-sync after 422 (the id itself was rejected)', shouldResyncAfterConvertFailure('invalid') === false);
check('no re-sync after a network failure', shouldResyncAfterConvertFailure('network') === false);
check('no re-sync after a 5xx', shouldResyncAfterConvertFailure('server') === false);
check('no re-sync after an unknown status', shouldResyncAfterConvertFailure('unknown') === false);

/* ---------------------------------------------------------------- copy keys */

eq('422 → its own copy key', convertToRegularErrorKey('invalid'), 'jobd_convert_err_invalid');
eq(
  '400 → the "not allowed any more" copy',
  convertToRegularErrorKey('badrequest'),
  'jobd_convert_err_notallowed'
);
eq(
  '409 → the "not allowed any more" copy',
  convertToRegularErrorKey('conflict'),
  'jobd_convert_err_notallowed'
);
eq('403 → its own copy key', convertToRegularErrorKey('forbidden'), 'jobd_convert_err_forbidden');
eq('404 → its own copy key', convertToRegularErrorKey('notfound'), 'jobd_convert_err_notfound');
eq('network → its own copy key', convertToRegularErrorKey('network'), 'jobd_convert_err_network');
eq('5xx → the generic copy', convertToRegularErrorKey('server'), 'jobd_convert_err_server');
eq('unknown → the generic copy', convertToRegularErrorKey('unknown'), 'jobd_convert_err_server');
eq(
  '401 → the generic copy too (never rendered; the caller routes to login)',
  convertToRegularErrorKey('unauthorized'),
  'jobd_convert_err_server'
);

const fakeTranslate = (key: string) => `t:${key}`;
eq(
  'a 422 detail message is shown verbatim, not a generic string',
  convertToRegularFailureMessage(
    { kind: 'invalid', message: 'Input should be a valid integer' } as any,
    fakeTranslate as any
  ),
  'Input should be a valid integer'
);
eq(
  'without a backend message the translated bucket copy is used',
  convertToRegularFailureMessage({ kind: 'conflict', message: null } as any, fakeTranslate as any),
  't:jobd_convert_err_notallowed'
);

/* =====================================================================
 * The REVERSE direction: convert-to-urgent (REGULAR → URGENT)
 * =================================================================== */

check('isRegularJob is the exact complement of isUrgentJob (urgent)', isRegularJob({ is_urgent: true } as any) === false);
check(
  'isRegularJob is the exact complement of isUrgentJob (enum urgent)',
  isRegularJob({ is_urgent: false, request_type: 'URGENT' } as any) === false
);
check(
  'isRegularJob true for a regular job',
  isRegularJob({ is_urgent: false, request_type: 'REGULAR' } as any) === true
);
check('isRegularJob true for null (no urgency claim)', isRegularJob(null) === true);

const regularConvertible = {
  can_convert_to_urgent: true,
  is_urgent: false,
  request_type: 'REGULAR',
} as any;

check(
  'the urgent action is offered for a regular job the backend marked convertible',
  canConvertJobToUrgent(regularConvertible) === true
);
check(
  'NOT offered when the backend says it cannot be converted (its flag decides)',
  canConvertJobToUrgent({ ...regularConvertible, can_convert_to_urgent: false }) === false
);
check(
  'NOT offered on a job that is already urgent, even if the flag is stale-true',
  canConvertJobToUrgent({ can_convert_to_urgent: true, is_urgent: true, request_type: 'URGENT' }) === false
);
check(
  'NOT offered when the flag is missing (unexpected payload)',
  canConvertJobToUrgent({ is_urgent: false, request_type: 'REGULAR' } as any) === false
);
check(
  'NOT offered when the flag is a truthy non-boolean',
  canConvertJobToUrgent({ can_convert_to_urgent: 'yes', is_urgent: false } as any) === false
);
check('NOT offered for null/undefined job', [canConvertJobToUrgent(null), canConvertJobToUrgent(undefined)].every((v) => v === false));

// The two directions never both apply to the same payload.
check(
  'the two convert gates are mutually exclusive (regular job)',
  canConvertJobToUrgent(regularConvertible) === true &&
    canConvertJobToRegular({ ...regularConvertible, can_convert_to_regular: true }) === false
);
check(
  'the two convert gates are mutually exclusive (urgent job)',
  canConvertJobToRegular(urgentConvertible) === true &&
    canConvertJobToUrgent({ ...urgentConvertible, can_convert_to_urgent: true }) === false
);

// The urgent-direction classifier is the same core.
for (const [err, kind] of [
  [{ response: { status: 422, data: { detail: 'bad id' } } }, 'invalid'],
  [{ response: { status: 409, data: null } }, 'conflict'],
  [{ response: { status: 403, data: null } }, 'forbidden'],
  [{ response: { status: 404, data: null } }, 'notfound'],
  [{ response: { status: 500, data: null } }, 'server'],
  [new Error('offline'), 'network'],
] as Array<[unknown, JobActionFailureKind]>) {
  eq(
    `classifyConvertToUrgentFailure ${JSON.stringify(err)} → kind`,
    classifyConvertToUrgentFailure(err).kind,
    kind
  );
}

// Buckets/wording rules are shared between the directions…
check(
  '400 and 409 are "not allowed" for the urgent direction too',
  (['badrequest', 'conflict'] as JobActionFailureKind[]).every(isConvertNotAllowed)
);
check(
  're-sync applies to the urgent direction too',
  (['badrequest', 'conflict', 'forbidden', 'notfound'] as JobActionFailureKind[]).every(
    shouldResyncAfterConvertFailure
  ) &&
    (['invalid', 'network', 'server'] as JobActionFailureKind[]).every(
      (k) => !shouldResyncAfterConvertFailure(k)
    )
);
check('401 is the unauthorized bucket in the urgent direction too', isConvertUnauthorized('unauthorized') === true);

// …but the copy keys are the direction's own, and none are shared by accident.
eq('urgent 422 → its own copy key', convertToUrgentErrorKey('invalid'), 'jobd_urgent_err_invalid');
eq('urgent 400 → the "not allowed" copy', convertToUrgentErrorKey('badrequest'), 'jobd_urgent_err_notallowed');
eq('urgent 409 → the "not allowed" copy', convertToUrgentErrorKey('conflict'), 'jobd_urgent_err_notallowed');
eq('urgent 403 → its own copy key', convertToUrgentErrorKey('forbidden'), 'jobd_urgent_err_forbidden');
eq('urgent 404 → its own copy key', convertToUrgentErrorKey('notfound'), 'jobd_urgent_err_notfound');
eq('urgent network → its own copy key', convertToUrgentErrorKey('network'), 'jobd_urgent_err_network');
eq('urgent 5xx → the generic copy', convertToUrgentErrorKey('server'), 'jobd_urgent_err_server');
eq('urgent unknown → the generic copy', convertToUrgentErrorKey('unknown'), 'jobd_urgent_err_server');
eq(
  'urgent 401 → the generic copy (never rendered; the caller routes to login)',
  convertToUrgentErrorKey('unauthorized'),
  'jobd_urgent_err_server'
);
for (const kind of ['invalid', 'badrequest', 'conflict', 'forbidden', 'notfound', 'server', 'network', 'unknown', 'unauthorized'] as JobActionFailureKind[]) {
  check(
    `the two directions never share a copy key (${kind})`,
    String(convertToUrgentErrorKey(kind)) !== String(convertToRegularErrorKey(kind)) ||
      kind === 'server' ||
      kind === 'unknown' ||
      kind === 'unauthorized'
  );
}

eq(
  'a 422 detail message wins for the urgent direction too',
  convertToUrgentFailureMessage(
    { kind: 'invalid', message: 'Input should be a valid integer' } as any,
    fakeTranslate as any
  ),
  'Input should be a valid integer'
);
eq(
  'without a backend message the urgent bucket copy is used',
  convertToUrgentFailureMessage({ kind: 'conflict', message: null } as any, fakeTranslate as any),
  't:jobd_urgent_err_notallowed'
);

/* ------------------------------------------------------------------------ report */

export const summary = { passed, total: passed + failures.length };
console.log(`jobConvert: ${summary.passed}/${summary.total} assertions passed`);
