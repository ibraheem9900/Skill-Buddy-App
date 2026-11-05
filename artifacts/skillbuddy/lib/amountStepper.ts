/**
 * amountStepper.ts — the pure timing/step rules behind <AmountStepper>.
 *
 * Boss: "Kindly add Bid amount buttons, something similar to the time adding
 * buttons you added earlier for Any-time option." The time picker's press-and-
 * hold arrows were the reference: tap = one step, hold = repeat, then accelerate.
 *
 * SCHEDULE (exactly the spec):
 *   • the first repeat fires after 400 ms;
 *   • then every 100 ms;
 *   • from 1.5 s held, each repeat moves 500 cents instead of 100;
 *   • from 3 s held, 1000 cents;
 *   • release / blur / unmount stops it, with no timer left behind.
 */

/** Tap step: one euro. */
export const BID_STEP_CENTS = 100;
/** The three quick chips under the amount. */
export const BID_CHIPS_CENTS = [100, 500, 1000] as const;
/** Pressure thresholds for the accelerating hold. */
export const STEP_FAST_AFTER_MS = 1500;
export const STEP_FASTER_AFTER_MS = 3000;
export const STEP_FAST_CENTS = 500;
export const STEP_FASTER_CENTS = 1000;
export const STEP_FIRST_DELAY_MS = 400;
export const STEP_REPEAT_MS = 100;

/**
 * How many cents one repeat moves after `elapsedMs` of holding the button.
 * The first repeat (at 400 ms) is already 100 cents; growth starts at 1.5 s.
 */
export function repeatStepFor(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return BID_STEP_CENTS;
  if (elapsedMs >= STEP_FASTER_AFTER_MS) return STEP_FASTER_CENTS;
  if (elapsedMs >= STEP_FAST_AFTER_MS) return STEP_FAST_CENTS;
  return BID_STEP_CENTS;
}

/** The delay before the next repeat: 400 ms first, then 100 ms. */
export function nextRepeatDelay(elapsedMs: number): number {
  return elapsedMs <= 0 ? STEP_FIRST_DELAY_MS : STEP_REPEAT_MS;
}

/**
 * Move a value by one step, clamped to the window. `direction` is -1 or +1.
 * Returning the clamped value means a held button stops moving at the end
 * instead of accumulating an out-of-range number.
 */
export function stepCents(
  cents: number,
  direction: -1 | 1,
  step = BID_STEP_CENTS,
  minCents = 100,
  maxCents = 9_999_900
): number {
  const next = Math.round(cents) + direction * Math.abs(Math.round(step));
  return Math.min(Math.max(next, minCents), maxCents);
}

/** Can the minus / plus button act at all? */
export function canStep(
  cents: number,
  direction: -1 | 1,
  minCents = 100,
  maxCents = 9_999_900,
  disabled = false
): boolean {
  if (disabled) return false;
  return direction === -1 ? cents > minCents : cents < maxCents;
}

/** A shorthand: the amount in euros for a cents value, exact at 2 decimals. */
export function eurosForCents(cents: number): number {
  return Math.round(cents) / 100;
}
