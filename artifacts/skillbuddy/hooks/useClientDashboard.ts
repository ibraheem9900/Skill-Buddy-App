import { useCallback, useRef, useState } from 'react';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import type { ClientDashboardSummary } from '@/types';

/**
 * Client dashboard summary state (GET /api/v1/clients/dashboard) — the
 * client's lightweight activity strip:
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     summary loaded (data set)
 *  - error     network/5xx — retryable (inline retry on the Home strip)
 *
 * READ-ONLY display data, kept COMPLETELY SEPARATE from useClientProfile —
 * per spec this summary is never merged into the profile cache and is never
 * the source of truth for anything editable. Unlike the profile hook this
 * data is NOT cached across sessions: stats change frequently, so it refetches
 * fresh on every dashboard entry (spec: fetch on open / pull-to-refresh) and
 * supports forced refresh from the screen's pull-to-refresh handler.
 */
export type ClientDashboardStatus = 'idle' | 'loading' | 'ready' | 'error';

export function useClientDashboard() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<ClientDashboardStatus>('idle');
  const [summary, setSummary] = useState<ClientDashboardSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<TranslationKey | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (!force && status === 'ready') return; // already have it for this visit
    inFlight.current = true;
    setStatus('loading');
    try {
      const { data } = await authApi.getClientDashboard();
      setSummary(data);
      setStatus('ready');
    } catch {
      setStatus('error');
      setErrorMessage('cd_err_network');
    } finally {
      inFlight.current = false;
    }
  }, [status]);

  return { status, summary, errorMessage, load, refresh: () => load(true), t };
}

export default useClientDashboard;
