import { invalidateReviews, useReviewsPage } from '@/hooks/useReviewsPage';

/**
 * GET /api/v1/clients/{client_id}/reviews — published PILOT reviews of a
 * client, with the rating summary.
 *
 * Same shared paginated reader as the provider list (useReviewsPage), keyed by
 * the CLIENT PROFILE id — measured live: `/clients/4/reviews` answers 200 while
 * the same person's user id answers 404 "Client not found.".
 */
export function invalidateClientReviews(clientId?: number): void {
  invalidateReviews('client', clientId);
}

/** Exposed for tests / logout. */
export { clearReviewsCache as clearClientReviewsCache } from '@/hooks/useReviewsPage';

export function useClientReviews(clientId: number | null) {
  return useReviewsPage('client', clientId);
}

export default useClientReviews;
