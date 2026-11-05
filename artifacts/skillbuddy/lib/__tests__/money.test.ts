import {
  MAX_MONEY_CENTS,
  MIN_MONEY_CENTS,
  centsToAmount,
  clampCents,
  formatCents,
  isValidCents,
  parseMoneyToCents,
} from '../money';

/**
 * Money is INTEGER CENTS end to end. The bug this closes: the bid field held
 * "29.97833444215889632447" — twenty decimals of a float.
 */

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function eq<T>(label: string, actual: T, expected: T) {
  if (actual === expected) passed += 1;
  else failures.push(`${label} (got ${String(actual)}, want ${String(expected)})`);
}

/* ── Parsing ──────────────────────────────────────────────────────────────── */

eq('whole euros', parseMoneyToCents('12'), 1200);
eq('a dot decimal', parseMoneyToCents('12.5'), 1250);
eq('a comma decimal', parseMoneyToCents('12,5'), 1250);
eq('two decimals', parseMoneyToCents('12.50'), 1250);
eq('a leading dot', parseMoneyToCents('.75'), 75);
eq('a trailing dot', parseMoneyToCents('12.'), 1200);
eq('a currency symbol is ignored', parseMoneyToCents('€12.50'), 1250);
eq('a space thousands gap', parseMoneyToCents('1 234,56'), 123456);
eq('a dot thousands gap with a comma decimal', parseMoneyToCents('1.234,56'), 123456);
eq('a comma thousands gap with a dot decimal', parseMoneyToCents('1,234.56'), 123456);

/* THE REPORTED VALUE: twenty decimals, rounded half up to cents. */
eq('the 20-decimal float rounds to €29.98', parseMoneyToCents('29.97833444215889632447'), 2998);
eq('half a cent rounds up', parseMoneyToCents('0.005'), 1);
eq('just under half a cent rounds down', parseMoneyToCents('0.0049'), 0);
eq('a number works too', parseMoneyToCents(29.978334442158896), 2998);

/* ── Rejections ───────────────────────────────────────────────────────────── */

eq('empty is no value', parseMoneyToCents(''), null);
eq('blank is no value', parseMoneyToCents('   '), null);
eq('letters are refused', parseMoneyToCents('abc'), null);
eq('mixed junk is refused', parseMoneyToCents('12x5'), null);
eq('a negative is refused', parseMoneyToCents('-5'), null);
eq('two separators of the same kind', parseMoneyToCents('1.2.3'), null);
eq('null is no value', parseMoneyToCents(null), null);
eq('NaN is no value', parseMoneyToCents(Number.NaN), null);

/* ── Formatting ───────────────────────────────────────────────────────────── */

eq('cents format with 2 decimals', formatCents(2998), '29.98');
eq('whole euros keep .00', formatCents(1200), '12.00');
eq('one cent', formatCents(1), '0.01');
eq('nothing formats to empty', formatCents(null), '');
eq('a round-trip is stable', parseMoneyToCents(formatCents(2998)), 2998);

/* ── The wire value ───────────────────────────────────────────────────────── */

eq('the wire amount is exact', centsToAmount(2998), 29.98);
eq('the wire amount never has 20 decimals', String(centsToAmount(2998)), '29.98');

/* ── Clamping ─────────────────────────────────────────────────────────────── */

eq('below the minimum clamps up', clampCents(0, 100, 9_999_900), 100);
eq('above the maximum clamps down', clampCents(20_000_000, 100, 9_999_900), 9_999_900);
eq('inside the window is untouched', clampCents(2998, 100, 9_999_900), 2998);
eq('a fractional cent is rounded', clampCents(2998.6, 100, 9_999_900), 2999);

eq('the minimum is €0.01', MIN_MONEY_CENTS, 1);
eq('a valid value passes', isValidCents(2998), true);
eq('zero is below the minimum', isValidCents(0), false);
eq('a float is not cents', isValidCents(29.98), false);
eq('the ceiling is a real amount', MAX_MONEY_CENTS > 9_000_000, true);

if (failures.length > 0) {
  console.log(`money: ${passed} checks, ${failures.length} failure(s) — ${failures.join(', ')}`);
  throw new Error(`${failures.length} money check(s) failed`);
}
console.log(`money: ${passed} checks, 0 failure(s)`);
