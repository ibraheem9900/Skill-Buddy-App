import {
  BID_CHIPS_CENTS,
  BID_STEP_CENTS,
  STEP_FAST_AFTER_MS,
  STEP_FAST_CENTS,
  STEP_FASTER_AFTER_MS,
  STEP_FASTER_CENTS,
  STEP_FIRST_DELAY_MS,
  STEP_REPEAT_MS,
  canStep,
  eurosForCents,
  nextRepeatDelay,
  repeatStepFor,
  stepCents,
} from '../amountStepper';

/**
 * The press-and-hold schedule behind <AmountStepper> (same feel as the old
 * Anytime time-picker arrows): tap = €1, hold = 400 ms then every 100 ms,
 * accelerating to €5 after 1.5 s and €10 after 3 s.
 */

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function eq<T>(label: string, actual: T, expected: T) {
  if (actual === expected) passed += 1;
  else failures.push(`${label} (got ${String(actual)}, want ${String(expected)})`);
}

/* ── Constants ────────────────────────────────────────────────────────────── */

eq('a tap is one euro', BID_STEP_CENTS, 100);
eq('three chips: €1, €5, €10', BID_CHIPS_CENTS.join(','), '100,500,1000');
eq('first repeat at 400 ms', STEP_FIRST_DELAY_MS, 400);
eq('then every 100 ms', STEP_REPEAT_MS, 100);

/* ── The accelerating step ────────────────────────────────────────────────── */

eq('a fresh press moves €1', repeatStepFor(0), 100);
eq('still €1 just before 1.5 s', repeatStepFor(1499), 100);
eq('€5 from 1.5 s', repeatStepFor(1500), STEP_FAST_CENTS);
eq('still €5 just before 3 s', repeatStepFor(2999), STEP_FAST_CENTS);
eq('€10 from 3 s', repeatStepFor(3000), STEP_FASTER_CENTS);
eq('€10 stays after 3 s', repeatStepFor(10_000), STEP_FASTER_CENTS);
eq('a negative elapsed is treated as a tap', repeatStepFor(-50), 100);
eq('NaN is treated as a tap', repeatStepFor(Number.NaN), 100);
eq('the thresholds are ordered', STEP_FAST_AFTER_MS < STEP_FASTER_AFTER_MS, true);

/* ── Repeat timing ────────────────────────────────────────────────────────── */

eq('the first repeat waits 400 ms', nextRepeatDelay(0), 400);
eq('later repeats wait 100 ms', nextRepeatDelay(400), 100);
eq('later repeats keep waiting 100 ms', nextRepeatDelay(3000), 100);

/* ── Stepping ─────────────────────────────────────────────────────────────── */

eq('plus moves up one euro', stepCents(2998, 1), 3098);
eq('minus moves down one euro', stepCents(2998, -1), 2898);
eq('a chip can move €5', stepCents(2998, 1, 500), 3498);
eq('minus stops at the minimum', stepCents(150, -1, 100, 100, 9_999_900), 100);
eq('plus stops at the maximum', stepCents(9_999_850, 1, 100, 100, 9_999_900), 9_999_900);
eq('never below the minimum', stepCents(100, -1, 1000, 100, 9_999_900), 100);
eq('a fractional value is rounded before stepping', stepCents(2998.6, 1), 3099);
eq('a custom window is honoured', stepCents(5000, 1, 100, 1000, 5100), 5100);

/* ── Button availability ──────────────────────────────────────────────────── */

eq('minus is disabled at the minimum', canStep(100, -1, 100, 9_999_900), false);
eq('minus works above the minimum', canStep(200, -1, 100, 9_999_900), true);
eq('plus is disabled at the maximum', canStep(9_999_900, 1, 100, 9_999_900), false);
eq('plus works below the maximum', canStep(9_999_800, 1, 100, 9_999_900), true);
eq('a submitting stepper is frozen', canStep(5000, 1, 100, 9_999_900, true), false);
eq('a submitting stepper freezes minus too', canStep(5000, -1, 100, 9_999_900, true), false);

/* ── The euro amount ──────────────────────────────────────────────────────── */

eq('cents become an exact euro amount', eurosForCents(2998), 29.98);
eq('the float garbage is not possible from cents', String(eurosForCents(2998)), '29.98');

if (failures.length > 0) {
  console.log(`amountStepper: ${passed} checks, ${failures.length} failure(s) — ${failures.join(', ')}`);
  throw new Error(`${failures.length} amountStepper check(s) failed`);
}
console.log(`amountStepper: ${passed} checks, 0 failure(s)`);
