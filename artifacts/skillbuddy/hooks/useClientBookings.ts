import { useCallback, useRef, useState } from 'react';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import type { ClientBooking } from '@/types';

/**
 * Client bookings state (GET /api/v1/clients/bookings):
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     list loaded (possibly empty — the screen renders the
 *              "no bookings yet" state for an empty array)
 *  - error     network/5xx — retryable
 *
 * READ-ONLY list, kept separate from every other cache. Booking items are
 * opaque per the OpenAPI schema — consume via lib/bookingFields.ts (the web
 * app's candidate-key strategy; no guessed fields). No pagination exists
 * (parameters: []) — `total` is the full count.
 *
 * Cache discipline: NO cross-session cache — bookings change frequently, so
 * this refetches on every screen entry (caller gates on role/auth) and on
 * pull-to-refresh via refresh().
 */
export type ClientBookingsStatus = 'idle' | 'loading' | 'ready' | 'error';

export function useClientBookings() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<ClientBookingsStatus>('idle');
  const [bookings, setBookings] = useState<ClientBooking[]>([]);
  const [total, setTotal] = useState(0);
  const [errorMessage, setErrorMessage] = useState<TranslationKey | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (!force && status === 'ready') return; // already have it for this visit
    inFlight.current = true;
    setStatus('loading');
    try {
      const { data } = await authApi.getClientBookings();
      setBookings(Array.isArray(data?.bookings) ? data.bookings : []);
      setTotal(typeof data?.total === 'number' ? data.total : 0);
      setStatus('ready');
    } catch {
      setStatus('error');
      setErrorMessage('cb_err_network');
    } finally {
      inFlight.current = false;
    }
  }, [status]);

  return { status, bookings, total, errorMessage, load, refresh: () => load(true), t };
}

export default useClientBookings;
