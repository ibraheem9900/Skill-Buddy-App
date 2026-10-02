import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  LATEST_RELEASE_API_URL,
  buildReleaseInfo,
  isNewerRelease,
  readStampedBuildRun,
  type LatestRelease,
} from '@/lib/appUpdate';

/**
 * In-app update check (see lib/appUpdate.ts for the rules).
 *
 * Fetches the repository's latest GitHub Release and compares it with the APK
 * this phone was installed from. The installed build number is stamped into
 * app.json by the apk-build CI job as `extra.buildRun`; OTA manifests carry no
 * buildRun, so the first build number this install ever reports is remembered
 * and keeps identifying the APK even after JS updates have been applied.
 *
 * Behaviour:
 *   - Android release builds only (not web, not Expo Go, not __DEV__).
 *   - A successful check is cached for six hours; the app does not poll GitHub
 *     on every launch (unauthenticated API rate limits are real).
 *   - Failures are silent: the banner simply stays hidden (or keeps showing the
 *     last known release) — a background update check must never block the app.
 *   - Re-checks when the app returns to the foreground (TTL-guarded) so a
 *     release published while the app was backgrounded shows up on resume.
 *
 * Status:
 *   idle        nothing checked yet
 *   ready       a release was loaded (fresh or cached) — `latest` is set
 *   error       GitHub could not be reached and nothing was cached
 *   unsupported not an Android release build — the check is skipped entirely
 */

export type AppUpdateStatus = 'idle' | 'ready' | 'error' | 'unsupported';

const CACHE_KEY = 'sb_update_release_cache_v1';
const INSTALLED_BUILD_KEY = 'sb_update_installed_build_v1';
const DISMISSED_TAG_KEY = 'sb_update_dismissed_tag_v1';

/** A successful check is trusted for this long before GitHub is asked again. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** After a failed attempt, wait this long before trying again (per launch). */
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12000;

interface CachedRelease {
  checkedAt: number;
  release: LatestRelease;
}

/** Module-level so every mount/foreground event respects the same failure backoff. */
let lastFetchAttemptAt = 0;

/** The banner targets sideloaded APKs; every other environment is skipped. */
function isSupportedPlatform(): boolean {
  return Platform.OS === 'android' && !__DEV__ && Constants.appOwnership !== 'expo';
}

async function readCache(): Promise<CachedRelease | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CachedRelease> | null;
    if (!parsed || typeof parsed.checkedAt !== 'number' || !parsed.release) return null;

    const release = parsed.release as LatestRelease;
    if (
      typeof release.tag !== 'string' ||
      typeof release.version !== 'string' ||
      typeof release.downloadUrl !== 'string'
    ) {
      return null;
    }
    return { checkedAt: parsed.checkedAt, release };
  } catch {
    return null;
  }
}

async function writeCache(value: CachedRelease): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // Storage is best-effort: a full cache just means the next launch re-fetches.
  }
}

export function useAppUpdate() {
  const [status, setStatus] = useState<AppUpdateStatus>('idle');
  const [latest, setLatest] = useState<LatestRelease | null>(null);
  const [installedBuild, setInstalledBuild] = useState<number | null>(null);
  const [dismissedTag, setDismissedTag] = useState<string | null>(null);
  const mounted = useRef(false);
  /** Per-instance: a remount must not be left waiting on another instance's fetch. */
  const fetching = useRef(false);

  const load = useCallback(async (force = false) => {
    if (!isSupportedPlatform()) {
      if (mounted.current) setStatus('unsupported');
      return;
    }
    if (fetching.current) return;

    // Which build is installed? A stamped config belongs to this APK (only the
    // apk-build job stamps buildRun), so record it; otherwise fall back to what
    // this install reported the first time it ran.
    const stamped = readStampedBuildRun(Constants.expoConfig?.extra);
    let knownBuild = stamped;
    if (stamped != null) {
      void AsyncStorage.setItem(INSTALLED_BUILD_KEY, String(stamped)).catch(() => {});
    } else {
      const stored = await AsyncStorage.getItem(INSTALLED_BUILD_KEY).catch(() => null);
      const parsedStored = stored != null ? Number(stored) : Number.NaN;
      knownBuild = Number.isInteger(parsedStored) && parsedStored > 0 ? parsedStored : null;
    }

    const cached = await readCache();
    const storedDismissed = await AsyncStorage.getItem(DISMISSED_TAG_KEY).catch(() => null);

    if (mounted.current) {
      setInstalledBuild(knownBuild);
      setDismissedTag(storedDismissed);
    }

    const cachedAt = cached?.checkedAt ?? 0;
    const fresh = cached != null && Date.now() - cachedAt < CACHE_TTL_MS;
    if (!force) {
      if (fresh) {
        if (mounted.current) {
          setLatest(cached.release);
          setStatus('ready');
        }
        return;
      }
      if (Date.now() - lastFetchAttemptAt < RETRY_AFTER_FAILURE_MS) {
        if (mounted.current) {
          if (cached) {
            setLatest(cached.release);
            setStatus('ready');
          } else {
            setStatus('error');
          }
        }
        return;
      }
    }

    fetching.current = true;
    lastFetchAttemptAt = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let payload: unknown;
      try {
        const response = await fetch(LATEST_RELEASE_API_URL, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`GitHub responded ${response.status}`);
        payload = await response.json();
      } finally {
        clearTimeout(timer);
      }

      const release = buildReleaseInfo(payload);
      if (!release) throw new Error('Unexpected release payload');

      await writeCache({ checkedAt: Date.now(), release });
      if (mounted.current) {
        setLatest(release);
        setStatus('ready');
      }
    } catch (err) {
      console.log(
        '[useAppUpdate] latest release check failed',
        err instanceof Error ? err.message : err
      );
      if (mounted.current) {
        if (cached) {
          setLatest(cached.release);
          setStatus('ready');
        } else {
          setStatus('error');
        }
      }
    } finally {
      fetching.current = false;
    }
  }, []);

  /** Hides the banner for one release tag; the next release brings it back. */
  const dismiss = useCallback(() => {
    if (!latest) return;
    setDismissedTag(latest.tag);
    void AsyncStorage.setItem(DISMISSED_TAG_KEY, latest.tag).catch(() => {});
  }, [latest]);

  useEffect(() => {
    mounted.current = true;
    void load();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });

    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, [load]);

  const installedVersion = Constants.expoConfig?.version ?? null;
  // A build that can report neither a version nor a stamped build number cannot
  // compare itself with anything — stay quiet rather than nag around the clock.
  const hasInstalledIdentity = installedVersion != null || installedBuild != null;
  const updateAvailable =
    status === 'ready' &&
    hasInstalledIdentity &&
    latest != null &&
    isNewerRelease({ version: installedVersion, build: installedBuild }, latest);

  return {
    status,
    latest,
    installedBuild,
    /** True when the banner should be shown to the user. */
    visible: updateAvailable && latest != null && latest.tag !== dismissedTag,
    dismiss,
    check: load,
  };
}

export default useAppUpdate;
