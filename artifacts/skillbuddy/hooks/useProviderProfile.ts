import { useCallback, useRef, useState } from 'react';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import type { ProviderProfile } from '@/types';

/**
 * Provider profile state machine:
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     profile loaded (data set)
 *  - none      server says this user has no provider profile (404-style) —
 *              the UI shows the "create profile" state, NOT a broken dashboard
 *  - error     network/5xx — retryable
 *
 * Cached at module level: the endpoint is fetched once per app session on
 * first dashboard entry (per the no-unnecessary-refetches rule) and only
 * re-fetched via refresh() after profile create/update or manual refresh.
 */
export type ProviderProfileStatus = 'idle' | 'loading' | 'ready' | 'none' | 'error';

let cache: ProviderProfile | null = null;
let cacheStatus: ProviderProfileStatus = 'idle';

export function useProviderProfile() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<ProviderProfileStatus>(cacheStatus);
  const [profile, setProfile] = useState<ProviderProfile | null>(cache);
  const [errorMessage, setErrorMessage] = useState<TranslationKey | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(
    async (force = false) => {
      if (inFlight.current) return;
      if (!force && cacheStatus === 'ready') return; // cached — no re-fetch
      inFlight.current = true;
      setStatus('loading');
      try {
        const { data } = await authApi.getProviderProfile();
        cache = data;
        cacheStatus = 'ready';
        setProfile(data);
        setStatus('ready');
      } catch (err: any) {
        if (err?.response?.status === 404) {
          // "No provider profile yet" (response shape not documented —
          // 404 assumed; flagged for team confirmation). Cacheable state.
          cache = null;
          cacheStatus = 'none';
          setProfile(null);
          setStatus('none');
        } else {
          cacheStatus = 'error';
          setStatus('error');
          setErrorMessage(err?.response ? 'prov_err_generic' : 'prov_err_network');
        }
      } finally {
        inFlight.current = false;
      }
    },
    [],
  );

  /**
   * Replace the cached profile with server-confirmed data (the 200 response
   * of PATCH /providers/profile — the source of truth, never local guesses).
   * Called by the edit screen after a successful update so the dashboard
   * reflects changes instantly without a refetch.
   */
  const seedProfile = useCallback((data: ProviderProfile) => {
    cache = data;
    cacheStatus = 'ready';
    setProfile(data);
    setStatus('ready');
  }, []);

  /**
   * Sync the cached profile's current_status from GET
   * /api/v1/providers/status-current (the dedicated authority for the status
   * head — the profile response's current_status can be stale). No network
   * call itself: callers fetch once on dashboard entry and seed the result
   * here, so POST /providers/status success and this GET share ONE state —
   * no duplicate fetching (the POST path skips the GET entirely).
   */
  const seedCurrentStatus = useCallback((data: { status: string; reason?: string | null; is_current?: boolean } | null) => {
    if (!cache) return;
    const next: ProviderProfile = {
      ...cache,
      current_status: data ? { status: data.status, reason: data.reason ?? null, is_current: data.is_current ?? true } : null,
    };
    cache = next;
    cacheStatus = 'ready';
    setProfile(next);
    setStatus('ready');
  }, []);

  return { status, profile, errorMessage, load, refresh: () => load(true), seedProfile, seedCurrentStatus, t };
}

/**
 * Formatting helpers (hourly_rate is a decimal STRING per schema — often a
 * huge one, as the docs example shows; parse defensively).
 */
export function formatHourlyRate(raw: string | null | undefined, t: (k: TranslationKey) => string): string {
  if (raw == null || raw.trim() === '') return t('prov_rate_unavailable');
  const n = Number(raw);
  if (!Number.isFinite(n)) return t('prov_rate_unavailable');
  // Round to 2dp; cap absurd doc-example values by just formatting them.
  return `€${n.toFixed(2)}`;
}

export function formatAcceptanceRate(raw: number | null | undefined): string {
  if (raw == null) return '—';
  return `${raw}%`;
}

export default useProviderProfile;
