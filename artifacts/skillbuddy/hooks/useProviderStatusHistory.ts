import { useCallback, useRef, useState } from 'react';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import type { ProviderStatusResponse } from '@/types';

/**
 * Provider status history state (GET /api/v1/providers/status-history):
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     history loaded (entries set — possibly empty = "no changes yet")
 *  - error     network/5xx — retryable
 *
 * Module-level cache, kept SEPARATE from the profile and dashboard caches:
 * fetched once per session on dashboard entry + manual refresh. The status
 * POST flow does NOT need to re-fetch this (newest entry == the POST
 * response) but a refresh keeps the list honest, so the screen calls
 * refresh() after a successful status change.
 *
 * NOTE: entries carry no id/timestamp (live-spec verified) — list keys use
 * the array index as a fallback and no "when" is shown (flagged to team).
 */
export type StatusHistoryState = 'idle' | 'loading' | 'ready' | 'error';

let cache: ProviderStatusResponse[] | null = null;
let cacheState: StatusHistoryState = 'idle';

export function useProviderStatusHistory() {
  const { t } = useLanguage();
  const [state, setState] = useState<StatusHistoryState>(cacheState);
  const [entries, setEntries] = useState<ProviderStatusResponse[] | null>(cache);
  const [errorMessage, setErrorMessage] = useState<TranslationKey | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(
    async (force = false) => {
      if (inFlight.current) return;
      if (!force && cacheState === 'ready') return; // cached — no re-fetch
      inFlight.current = true;
      setState('loading');
      try {
        const { data } = await authApi.getProviderStatusHistory();
        cache = Array.isArray(data) ? data : [];
        cacheState = 'ready';
        setEntries(cache);
        setState('ready');
      } catch (err: any) {
        cacheState = 'error';
        setState('error');
        setErrorMessage(err?.response ? 'prov_err_generic' : 'prov_err_network');
      } finally {
        inFlight.current = false;
      }
    },
    [],
  );

  return { state, entries, errorMessage, load, refresh: () => load(true), t };
}

export default useProviderStatusHistory;
