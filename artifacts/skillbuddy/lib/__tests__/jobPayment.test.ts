/**
 * Unit tests for Confirm Payment (POST /api/v1/jobs/{job_id}/confirm-payment).
 *
 * Run through the project's own harness: `pnpm run test`. No React, no axios, no
 * network — only the rules that decide whether the action may be offered, which
 * responses are treated as "already paid", and how a failure is bucketed and worded.
 */
import {
  canConfirmPayment,
  classifyConfirmPaymentFailure,
  confirmPaymentErrorKey,
  confirmPaymentFailureMessage,
  isPaymentNotAllowed,
  isPaymentPending,
  isPaymentUnauthorized,
  isValidJobId,
  paymentResolvedAfterResync,
  shouldResyncAfterPaymentFailure,
} from '../jobPayment';
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

type PayableJob = Parameters<typeof canConfirmPayment>[0];

const payable = {
  status: 'PAYMENT_PENDING' as const,
  cancelled_at: null as string | null,
  completed_at: null as string | null,
};
const job = (over: Partial<NonNullable<PayableJob>>) =>
  ({ ...payable, ...over }) as PayableJob;

// ── The payable state is the backend's status, never a guess ──────────────────
eq('PAYMENT_PENDING is the payable state', isPaymentPending({ status: 'PAYMENT_PENDING' }), true);
eq('OPEN is not payable', isPaymentPending({ status: 'OPEN' }), false);
eq('DRAFT is not payable', isPaymentPending({ status: 'DRAFT' }), false);
eq('null job is not payable', isPaymentPending(null), false);
eq('undefined job is not payable', isPaymentPending(undefined), false);

// ── Gating ───────────────────────────────────────────────────────────────────
eq('PAYMENT_PENDING job can confirm payment', canConfirmPayment(payable), true);
eq('null job cannot confirm payment', canConfirmPayment(null), false);
eq('undefined job cannot confirm payment', canConfirmPayment(undefined), false);
eq('OPEN job cannot confirm payment', canConfirmPayment(job({ status: 'OPEN' })), false);
eq('DRAFT job cannot confirm payment', canConfirmPayment(job({ status: 'DRAFT' })), false);
eq(
  'already-cancelled payment job cannot confirm payment',
  canConfirmPayment(job({ cancelled_at: '2026-09-29T10:00:00Z' })),
  false
);
eq(
  'already-completed payment job cannot confirm payment',
  canConfirmPayment(job({ completed_at: '2026-09-29T10:00:00Z' })),
  false
);
// The status is what gates; a stale flag can never bring the action back.
eq(
  'a job that moved on past PAYMENT_PENDING offers nothing',
  canConfirmPayment(job({ status: 'PROVIDER_ASSIGNED' })),
  false
);

// ── Failure classification (shared core) ─────────────────────────────────────
const http = (status: number) => ({ isAxiosError: true, response: { status } });
const bucket = (status: number): JobActionFailureKind => classifyConfirmPaymentFailure(http(status)).kind;

eq('400 → badrequest', bucket(400), 'badrequest');
eq('401 → unauthorized', bucket(401), 'unauthorized');
eq('403 → forbidden', bucket(403), 'forbidden');
eq('404 → notfound', bucket(404), 'notfound');
eq('409 → conflict', bucket(409), 'conflict');
eq('422 → invalid', bucket(422), 'invalid');
eq('500 → server', bucket(500), 'server');
eq('no response → network', classifyConfirmPaymentFailure(new Error('boom')).kind, 'network');
eq(
  'a 422 detail message is carried through verbatim',
  classifyConfirmPaymentFailure({
    isAxiosError: true,
    response: { status: 422, data: { detail: [{ loc: ['path', 'job_id'], msg: 'Invalid job id' }] } },
  }).message,
  'Invalid job id'
);
eq(
  'a plain {detail: "..."} message is carried through verbatim',
  classifyConfirmPaymentFailure({
    isAxiosError: true,
    response: { status: 409, data: { detail: 'Payment already confirmed' } },
  }).message,
  'Payment already confirmed'
);

