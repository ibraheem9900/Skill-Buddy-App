import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import ReviewsScreen from '@/components/ReviewsScreen';

/**
 * "Reviews" for ONE PILOT — the client reviews of their profile.
 * The shared screen does the work; the route only resolves the provider PROFILE
 * id (measured live: the user id answers 404 "Provider not found.").
 */
export default function ProviderReviewsRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const providerId = id && /^\d+$/.test(id) ? Number(id) : null;
  return <ReviewsScreen subject="provider" id={providerId} />;
}
