/**
 * money.ts — ALL money arithmetic in integer cents.
 *
 * THE BUG (boss screenshot, "Place Your Bid"): the price field held
 * "29.97833444215889632447" — twenty decimals of a floating-point number. Money
 * must never be handled as an unrounded binary fraction, not even in a text
 * field that a later step parses.
 *
 * ONE parser, one formatter, one clamp:
 *   parseMoneyToCents("12,5")  → 1250
 *   parseMoneyToCents("29.97833444215889632447") → 2998   (half-up to cents)
 *   parseMoneyToCents("1.234,56") → 123456
 *   formatCents(2998) → "29.98"
 *
 * Negative amounts, letters and empty strings return null; callers decide
 * whether that is an error or "no value yet".
 */

/** €0.01 — the schema's exclusiveMinimum 0 for offered_price. */
export const MIN_MONEY_CENTS = 1;
/** A generous ceiling; no real bid is near it. */
export const MAX_MONEY_CENTS = 999_999_900;

const CURRENCY_SYMBOLS = /[€$£]/g;
/** Any whitespace, including the NBSP and thin space used as thousands gaps. */
const ALL_SPACES = /[\s\u00a0\u202f]/g;

/** Strip currency symbols and whitespace; keep digits and one separator group. */
function cleanMoney(input: unknown): string {
  if (typeof input === 'number') return Number.isFinite(input) ? String(input) : '';
  if (typeof input !== 'string') return '';
  return input.replace(CURRENCY_SYMBOLS, '').replace(ALL_SPACES, '').trim();
}

/**
 * A money string or number as integer cents, rounded HALF UP.
 *
 * Accepted shapes: "12", "12.5", "12,5", "12.50", ".75", "12.", "1.234,56",
 * "1,234.56", "€12.50". The LAST separator is the decimal point when both are
 * present, and any earlier separator is read as a thousands gap — so a pasted
 * value can never be off by 1000×. More than two decimals are rounded, not
 * rejected: the displayed/stored value is always exact cents.
 */
export function parseMoneyToCents(input: string | number | null | undefined): number | null {
  const cleaned = cleanMoney(input);
  if (cleaned.length === 0 || cleaned.length > 24) return null;
  if (/[^0-9.,-]/.test(cleaned)) return null;
  if (cleaned.startsWith('-')) return null; // money here is never negative

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let whole = cleaned;
  let fraction = '';

  if (lastDot !== -1 && lastComma !== -1) {
    const decimalIndex = Math.max(lastDot, lastComma);
    whole = cleaned.slice(0, decimalIndex);
    fraction = cleaned.slice(decimalIndex + 1);
    whole = whole.replace(/[.,]/g, '');
  } else if (lastDot !== -1 || lastComma !== -1) {
    const index = Math.max(lastDot, lastComma);
    whole = cleaned.slice(0, index);
    fraction = cleaned.slice(index + 1);
  }

  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return null;
  if (whole === '' && fraction === '') return null;

  const wholeNumber = Number(whole || '0');
  if (!Number.isSafeInteger(wholeNumber)) return null;

  // Round half up at the cent boundary: "29.97833…" → 2998, "0.005" → 1.
  const fractionDigits = fraction.slice(0, 2).padEnd(2, '0');
  const cents = wholeNumber * 100 + Number(fractionDigits || '0');
  if (!Number.isSafeInteger(cents)) return null;

  const thirdDigit = fraction.length > 2 ? Number(fraction[2]) : 0;
  const rest = fraction.slice(3);
  const roundUp = thirdDigit > 5 || (thirdDigit === 5 && (/[1-9]/.test(rest) || Number(fraction[2] ?? '0') === 5));
  return cents + (roundUp ? 1 : 0);
}

/** Integer cents as the field's dot form with exactly 2 decimals: "29.98". */
export function formatCents(cents: number | null | undefined): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return '';
  const safe = Math.round(cents);
  return (safe / 100).toFixed(2);
}

/** The number that goes on the wire — exact at 2 decimals because it comes from cents. */
export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

/** Keep a value inside a [min, max] cent window. */
export function clampCents(cents: number, minCents = MIN_MONEY_CENTS, maxCents = MAX_MONEY_CENTS): number {
  if (!Number.isFinite(cents)) return minCents;
  return Math.min(Math.max(Math.round(cents), minCents), maxCents);
}

/** True when this many cents can be shown/edited at all. */
export function isValidCents(cents: number | null | undefined): cents is number {
  return typeof cents === 'number' && Number.isInteger(cents) && cents >= MIN_MONEY_CENTS && cents <= MAX_MONEY_CENTS;
}
