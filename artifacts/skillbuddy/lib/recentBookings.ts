/**
 * recentBookings.ts — "most recent first, at most N" for Home's Recent
 * Bookings list (Fix 2a).
 *
 * The endpoint (GET /api/v1/clients/bookings) returns the client's bookings in
 * an order the app must not rely on, and booking items are opaque (fields read
 * defensively via lib/bookingFields), so this helper takes the date EXTRACTOR
 * from the caller and does the ordering itself:
 *   • newest first;
 *   • a booking without a parseable date goes after the dated ones (it cannot
 *     be "recent", and it must not jump to the top just because it is invalid);
 *   • ties keep their incoming order (stable sort);
 *   • the list is capped, default 3.
 *
 * Pure and unit tested.
 */

export type DateExtractor<T> = (item: T) => string | null | undefined;

/** Epoch ms for a date-ish value, or null when it cannot be understood. */
function timestamp(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = new Date(value.trim()).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

/** Newest first, undated last, stable. Does not mutate the input. */
export function sortByRecency<T>(items: readonly T[], getDate: DateExtractor<T>): T[] {
  return items
    .map((item, index) => ({ item, index, at: timestamp(getDate(item)) }))
    .sort((a, b) => {
      if (a.at === null && b.at === null) return a.index - b.index;
      if (a.at === null) return 1;
      if (b.at === null) return -1;
      if (b.at !== a.at) return b.at - a.at;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/** The newest `limit` bookings (default 3). */
export function recentBookings<T>(
  items: readonly T[],
  getDate: DateExtractor<T>,
  limit = 3
): T[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const capped = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (capped === 0) return [];
  return sortByRecency(items, getDate).slice(0, capped);
}
