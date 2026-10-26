/**
 * fetchRetry.test.ts — the shared list-fetch retry policy.
 *
 *   • network errors (status null) and 5xx are retried with 300/600 ms backoff;
 *   • 4xx is re-thrown immediately (definitive answer — never masked);
 *   • the budget is respected (3 attempts total by default);
 *   • the last error is rethrown when the budget is spent;
 *   • a success after retries is returned normally.
 *
 * Run through the same harness: `pnpm run test`.
 */
import { httpStatusOf, isRetryableStatus, shouldRetry, withRetry } from '../fetchRetry';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean) {
  if (ok) {
    passed += 1;
  } else {
    failures.push(label);
    console.log(`FAIL ${label}`);
  }
}

function eq<T>(label: string, actual: T, expected: T) {
  check(`${label} (got ${String(actual)}, want ${String(expected)})`, actual === expected);
}

const errWith = (status: number | null) =>
  status === null ? new Error('Network Error') : { response: { status } };

// ── classification ─────────────────────────────────────────────────────────
eq('reads status from an axios-shaped error', httpStatusOf(errWith(503)), 503);
eq('network error → null status', httpStatusOf(errWith(null)), null);
eq('thrown string → null status', httpStatusOf('boom'), null);
check('null (network) is retryable', isRetryableStatus(null));
check('500 is retryable', isRetryableStatus(500));
check('503 is retryable', isRetryableStatus(503));
check('404 is NOT retryable', !isRetryableStatus(404));
check('401 is NOT retryable', !isRetryableStatus(401));

// ── shouldRetry budget ─────────────────────────────────────────────────────
check('attempt 0 of 3 on network error → retry', shouldRetry(0, 3, null));
check('attempt 1 of 3 on 503 → retry', shouldRetry(1, 3, 503));
check('attempt 2 of 3 → budget spent', !shouldRetry(2, 3, null));
check('attempt 0 on 422 → never retry', !shouldRetry(0, 3, 422));

// ── withRetry behaviour ────────────────────────────────────────────────────
// The harness compiles to CommonJS, so the async part lives in main().
async function main(): Promise<void> {
  const noSleep = () => Promise.resolve();

  // Retries a network error then succeeds.
  {
    const delays: number[] = [];
    let calls = 0;
    const result = await withRetry(
      () => {
        calls += 1;
        if (calls < 3) return Promise.reject(errWith(null));
        return Promise.resolve('ok');
      },
      { sleep: (ms) => (delays.push(ms), Promise.resolve()) }
    );
    eq('network flake recovers after 2 retries', result, 'ok');
    eq('total attempts used', calls, 3);
    eq('first backoff 300ms', delays[0], 300);
    eq('second backoff 600ms', delays[1], 600);
  }

  // 4xx throws on the very first attempt, no sleep, no retry.
  {
    const delays: number[] = [];
    const unauthorized = errWith(401);
    let calls = 0;
    let caught: unknown = null;
    try {
      await withRetry(
        () => {
          calls += 1;
          return Promise.reject(unauthorized);
        },
        { sleep: (ms) => (delays.push(ms), Promise.resolve()) }
      );
    } catch (e) {
      caught = e;
    }
    check('401 rethrown as-is (same object, not masked)', caught === (unauthorized as unknown));
    eq('only one attempt for 401', calls, 1);
    eq('no backoff delay for 401', delays.length, 0);
  }

  // Persistent 500 exhausts the budget and rethrows the LAST error.
  {
    let calls = 0;
    const last = errWith(500);
    let caught: unknown = null;
    try {
      await withRetry(
        () => {
          calls += 1;
          return Promise.reject(calls === 3 ? last : errWith(500));
        },
        { sleep: noSleep }
      );
    } catch (e) {
      caught = e;
    }
    eq('persistent 500 uses the whole budget', calls, 3);
    check('last error rethrown', caught === (last as unknown));
  }

  // A single-attempt mode never retries.
  {
    let calls = 0;
    let caught: unknown = null;
    try {
      await withRetry(
        () => {
          calls += 1;
          return Promise.reject(errWith(null));
        },
        { attempts: 1, sleep: noSleep }
      );
    } catch (e) {
      caught = e;
    }
    eq('attempts:1 runs once', calls, 1);
    check('attempts:1 rethrows', caught !== null);
  }

  // A success on the first try is returned untouched.
  {
    let calls = 0;
    const value = await withRetry(() => (calls += 1, Promise.resolve(7)), { sleep: noSleep });
    eq('first-try success returned', value, 7);
    eq('first-try success makes one call', calls, 1);
  }

  console.log(`fetchRetry: ${passed} checks, ${failures.length} failure(s)`);
  if (failures.length > 0) throw new Error(`${failures.length} fetchRetry check(s) failed`);
}

void main();
