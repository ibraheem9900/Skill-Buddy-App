import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import type { ServiceDetailResponse } from '@/types';

/**
 * ONE service's full detail (GET /api/v1/services/{service_id}):
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     detail loaded
 *  - notfound  404 "Service not found." (live-verified; undocumented but real)
 *  - invalid   422 int_parsing — service_id was not an integer (retryable,
 *              though pointless without a different id)
 *  - error     network/timeout/any other non-2xx — retryable
 *
 * ERROR HANDLING mirrors the category-services hook, with the 404/422
 * distinction the requirement asks for:
 *  - 404 → `notfound` (the user sees a "not available" card, not a generic
 *    network error — a dead link and a broken Wi-Fi must not look the same)
 *  - 422 → `invalid`, with the server's `detail` array logged to the console
 *    for debugging (requirement 6)
 *  - everything else → `error`, status + body logged
 *
 * CACHE DISCIPLINE: detail records are cached per numeric id in a module
 * Map (the SAME id always re-fetches on revisit otherwise — the detail
 * schema is richer than the list item, so a list entry can never satisfy
 * this view). `refresh()` force-refetches; screen retry calls it.
 */
export type ServiceDetailStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'notfound'
  | 'invalid'
  | 'error';

const cache = new Map<number, ServiceDetailResponse>();

export function useServiceDetail(serviceId: number | null) {
  const [status, setStatus] = useState<ServiceDetailStatus>(
    serviceId !== null && cache.has(serviceId) ? 'ready' : 'idle'
  );
  const [service, setService] = useState<ServiceDetailResponse | null>(
    serviceId !== null ? cache.get(serviceId) ?? null : null
  );
  const inFlight = useRef(false);

  const load = useCallback(
    async (force = false) => {
      if (serviceId === null || inFlight.current) return;
      if (!force && cache.has(serviceId)) {
        setService(cache.get(serviceId)!);
        setStatus('ready');
        return;
      }
      inFlight.current = true;
      setStatus('loading');
      try {
        const { data } = await authApi.getServiceById(serviceId);
        cache.set(serviceId, data);
        setService(data);
        setStatus('ready');
      } catch (err: any) {
        const statusNum: number | undefined = err?.response?.status;
        const body: unknown = err?.response?.data;
        if (statusNum === 404) {
          console.log('[useServiceDetail] 404 Service not found for id', serviceId);
          setStatus('notfound');
        } else if (statusNum === 422) {
          // Requirement 6: log the validation `detail` array for debugging.
          console.log(
            '[useServiceDetail] 422 validation error for id',
            serviceId,
            JSON.stringify(body)
          );
          setStatus('invalid');
        } else {
          console.log(
            '[useServiceDetail] GET /api/v1/services/{id} failed',
            statusNum,
            body ?? err?.message
          );
          setStatus('error');
        }
      } finally {
        inFlight.current = false;
      }
    },
    [serviceId]
  );

  return { status, service, load, refresh: () => load(true) };
}

export default useServiceDetail;
