/**
 * The ONE hourly price formatter (Fix 1d): every catalog service is priced per
 * hour, so the label must read "€15.00/h – €25.00/h", collapse to a single
 * value when both bounds match, and say "From …" when only a minimum exists.
 */
import {
  formatHourlyPriceRange,
  formatServiceHourlyPrice,
  formatServicePrice,
} from '../servicePrice';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function eq(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    passed += 1;
  } else {
    failures.push(label);
    console.log(`FAIL ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
  }
}

/* ── The boss's wording ───────────────────────────────────────────────────── */
eq(
  'a range is written per hour on both bounds',
  formatHourlyPriceRange('15.00', '25.00'),
  '€15.00/h – €25.00/h'
);
eq(
  'equal bounds collapse to ONE hourly value',
  formatHourlyPriceRange('20', '20.00'),
  '€20.00/h'
);
eq(
  'a minimum-only range is prefixed',
  formatHourlyPriceRange('15.00', null),
  'From €15.00/h'
);
eq(
  'the prefix is translatable',
  formatHourlyPriceRange('15.00', undefined, { fromLabel: 'Alates' }),
  'Alates €15.00/h'
);
eq(
  'a maximum-only range is a single hourly value',
  formatHourlyPriceRange(null, '45'),
  '€45.00/h'
);
eq('no bounds means no label', formatHourlyPriceRange(null, null), null);
eq('empty strings mean no label', formatHourlyPriceRange('', ''), null);

/* ── Number inputs and currency ───────────────────────────────────────────── */
eq('numeric bounds work', formatHourlyPriceRange(10, 15), '€10.00/h – €15.00/h');
eq(
  'another currency is honoured',
  formatHourlyPriceRange(10, 12, { currency: '$' }),
  '$10.00/h – $12.00/h'
);

/* ── Defensive parsing (the API sends strings) ────────────────────────────── */
eq('a non-numeric string is ignored', formatHourlyPriceRange('abc', null), null);
eq('NaN is ignored', formatHourlyPriceRange(Number.NaN, '10'), '€10.00/h');
eq('an absurdly long value is rejected', formatHourlyPriceRange('0'.repeat(40), null), null);

/* ── The server item wrapper ──────────────────────────────────────────────── */
eq(
  'the item wrapper reads price_from/price_to',
  formatServiceHourlyPrice({ price_from: '25.00', price_to: '45.00' }),
  '€25.00/h – €45.00/h'
);
eq(
  'the wrapper falls back to the server label verbatim (no invented /h)',
  formatServiceHourlyPrice({ price_range: 'On request' }),
  'On request'
);
eq('the wrapper returns null with nothing usable', formatServiceHourlyPrice({}), null);

/* ── The old non-hourly formatter is unchanged for its callers ────────────── */
eq('old formatter keeps its style', formatServicePrice({ price_from: '10', price_to: '25' }), '€10.00 – €25.00');
eq('old formatter keeps the plus for min-only', formatServicePrice({ price_from: '10' }), '€10.00+');

const total = passed + failures.length;
console.log(`servicePrice: ${passed}/${total} assertions passed`);
