import { useCallback, useRef, useState } from 'react';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import type { ClientProfileResponse } from '@/types';

/**
 * Client activity-profile state (GET /api/v1/clients/profile) — the "My
 * Activity" stat set:
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     profile stats loaded (data set)
 *  - error     network/5xx — retryable (the profile tab renders a fallback)
 *
 * No documented error shape for this endpoint (no parameters); 401s flow
 * through the shared silent-refresh interceptor. The screen gates loading on
 * the active role, so provider-only sessions never hit this endpoint.
 *
 * Cache discipline: module-level cache + once-per-session fetch (the screen
 * gates loading on the active role and first CLIENT entry) + manual retry
 * from the error banner. Kept SEPARATE from every other cache.
 */
export type ClientProfileStatus = 'idle' | 'loading' | 'ready' | 'error';

let cache: ClientProfileResponse | null = null;
let cacheStatus: ClientProfileStatus = 'idle';

/** Parse the schema's decimal-string `total_amount_spent` safely. */
export function parseAmountSpent(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Format the parsed amount as EUR currency for display (never the raw string). */
export function formatAmountSpent(raw: string | null | undefined): string {
  const n = parseAmountSpent(raw);
  if (n === null) return '—';
  return `€${n.toLocaleString('en-EU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function useClientProfile() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<ClientProfileStatus>(cacheStatus);
  const [profile, setProfile] = useState<ClientProfileResponse | null>(cache);
  const [errorMessage, setErrorMessage] = useState<TranslationKey | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (!force && cacheStatus === 'ready') return; // cached — no re-fetch
    inFlight.current = true;
    setStatus('loading');
    try {
      const { data } = await authApi.getClientProfile();
      cache = data;
      cacheStatus = 'ready';
      setProfile(data);
      setStatus('ready');
    } catch {
      cacheStatus = 'error';
      setStatus('error');
      setErrorMessage('cstat_err_network');
    } finally {
      inFlight.current = false;
    }
  }, []);

  /**
   * PATCH /api/v1/clients/profile — persist a new preferred_language.
   * On success the FULL 200 response replaces the cached profile (server
   * truth, stats included — display-only, never edited). Throws the axios
   * error on failure so the caller can distinguish 422 from network.
   */
  const updateLanguage = useCallback(async (language: string | null): Promise<ClientProfileResponse> => {
    const { data } = await authApi.updateClientProfile({ preferred_language: language });
    cache = data;
    cacheStatus = 'ready';
    setProfile(data);
    setStatus('ready');
    return data;
  }, []);

  return { status, profile, errorMessage, load, refresh: () => load(true), updateLanguage, t };
}

export default useClientProfile;
