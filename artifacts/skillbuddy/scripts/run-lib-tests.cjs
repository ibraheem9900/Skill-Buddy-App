#!/usr/bin/env node
/**
 * Dependency-free test runner for the pure helper modules in lib/.
 *
 * This workspace ships no test framework (no jest / vitest / tsx), so the harness:
 *   1. compiles lib/__tests__/*.test.ts (and the helpers they import) with the
 *      project's own TypeScript into lib/__tests__/.out,
 *   2. rewrites the `@/lib/...` import specifiers the app relies on into relative
 *      requires (node has no idea about the app's tsconfig path aliases),
 *   3. runs each emitted test file with plain node and fails the run if any
 *      assertion was recorded.
 *
 * Usage: pnpm run test
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const testDir = path.join(projectRoot, 'lib', '__tests__');
const outDir = path.join(testDir, '.out');

const TEST_FILES = [
  'jobAddressUpdate.test.js',
  'jobStatus.test.js',
  'jobRestartTimer.test.js',
  'jobConvert.test.js',
  'jobAssign.test.js',
  'jobPayment.test.js',
  'jobStart.test.js',
  'jobComplete.test.js',
  'jobCancel.test.js',
  'providerCancel.test.js',
  'providerDecline.test.js',
  'jobPause.test.js',
  'providerPause.test.js',
  'jobBlocker.test.js',
  'jobAttachment.test.js',
  'appUpdate.test.js',
  'jobSchedule.test.js',
  'jobBooking.test.js',
  'jobFilters.test.js',
  'jobCreateError.test.js',
  'bid.test.js',
  'realtimeEvents.test.js',
  'realtime.test.js',
  'debounce.test.js',
  'jobBidsLive.test.js',
  'jobBiddingOptions.test.js',
  'nearbyJobs.test.js',
  'nearbyStale.test.js',
  'providerSkills.test.js',
  'providerAddress.test.js',
  'myBids.test.js',
  'bidResults.test.js',
  'moneyEvents.test.js',
  'dataState.test.js',
  'tabNav.test.js',
  'tabPager.test.js',
  'postWizard.test.js',
  'timeSlots.test.js',
  'bidTimes.test.js',
  'postDetails.test.js',
  'postAddress.test.js',
  'translations.test.js',
  'colorStops.test.js',
  'fetchRetry.test.js',
];

const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

/** Windows can transiently refuse to start a child process; give it this many goes. */
const SPAWN_ATTEMPTS = 3;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: options.quiet ? 'pipe' : 'inherit',
    cwd: projectRoot,
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
}

if (!fs.existsSync(path.join(testDir, 'tsconfig.json'))) {
  console.error('lib/__tests__/tsconfig.json is missing — nothing to compile.');
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });

/**
 * Run the project's own TypeScript compiler.
 *
 * `pnpm exec tsc` fails on some Windows setups with `spawn EPERM` (the .cmd shim
 * cannot be spawned from a non-shell parent), so the local compiler entry point is
 * invoked through node and pnpm is only the fallback.
 */
function compileTests() {
  const tsconfig = path.join('lib', '__tests__', 'tsconfig.json');
  const localTsc = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  if (fs.existsSync(localTsc)) {
    for (let attempt = 1; ; attempt += 1) {
      const result = spawnSync(process.execPath, [localTsc, '-p', tsconfig], {
        stdio: 'inherit',
        cwd: projectRoot,
        encoding: 'utf8',
      });
      if (result.error && result.error.code === 'ENOENT') {
        console.warn('local tsc could not be executed, falling back to pnpm exec');
        break;
      }
      // Windows intermittently refuses to start the child process itself
      // (`spawn EPERM`); tsc never exits non-zero without printing a diagnostic,
      // so a silent failure is a launch failure worth retrying.
      if (!result.error && result.status === 0) return result;
      if (result.error || result.status === null) {
        if (attempt < SPAWN_ATTEMPTS) {
          console.warn(`  … tsc could not be started (${result.error?.code ?? 'killed'}), retrying`);
          continue;
        }
      }
      return result;
    }
  }
  return run('pnpm', ['exec', 'tsc', '-p', tsconfig]);
}

console.log('› compiling lib/__tests__ with tsc');
const compile = compileTests();
if (compile.status !== 0) {
  console.error('TypeScript compilation of the tests failed.');
  process.exit(compile.status ?? 1);
}

/** Rewrite the app's path aliases into relative requires node can resolve. */
function rewriteAliases(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteAliases(full);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const source = fs.readFileSync(full, 'utf8');
    const rewritten = source.replace(/require\("@\/lib\//g, 'require("./');
    if (rewritten !== source) fs.writeFileSync(full, rewritten);
  }
}
rewriteAliases(outDir);

let failed = 0;
for (const file of TEST_FILES) {
  const emitted = path.join(outDir, 'lib', '__tests__', file);
  if (!fs.existsSync(emitted)) {
    console.error(`✗ ${file} was not emitted by tsc`);
    failed += 1;
    continue;
  }

  console.log(`\n› ${file}`);
  let result;
  let output = '';
  for (let attempt = 1; attempt <= SPAWN_ATTEMPTS; attempt += 1) {
    result = spawnSync(process.execPath, [emitted], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd();
    // Every test file prints its assertion report, so a silent non-zero exit means
    // the runner could not launch the test process (Windows `spawn EPERM`, which is
    // intermittent) rather than a genuine failure. Retry only that shape.
    const launched = output !== '';
    const spawnFailed = !launched && (result.error != null || result.status !== 0);
    if (!spawnFailed) break;
    if (attempt < SPAWN_ATTEMPTS) {
      console.warn(`  … could not launch the test process (${result.error?.code ?? 'no output'}), retrying`);
      continue;
    }
  }
  if (result.error) console.error(`  ${result.error.code ?? 'error'}: ${result.error.message}`);
  if (output) console.log(output.split('\n').map((line) => `  ${line}`).join('\n'));
  if (result.status !== 0) {
    failed += 1;
    continue;
  }

  // Every test file reports "<name>: <passed>/<total> assertions passed". A failed
  // assertion does not kill node on its own, so the run is failed here unless the
  // reported counts are equal AND no failure line was printed.
  // Two report shapes are used: `<n>/<m> assertions passed` and
  // `<n> checks, <k> failure(s)`.
  const ratio = /(\d+)\/(\d+) assertions passed/.exec(output);
  const counted = /(\d+) checks, (\d+) failure\(s\)/.exec(output);
  if (ratio) {
    if (ratio[1] !== ratio[2]) {
      console.error(`✗ ${file} reported ${ratio[1]}/${ratio[2]} passing assertions`);
      failed += 1;
    }
  } else if (counted) {
    if (counted[2] !== '0') {
      console.error(`✗ ${file} reported ${counted[2]} failing check(s)`);
      failed += 1;
    }
  } else {
    console.error(`✗ ${file} printed no assertion report`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`\n✗ ${failed} test file(s) failed`);
  process.exit(1);
}

console.log(`\n✓ all ${TEST_FILES.length} lib test file(s) passed`);
if (!VERBOSE) console.log('  (re-run with --verbose for the full compile log)');
