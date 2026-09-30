import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { useAppAlert } from '@/context/AlertModalContext';
import { useLanguage } from '@/context/LanguageContext';
import type { ServiceInclusionOption } from '@/types';

/**
 * ONE service's inclusion options ("what's included") from
 * GET /api/v1/services/{service_id}/inclusion-options.
 *
 * WHY THIS EXISTS SEPARATELY: Get Service by ID already returns
 * `inclusion_options` as an array of the SAME InclusionOptionResponse schema,
 * so calling both on one screen would fetch the same data twice. Per the
 * product decision (same as the service media task), the Service Detail screen
 * keeps rendering the detail response's array — zero extra requests — and this
 * hook backs a standalone list / lazy-load path where the options must load or
 * refresh WITHOUT pulling the whole service.
 *
 * STATES (mirrors useServiceMedia / useServiceDetail, since the failure modes
 * are identical):
 *  - idle      not started (or a cached id was hydrated without a request)
 *  - loading   request in flight
 *  - ready     loaded (possibly an empty array)
 *  - notfound  404 "Service not found." (live-verified; undocumented but real)
 *  - invalid   422 int_parsing — service_id was not an integer
 *  - error     timeout / network / 5xx — anything else
 *
 * ERROR HANDLING (422 separately from network errors, never crash, always
 * visible to the user):
 *  - 422 → the server's `detail` array is logged to the console for debugging
 *    AND surfaced through the app's existing alert modal (useAppAlert) with a
 *    Try Again action. The hook therefore has to run under
 *    AlertModalProvider, which app/_layout.tsx already wraps the app in.
 *  - timeout (axios ECONNABORTED) and any other non-2xx → `error`, logged and
 *    announced with the same retryable alert; `isTimeout` is exposed so a
 *    caller can word a timeout differently.
 *  - 404 → `notfound`, logged only: a missing service is not a failure of this
 *    list, so the caller renders its own state instead of an error dialog.
 *
 * NORMALISATION: names are trimmed and entries with a blank name are dropped,
 * so the UI never renders an empty bullet. `Normalisation` keeps the server's
 * order — `position` does not exist on this schema.
 *
 * CACHE: per numeric id, module-level, so revisiting a service neither
 * re-fetches nor flickers. `refresh()` force-refetches.
 */
export type ServiceInclusionOptionsStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'notfound'
  | 'invalid'
  | 'error';

/**
 * Pure normaliser (exported so it is unit-testable without React): trims
 * names, drops entries without a usable name, tolerates null/undefined.
 */
export function normalizeInclusionOptions(
  items: ServiceInclusionOption[] | null | undefined
): ServiceInclusionOption[] {
  if (!Array.isArray(items)) return [];

  return items
    .filter(
      (item): item is ServiceInclusionOption =>
        !!item &&
        typeof item.name === 'string' &&
        item.name.trim().length > 0
    )
    .map((item) => ({ id: item.id, name: item.name.trim() }));
}

const cache = new Map<number, ServiceInclusionOption[]>();

export function useServiceInclusionOptions(serviceId: number | null) {
  const showAlert = useAppAlert();
  const { t } = useLanguage();

  const [status, setStatus] = useState<ServiceInclusionOptionsStatus>(
    serviceId !== null && cache.has(serviceId) ? 'ready' : 'idle'
  );
  const [options, setOptions] = useState<ServiceInclusionOption[]>(
    serviceId !== null ? cache.get(serviceId) ?? [] : []
  );
  const [isTimeout, setIsTimeout] = useState(false);
  const inFlight = useRef(false);

  // The id can change while this hook stays mounted (same route, new param).
  // Adjust state during render rather than showing the previous service's
  // options for a frame.
  const [lastId, setLastId] = useState(serviceId);
  if (serviceId !== lastId) {
    setLastId(serviceId);
    setOptions(serviceId !== null ? cache.get(serviceId) ?? [] : []);
    setStatus(serviceId !== null && cache.has(serviceId) ? 'ready' : 'idle');
  }

  const load = useCallback(
    async (force = false) => {
      if (serviceId === null || inFlight.current) return;
      if (!force && cache.has(serviceId)) {
        setOptions(cache.get(serviceId)!);
        setStatus('ready');
        return;
      }

      inFlight.current = true;
      setStatus('loading');
      setIsTimeout(false);

      try {
        const { data } = await authApi.getServiceInclusionOptions(serviceId);
        const prepared = normalizeInclusionOptions(data);
        cache.set(serviceId, prepared);
        setOptions(prepared);
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
            '[useServiceInclusionOptions] 422 validation error for service',
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
            '[useServiceInclusionOptions] 404 Service not found for id',
            serviceId
          );
          setStatus('notfound');
        } else {
          console.log(
            '[useServiceInclusionOptions] GET /api/v1/services/{id}/inclusion-options failed',
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

  return { status, options, isTimeout, load, refresh: () => load(true) };
}

export default useServiceInclusionOptions;
