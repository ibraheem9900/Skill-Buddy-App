import { invalidateReviews, useReviewsPage } from '@/hooks/useReviewsPage';

/**
 * GET /api/v1/providers/{provider_id}/reviews — published CLIENT reviews of a
 * pilot. Thin wrapper over the shared paginated reader (useReviewsPage), so the
 * provider list keeps exactly the behaviour it had before the client list
 * existed: page size 20, dedupe by id, per-provider session cache, stale-focus
 * refresh, pull-to-refresh from offset 0, inline loadMore retry.
 */
export type ProviderReviewsStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Drops cached reviews for one pilot, or for every pilot. */
export function invalidateProviderReviews(providerId?: number): void {
  invalidateReviews('provider', providerId);
}

/** Exposed for tests / logout. */
export { clearReviewsCache as clearProviderReviewsCache } from '@/hooks/useReviewsPage';

export function useProviderReviews(providerId: number | null) {
  return useReviewsPage('provider', providerId);
}

export default useProviderReviews;
