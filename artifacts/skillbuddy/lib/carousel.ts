/**
 * carousel.ts — the pure rules behind AutoSlidingCarousel.
 *
 * Kept out of the component so the two behaviours that are easy to get wrong
 * are unit-tested without a device:
 *   • which slide comes next (wraps around, never returns an out-of-range index
 *     for an empty or one-slide list);
 *   • whether the timer may advance at all (paused while dragging, while the
 *     screen is not focused, while the app is in the background, and switched
 *     off entirely when the OS "reduce motion" setting is on).
 */

/** How long each slide stays on screen before the next one. */
export const CAROUSEL_INTERVAL_MS = 5000;

/** The slide after `current`, wrapping to the first one. Safe for 0/1 slides. */
export function nextCarouselIndex(current: number, count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const total = Math.floor(count);
  if (total === 1) return 0;
  const safeCurrent = Number.isFinite(current) ? Math.floor(current) : 0;
  const normalised = ((safeCurrent % total) + total) % total;
  return (normalised + 1) % total;
}

/** The index a scroll offset lands on (used after a manual swipe). */
export function indexFromOffset(offsetX: number, stride: number, count: number): number {
  if (!Number.isFinite(stride) || stride <= 0) return 0;
  if (!Number.isFinite(count) || count <= 0) return 0;
  const raw = Math.round((Number.isFinite(offsetX) ? offsetX : 0) / stride);
  return Math.min(Math.max(raw, 0), Math.floor(count) - 1);
}

export interface AutoAdvanceConditions {
  /** Number of slides (nothing to advance with fewer than two). */
  count: number;
  /** The screen owns focus (tab visible). */
  focused: boolean;
  /** AppState === 'active'. */
  appActive: boolean;
  /** The user's finger is on the carousel. */
  dragging: boolean;
  /** OS "reduce motion" accessibility setting. */
  reduceMotion: boolean;
}

/** May the auto-advance timer move the carousel right now? */
export function canAutoAdvance(conditions: AutoAdvanceConditions): boolean {
  const { count, focused, appActive, dragging, reduceMotion } = conditions;
  if (!Number.isFinite(count) || count < 2) return false;
  if (reduceMotion) return false;
  if (!focused || !appActive) return false;
  if (dragging) return false;
  return true;
}

/** Compact number for tight spots: 0, 999, 1.2k, 12k (never "1,200"). */
export function formatCompactPoints(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.max(0, Math.floor(value));
  if (n < 1000) return String(n);
  if (n < 10_000) {
    const thousands = n / 1000;
    // 1.2k (one decimal), dropping a trailing .0
    const rounded = Math.round(thousands * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}k`;
  }
  return `${Math.round(n / 1000)}k`;
}
