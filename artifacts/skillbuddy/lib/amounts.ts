/**
 * amounts.ts — the app's ONE defensive parser for the decimal STRINGS the API
 * sends (`total_amount_spent`, `price_from`, `price_to`, balances).
 *
 * It used to live in hooks/useClientProfile.ts, which made every pure consumer
 * (lib/servicePrice.ts) pull in a React hook — and made it impossible to unit
 * test the price formatter without React. The logic is unchanged; the hook now
 * re-exports it so existing imports keep working.
 */

/** A finite number from the schema's decimal string, or null. */
export function parseAmountSpent(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Format the parsed amount as EUR currency for display (never the raw string). */
export function formatAmountSpent(raw: string | null | undefined): string {
  const n = parseAmountSpent(raw);
  if (n === null) return '—';
  return `€${n.toLocaleString('en-EU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
