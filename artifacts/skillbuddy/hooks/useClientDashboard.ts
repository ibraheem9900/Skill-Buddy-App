import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { classifyDataFailure, type DataFailure } from '@/lib/dataState';
import type { ClientDashboardSummary } from '@/types';

/**
 * Client dashboard summary state (GET /api/v1/clients/dashboard) — the
 * client's lightweight activity strip:
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     summary loaded (data set)
 *  - error     the request FAILED (network/timeout/5xx/4xx) — retryable
 *
 * A response with zeros is NOT an error: it lands in 'ready' with the real
 * zeros, and the screen renders them without a Retry. `failure` carries the
 * classified cause so the copy can name it (only 'network' may mention the
 * connection), and "no client profile" arrives as kind 'client-profile'.
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
  const [status, setStatus] = useState<ClientDashboardStatus>('idle');
  const [summary, setSummary] = useState<ClientDashboardSummary | null>(null);
  const [failure, setFailure] = useState<DataFailure | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (!force && status === 'ready') return; // already have it for this visit
    inFlight.current = true;
    setStatus('loading');
    setFailure(null);
    try {
      const { data } = await authApi.getClientDashboard();
      setSummary(data);
      setStatus('ready');
    } catch (err) {
      setSummary(null);
      setFailure(classifyDataFailure(err));
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }, [status]);

  return { status, summary, failure, load, refresh: () => load(true) };
}

export default useClientDashboard;
