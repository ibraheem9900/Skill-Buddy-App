import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { useAppAlert } from '@/context/AlertModalContext';
import { useLanguage } from '@/context/LanguageContext';
import { prepareMedia, type PreparedMedia } from '@/lib/serviceMedia';

/**
 * ONE service's media (GET /api/v1/services/{service_id}/media).
 *
 * WHY THIS EXISTS SEPARATELY: Get Service by ID already embeds the same
 * ServiceMediaResponse array, so calling both on one screen would fetch the
 * same data twice. Per the product decision, the Service Detail screen keeps
 * rendering the detail response's `media` (zero extra requests) and this hook
 * backs a standalone gallery / lazy-load path where media must load or
 * refresh WITHOUT pulling the whole service.
 *
 * STATES (mirrors useServiceDetail, since the failure modes are identical):
 *  - idle      not started (or a cached id was hydrated without a request)
 *  - loading   request in flight
 *  - ready     media loaded (possibly an empty array)
 *  - notfound  404 "Service not found." (live-verified; undocumented but real)
 *  - invalid   422 int_parsing — service_id was not an integer
 *  - error     timeout / network / 5xx — anything else
 *
 * ERROR HANDLING (requirement: 422 separately from network errors, never
 * crash, always visible to the user):
 *  - 422 → the server's `detail` array is logged to the console for debugging
 *    AND surfaced through the app's existing alert modal (useAppAlert) with a
 *    Try Again action. The hook can only be used under AlertModalProvider,
 *    which app/_layout.tsx already wraps the whole app in.
 *  - timeout (axios ECONNABORTED) and any other non-2xx → `error`, logged,
 *    and announced with the same retryable alert. `isTimeout` is exposed so a
 *    caller can word a timeout differently if it wants to.
 *  - 404 → `notfound`, logged only. A missing service is not a gallery
 *    failure, so the caller renders its empty/not-found state without an
 *    alert instead of throwing an error dialog at the user.
 *
 * ORDERING: results are always position-sorted and URL-less entries dropped by
 * lib/serviceMedia.prepareMedia, so `media` is gallery-order ready.
 *
 * CACHE: per numeric id, module-level, so revisiting a service neither
 * re-fetches nor flickers. `refresh()` force-refetches.
 */
export type ServiceMediaStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'notfound'
  | 'invalid'
  | 'error';

const cache = new Map<number, PreparedMedia[]>();

export function useServiceMedia(serviceId: number | null) {
  const showAlert = useAppAlert();
  const { t } = useLanguage();

  const [status, setStatus] = useState<ServiceMediaStatus>(
    serviceId !== null && cache.has(serviceId) ? 'ready' : 'idle'
  );
  const [media, setMedia] = useState<PreparedMedia[]>(
    serviceId !== null ? cache.get(serviceId) ?? [] : []
  );
  const [isTimeout, setIsTimeout] = useState(false);
  const inFlight = useRef(false);

  // The id can change while this hook stays mounted (same route, new param).
  // Adjust state during render rather than showing the previous service's
  // gallery for a frame.
  const [lastId, setLastId] = useState(serviceId);
  if (serviceId !== lastId) {
    setLastId(serviceId);
    setMedia(serviceId !== null ? cache.get(serviceId) ?? [] : []);
    setStatus(serviceId !== null && cache.has(serviceId) ? 'ready' : 'idle');
  }

  const load = useCallback(
    async (force = false) => {
      if (serviceId === null || inFlight.current) return;
      if (!force && cache.has(serviceId)) {
        setMedia(cache.get(serviceId)!);
        setStatus('ready');
        return;
      }

      inFlight.current = true;
      setStatus('loading');
      setIsTimeout(false);

      try {
        const { data } = await authApi.getServiceMedia(serviceId);
        const prepared = prepareMedia(data);
        cache.set(serviceId, prepared);
        setMedia(prepared);
        setStatus('ready');
      } catch (err: any) {
        const statusNum: number | undefined = err?.response?.status;
        const body: unknown = err?.response?.data;
        const timedOut =
          err?.code === 'ECONNABORTED' ||
          (typeof err?.message === 'string' && /timeout/i.test(err.message));

        if (statusNum === 422) {
          // Requirement: log the validation `detail` array for debugging.
          console.log(
            '[useServiceMedia] 422 validation error for service',
            serviceId,
            JSON.stringify((body as any)?.detail ?? body)
          );
          setStatus('invalid');
          showAlert({
            title: t('error_title'),
            message: t('svcd_invalid'),
            icon: 'alert-circle',
            buttons: [{ text: t('error_retry'), onPress: () => load(true) }],
          });
        } else if (statusNum === 404) {
          console.log(
            '[useServiceMedia] 404 Service not found for id',
            serviceId
          );
          setStatus('notfound');
        } else {
          console.log(
            '[useServiceMedia] GET /api/v1/services/{id}/media failed',
            timedOut ? 'timeout' : statusNum,
            body ?? err?.message
          );
          setIsTimeout(timedOut);
          setStatus('error');
          showAlert({
            title: t('error_title'),
            message: t('svcd_load_error'),
            icon: 'wifi-off',
            buttons: [{ text: t('error_retry'), onPress: () => load(true) }],
          });
        }
      } finally {
        inFlight.current = false;
      }
    },
    [serviceId, showAlert, t]
  );

  return { status, media, isTimeout, load, refresh: () => load(true) };
}

export default useServiceMedia;