// A 401 that survived the shared refresh+replay sends the client to login.
eq('401 is the unauthorized bucket', isPaymentUnauthorized('unauthorized'), true);
eq('409 is not unauthorized', isPaymentUnauthorized('conflict'), false);

// ── "No longer payable" gets its own copy, and re-syncs ──────────────────────
eq('400 is a not-allowed bucket', isPaymentNotAllowed('badrequest'), true);
eq('409 is a not-allowed bucket', isPaymentNotAllowed('conflict'), true);
eq('404 is NOT a not-allowed bucket', isPaymentNotAllowed('notfound'), false);
eq('network is NOT a not-allowed bucket', isPaymentNotAllowed('network'), false);

eq('400 re-syncs the job', shouldResyncAfterPaymentFailure('badrequest'), true);
eq('409 re-syncs the job', shouldResyncAfterPaymentFailure('conflict'), true);
eq('403 re-syncs the job (stale ownership/state)', shouldResyncAfterPaymentFailure('forbidden'), true);
eq('404 re-syncs the job', shouldResyncAfterPaymentFailure('notfound'), true);
eq('422 does NOT re-sync (the path id was rejected)', shouldResyncAfterPaymentFailure('invalid'), false);
eq('server does NOT re-sync', shouldResyncAfterPaymentFailure('server'), false);
eq('network does NOT re-sync here (handled separately)', shouldResyncAfterPaymentFailure('network'), false);

// ── Lost response: a re-read decides whether it actually went through ────────
eq(
  'job no longer PAYMENT_PENDING after a lost response → already confirmed',
  paymentResolvedAfterResync({ status: 'OPEN' }),
  true
);
eq(
  'job still PAYMENT_PENDING after a lost response → not confirmed',
  paymentResolvedAfterResync({ status: 'PAYMENT_PENDING' }),
  false
);
eq('a failed re-read claims nothing', paymentResolvedAfterResync(null), false);
eq('a failed re-read claims nothing (undefined)', paymentResolvedAfterResync(undefined), false);
eq(
  'a job cancelled during the lost request counts as resolved',
  paymentResolvedAfterResync({ status: 'CANCELLED' }),
  true
);

// ── Copy ─────────────────────────────────────────────────────────────────────
eq('422 copy key', confirmPaymentErrorKey('invalid'), 'jobd_pay_err_invalid');
eq('400 copy key', confirmPaymentErrorKey('badrequest'), 'jobd_pay_err_notallowed');
eq('409 copy key', confirmPaymentErrorKey('conflict'), 'jobd_pay_err_notallowed');
eq('403 copy key', confirmPaymentErrorKey('forbidden'), 'jobd_pay_err_forbidden');
eq('404 copy key', confirmPaymentErrorKey('notfound'), 'jobd_pay_err_notfound');
eq('500 copy key', confirmPaymentErrorKey('server'), 'jobd_pay_err_server');
eq('network copy key', confirmPaymentErrorKey('network'), 'jobd_pay_err_network');

const fake = (key: string) => `<${key}>`;
eq(
  "the backend's own message always wins",
  confirmPaymentFailureMessage({ kind: 'conflict', message: 'Payment already confirmed' }, fake as any),
  'Payment already confirmed'
);
eq(
  'no server message → the bucket copy',
  confirmPaymentFailureMessage({ kind: 'conflict', message: null }, fake as any),
  '<jobd_pay_err_notallowed>'
);
eq(
  'network with no server message → the network copy',
  confirmPaymentFailureMessage({ kind: 'network', message: null }, fake as any),
  '<jobd_pay_err_network>'
);

// ── The path id guard (shared with the other job actions) ────────────────────
eq('accepts a real job id', isValidJobId(42), true);
eq('rejects 0', isValidJobId(0), false);
eq('rejects a float', isValidJobId(1.5), false);
eq('rejects NaN', isValidJobId(Number.NaN), false);
eq('rejects a string id', isValidJobId('7' as unknown as number), false);

/* ------------------------------------------------------------------------ report */

export const summary = { passed, total: passed + failures.length };
for (const failure of failures) console.log(`  ✗ ${failure}`);
console.log(`jobPayment: ${summary.passed}/${summary.total} assertions passed`);
