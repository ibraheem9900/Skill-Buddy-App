/**
 * serviceGalleryFetch — ONE place that knows how a single service's public
 * page is fetched, so the paginated screen and the single-screen preview cannot
 * drift apart.
 *
 * PRIMARY SOURCE: GET /api/v1/services/{service_id}/gallery?limit&offset — the
 * dedicated endpoint (PUBLIC, verified live with and without a token). It
 * answers the SAME wrapper as List Public Media: {service_id, category_id,
 * items}, so normalisation is shared (normalizePublicMediaResponse).
 *
 * EDGE BEHAVIOUR (measured, not guessed):
 *   • unknown / media-less service → 200 with an EMPTY items array (service
 *     999999 verified live). It is NOT a 404, so a calm empty state is the
 *     normal outcome.
 *   • a 404 is still mapped to an empty page for safety (some deployments may
 *     validate the parent resource), never to an error screen.
 *   • 405 / 501 mean the path is not mounted on this deployment. Only then does
 *     the helper fall back to List Public Media with service_id — the same
 *     filters, the same wrapper, so nothing downstream changes. That fallback
 *     is reported, not silent guessing.
 *   • every other failure is re-thrown, so the caller keeps its usual
 *     "offline / unauthorized / invalid / server" classification.
 *
 * RAW COUNT: `items.length` BEFORE filtering. The API has no total, so
 * "there may be more" is inferred from a full page, and the offset always
 * advances by the RAW rows received (filtered-out rows would otherwise be
 * requested again forever).
 */
import { BASE_URL, authApi } from '@/services/api';
import { normalizePublicMediaResponse, type DisplayMedia } from '@/lib/mediaGallery';

export type ServicePageSource = 'service-gallery' | 'public-media';

export interface ServiceGalleryPageResult {
  /** Renderable photos, private fields already stripped. */
  media: DisplayMedia[];
  /** `items.length` as received — drives the end-of-list rule. */
  rawCount: number;
  /** Which endpoint actually answered (diagnostics only, never shown). */
  source: ServicePageSource;
}

export interface ServiceGalleryPageParams {
  /** 1..100 (server default 30). */
  limit?: number;
  /** >= 0 (server default 0). */
  offset?: number;
}

function pageOf(raw: unknown, source: ServicePageSource): ServiceGalleryPageResult {
  const items = (raw as { items?: unknown } | null)?.items;
  return {
    media: normalizePublicMediaResponse(raw, BASE_URL),
    rawCount: Array.isArray(items) ? items.length : 0,
    source,
  };
}

/**
 * One page of a single service's public photos. Never returns null; a missing
 * service resolves to an empty page.
 */
export async function fetchServiceGalleryPage(
  serviceId: number,
  params: ServiceGalleryPageParams = {}
): Promise<ServiceGalleryPageResult> {
  try {
    const page = await authApi.getServiceGallery(serviceId, params);
    return pageOf(page, 'service-gallery');
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404) {
      // Unknown service on a deployment that validates it → ordinary empty page.
      return { media: [], rawCount: 0, source: 'service-gallery' };
    }
    if (status === 405 || status === 501) {
      // Dedicated path not mounted here → documented List Public Media filter.
      console.log(
        '[serviceGalleryFetch] /services/{id}/gallery unavailable, using List Public Media',
        status
      );
      const page = await authApi.getPublicMedia({
        service_id: serviceId,
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(params.offset !== undefined ? { offset: params.offset } : {}),
      });
      return pageOf(page, 'public-media');
    }
    throw err;
  }
}
