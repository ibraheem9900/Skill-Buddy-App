import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import ReviewsScreen from '@/components/ReviewsScreen';

/**
 * "Reviews" for ONE CLIENT — the pilot reviews of their profile. Same shared
 * screen as the pilot list; `subject` switches the reviewer label, the option
 * context (PROVIDER_REVIEW) and the empty-state copy.
 *
 * The id is the client PROFILE id: measured live, `/clients/4/reviews` answers
 * 200 while the same person's user id answers 404 "Client not found.".
 */
export default function ClientReviewsRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const clientId = id && /^\d+$/.test(id) ? Number(id) : null;
  return <ReviewsScreen subject="client" id={clientId} />;
}
