/**
 * Geometry for the finger-tracking tab pager.
 *
 * Everything animated during a swipe is derived from ONE continuous value:
 * `position`, the pager's offset in tab units (0 = Home, 1 = Services, …,
 * 4 = Profile, including fractions while a finger is down). The pager itself
 * lives in `react-native-tab-view` (backed by `react-native-pager-view`), and
 * the tab bar reads the same Animated value, so pages and bar can never drift.
 *
 * The ranges below are the single source of truth for that mapping; the
 * components feed them straight into `position.interpolate(...)`, and the tests
 * sample the same ranges so the visual contract is covered without rendering.
 */

export const TAB_COUNT = 5;

/** The active pill behind an icon (same size as the pre-pager design). */
export const TAB_PILL_WIDTH = 44;
export const TAB_PILL_HEIGHT = 28;

/** How far the incoming icon lifts while it becomes active. */
export const TAB_ICON_SCALE_MAX = 1.1;
/** ±window (in tab units) around a tab's index where its lift is visible. */
export const TAB_ICON_LIFT_WINDOW = 0.7;

/** Page polish at the far end of a swipe. Deliberately small. */
export const PAGE_SCALE_MIN = 0.972;
export const PAGE_OPACITY_MIN = 0.86;
/** Maximum horizontal parallax (px) applied while dragging. */
export const PAGE_PARALLAX_PX = 10;

/** Vertical lift (px) of the incoming icon at full selection. */
export const TAB_ICON_LIFT_PX = 2;

export type Range = {
  inputRange: number[];
  outputRange: number[];
  extrapolate: 'clamp';
};

/** Linear interpolation with clamping — mirrors `Animated`/`Reanimated`. */
export function sampleRange(range: Range, value: number): number {
  const { inputRange, outputRange } = range;
  if (value <= inputRange[0]) return outputRange[0];
  const last = inputRange.length - 1;
  if (value >= inputRange[last]) return outputRange[last];
  for (let i = 1; i <= last; i += 1) {
    const a = inputRange[i - 1];
    const b = inputRange[i];
    if (value <= b) {
      const t = b === a ? 0 : (value - a) / (b - a);
      return outputRange[i - 1] + (outputRange[i] - outputRange[i - 1]) * t;
    }
  }
  return outputRange[last];
}

/**
 * Where the active pill sits for each tab, as a `left` offset so the pill's
 * CENTRE lands on the middle of the tab's slot. Every tab is an equal slice of
 * the bar's full width, so the bar needs no per-item measurement.
 */
export function pillLeftRange(
  count: number,
  width: number,
  pillWidth = TAB_PILL_WIDTH
): Range {
  const slot = count > 0 ? width / count : 0;
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  for (let i = 0; i < count; i += 1) {
    inputRange.push(i);
    outputRange.push(slot * (i + 0.5) - pillWidth / 2);
  }
  return { inputRange, outputRange, extrapolate: 'clamp' };
}

/** 0 → 1 → 0 fill of the icon whose index is `index`, over one tab either side. */
export function iconFillRange(index: number): Range {
  return {
    inputRange: [index - 1, index, index + 1],
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  };
}

/** Scale lift of the incoming icon, peaking when its tab is active. */
export function iconScaleRange(index: number): Range {
  return {
    inputRange: [
      index - TAB_ICON_LIFT_WINDOW,
      index,
      index + TAB_ICON_LIFT_WINDOW,
    ],
    outputRange: [1, TAB_ICON_SCALE_MAX, 1],
    extrapolate: 'clamp',
  };
}

/** 0 → 1 → 0 vertical-lift weight for the incoming icon. */
export function iconLiftRange(index: number): Range {
  return {
    inputRange: [
      index - TAB_ICON_LIFT_WINDOW,
      index,
      index + TAB_ICON_LIFT_WINDOW,
    ],
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  };
}

/** The outgoing page fades as it leaves; the incoming page fades back in. */
export function pageOpacityRange(index: number): Range {
  return {
    inputRange: [index - 1, index, index + 1],
    outputRange: [PAGE_OPACITY_MIN, 1, PAGE_OPACITY_MIN],
    extrapolate: 'clamp',
  };
}

/** The outgoing page recedes slightly; the incoming page grows back to full. */
export function pageScaleRange(index: number): Range {
  return {
    inputRange: [index - 1, index, index + 1],
    outputRange: [PAGE_SCALE_MIN, 1, PAGE_SCALE_MIN],
    extrapolate: 'clamp',
  };
}

/**
 * Horizontal parallax offset (px) for a page.
 *
 * While the finger is down, both the page being left and the page being
 * revealed lag a few pixels behind the pager's 1:1 movement, which is what
 * reads as depth. The sign follows the drag direction, and the whole offset is
 * scaled by how far the pager is from the ACTIVE tab so that at rest — or on
 * the off-screen neighbour — it is exactly zero (no sliver at the screen edge).
 */
export function parallaxPx(
  position: number,
  index: number,
  activeIndex: number,
  amount = PAGE_PARALLAX_PX
): number {
  const drag = Math.min(1, Math.abs(position - activeIndex));
  const distance = Math.min(1, Math.abs(position - index));
  const direction = position >= activeIndex ? 1 : -1;
  return direction * distance * drag * amount;
}

/** True when `value` is close enough to `index` to be considered settled. */
export function isSettled(position: number, index: number): boolean {
  return Math.abs(position - index) < 0.001;
}
