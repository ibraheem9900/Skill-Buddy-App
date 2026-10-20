/**
 * clockMath.ts
 *
 * The geometry and stepping rules behind the clock picker, kept free of React so
 * every rule is unit-testable (that is what the dialog's "needle jumps around"
 * bug needed: one place that DERIVES an angle from a value, never accumulates
 * one).
 *
 * Conventions
 *  - 0° is 12 o'clock, angles grow CLOCKWISE (screen y grows downward).
 *  - An angle is always the SHORTEST one for a value: hour 12 → 0°, hour 3 → 90°,
 *    minute 55 → 330° (never 390°), so the hand can never spin the long way
 *    round when the value crosses 12 o'clock or 59 → 0.
 *  - Hours are handled as the 12-hour dial value (1..12); the AM/PM half of the
 *    reading is the caller's state and is never touched here.
 */

/** The two dial modes. */
export type DialMode = 'hour' | 'minute';

/** Decimal degrees in [0, 360). */
export function normalizeDegrees(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Angle of the hand for a 12-hour value (1..12), 0° at 12 o'clock. */
export function angleForHour(hour12: number): number {
  const safe = Number.isFinite(hour12) ? Math.trunc(hour12) % 12 : 0;
  return normalizeDegrees(safe * 30);
}

/** Angle of the hand for a minute value (0..59). */
export function angleForMinute(minute: number): number {
  const safe = Number.isFinite(minute) ? Math.trunc(minute) : 0;
  return normalizeDegrees(safe * 6);
}

/** Angle of the hand for the ACTIVE mode. */
export function angleForValue(value: number, mode: DialMode): number {
  return mode === 'hour' ? angleForHour(value) : angleForMinute(value);
}

/**
 * Angle (0..360, clockwise from 12) of a touch point relative to the dial
 * centre. atan2 with x first and -y second gives 0 at 12 o'clock and grows
 * clockwise; the result is normalized so a drag across 12 o'clock never yields a
 * negative angle that would flip the hand.
 */
export function angleForPoint(dx: number, dy: number): number {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
  return normalizeDegrees((Math.atan2(dx, -dy) * 180) / Math.PI);
}

/**
 * The 12-hour dial value nearest to an angle. 0°/359° → 12, 90° → 3, 180° → 6.
 * The +/-15° window around each 30° tick means a tap anywhere on the dial picks
 * the CLOSEST label instead of requiring a precise hit.
 */
export function hourFromAngle(deg: number): number {
  const tick = Math.round(normalizeDegrees(deg) / 30) % 12;
  return tick === 0 ? 12 : tick;
}

/** The minute nearest to an angle, snapped to `step` (5 on the dial). */
export function minuteFromAngle(deg: number, step = 5): number {
  const safeStep = Number.isFinite(step) && step > 0 ? Math.trunc(step) : 5;
  const snapped = Math.round(normalizeDegrees(deg) / 6 / safeStep) * safeStep;
  return ((snapped % 60) + 60) % 60;
}

/** Value of the dial for a touch point, in the active mode. */
export function valueFromPoint(dx: number, dy: number, mode: DialMode, step = 5): number {
  const deg = angleForPoint(dx, dy);
  return mode === 'hour' ? hourFromAngle(deg) : minuteFromAngle(deg, step);
}

/** Is the touch point far enough from the centre to be a real direction? */
export function isOutsideDeadZone(dx: number, dy: number, deadZone = 10): boolean {
  return Math.hypot(dx, dy) >= deadZone;
}

/**
 * Step the 12-hour dial value by ±1, wrapping 12 → 1 and 1 → 12. The 24-hour
 * value (and therefore AM/PM) is untouched: this only moves the dial value.
 */
export function stepHour12(hour12: number, delta: number): number {
  const current = Number.isFinite(hour12) ? Math.trunc(hour12) : 12;
  const base = ((current % 12) + 12) % 12; // 12 → 0
  const next = (((base + Math.trunc(delta)) % 12) + 12) % 12;
  return next === 0 ? 12 : next;
}

/**
 * Step the minutes by ±1, wrapping 59 → 0 and 0 → 59 WITHOUT changing the hour.
 * A step of 5 is used by tests for the dial's own granularity.
 */
export function stepMinute(minute: number, delta: number): number {
  const current = Number.isFinite(minute) ? Math.trunc(minute) : 0;
  return ((((current + Math.trunc(delta)) % 60) + 60) % 60);
}

/**
 * The shortest signed turn (in degrees, -180..180) from one angle to another.
 * Used to keep the hand still when a new value is only a few degrees away.
 */
export function shortestTurn(from: number, to: number): number {
  const diff = normalizeDegrees(to) - normalizeDegrees(from);
  if (diff > 180) return diff - 360;
  if (diff < -180) return diff + 360;
  return diff;
}

/** 5-minute-aligned minute value (the dial's own granularity). */
export function snapMinute(minute: number, step = 5): number {
  const safe = Number.isFinite(minute) ? Math.trunc(minute) : 0;
  const safeStep = Number.isFinite(step) && step > 0 ? Math.trunc(step) : 5;
  return ((Math.round(safe / safeStep) * safeStep) % 60 + 60) % 60;
}
