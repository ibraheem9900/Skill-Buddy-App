import { useCallback, useRef, useState } from 'react';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import type { CertificationResponse } from '@/types';

/**
 * Provider certifications state (GET /api/v1/certifications):
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     list loaded (possibly empty — the screen renders the
 *              "no certifications yet" state when the array is empty)
 *  - error     network/5xx — retryable
 *
 * READ-ONLY list, kept separate from every other cache. The response is a
 * WRAPPED object { certifications, total } — never treated as a bare array.
 * No pagination exists (parameters: []) — the endpoint scopes to the
 * authenticated provider via the token.
 *
 * Cache discipline: module-level cache + fetch on screen entry (caller gates
 * on role/auth) + pull-to-refresh via refresh(). The future Upload
 * Certification (POST) task should call refresh(true) after a successful
 * upload so the list stays in sync — the hook is ready for it.
 */
export type CertificationsStatus = 'idle' | 'loading' | 'ready' | 'error';

let cache: CertificationResponse[] = [];
let cachedTotal = 0;
let cacheStatus: CertificationsStatus = 'idle';

export function useCertifications() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<CertificationsStatus>(cacheStatus);
  const [certifications, setCertifications] = useState<CertificationResponse[]>(cache);
  const [total, setTotal] = useState(cachedTotal);
  const [errorMessage, setErrorMessage] = useState<TranslationKey | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (!force && cacheStatus === 'ready') return; // cached — no re-fetch
    inFlight.current = true;
    setStatus('loading');
    try {
      const { data } = await authApi.getCertifications();
      cache = Array.isArray(data?.certifications) ? data.certifications : [];
      cachedTotal = typeof data?.total === 'number' ? data.total : cache.length;
      cacheStatus = 'ready';
      setCertifications(cache);
      setTotal(cachedTotal);
      setStatus('ready');
    } catch {
      cacheStatus = 'error';
      setStatus('error');
      setErrorMessage('cert_err_network');
    } finally {
      inFlight.current = false;
    }
  }, []);

  /**
   * POST /api/v1/certifications — upload a certification file. The 201's
   * `certification` object is appended to the cached list (SERVER truth,
   * never a locally-guessed object) and `total` incremented; nothing changes
   * on failure — the caller surfaces the error. Called by the upload hook
   * after its pick/validate/confirm flow.
   */
  const upload = useCallback(async (file: { uri: string; name: string; mimeType: string }): Promise<string> => {
    const { data } = await authApi.uploadCertification(file);
    cache = [...cache, data.certification];
    cachedTotal = cachedTotal + 1;
    cacheStatus = 'ready';
    setCertifications(cache);
    setTotal(cachedTotal);
    return data.message;
  }, []);

  /**
   * GET ONE certification by id (GET /api/v1/certifications/{certification_id}).
   *
   * Same shape as a list item (live OpenAPI: $ref CertificationResponse), so
   * the list cache ALREADY carries every field — taps use the cached object
   * directly (zero network). The network call only fires when there is no
   * cached record (deep-link / notification-open case), per the agreed
   * decision: always-cache + fallback-only fetch. Returns null on 404 (not
   * documented — web precedent) and sets `errorMessage` otherwise.
   */
  const getById = useCallback(async (certificationId: number): Promise<CertificationResponse | null> => {
    const found = cache.find((c) => c.id === certificationId);
    if (found) return found; // cached — no network call at all

    if (cacheStatus !== 'ready') {
      try {
        const { data } = await authApi.getCertification(certificationId);
        return data;
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 404) return null;
        setErrorMessage('cert_err_network');
        throw err;
      }
    }
    return null;
  }, [cache, cacheStatus]);

  /**
   * DELETE /api/v1/certifications/{certification_id} — removes an uploaded
   * certification. NO optimistic removal: the cached row (and total) drops
   * ONLY after the confirmed 200 (or a 404/403 "already gone" sync per web
   * precedent) — on network failure/422 everything rethrows so the row
   * survives with a retry-able error. Returns the bare-string 200 body (if
   * any) for the caller's toast.
   */
  const remove = useCallback(async (certificationId: number): Promise<string | null> => {
    const data = await authApi.deleteCertification(certificationId);
    // Success (or already-gone) — drop the row from the shared cache.
    const before = cache.length;
    cache = cache.filter((c) => c.id !== certificationId);
    if (cache.length !== before) {
      cachedTotal = Math.max(0, cachedTotal - 1);
      setCertifications(cache);
      setTotal(cachedTotal);
    }
    return typeof data === 'string' ? data : null;
  }, []);

  return { status, certifications, total, errorMessage, load, refresh: () => load(true), upload, getById, remove, t };
}

export default useCertifications;
