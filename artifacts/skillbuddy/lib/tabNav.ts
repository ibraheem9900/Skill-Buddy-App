/**
 * The five bottom tabs, in the order they appear in the bar.
 *
 * Swipe navigation and the tab bar must never disagree about that order, so the
 * order lives here (a pure module the tests can import) instead of being
 * duplicated in the layout and in the gesture handler.
 */
export const TAB_ORDER = ['/', '/services', '/jobs', '/inbox', '/profile'] as const;

export type TabPath = (typeof TAB_ORDER)[number];

/**
 * The tab bar's height WITHOUT the device's bottom inset. Screens reserve
 * `TAB_BAR_HEIGHT + insets.bottom` of bottom padding so nothing scrolls under
 * the bar, and the layout sizes the bar itself from the same constant.
 */
export const TAB_BAR_HEIGHT = 60;

/** Strip query/trailing slashes so '/jobs/' and '/jobs' are the same tab. */
export function normalizePathname(pathname: string | null | undefined): string | null {
  if (typeof pathname !== 'string' || pathname.length === 0) return null;
  const withoutQuery = pathname.split('?')[0].split('#')[0];
  if (withoutQuery.length === 0) return '/';
  const trimmed = withoutQuery.replace(/\/+$/, '');
  return trimmed.length === 0 ? '/' : trimmed;
}

/**
 * Which tab a pathname is, or null.
 *
 * Deliberately EXACT: only the five root tab screens are swipeable. A detail
 * screen such as `/profile/edit` or `/job/12` owns its own back gesture and
 * must never be swiped sideways into a neighbouring tab.
 */
export function tabPathOf(pathname: string | null | undefined): TabPath | null {
  const normalized = normalizePathname(pathname);
  if (normalized === null) return null;
  return (TAB_ORDER as readonly string[]).includes(normalized) ? (normalized as TabPath) : null;
}

/** True when the pathname is one of the five root tab screens. */
export function isTabPath(pathname: string | null | undefined): boolean {
  return tabPathOf(pathname) !== null;
}

/** Index in TAB_ORDER, or -1 when the pathname is not a root tab. */
export function tabIndex(pathname: string | null | undefined): number {
  const tab = tabPathOf(pathname);
  return tab === null ? -1 : TAB_ORDER.indexOf(tab);
}

/**
 * The tab next to the current one: `direction` -1 = swipe right = move left in
 * the bar (Home ← Services), +1 = swipe left = move right (Services → Jobs).
 * Returns null at either end and for any non-tab screen, so the caller simply
 * does nothing rather than wrapping around.
 */
export function adjacentTabPath(
  pathname: string | null | undefined,
  direction: -1 | 1
): TabPath | null {
  const index = tabIndex(pathname);
  if (index < 0) return null;
  const next = index + direction;
  if (next < 0 || next >= TAB_ORDER.length) return null;
  return TAB_ORDER[next];
}
