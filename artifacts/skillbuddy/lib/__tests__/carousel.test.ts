/**
 * AutoSlidingCarousel rules (Fix 3b) — the parts that are easy to get wrong and
 * impossible to see in a screenshot: which slide is next (it wraps), when the
 * timer may run at all (focus / background / dragging / reduce motion), and the
 * compact "1.2k" formatting of the header points pill.
 */
import {
  CAROUSEL_INTERVAL_MS,
  canAutoAdvance,
  formatCompactPoints,
  indexFromOffset,
  nextCarouselIndex,
} from '../carousel';
import { recentBookings, sortByRecency } from '../recentBookings';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function eq(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
  } else {
    failures.push(label);
    console.log(`FAIL ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
  }
}

/* ── The interval ─────────────────────────────────────────────────────────── */
eq('one slide every ~5 seconds', CAROUSEL_INTERVAL_MS, 5000);

/* ── Next index ───────────────────────────────────────────────────────────── */
eq('advances forward', nextCarouselIndex(0, 3), 1);
eq('advances forward again', nextCarouselIndex(1, 3), 2);
eq('wraps from the last slide to the first', nextCarouselIndex(2, 3), 0);
eq('one slide never moves', nextCarouselIndex(0, 1), 0);
eq('an empty carousel stays at 0', nextCarouselIndex(0, 0), 0);
eq('an out-of-range index is normalised', nextCarouselIndex(7, 3), 2);

/* ── Swipe offset → index ─────────────────────────────────────────────────── */
eq('offset 0 is the first slide', indexFromOffset(0, 300, 3), 0);
eq('one stride is the second slide', indexFromOffset(300, 300, 3), 1);
eq('two strides is the third slide', indexFromOffset(600, 300, 3), 2);
eq('an offset past the end is clamped', indexFromOffset(5000, 300, 3), 2);
eq('a negative offset is clamped', indexFromOffset(-400, 300, 3), 0);
eq('a zero stride cannot divide', indexFromOffset(300, 0, 3), 0);

/* ── When may it auto-advance? ────────────────────────────────────────────── */
const running = { count: 3, focused: true, appActive: true, dragging: false, reduceMotion: false };
eq('runs when idle, focused and foreground', canAutoAdvance(running), true);
eq('pauses while dragging', canAutoAdvance({ ...running, dragging: true }), false);
eq('pauses while the screen is not focused', canAutoAdvance({ ...running, focused: false }), false);
eq('pauses while the app is in the background', canAutoAdvance({ ...running, appActive: false }), false);
eq('never auto-advances with reduce motion on', canAutoAdvance({ ...running, reduceMotion: true }), false);
eq('does nothing with a single slide', canAutoAdvance({ ...running, count: 1 }), false);
eq('does nothing with no slides', canAutoAdvance({ ...running, count: 0 }), false);

/* ── Compact points pill ──────────────────────────────────────────────────── */
eq('zero points', formatCompactPoints(0), '0');
eq('a normal balance', formatCompactPoints(732), '732');
eq('exactly one thousand', formatCompactPoints(1000), '1k');
eq('one thousand two hundred', formatCompactPoints(1200), '1.2k');
eq('nine thousand nine hundred', formatCompactPoints(9900), '9.9k');
eq('twelve thousand four hundred', formatCompactPoints(12400), '12k');
eq('a non-number is not formatted', formatCompactPoints(Number.NaN), null);
eq('a negative balance floors at zero', formatCompactPoints(-5), '0');

/* ── Recent bookings ─────────────────────────────────────────────────────── */
type Booking = { id: string; at?: string };
const bookings: Booking[] = [
  { id: 'old', at: '2026-01-01T10:00:00Z' },
  { id: 'newest', at: '2026-03-01T10:00:00Z' },
  { id: 'undated' },
  { id: 'middle', at: '2026-02-01T10:00:00Z' },
];

eq(
  'newest first, undated last',
  sortByRecency(bookings, (b) => b.at).map((b) => b.id),
  ['newest', 'middle', 'old', 'undated']
);
eq(
  'the Home list is capped at three',
  recentBookings(bookings, (b) => b.at).map((b) => b.id),
  ['newest', 'middle', 'old']
);
eq('a shorter list is returned whole', recentBookings<Booking>([{ id: 'a', at: '2026-01-01' }], (b) => b.at).length, 1);
eq('an empty list returns an empty list', recentBookings<Booking>([], (b) => b.at), []);
eq('a zero limit returns nothing', recentBookings(bookings, (b) => b.at, 0), []);
eq(
  'ties keep their incoming order',
  sortByRecency(
    [
      { id: 'first', at: '2026-01-01T00:00:00Z' },
      { id: 'second', at: '2026-01-01T00:00:00Z' },
    ],
    (b) => b.at
  ).map((b) => b.id),
  ['first', 'second']
);

const total = passed + failures.length;
console.log(`carousel: ${passed}/${total} assertions passed`);
