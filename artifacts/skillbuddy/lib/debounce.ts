/**
 * A small trailing debounce helper for screens that react to bursts of realtime
 * events (a bid stream can repeat the same event: `job.bidding_closed` arrives
 * about every 25s while a job is OPEN with an expired window, and handlers must
 * be idempotent — debouncing keeps the REST refetch to one call per burst).
 *
 * Rules:
 *   - trailing: the callback runs once, after `waitMs` of silence;
 *   - the LAST arguments win (the latest event is the one acted on);
 *   - `cancel()` drops a pending call without running it;
 *   - `flush()` runs it immediately if one is pending;
 *   - timers are injected, so the behaviour is unit testable without wall-clock
 *     waits and so callers can share one scheduler.
 *
 * No React, no side effects beyond the injected timer.
 */

/** Default quiet period. Must stay inside the 300–500 ms band. */
export const DEBOUNCE_DEFAULT_MS = 350;

export type DebounceHandle = unknown;

export interface DebounceTimerApi {
  schedule: (run: () => void, delayMs: number) => DebounceHandle;
  cancel: (handle: DebounceHandle) => void;
}

export interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  /** Drop a pending trailing call. */
  cancel: () => void;
  /** Run a pending trailing call now (no-op when nothing is pending). */
  flush: () => void;
  /** True while a trailing call is waiting. */
  isPending: () => boolean;
}

/**
 * Wrap `callback` so it only runs `waitMs` after the last call.
 * `waitMs` is clamped into the [300, 500] band the screens use.
 */
export function debounce<Args extends unknown[]>(
  callback: (...args: Args) => void,
  waitMs: number = DEBOUNCE_DEFAULT_MS,
  timers: DebounceTimerApi
): Debounced<Args> {
  const wait = Math.min(500, Math.max(300, Math.round(waitMs)));
  let handle: DebounceHandle | null = null;
  let pendingArgs: Args | null = null;

  const clear = () => {
    if (handle === null) return;
    const current = handle;
    handle = null;
    timers.cancel(current);
  };

  const invoke = () => {
    const args = pendingArgs;
    pendingArgs = null;
    handle = null;
    if (args === null) return;
    callback(...args);
  };

  const debounced = ((...args: Args) => {
    pendingArgs = args;
    clear();
    handle = timers.schedule(invoke, wait);
  }) as Debounced<Args>;

  debounced.cancel = () => {
    clear();
    pendingArgs = null;
  };

  debounced.flush = () => {
    if (handle === null && pendingArgs === null) return;
    clear();
    invoke();
  };

  debounced.isPending = () => handle !== null;

  return debounced;
}
