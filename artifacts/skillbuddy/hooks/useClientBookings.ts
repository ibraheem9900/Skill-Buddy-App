import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { classifyDataFailure, type DataFailure } from '@/lib/dataState';
import type { ClientBooking } from '@/types';

/**
 * Client bookings state (GET /api/v1/clients/bookings):
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     list loaded (possibly empty — the screen renders the
 *              "no bookings yet" state for an empty array)
 *  - error     the request FAILED — retryable
 *
 * An empty array is 'ready' with zero bookings, never an error. `failure`
 * carries the classified cause (see lib/dataState).
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
  const [status, setStatus] = useState<ClientBookingsStatus>('idle');
  const [bookings, setBookings] = useState<ClientBooking[]>([]);
  const [total, setTotal] = useState(0);
  const [failure, setFailure] = useState<DataFailure | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (!force && status === 'ready') return; // already have it for this visit
    inFlight.current = true;
    setStatus('loading');
    setFailure(null);
    try {
      const { data } = await authApi.getClientBookings();
      setBookings(Array.isArray(data?.bookings) ? data.bookings : []);
      setTotal(typeof data?.total === 'number' ? data.total : 0);
      setStatus('ready');
    } catch (err) {
      setBookings([]);
      setTotal(0);
      setFailure(classifyDataFailure(err));
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }, [status]);

  return { status, bookings, total, failure, load, refresh: () => load(true) };
}

export default useClientBookings;
