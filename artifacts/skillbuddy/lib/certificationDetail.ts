import type { CertificationResponse } from '@/types';

/**
 * Certification detail (GET /api/v1/certifications/{certification_id}) helpers.
 *
 * Kept pure so the cold-open rules can be tested with plain node:
 *  - a route param is only valid when it is a positive integer,
 *  - a cached row is used only when it is a complete certification,
 *  - a MISSING row is always fetched from the server, even when the list
 *    cache is already `ready` (the bug behind direct opens staying on the
 *    loader),
 *  - the response may be the bare CertificationResponse documented today or a
 *    `{ certification }` wrapper, and both normalize to one row,
 *  - 404 means not-found; any other rejection is a retryable error.
 */

export type CertificationDetailResult =
  | { status: 'ready'; cert: CertificationResponse }
  | { status: 'notfound' }
  | { status: 'error' };

/** A route param is valid only as a positive integer id. */
export function parseCertificationId(
  raw: string | string[] | undefined | null
): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const id = Number(trimmed);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Accept the documented bare row (and tolerantly the wrapped shape some list
 * endpoints use). Returns null when the id/url needed by the screen are absent,
 * so a malformed row can never render a blank card with both actions.
 */
export function normalizeCertification(
  raw: unknown,
  expectedId?: number
): CertificationResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate =
    'certification' in raw
      ? (raw as { certification?: unknown }).certification
      : raw;
  if (!candidate || typeof candidate !== 'object') return null;

  const row = candidate as Partial<CertificationResponse>;
  const id = Number(row.id);
  const url = typeof row.certification_url === 'string' ? row.certification_url.trim() : '';
  if (!Number.isSafeInteger(id) || id <= 0 || !url) return null;
  if (expectedId != null && id !== expectedId) return null;

  return row as CertificationResponse;
}

/** Both detail actions are rendered for any complete certification row. */
export function hasCertificationActions(cert: CertificationResponse | null): boolean {
  return !!cert && typeof cert.certification_url === 'string' && !!cert.certification_url.trim();
}

export interface CertificationDetailDeps {
  cached: CertificationResponse[];
  /** Fetch ONE row. A 404 is expected to resolve to null; other failures throw. */
  fetchOne: (id: number) => Promise<CertificationResponse | null>;
}

/**
 * Cold-open safe loader. The cache is a shortcut, never a gate: a valid cached
 * row answers immediately, otherwise ONE server read runs. That is the
 * regression this module exists for — the previous hook returned null without
 * fetching when the list cache was `ready` but did not contain this id.
 */
export async function loadCertificationDetail(
  certificationId: number,
  deps: CertificationDetailDeps
): Promise<CertificationDetailResult> {
  if (!Number.isSafeInteger(certificationId) || certificationId <= 0) {
    return { status: 'notfound' };
  }

  const cached = deps.cached.find((row) => row.id === certificationId);
  const cachedCert = normalizeCertification(cached, certificationId);
  if (cachedCert) return { status: 'ready', cert: cachedCert };

  let fetched: CertificationResponse | null;
  try {
    fetched = await deps.fetchOne(certificationId);
  } catch {
    return { status: 'error' };
  }

  const cert = normalizeCertification(fetched, certificationId);
  return cert ? { status: 'ready', cert } : { status: 'notfound' };
}
