import { useCallback, useRef, useState } from 'react';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import type { ProviderDashboardSummary } from '@/types';

/**
 * Provider dashboard summary state (GET /api/v1/providers/dashboard):
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     summary loaded (data set)
 *  - none      caller has no provider profile (404-style — the dashboard
 *              screen handles routing to the create-profile flow)
 *  - error     network/5xx — retryable
 *
 * READ-ONLY summary cache, kept COMPLETELY SEPARATE from useProviderProfile:
 * per spec this response (five fields: user_id, job counts, is_available,
 * is_active) must never be merged into or overwrite the editable
 * ProviderProfile cache, and must never pre-fill the edit form.
 *
 * Fetch discipline: once per session on first dashboard entry + manual
 * refresh only (no per-render refetches).
 */
export type ProviderDashboardStatus = 'idle' | 'loading' | 'ready' | 'none' | 'error';

let cache: ProviderDashboardSummary | null = null;
let cacheStatus: ProviderDashboardStatus = 'idle';

export function useProviderDashboard() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<ProviderDashboardStatus>(cacheStatus);
  const [summary, setSummary] = useState<ProviderDashboardSummary | null>(cache);
  const [errorMessage, setErrorMessage] = useState<TranslationKey | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(
    async (force = false) => {
      if (inFlight.current) return;
      if (!force && cacheStatus === 'ready') return; // cached — no re-fetch
      inFlight.current = true;
      setStatus('loading');
      try {
        const { data } = await authApi.getProviderDashboard();
        cache = data;
        cacheStatus = 'ready';
        setSummary(data);
        setStatus('ready');
      } catch (err: any) {
        if (err?.response?.status === 404) {
          // "No provider profile yet" (same convention as useProviderProfile;
          // response shape not documented — 404 assumed, flagged for team).
          cache = null;
          cacheStatus = 'none';
          setSummary(null);
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

  return { status, summary, errorMessage, load, refresh: () => load(true), t };
}

export default useProviderDashboard;
