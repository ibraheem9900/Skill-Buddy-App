/**
 * Pager geometry: one `position` value drives the pill, the five icons and the
 * page polish. These checks pin the mapping so a swipe can never leave the bar
 * or the pages out of sync.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import {
  PAGE_OPACITY_MIN,
  PAGE_PARALLAX_PX,
  PAGE_SCALE_MIN,
  TAB_COUNT,
  TAB_ICON_SCALE_MAX,
  TAB_PILL_WIDTH,
  iconFillRange,
  iconLiftRange,
  iconScaleRange,
  isSettled,
  pageOpacityRange,
  pageScaleRange,
  parallaxPx,
  pillLeftRange,
  sampleRange,
} from '../tabPager';

declare const console: { log: (msg: string) => void };
declare function require(name: string): any;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');

let passed = 0;
const failures: string[] = [];

function eq<T>(label: string, actual: T, expected: T) {
  if (actual === expected) {
    passed += 1;
  } else {
    failures.push(label);
    console.log(`FAIL ${label} (got ${String(actual)}, want ${String(expected)})`);
  }
}

function close(label: string, actual: number, expected: number, epsilon = 0.001) {
  if (Math.abs(actual - expected) <= epsilon) {
    passed += 1;
  } else {
    failures.push(label);
    console.log(`FAIL ${label} (got ${actual}, want ${expected})`);
  }
}

// ── Pill ────────────────────────────────────────────────────────────────────
const pill = pillLeftRange(TAB_COUNT, 400, TAB_PILL_WIDTH);
eq('the pill has one stop per tab', pill.inputRange.length, 5);
eq('the pill stops are the tab indices', pill.inputRange.join(','), '0,1,2,3,4');
close('the first pill is centred on the first slot', pill.outputRange[0], 40 - 22);
close('the middle pill is centred on the middle slot', pill.outputRange[2], 200 - 22);
close('the last pill is centred on the last slot', pill.outputRange[4], 360 - 22);
close('a half-way swipe puts the pill between two tabs', sampleRange(pill, 0.5), 80 - 22);
close('the pill clamps before the first tab', sampleRange(pill, -1), 18);
close('the pill clamps past the last tab', sampleRange(pill, 9), 338);
eq('a zero-width bar cannot divide by zero', pillLeftRange(5, 0).outputRange.every(Number.isFinite), true);

// ── Icon fill ───────────────────────────────────────────────────────────────
const fill2 = iconFillRange(2);
close('the active icon is fully filled', sampleRange(fill2, 2), 1);
close('the neighbour to its left is empty', sampleRange(fill2, 1), 0);
close('the neighbour to its right is empty', sampleRange(fill2, 3), 0);
close('half-way into Jobs the Services icon is half filled', sampleRange(iconFillRange(1), 1.5), 0.5);
close('an icon keeps filling until its tab is centred', sampleRange(iconFillRange(1), 0.8), 0.8);
close('fill clamps far from its tab', sampleRange(fill2, 4), 0);

// ── Icon lift ───────────────────────────────────────────────────────────────
close('the active icon is lifted to the max scale', sampleRange(iconScaleRange(3), 3), TAB_ICON_SCALE_MAX);
close('the neighbouring icon is at rest', sampleRange(iconScaleRange(3), 2), 1);
close('lift is symmetric around its tab', sampleRange(iconScaleRange(3), 2.65), sampleRange(iconScaleRange(3), 3.35));
close('lift weight peaks on the active tab', sampleRange(iconLiftRange(3), 3), 1);
close('lift weight is zero a full tab away', sampleRange(iconLiftRange(3), 4), 0);

// ── Page polish ─────────────────────────────────────────────────────────────
const opacity1 = pageOpacityRange(1);
close('the active page is fully opaque', sampleRange(opacity1, 1), 1);
close('a fully swiped-out page is faded', sampleRange(opacity1, 0), PAGE_OPACITY_MIN);
close('opacity is symmetric', sampleRange(opacity1, 1.5), sampleRange(opacity1, 0.5));
const scale1 = pageScaleRange(1);
close('the active page is full size', sampleRange(scale1, 1), 1);
close('an off-screen page is slightly smaller', sampleRange(scale1, 2), PAGE_SCALE_MIN);
close('scale is symmetric', sampleRange(scale1, 0.25), sampleRange(scale1, 1.75));

// ── Parallax ────────────────────────────────────────────────────────────────
eq('there is no parallax at rest', parallaxPx(2, 2, 2), 0);
eq('there is no parallax on the off-screen neighbour at rest', parallaxPx(2, 3, 2), 0);
eq('dragging left lags the outgoing page to the right', parallaxPx(2.5, 2, 2) > 0, true);
eq('dragging left lags the incoming page to the right', parallaxPx(2.5, 3, 2) > 0, true);
eq('dragging right lags the outgoing page to the left', parallaxPx(1.5, 2, 2) < 0, true);
eq('dragging right lags the incoming page to the left', parallaxPx(1.5, 1, 2) < 0, true);
eq('the lag never exceeds the configured amount', Math.abs(parallaxPx(2.5, 3, 2)) <= PAGE_PARALLAX_PX, true);
close('the lag peaks half-way through a drag', parallaxPx(2.5, 3, 2), PAGE_PARALLAX_PX * 0.25);
eq('a settled page reports settled', isSettled(3, 3), true);
eq('a mid-swipe page is not settled', isSettled(3.2, 3), false);

// ── Source wiring ──────────────────────────────────────────────────────────
// The ranges above are only worth anything if the pager's one `position`
// actually reaches both the bar and the pages, so pin the wiring too.
function projectRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.join(dir, '..');
  }
  throw new Error(`could not find the project root above ${from}`);
}
const root = projectRoot(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const layout = read('app/(tabs)/_layout.tsx');
const bar = read('components/tabBar/TabPagerBar.tsx');
const page = read('components/tabBar/TabPagerPage.tsx');

eq('the tabs are a bottom pager', layout.includes('tabBarPosition="bottom"'), true);
eq('the pager follows the finger', layout.includes('swipeEnabled: true'), true);
eq('neighbouring tabs are pre-mounted', layout.includes('lazyPreloadDistance: 1'), true);
eq('the custom bar is rendered', layout.includes('<TabPagerBar'), true);

eq('the pill comes from the shared position', bar.includes('position.interpolate(pillLeftRange('), true);
eq('every icon fill comes from the shared position', bar.includes('position.interpolate(iconFillRange(index))'), true);
eq('the incoming icon lifts from the shared position', bar.includes('position.interpolate(iconLiftRange(index))'), true);
eq('the bar reports the settled tab once', bar.includes('onActiveIndexChange?.(state.index)'), true);
eq('the bar never holds the animation in React state', /useState|setState/.test(bar), false);

eq('pages read the pager position', page.includes('TabAnimationContext'), true);
eq('pages fade from the shared position', page.includes('pageOpacityRange(index)'), true);
eq('pages scale from the shared position', page.includes('pageScaleRange(index)'), true);
eq('pages never hold the animation in React state', /useState|setState/.test(page), false);

eq('reduce motion is respected', page.includes('useReduceMotion()'), true);

eq('reduce motion is respected by the bar', bar.includes('useReduceMotion()'), true);

const screens: [string, number][] = [
  ['app/(tabs)/index.tsx', 0],
  ['app/(tabs)/services.tsx', 1],
  ['app/(tabs)/jobs.tsx', 2],
  ['app/(tabs)/inbox.tsx', 3],
  ['app/(tabs)/profile.tsx', 4],
];
for (const [file, index] of screens) {
  const source = read(file);
  eq(`${file} is a pager page`, source.includes(`withTabPagerPage(`), true);
  eq(`${file} knows its index`, source.includes(`, ${index});`), true);
}

console.log(`tabPager: ${passed} checks, ${failures.length} failure(s)`);
if (failures.length > 0) throw new Error(`${failures.length} tabPager check(s) failed`);
