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
eq(
  'the bar height adds the real bottom inset',
  layout.includes('height: TAB_BAR_HEIGHT + insets.bottom'),
  true
);
eq('the bar pads by the inset', layout.includes('paddingBottom: (insets.bottom > 0 ? insets.bottom : 0) + 6'), true);
eq('the navigator is wrapped by the swipe area', layout.includes('<TabSwipeArea>'), true);
eq(
  'every tab uses the shared animated wrapper',
  (layout.match(/<AnimatedTabIcon/g) ?? []).length,
  5
);
eq('no leftover old icon names', /DoorTabIcon|GridBlocksTabIcon|ChatPopTabIcon|EyesTabIcon/.test(layout), false);

const swipe = read('components/TabSwipeArea.tsx');
eq('the swipe is limited to root tabs', swipe.includes('isTabPath(pathname)'), true);
eq('it needs a 24 px horizontal move to activate', swipe.includes('ACTIVATE_X = 24'), true);
eq('a vertical move cancels it', swipe.includes('failOffsetY'), true);
eq(
  'it navigates rather than pushing a stack screen',
  swipe.includes('router.navigate') && !swipe.includes('router.push'),
  true
);

console.log(`tabNav: ${passed} checks, ${failures.length} failure(s)`);
if (failures.length > 0) throw new Error(`${failures.length} tabNav check(s) failed`);
