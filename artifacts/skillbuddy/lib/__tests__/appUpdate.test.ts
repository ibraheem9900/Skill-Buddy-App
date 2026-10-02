/**
 * Unit tests for the in-app update check logic (lib/appUpdate.ts).
 *
 * Run through the project's own harness: `pnpm run test`. No React, no network —
 * only tag parsing, version comparison and the GitHub payload validation that
 * decides whether the "Update available" banner may appear.
 */
import {
  LATEST_RELEASE_API_URL,
  PERMANENT_APK_URL,
  RELEASE_REPO,
  buildReleaseInfo,
  compareVersions,
  formatReleaseLabel,
  isNewerRelease,
  parseReleaseTag,
  readStampedBuildRun,
} from '../appUpdate';

declare const console: { log: (msg: string) => void };

let passed = 0;
export const failures: string[] = [];

function check(label: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(label);
}

function eq(label: string, actual: unknown, expected: unknown): void {
  check(
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    actual === expected
  );
}

/* ------------------------------------------------------------- constants */

eq('release repo points at the publishing repository', RELEASE_REPO, 'ibraheem9900/Skill-Buddy-App');
eq(
  'latest release api url is pinned to this repository',
  LATEST_RELEASE_API_URL,
  'https://api.github.com/repos/ibraheem9900/Skill-Buddy-App/releases/latest'
);
eq(
  'permanent apk url keeps the exact asset name',
  PERMANENT_APK_URL,
  'https://github.com/ibraheem9900/Skill-Buddy-App/releases/latest/download/SkillBuddy.apk'
);

/* --------------------------------------------------------- tag parsing */

const parsed = parseReleaseTag('android-v1.0.1-r26');
eq('parses the app version', parsed?.version, '1.0.1');
eq('parses the workflow run', parsed?.build, 26);

const twoPart = parseReleaseTag('android-v2.10-r42');
eq('parses a two-part version', twoPart?.version, '2.10');
eq('parses its run too', twoPart?.build, 42);

const noRun = parseReleaseTag('android-v1.0.1');
eq('a tag without -r still yields the version', noRun?.version, '1.0.1');
eq('a tag without -r has no build', noRun?.build, null);

check('legacy tag is rejected', parseReleaseTag('v1.0.0-android') === null);
check('unrelated tag is rejected', parseReleaseTag('release-1.0.1') === null);
check('trailing junk is rejected', parseReleaseTag('android-v1.0.1-r26-extra') === null);
check('empty string is rejected', parseReleaseTag('') === null);
check('null is rejected', parseReleaseTag(null) === null);
check('undefined is rejected', parseReleaseTag(undefined) === null);
check('a number is rejected', parseReleaseTag(26) === null);
check('surrounding whitespace is tolerated', parseReleaseTag('  android-v1.0.1-r26  ')?.build === 26);

/* ----------------------------------------------------- version comparison */

eq('equal versions compare 0', compareVersions('1.0.1', '1.0.1'), 0);
eq('a patch bump is newer', compareVersions('1.0.2', '1.0.1'), 1);
eq('a minor bump is newer', compareVersions('1.1.0', '1.0.9'), 1);
eq('a major bump is newer', compareVersions('2.0.0', '1.99.99'), 1);
eq('an older patch is older', compareVersions('1.0.0', '1.0.1'), -1);
eq('missing segments count as zero', compareVersions('1.1', '1.1.0'), 0);
eq('a longer equal version is equal', compareVersions('1.1.0.0', '1.1'), 0);
eq('numeric (not lexical) ordering', compareVersions('1.10.0', '1.9.0'), 1);
eq('unparsable segments degrade to zero', compareVersions('1.x', '1.0'), 0);

/* ------------------------------------------------- stamped build reading */

eq('reads a numeric stamp', readStampedBuildRun({ buildRun: 27 }), 27);
eq('reads a numeric string stamp', readStampedBuildRun({ buildRun: '27' }), 27);
eq('ignores unrelated extra fields', readStampedBuildRun({ eas: { projectId: 'x' } }), null);
eq('rejects zero', readStampedBuildRun({ buildRun: 0 }), null);
eq('rejects negative values', readStampedBuildRun({ buildRun: -3 }), null);
eq('rejects fractional values', readStampedBuildRun({ buildRun: 2.5 }), null);
eq('rejects booleans', readStampedBuildRun({ buildRun: true }), null);
eq('rejects null extra', readStampedBuildRun(null), null);
eq('rejects undefined extra', readStampedBuildRun(undefined), null);
eq('rejects a non-object extra', readStampedBuildRun('extra'), null);

/* --------------------------------------------- github payload validation */

/** Verbatim shape of the real `releases/latest` payload for r26. */
const r26Payload = {
  tag_name: 'android-v1.0.1-r26',
  name: 'SkillBuddy Android 1.0.1 (build 26)',
  html_url: 'https://github.com/ibraheem9900/Skill-Buddy-App/releases/tag/android-v1.0.1-r26',
  published_at: '2026-10-02T20:12:40Z',
  body: '## SkillBuddy for Android — android-v1.0.1-r26',
  assets: [
    {
      name: 'SkillBuddy.apk',
      browser_download_url:
        'https://github.com/ibraheem9900/Skill-Buddy-App/releases/download/android-v1.0.1-r26/SkillBuddy.apk',
    },
  ],
};

