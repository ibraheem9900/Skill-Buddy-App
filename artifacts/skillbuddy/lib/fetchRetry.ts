/**
 * fetchRetry.ts
 *
 * One retry policy for every list fetch in the app: short backoff, network
 * errors and 5xx only. A 4xx is a definitive answer from the server and is
 * re-thrown on the first attempt — retrying it can only waste the user's
 * battery and mask the real problem.
 *
 * Pure and injectable (sleep can be replaced), so the whole policy is unit
 * tested without a network (lib/__tests__/fetchRetry.test.ts).
 */

/** HTTP status of an axios-style error; null means "no response at all" (network/timeout). */
export function httpStatusOf(error: unknown): number | null {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

/** Retry only network failures (null) and server errors (5xx). */
export function isRetryableStatus(status: number | null): boolean {
  return status === null || status >= 500;
}

/**
 * Should attempt number `attempt` (0-based — how many attempts already
 * failed) be retried, given the last error's HTTP status and the total
 * budget `attempts` (default 3 = initial try + 2 retries)?
 */
export function shouldRetry(
  attempt: number,
  attempts: number,
  status: number | null
): boolean {
  if (attempt + 1 >= attempts) return false; // budget spent
  return isRetryableStatus(status);
}

export interface WithRetryOptions {
  /** Total attempts including the first one. Default 3. */
  attempts?: number;
  /** Backoff base in ms — attempt N waits baseDelayMs * 2^(N-1) (300, 600, …). */
  baseDelayMs?: number;
  /** Override the clock (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

// Declared locally so the pure-helper test tsconfig (lib: es2020, no DOM/node
// types) can compile this module; the host runtime always provides setTimeout.
declare const setTimeout: (callback: () => void, ms: number) => unknown;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` with the retry policy above. Rethrows the LAST error once the
 * budget is spent or when the error is not retryable (4xx, thrown values).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, Math.trunc(options.attempts ?? 3));
  const baseDelayMs = options.baseDelayMs ?? 300;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(baseDelayMs * 2 ** (attempt - 1));
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!shouldRetry(attempt, attempts, httpStatusOf(error))) throw error;
    }
  }
  throw lastError;
}
