/**
 * amountStepper.ts — the pure timing/step rules behind <AmountStepper>.
 *
 * Boss: "Kindly add Bid amount buttons, something similar to the time adding
 * buttons you added earlier for Any-time option." The time picker's press-and-
 * hold arrows were the reference: tap = one step, hold = repeat, then accelerate.
 *
 * SCHEDULE (exactly the spec):
 *   • every tap moves exactly €5;
 *   • the first repeat fires after 400 ms;
 *   • then every 100 ms;
 *   • from 1.5 s held, each repeat moves 500 cents instead of 100;
 *   • from 3 s held, 1000 cents;
 *   • release / blur / unmount stops it, with no timer left behind.
 *
 * Bids are whole euros in this product: the default minimum is €5 and every
 * value must be a multiple of €5. The helpers below are the one definition of
 * that rule, shared by the stepper and the submit validators.
 */

/** Tap step: five euros. */
export const BID_STEP_CENTS = 500;
/** The two quick chips under the amount: +€5 and +€10. */
export const BID_CHIPS_CENTS = [500, 1000] as const;
/** The bid unit. Every displayed/submitted bid is a multiple of this. */
export const BID_UNIT_CENTS = 500;
/** The product minimum when the job/server does not provide a higher one. */
export const BID_DEFAULT_MIN_CENTS = 500;

/** True for a positive whole-euro amount that is a multiple of €5. */
export function isMultipleOfFiveCents(cents: number): boolean {
  return Number.isInteger(cents) && cents > 0 && cents % BID_UNIT_CENTS === 0;
}

/** The nearest multiple of €5, never below the supplied minimum. */
export function nearestFiveCents(cents: number, minCents = BID_DEFAULT_MIN_CENTS): number {
  const safeMin = Math.max(BID_UNIT_CENTS, Math.round(minCents));
  const rounded = Math.round(Math.max(0, cents) / BID_UNIT_CENTS) * BID_UNIT_CENTS;
  return Math.max(safeMin, rounded);
}

/** The next multiple of €5 at or above the amount (used for prefill). */
export function roundUpFiveCents(cents: number, minCents = BID_DEFAULT_MIN_CENTS): number {
  const safeMin = Math.max(BID_UNIT_CENTS, Math.round(minCents));
  const rounded = Math.ceil(Math.max(0, cents) / BID_UNIT_CENTS) * BID_UNIT_CENTS;
  return Math.max(safeMin, rounded);
}
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
  minCents = BID_DEFAULT_MIN_CENTS,
  maxCents = 9_999_900
): number {
  const next = Math.round(cents) + direction * Math.abs(Math.round(step));
  return Math.min(Math.max(next, minCents), maxCents);
}

/** Can the minus / plus button act at all? */
export function canStep(
  cents: number,
  direction: -1 | 1,
  minCents = BID_DEFAULT_MIN_CENTS,
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
