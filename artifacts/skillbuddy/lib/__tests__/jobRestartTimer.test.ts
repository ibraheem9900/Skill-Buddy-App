/**
 * Unit tests for the Restart Timer helpers (POST /api/v1/jobs/{job_id}/restart-timer).
 *
 * Run through the project's own harness: `pnpm run test` (there is no jest/vitest
 * in this workspace). No React, no axios, no network — only the rules that decide
 * whether the action may be offered and how a failure is bucketed and worded.
 */
import {
  canRestartJobTimer,
  classifyRestartTimerFailure,
  isRestartNotAllowed,
  isValidJobId,
  restartTimerErrorKey,
  restartTimerFailureMessage,
} from '../jobRestartTimer';
import type { RestartTimerFailureKind } from '../jobRestartTimer';

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

/* --------------------------------------------------- gating: the backend's flag */

check(
  'canRestartJobTimer true only when can_restart_timer is exactly true',
  canRestartJobTimer({ can_restart_timer: true }) === true
);
check(
  'canRestartJobTimer false when the backend says false (limit reached)',
  canRestartJobTimer({ can_restart_timer: false }) === false
);
check(
  'canRestartJobTimer false when the flag is missing (unexpected payload)',
  canRestartJobTimer({} as any) === false
);
check(
  'canRestartJobTimer false for a null flag',
  canRestartJobTimer({ can_restart_timer: null } as any) === false
);
check(
  'canRestartJobTimer does not accept a truthy non-boolean',
  canRestartJobTimer({ can_restart_timer: 1 } as any) === false
);
check('canRestartJobTimer false for null/undefined job', canRestartJobTimer(null) === false);
check('canRestartJobTimer false for undefined job', canRestartJobTimer(undefined) === false);

/* --------------------------------------------------------- id guard (path safety) */

check('isValidJobId accepts a positive integer', isValidJobId(12) === true);
check('isValidJobId rejects 0', isValidJobId(0) === false);
check('isValidJobId rejects a float', isValidJobId(1.5) === false);
check('isValidJobId rejects a numeric string', isValidJobId('12') === false);
check('isValidJobId rejects NaN', isValidJobId(Number.NaN) === false);

/* ------------------------------------------------------------- failure bucketing */

type Case = [unknown, RestartTimerFailureKind, string | null];

const cases: Case[] = [
  [{ response: { status: 422, data: { detail: [{ loc: ['path', 'job_id'], msg: 'bad id' }] } } }, 'invalid', 'bad id'],
  [{ response: { status: 400, data: { detail: 'bad request' } } }, 'badrequest', 'bad request'],
  [{ response: { status: 401, data: { detail: 'Not authenticated' } } }, 'unauthorized', 'Not authenticated'],
  [{ response: { status: 409, data: { detail: 'Cannot restart the timer.' } } }, 'limit', 'Cannot restart the timer.'],
  [{ response: { status: 403, data: null } }, 'forbidden', null],
  [{ response: { status: 404, data: null } }, 'notfound', null],
  [{ response: { status: 500, data: null } }, 'server', null],
  [{ response: { status: 503, data: null } }, 'server', null],
  [{ response: { status: 418, data: null } }, 'unknown', null],
  [new Error('Network Error'), 'network', null],
  [undefined, 'network', null],
  [null, 'network', null],
  ['nonsense', 'network', null],
];

for (const [err, kind, message] of cases) {
  const result = classifyRestartTimerFailure(err);
  eq(`classify ${JSON.stringify(err)} → kind`, result.kind, kind);
  eq(`classify status ${kind} → message`, result.message, message);
}

// A malformed error object must degrade, never throw.
const malformed = classifyRestartTimerFailure({ response: { status: 'oops' } } as any);
eq('a non-numeric status degrades to the network bucket', malformed.kind, 'network');
eq(
  '422 with no readable detail leaves the message null so the UI can fall back',
  classifyRestartTimerFailure({ response: { status: 422, data: {} } }).message,
  null
);

/* ------------------------------------------------------- the "not allowed" bucket */

check('409 (state conflict) is the not-allowed bucket', isRestartNotAllowed('limit') === true);
check('403 is NOT treated as the restart limit', isRestartNotAllowed('forbidden') === false);
check('422 is NOT treated as the restart limit', isRestartNotAllowed('invalid') === false);
check('network is NOT treated as the restart limit', isRestartNotAllowed('network') === false);

/* ------------------------------------------------------------------- error copy */

eq('422 maps to its own copy key', restartTimerErrorKey('invalid'), 'jobd_restart_err_invalid');
eq(
  '400 maps to its own copy key',
  restartTimerErrorKey('badrequest'),
  'jobd_restart_err_badrequest'
);
eq(
  '403 maps to its own copy key',
  restartTimerErrorKey('forbidden'),
  'jobd_restart_err_forbidden'
);
eq(
  '404 maps to its own copy key',
  restartTimerErrorKey('notfound'),
  'jobd_restart_err_notfound'
);
eq('network maps to its own copy key', restartTimerErrorKey('network'), 'jobd_restart_err_network');
eq('5xx maps to the generic server copy', restartTimerErrorKey('server'), 'jobd_restart_err_server');
eq(
  'unknown maps to the generic server copy',
  restartTimerErrorKey('unknown'),
  'jobd_restart_err_server'
);
eq(
  'the limit bucket also has a printable fallback (never rendered: it has its own alert)',
  restartTimerErrorKey('limit'),
  'jobd_restart_err_server'
);
eq(
  'an unauthorized bucket also falls back safely',
  restartTimerErrorKey('unauthorized'),
  'jobd_restart_err_server'
);

const fakeTranslate = (key: string) => `t:${key}`;
eq(
  'the backend message WINS over the app copy',
  restartTimerFailureMessage({ kind: 'invalid', message: 'Backend says no' }, fakeTranslate as any),
  'Backend says no'
);
eq(
  'without a backend message the translated copy is used',
  restartTimerFailureMessage({ kind: 'network', message: null }, fakeTranslate as any),
  't:jobd_restart_err_network'
);
eq(
  'a blank backend message falls back too (null, not an empty alert body)',
  restartTimerFailureMessage({ kind: 'server', message: null }, fakeTranslate as any),
  't:jobd_restart_err_server'
);

/* ------------------------------------------------------------------------- report */

export const summary = { passed, total: passed + failures.length };
console.log(`jobRestartTimer: ${summary.passed}/${summary.total} assertions passed`);
