/**
 * Unit tests for the shared trailing debounce helper (lib/debounce.ts) that
 * later realtime screens use to fold bursts of events into one REST refetch.
 *
 * Run through the project's own harness: `pnpm run test`. Timers are injected,
 * so nothing here waits on the wall clock.
 */
import { DEBOUNCE_DEFAULT_MS, debounce, type DebounceHandle, type DebounceTimerApi } from '../debounce';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

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

interface FakeTimer {
  run: () => void;
  delayMs: number;
  cancelled: boolean;
  fired: boolean;
}

class Clock {
  readonly timers: FakeTimer[] = [];

  readonly api: DebounceTimerApi = {
    schedule: (run, delayMs) => {
      const handle: FakeTimer = { run, delayMs, cancelled: false, fired: false };
      this.timers.push(handle);
      return handle;
    },
    cancel: (handle: DebounceHandle) => {
      (handle as FakeTimer).cancelled = true;
    },
  };

  get pending(): FakeTimer | null {
    for (let i = this.timers.length - 1; i >= 0; i -= 1) {
      if (!this.timers[i].cancelled && !this.timers[i].fired) return this.timers[i];
    }
    return null;
  }

  /** Fire the newest timer that is still waiting. */
  fire(): void {
    const timer = this.pending;
    if (!timer) return;
    timer.fired = true;
    timer.run();
  }

  delays(): number[] {
    return this.timers.map((timer) => timer.delayMs);
  }
}

/* ------------------------------------------------------------ trailing call */

const clock = new Clock();
const calls: number[] = [];
const debounced = debounce((value: number) => calls.push(value), 400, clock.api);

debounced(1);
eq('nothing runs before the quiet period', calls.length, 0);
eq('the scheduled delay honours the requested wait', clock.delays()[0], 400);

debounced(2);
debounced(3);
eq('a burst reschedules instead of running', calls.length, 0);
eq('each burst entry schedules its own timer', clock.timers.length, 3);
eq('the superseded timers are cancelled', clock.timers[0].cancelled, true);
eq('the superseded timers are cancelled (second)', clock.timers[1].cancelled, true);
eq('only the newest timer is still pending', clock.timers[2].cancelled, false);

clock.fire();
eq('the burst collapses into exactly one call', calls.length, 1);
eq('the LAST arguments win', calls[0], 3);
eq('nothing is pending after firing', debounced.isPending(), false);
eq('isPending is true while waiting', (debounced(4), debounced.isPending()), true);

/* ------------------------------------------------------------------ cancel */

debounced(5);
debounced.cancel();
eq('cancel drops the pending call', calls.length, 1);
eq('the cancelled timer is marked cancelled', clock.pending === null, true);
eq('after cancel nothing is pending', debounced.isPending(), false);

/* ------------------------------------------------------------------- flush */

debounced(6);
eq('flush has something to run', debounced.isPending(), true);
debounced.flush();
eq('flush runs the pending call immediately', calls[calls.length - 1], 6);
eq('flush clears the pending state', debounced.isPending(), false);
const beforeIdleFlush = calls.length;
debounced.flush();
eq('flush with nothing pending is a no-op', calls.length, beforeIdleFlush);

/* ------------------------------------------------------- the 300-500ms band */

const bandClock = new Clock();
const band = debounce(() => undefined, 10, bandClock.api);
band();
eq('a too-small wait is clamped up to 300ms', bandClock.delays()[0], 300);

const bandClock2 = new Clock();
const band2 = debounce(() => undefined, 5000, bandClock2.api);
band2();
eq('a too-large wait is clamped down to 500ms', bandClock2.delays()[0], 500);

const defaultClock = new Clock();
const defaulted = debounce(() => undefined, undefined, defaultClock.api);
defaulted();
check(
  'the default wait sits in the 300-500ms band',
  DEBOUNCE_DEFAULT_MS >= 300 && DEBOUNCE_DEFAULT_MS <= 500
);
eq('the default wait is the one that is scheduled', defaultClock.delays()[0], DEBOUNCE_DEFAULT_MS);

/* --------------------------------------------- separate instances, own clocks */

const clockA = new Clock();
const clockB = new Clock();
const runsA: string[] = [];
const runsB: string[] = [];
const a = debounce(() => runsA.push('a'), 350, clockA.api);
const b = debounce(() => runsB.push('b'), 350, clockB.api);
a();
b();
clockA.fire();
eq('one instance fires on its own clock only', runsA.length, 1);
eq('the other instance is untouched', runsB.length, 0);
clockB.fire();
eq('the other instance fires on its own clock', runsB.length, 1);

/* ------------------------------------------------------------------ report */

for (const failure of failures) console.log(`  x ${failure}`);
console.log(`debounce: ${passed}/${passed + failures.length} assertions passed`);