const r26 = buildReleaseInfo(r26Payload);
eq('valid payload yields the tag', r26?.tag, 'android-v1.0.1-r26');
eq('valid payload yields the version', r26?.version, '1.0.1');
eq('valid payload yields the run', r26?.build, 26);
eq('release name is preserved', r26?.name, 'SkillBuddy Android 1.0.1 (build 26)');
eq('page url is preserved', r26?.pageUrl, r26Payload.html_url);
eq('apk asset url is used for downloads', r26?.downloadUrl, r26Payload.assets[0].browser_download_url);
eq('published_at is preserved', r26?.publishedAt, '2026-10-02T20:12:40Z');
eq('notes body is preserved', r26?.notes, r26Payload.body);

const noAssets = buildReleaseInfo({ tag_name: 'android-v1.0.1-r27' });
eq('without an apk asset the permanent link is used', noAssets?.downloadUrl, PERMANENT_APK_URL);
eq('missing name falls back to the tag', noAssets?.name, 'android-v1.0.1-r27');
eq('missing html_url falls back to the tag page', noAssets?.pageUrl,
  'https://github.com/ibraheem9900/Skill-Buddy-App/releases/tag/android-v1.0.1-r27');
eq('missing published_at is null', noAssets?.publishedAt, null);
eq('missing body is an empty string', noAssets?.notes, '');

check('a 404 payload is rejected', buildReleaseInfo({ message: 'Not Found' }) === null);
check('a rate-limit payload is rejected', buildReleaseInfo({ message: 'API rate limit exceeded' }) === null);
check('a tag-less payload is rejected', buildReleaseInfo({ name: 'x' }) === null);
check('a legacy-tag payload is rejected', buildReleaseInfo({ tag_name: 'v1.0.0-android' }) === null);
check('null payload is rejected', buildReleaseInfo(null) === null);
check('undefined payload is rejected', buildReleaseInfo(undefined) === null);
check('a non-object payload is rejected', buildReleaseInfo('nope') === null);
check(
  'an apk asset without a url falls back to the permanent link',
  buildReleaseInfo({ tag_name: 'android-v1.0.1-r27', assets: [{ name: 'SkillBuddy.apk' }] })?.downloadUrl ===
    PERMANENT_APK_URL
);
check(
  'non-apk assets are ignored',
  buildReleaseInfo({ tag_name: 'android-v1.0.1-r27', assets: [{ name: 'notes.txt', browser_download_url: 'x' }] })
    ?.downloadUrl === PERMANENT_APK_URL
);

/* --------------------------------------------------- update decision */

const latest27 = buildReleaseInfo({ tag_name: 'android-v1.0.1-r27' })!;
const latest26 = buildReleaseInfo({ tag_name: 'android-v1.0.1-r26' })!;
const latest110 = buildReleaseInfo({ tag_name: 'android-v1.1.0-r30' })!;

check(
  'a newer run of the same version is an update',
  isNewerRelease({ version: '1.0.1', build: 26 }, latest27) === true
);
check(
  'the same run is not an update',
  isNewerRelease({ version: '1.0.1', build: 27 }, latest27) === false
);
check(
  'an unknown installed build gets the same-version banner',
  isNewerRelease({ version: '1.0.1', build: null }, latest27) === true
);
check(
  'an unknown installed build is offered the release even when it is the current one (pre-stamp installs)',
  isNewerRelease({ version: '1.0.1', build: null }, latest26) === true
);
check(
  'a newer product version is an update regardless of build',
  isNewerRelease({ version: '1.0.1', build: 99 }, latest110) === true
);
check(
  'an older product version is not an update',
  isNewerRelease({ version: '1.0.2', build: 26 }, latest27) === false
);
check(
  'an unknown installed version gets the banner',
  isNewerRelease({ version: null, build: null }, latest27) === true
);
check(
  'a missing run number on the release cannot force a banner',
  isNewerRelease({ version: '1.0.1', build: 27 }, buildReleaseInfo({ tag_name: 'android-v1.0.1' })!) === false
);
check(
  'the r26 payload says "no update" to an r26 install',
  isNewerRelease({ version: '1.0.1', build: 26 }, r26!) === false
);
check(
  'the r26 payload says "update" to an r25 install',
  isNewerRelease({ version: '1.0.1', build: 25 }, r26!) === true
);
check(
  'a stamped build older than the release still counts as an update after an OTA',
  isNewerRelease({ version: '1.0.1', build: 26 }, latest27) === true
);

/* ------------------------------------------------------------- label */

eq('label with a build number', formatReleaseLabel({ version: '1.0.1', build: 27 }), '1.0.1 (27)');
eq('label without a build number', formatReleaseLabel({ version: '1.0.1', build: null }), '1.0.1');

/* ------------------------------------------------------------------------ report */

export const summary = { passed, total: passed + failures.length };
console.log(`appUpdate: ${summary.passed}/${summary.total} assertions passed`);
for (const failure of failures) console.log(`  ✗ ${failure}`);
