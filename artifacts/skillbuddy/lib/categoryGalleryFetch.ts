/**
 * categoryGalleryFetch — ONE place that knows how a category's public work page
 * is fetched, so the category screen preview and the paginated category gallery
 * cannot drift apart.
 *
 * PRIMARY SOURCE: GET /api/v1/categories/{category_id}/gallery?limit&offset —
 * the dedicated endpoint (PUBLIC, verified live 2026-11-18 with no token and
 * with a bogus token). It answers the SAME wrapper as List Public Media:
 * {service_id, category_id, items}, so normalisation is shared
 * (normalizePublicMediaResponse). `service_id` is null on a category page, and
 * each item still carries its own service_id — irrelevant for display.
 *
 * EDGE BEHAVIOUR (measured, not guessed):
 *   • unknown / media-less category → 200 with an EMPTY items array (category
 *     999999 verified live). It is NOT a 404, so a calm empty state is the
 *     normal outcome.
 *   • a 404 is still mapped to an empty page for safety (a deployment may
 *     validate the parent resource), never to an error screen.
 *   • 405 / 501 mean the path is not mounted on this deployment. Only then does
 *     the helper fall back to List Public Media with category_id — the same
 *     filter and wrapper, so nothing downstream changes. That fallback is
 *     reported in the log, not silently guessed.
 *   • every other failure is re-thrown, so the caller keeps its usual
 *     "offline / unauthorized / invalid / server" classification. A 422 (bad
 *     category_id) therefore hides the section instead of breaking the screen.
 *
 * RAW COUNT: `items.length` BEFORE filtering. The API has no total, so
 * "there may be more" is inferred from a full page, and the offset always
 * advances by the RAW rows received (filtered-out rows would otherwise be
 * requested again forever).
 */
import { BASE_URL, authApi } from '@/services/api';
import { normalizePublicMediaResponse, type DisplayMedia } from '@/lib/mediaGallery';

export type CategoryPageSource = 'category-gallery' | 'public-media';

export interface CategoryGalleryPageResult {
  /** Renderable photos, private fields already stripped. */
  media: DisplayMedia[];
  /** `items.length` as received — drives the end-of-list rule. */
  rawCount: number;
  /** Which endpoint actually answered (diagnostics only, never shown). */
  source: CategoryPageSource;
}

export interface CategoryGalleryPageParams {
  /** 1..100 (server default 30). */
  limit?: number;
  /** >= 0 (server default 0). */
  offset?: number;
}

function pageOf(raw: unknown, source: CategoryPageSource): CategoryGalleryPageResult {
  const items = (raw as { items?: unknown } | null)?.items;
  return {
    media: normalizePublicMediaResponse(raw, BASE_URL),
    rawCount: Array.isArray(items) ? items.length : 0,
    source,
  };
}

/**
 * One page of a category's public photos. Never returns null; a missing or
 * media-less category resolves to an empty page.
 */
export async function fetchCategoryGalleryPage(
  categoryId: number,
  params: CategoryGalleryPageParams = {}
): Promise<CategoryGalleryPageResult> {
  try {
    const page = await authApi.getCategoryGallery(categoryId, params);
    return pageOf(page, 'category-gallery');
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404) {
      // Unknown category on a deployment that validates it → ordinary empty page.
      return { media: [], rawCount: 0, source: 'category-gallery' };
    }
    if (status === 405 || status === 501) {
      // Dedicated path not mounted here → documented List Public Media filter.
      console.log(
        '[categoryGalleryFetch] /categories/{id}/gallery unavailable, using List Public Media',
        status
      );
      const page = await authApi.getPublicMedia({
        category_id: categoryId,
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(params.offset !== undefined ? { offset: params.offset } : {}),
      });
      return pageOf(page, 'public-media');
    }
    throw err;
  }
}
