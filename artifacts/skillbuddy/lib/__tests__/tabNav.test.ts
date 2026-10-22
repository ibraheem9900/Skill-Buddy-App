/**
 * Bottom-tab order, swipe targets and the bar's safe-area contract.
 *
 * Swiping must follow the bar exactly (Home ↔ Services ↔ Jobs ↔ Inbox ↔
 * Profile), must not wrap around, and must stay OFF every non-tab screen so a
 * detail screen keeps its own back gesture.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import {
  TAB_BAR_HEIGHT,
  TAB_ORDER,
  adjacentTabPath,
  isTabPath,
  normalizePathname,
  tabIndex,
  tabPathOf,
} from '../tabNav';

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

// ── Order ──────────────────────────────────────────────────────────────────
eq('five tabs', TAB_ORDER.length, 5);
eq('the bar order is Home, Services, Jobs, Inbox, Profile', TAB_ORDER.join(' '), '/ /services /jobs /inbox /profile');
eq('the bar is 60 pt of content plus the inset', TAB_BAR_HEIGHT, 60);

// ── Path matching ──────────────────────────────────────────────────────────
eq('the home tab is /', tabPathOf('/'), '/');
eq('a trailing slash still matches', tabPathOf('/jobs/'), '/jobs');
eq('a query string is ignored', tabPathOf('/profile?tab=about'), '/profile');
eq('nested screens are NOT tabs', tabPathOf('/profile/edit'), null);
eq('job detail is not a tab', tabPathOf('/job/12'), null);
eq('an empty path is not a tab', tabPathOf(''), null);
eq('null is not a tab', tabPathOf(null), null);
eq('normalize keeps the root', normalizePathname('///'), '/');
eq('isTabPath agrees', [isTabPath('/'), isTabPath('/inbox'), isTabPath('/job/post')].join(','), 'true,true,false');
eq('index of Profile is 4', tabIndex('/profile'), 4);
eq('index of a non-tab is -1', tabIndex('/job/post'), -1);

// ── Swipe targets ──────────────────────────────────────────────────────────
eq('swiping left on Home goes to Services', adjacentTabPath('/', 1), '/services');
eq('swiping right on Services goes to Home', adjacentTabPath('/services', -1), '/');
eq('swiping left walks the whole bar', [
  adjacentTabPath('/', 1),
  adjacentTabPath('/services', 1),
  adjacentTabPath('/jobs', 1),
  adjacentTabPath('/inbox', 1),
].join(','), '/services,/jobs,/inbox,/profile');
eq('the last tab cannot swipe further left', adjacentTabPath('/profile', 1), null);
eq('the first tab cannot swipe further right', adjacentTabPath('/', -1), null);
eq('no swipe on a detail screen', adjacentTabPath('/job/12', 1), null);
eq('no swipe on a profile sub-screen', adjacentTabPath('/profile/edit', -1), null);

// ── Source checks: the bar honours the inset, the swipe is scoped ─────────
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

// ── The pager navigator ────────────────────────────────────────────────────
eq('the five tabs are a pager, not discrete taps', layout.includes('<TopTabs'), true);
eq('the custom bar is rendered at the bottom', layout.includes('tabBarPosition="bottom"'), true);
eq('the bar is the custom one', layout.includes('<TabPagerBar'), true);
eq('swiping between tabs is enabled', layout.includes('swipeEnabled: true'), true);
eq(
  'the immediate neighbours are pre-mounted, distant tabs stay lazy',
  layout.includes('lazy: true') && layout.includes('lazyPreloadDistance: 1'),
  true
);
eq(
  'every tab is declared once',
  (layout.match(/<TopTabs\.Screen/g) ?? []).length,
  5
);
eq('no leftover old icon names', /DoorTabIcon|GridBlocksTabIcon|ChatPopTabIcon|EyesTabIcon/.test(layout), false);
eq('the old discrete swipe wrapper is gone', fs.existsSync(path.join(root, 'components/TabSwipeArea.tsx')), false);

// ── The bar ────────────────────────────────────────────────────────────────
eq(
  'the bar height adds the real bottom inset',
  bar.includes('height: isWeb ? 84 : TAB_BAR_HEIGHT + insets.bottom'),
  true
);
eq('the bar pads by the inset', bar.includes('paddingBottom: isWeb ? 34 : (insets.bottom > 0 ? insets.bottom : 0) + 6'), true);
eq('one continuous position drives the pill', bar.includes('position.interpolate(pillLeftRange('), true);
eq('each icon cross-fades outline to filled', bar.includes('position.interpolate(iconFillRange('), true);
eq('each label cross-fades its colour', bar.includes('opacity: fill'), true);
eq('the incoming icon lifts with a scale', bar.includes('position.interpolate(iconScaleRange('), true);
eq('tapping a tab goes through the pager', bar.includes('jumpTo(route.key)'), true);
eq('the bar draws its own icons', /HomeTabIcon[\s\S]*ProfileTabIcon/.test(bar), true);

// ── Pages ──────────────────────────────────────────────────────────────────
const page = read('components/tabBar/TabPagerPage.tsx');
eq('pages read the same pager position', page.includes('TabAnimationContext'), true);
eq('pages fade as they leave', page.includes('pageOpacityRange(index)'), true);
eq('pages scale slightly as they leave', page.includes('pageScaleRange(index)'), true);
eq('reduce motion switches the polish off', page.includes('reduceMotion'), true);

for (const [file, name, index] of [
  ['index.tsx', 'HomeScreen', 0],
  ['services.tsx', 'ServicesScreen', 1],
  ['jobs.tsx', 'JobsScreen', 2],
  ['inbox.tsx', 'InboxScreen', 3],
  ['profile.tsx', 'ProfileScreen', 4],
] as const) {
  eq(
    `${name} is wrapped for the pager at index ${index}`,
    read(`app/(tabs)/${file}`).includes(`withTabPagerPage(${name}, ${index})`),
    true
  );
}

console.log(`tabNav: ${passed} checks, ${failures.length} failure(s)`);
if (failures.length > 0) throw new Error(`${failures.length} tabNav check(s) failed`);
