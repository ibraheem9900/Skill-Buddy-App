/**
 * In-app update check — pure logic.
 *
 * Every push to `main` publishes two things (see
 * .github/workflows/build-and-update.yml):
 *   1. an OTA JS update for already-installed apps, and
 *   2. a new GitHub Release tagged `android-v<app version>-r<workflow run>`
 *      carrying `SkillBuddy.apk` (the sideloadable build).
 *
 * The check answers one question: "is the APK this phone was installed from
 * older than the latest published release?" The answers must be exact even
 * when the app version has not changed between pushes (this project publishes
 * many builds per version), so the comparison is:
 *
 *   - product version (semver) decides when it differs, and
 *   - the GitHub workflow run number decides when it does not.
 *
 * The installed side of the build number comes from `extra.buildRun`, which
 * the apk-build CI job stamps into app.json before `eas build` runs. The
 * embedded app config therefore carries the number of the run that built the
 * installed APK. OTA manifests are published from the committed app.json
 * (which never contains buildRun), so a JS update cannot impersonate a new
 * APK — the hook's record of the installed build stays put until a new APK
 * is actually installed.
 *
 * Nothing here touches React, AsyncStorage or the network: the hook does the
 * I/O, this module only parses and compares, so it can be unit tested through
 * the project's dependency-free harness (`pnpm run test`).
 */

/** Repository that publishes the Android releases. */
export const RELEASE_REPO = 'ibraheem9900/Skill-Buddy-App';

/** Latest published release (the GitHub API returns 404 payloads for none). */
export const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;

/**
 * Permanent, always-latest APK link. Used when a release payload carries no
 * `.apk` asset of its own (or one we cannot read).
 */
export const PERMANENT_APK_URL = `https://github.com/${RELEASE_REPO}/releases/latest/download/SkillBuddy.apk`;

export interface ReleaseTagInfo {
  /** App version from the tag, e.g. '1.0.1'. */
  version: string;
  /** Workflow run that produced the release, or null when the tag has no `-r` part. */
  build: number | null;
}

export interface InstalledAppInfo {
  /** Version reported by the installed app config (e.g. '1.0.1'), or null when unknown. */
  version: string | null;
  /**
   * Workflow run the installed APK was built from (`extra.buildRun`), or null
   * when the build predates the stamp / cannot be determined.
   */
  build: number | null;
}

export interface LatestRelease {
  tag: string;
  /** App version parsed out of the tag. */
  version: string;
  /** Workflow run parsed out of the tag, or null when absent. */
  build: number | null;
  /** Human-readable release name (falls back to the tag). */
  name: string;
  /** Release page on GitHub. */
  pageUrl: string;
  /** Direct APK download URL (falls back to the permanent link). */
  downloadUrl: string;
  publishedAt: string | null;
  /** Release body (markdown notes). */
  notes: string;
}

/** Release tags are always `android-v<version>-r<run>` (legacy `v1.0.0-android` is never used). */
const RELEASE_TAG_RE = /^android-v(\d+(?:\.\d+){0,3})(?:-r(\d+))?$/;

/** Parses `android-v1.0.1-r26` → `{ version: '1.0.1', build: 26 }`. */
export function parseReleaseTag(tag: unknown): ReleaseTagInfo | null {
  if (typeof tag !== 'string') return null;
  const match = RELEASE_TAG_RE.exec(tag.trim());
  if (!match) return null;

  const parsedBuild = match[2] != null ? Number(match[2]) : Number.NaN;
  const build = Number.isInteger(parsedBuild) && parsedBuild > 0 ? parsedBuild : null;
  return { version: match[1], build };
}

/** Splits a version into numeric parts; non-numeric segments count as 0. */
function versionParts(value: string): number[] {
  return String(value)
    .split('.')
    .map((part) => {
      const parsed = Number.parseInt(part, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    });
}

/**
 * Compares two dotted versions: -1 when `a < b`, 0 when equal, 1 when `a > b`.
 * Tolerant by design — anything unparsable degrades to 0 so a malformed payload
 * never throws mid-render.
 */
export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

/**
 * Reads the CI-stamped build number out of an app config's `extra` object.
 * Returns null for anything that is not a positive integer.
 */
export function readStampedBuildRun(extra: unknown): number | null {
  if (!extra || typeof extra !== 'object') return null;

  const raw = (extra as Record<string, unknown>).buildRun;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Validates a GitHub `releases/latest` payload. Returns null for anything that
 * is not a release we can offer (404 bodies, rate-limit notices, malformed
 * JSON shapes), so callers can simply skip the banner.
 */
export function buildReleaseInfo(payload: unknown): LatestRelease | null {
  if (!payload || typeof payload !== 'object') return null;

  const record = payload as Record<string, unknown>;
  if (typeof record.tag_name !== 'string') return null;

  const tag = parseReleaseTag(record.tag_name);
  if (!tag) return null;

  const assets = Array.isArray(record.assets) ? record.assets : [];
  const apkAsset = assets.find((asset) => {
    if (!asset || typeof asset !== 'object') return false;
    const name = (asset as Record<string, unknown>).name;
    return typeof name === 'string' && name.toLowerCase().endsWith('.apk');
  }) as Record<string, unknown> | undefined;

  const assetUrl =
    apkAsset && typeof apkAsset.browser_download_url === 'string' ? apkAsset.browser_download_url : null;

  return {
    tag: record.tag_name,
    version: tag.version,
    build: tag.build,
    name: typeof record.name === 'string' && record.name.trim() ? record.name : record.tag_name,
    pageUrl:
      typeof record.html_url === 'string'
        ? record.html_url
        : `https://github.com/${RELEASE_REPO}/releases/tag/${record.tag_name}`,
    downloadUrl: assetUrl ?? PERMANENT_APK_URL,
    publishedAt: typeof record.published_at === 'string' ? record.published_at : null,
    notes: typeof record.body === 'string' ? record.body : '',
  };
}

/**
 * Decides whether the latest release is worth prompting the user about.
 *
 * - A newer product version always wins (a real version bump is a milestone).
 * - On the same version the workflow run decides, because this project ships
 *   many builds of 1.0.1. An installed build that cannot be determined counts
 *   as 0, so an app that cannot prove which build it is gets told about any
 *   published build of the same version.
 * - Anything older (installed version ahead, same build) is not an update.
 */
export function isNewerRelease(installed: InstalledAppInfo, latest: LatestRelease): boolean {
  const comparison = compareVersions(latest.version, installed.version ?? '0.0.0');
  if (comparison > 0) return true;
  if (comparison < 0) return false;

  const installedBuild = installed.build ?? 0;
  const latestBuild = latest.build ?? 0;
  return latestBuild > installedBuild;
}

/** `{ version: '1.0.1', build: 27 }` → `'1.0.1 (27)'` — a locale-neutral label. */
export function formatReleaseLabel(release: Pick<LatestRelease, 'version' | 'build'>): string {
  return release.build != null ? `${release.version} (${release.build})` : release.version;
}
