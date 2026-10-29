/**
 * servicePrice.ts
 *
 * Price helpers for the server's `ServiceListResponse` items, whose
 * `price_from` / `price_to` arrive as NULLABLE NUMERIC STRINGS (the live
 * OpenAPI declares them with the pattern `^(?!^[-+.]*$)[+-]?0*\d*\.?\d*$`),
 * never as numbers. The docs' Example Value shows astronomically long values
 * — that is the unconstrained example generator, not real data.
 *
 * Shared by BOTH server-backed surfaces that render these items:
 *   - GET /api/v1/services                     (the Services tab)
 *   - GET /api/v1/categories/{category_id}/services
 *
 * Parsing reuses `parseAmountSpent` — the app's existing defensive
 * decimal-string parser from useClientProfile (returns null for
 * null/empty/non-finite input). Display matches the app's existing service
 * price style, `€${n.toFixed(2)}`, exactly as components/ServiceCard.tsx
 * renders service prices.
 */
import { parseAmountSpent } from '@/lib/amounts';

/**
 * Parsed price bound as a number, or null when the value is absent/unusable.
 * Guards the docs' absurd generator values two ways:
 *  - MAX_PRICE_INPUT_CHARS: the OpenAPI pattern `0*\d*\.?\d*` allows unbounded
 *    leading zeros, and the example generator emits 300-digit strings. A
 *    string that long is garbage even when all zeros (Number('000…0') === 0,
 *    which would otherwise render as a bogus "€0.00+"). No real price exceeds
 *    15 characters.
 *  - €1bn sanity bound: `toFixed()` renders anything above 1e21 in exponential
 *    notation, so huge nonzero values are rejected too.
 */
const MAX_PRICE_INPUT_CHARS = 15;

export function parseServicePrice(raw: string | null | undefined): number | null {
  if (typeof raw === 'string' && raw.trim().length > MAX_PRICE_INPUT_CHARS) return null;
  const n = parseAmountSpent(raw);
  if (n === null) return null;
  if (Math.abs(n) > 1e9) return null;
  return n;
}

/** Format ONE price bound as EUR, or null when there is nothing usable. */
export function formatPriceAmount(raw: string | null | undefined): string | null {
  const n = parseServicePrice(raw);
  return n === null ? null : `€${n.toFixed(2)}`;
}

/**
 * Hourly price labels (Fix 1d).
 *
 * Every service price in this catalog is PER HOUR (boss: "Kindly write the
 * price as €15.00/h - €25.00/h"). The API exposes NO unit field — verified
 * against the live OpenAPI and a live GET /api/v1/services (the keys are only
 * price_from/price_to/price_range) — so nothing in the data says "fixed price"
 * and appending /h cannot mislabel a documented unit. If a unit field ever
 * appears, this is the one place to branch on it.
 *
 *   both bounds  → "€15.00/h – €25.00/h" (single value when equal)
 *   minimum only → "From €15.00/h" (the label is translated by the caller)
 *   maximum only → "€25.00/h"
 *   neither      → null
 */
export interface HourlyPriceOptions {
  /** Currency symbol, default "€". */
  currency?: string;
  /** Translated "From" prefix for a minimum-only range. */
  fromLabel?: string;
}

function numericPrice(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return parseServicePrice(value);
}

/** "€15.00/h – €25.00/h" from two bounds (strings or numbers). */
export function formatHourlyPriceRange(
  min: string | number | null | undefined,
  max: string | number | null | undefined,
  options: HourlyPriceOptions = {}
): string | null {
  const from = numericPrice(min);
  const to = numericPrice(max);
  if (from === null && to === null) return null;

  const currency = options.currency ?? '€';
  const hourly = (n: number) => `${currency}${n.toFixed(2)}/h`;

  if (from !== null && to !== null) {
    return from === to ? hourly(from) : `${hourly(from)} – ${hourly(to)}`;
  }
  if (from !== null) {
    const prefix = options.fromLabel ?? 'From';
    return `${prefix} ${hourly(from)}`;
  }
  return hourly(to as number);
}

/**
 * Hourly label for a server service item, with the server's own `price_range`
 * as a LAST resort. That fallback is shown exactly as the server wrote it: a
 * label whose unit we do not know must never get an invented "/h".
 */
export function formatServiceHourlyPrice(
  item: {
    price_from?: string | null;
    price_to?: string | null;
    price_range?: string | null;
  },
  fromLabel?: string
): string | null {
  const range = formatHourlyPriceRange(item.price_from, item.price_to, { fromLabel });
  if (range) return range;
  const label = typeof item.price_range === 'string' ? item.price_range.trim() : '';
  return label.length > 0 ? label : null;
}

/**
 * Build the display label for an item's price.
 *  - both bounds     → "€10.00 – €25.00" (or a single value when equal)
 *  - lower only      → "€10.00+"
 *  - upper only      → "€25.00"
 *  - neither numeric → the server's own `price_range` string, if present
 *  - nothing usable  → null (caller hides the price row)
 */
export function formatServicePrice(
  item: { price_from?: string | null; price_to?: string | null; price_range?: string | null }
): string | null {
  const from = formatPriceAmount(item.price_from);
  const to = formatPriceAmount(item.price_to);
  if (from && to) return from === to ? from : `${from} – ${to}`;
  if (from) return `${from}+`;
  if (to) return to;
  const label = typeof item.price_range === 'string' ? item.price_range.trim() : '';
  return label.length > 0 ? label : null;
}
