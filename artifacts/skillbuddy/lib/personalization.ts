import type { Service } from '@/types';
import type { MockUser } from '@/data/mockData';

/**
 * Returns a personalized list of services for the given user.
 *
 * - If the user has past booking category IDs, services in those categories
 *   are returned first (sorted by rating desc), then remaining services
 *   sorted by rating desc fill the rest.
 * - If the user has no history, returns all services sorted by
 *   rating * reviewCount desc (most popular overall).
 *
 * @param user        The current mock user
 * @param allServices All available services
 * @param limit       Max number of services to return (default 10)
 */
export function getPersonalizedServices(
  user: MockUser,
  allServices: Service[],
  limit = 10,
): { services: Service[]; isPersonalized: boolean } {
  if (user.pastBookingCategoryIds.length > 0) {
    const categorySet = new Set(user.pastBookingCategoryIds);
    const matched = allServices
      .filter((s) => categorySet.has(s.categoryId))
      .sort((a, b) => b.rating - a.rating);
    const others = allServices
      .filter((s) => !categorySet.has(s.categoryId))
      .sort((a, b) => b.rating - a.rating);
    return {
      services: [...matched, ...others].slice(0, limit),
      isPersonalized: true,
    };
  }

  const sorted = [...allServices].sort(
    (a, b) => b.rating * b.reviewCount - a.rating * a.reviewCount,
  );
  return { services: sorted.slice(0, limit), isPersonalized: false };
}
