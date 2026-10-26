/**
 * colorStops.test.ts — the gradient-fade rule from the Job Details hero.
 *
 *   • stops interpolate linearly in RGB between two hex colors;
 *   • first stop == from, last stop == to (seam-free against the hero);
 *   • every stop is OPAQUE hex — never 'transparent', never rgba(0,0,0,0),
 *     which is what turned the old fade muddy gray;
 *   • non-hex input falls back to [from, to] instead of emitting garbage.
 *
 * Run through the same harness: `pnpm run test`.
 */
import { interpolateColorStops, parseHexColor, toHexColor } from '../colorStops';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean) {
  if (ok) {
    passed += 1;
  } else {
    failures.push(label);
    console.log(`FAIL ${label}`);
  }
}

function eq<T>(label: string, actual: T, expected: T) {
  check(`${label} (got ${String(actual)}, want ${String(expected)})`, actual === expected);
}

// ── parse / format round-trips ─────────────────────────────────────────────
eq('parses #2b795c r', parseHexColor('#2b795c')![0], 0x2b);
eq('parses #2b795c g', parseHexColor('#2b795c')![1], 0x79);
eq('parses #2b795c b', parseHexColor('#2b795c')![2], 0x5c);
eq('parses shorthand #FFF', parseHexColor('#FFF')!.join(','), '255,255,255');
eq('parses without #', parseHexColor('000000')!.join(','), '0,0,0');
check('rejects rgba() input', parseHexColor('rgba(0,0,0,0)') === null);
check('rejects garbage', parseHexColor('not-a-color') === null);
eq('formats 6 lowercase digits', toHexColor([43, 121, 92]), '#2b795c');
eq('clamps out-of-range channels', toHexColor([-5, 300, 12.4]), '#00ff0c');

// ── stops ──────────────────────────────────────────────────────────────────
const stops = interpolateColorStops('#2b795c', '#f8f8f8', 6);
eq('requested step count', stops.length, 6);
eq('first stop is the hero green (no seam)', stops[0], '#2b795c');
eq('last stop is the page background', stops[5], '#f8f8f8');
check(
  'every stop is opaque 6-digit hex (no transparent / alpha hole)',
  stops.every((s) => /^#[0-9a-f]{6}$/.test(s))
);
check(
  'no stop equals #000000 (never passes through black)',
  stops.every((s) => s !== '#000000')
);
// Midpoint of #000000 → #ffffff must be ~#808080 (linear RGB lerp).
const mid = interpolateColorStops('#000000', '#ffffff', 3);
eq('linear midpoint of black→white', mid[1], '#808080');
// Monotonic fade: red channel must strictly increase black→white.
const mono = interpolateColorStops('#000000', '#ffffff', 5);
check(
  'channel moves monotonically toward the target',
  mono.every((s, i) => i === 0 || parseInt(s.slice(1, 3), 16) >= parseInt(mono[i - 1].slice(1, 3), 16))
);

// Dark theme pair (heroCard charcoal → near-black background) also stays opaque.
const dark = interpolateColorStops('#151a1a', '#0a0d0d', 5);
eq('dark theme step count', dark.length, 5);
eq('dark first stop', dark[0], '#151a1a');
eq('dark last stop', dark[4], '#0a0d0d');
check('dark stops all opaque hex', dark.every((s) => /^#[0-9a-f]{6}$/.test(s)));

// ── fallbacks ──────────────────────────────────────────────────────────────
const fallback = interpolateColorStops('rgba(0,0,0,0)', '#ffffff', 6);
eq('non-hex falls back to exactly the two inputs', fallback.join('|'), 'rgba(0,0,0,0)|#ffffff');
eq('steps < 2 are clamped to 2', interpolateColorStops('#000000', '#ffffff', 1).length, 2);

console.log(`colorStops: ${passed} checks, ${failures.length} failure(s)`);
if (failures.length > 0) throw new Error(`${failures.length} colorStops check(s) failed`);
