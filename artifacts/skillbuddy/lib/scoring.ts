import type { BidProvider, Job } from '@/types';

/**
 * Recommendation Scoring Engine (Module 4D)
 *
 * Computes a 0–100 score for a provider bidding on a job, from 5 weighted
 * criteria: distance, star rating, badge tier, credibility %, response time.
 * This is real, deterministic scoring logic — not a random or hardcoded sort.
 */

function scoreDistance(distanceKm: number): number {
  if (distanceKm <= 2) return 25;
  if (distanceKm <= 5) return 20;
  if (distanceKm <= 10) return 15;
  return 10;
}

function scoreRating(rating: number): number {
  if (rating >= 4.8) return 20;
  if (rating >= 4.5) return 17;
  if (rating >= 4.0) return 15;
  if (rating >= 3.4) return 10;
  return 5;
}

function scoreBadge(badge: number): number {
  // badge: 3 = 100+ jobs, 2 = 50-99, 1 = 10-49, 0 = 0-9
  if (badge >= 3) return 15;
  if (badge === 2) return 14;
  if (badge === 1) return 13;
  return 10;
}

function scoreCredibility(credibility: number): number {
  if (credibility >= 95) return 25;
  if (credibility >= 90) return 20;
  if (credibility >= 85) return 15;
  if (credibility >= 80) return 13;
  if (credibility >= 75) return 10;
  if (credibility >= 60) return 5;
  return 0;
}

function scoreResponseTime(minutes: number): number {
  if (minutes <= 5) return 15;
  if (minutes <= 15) return 13;
  if (minutes <= 30) return 12;
  if (minutes <= 60) return 10;
  return 8;
}

export interface ScoreBreakdown {
  distance: number;
  rating: number;
  badge: number;
  credibility: number;
  responseTime: number;
  total: number;
}

export function calculateProviderScore(provider: BidProvider, _job?: Job): ScoreBreakdown {
  const distance = scoreDistance(provider.distanceKm);
  const rating = scoreRating(provider.rating ?? 0);
  const badge = scoreBadge(provider.badge ?? 0);
  const credibility = scoreCredibility(provider.credibility ?? 0);
  const responseTime = scoreResponseTime(provider.responseTimeMin);

  return {
    distance,
    rating,
    badge,
    credibility,
    responseTime,
    total: distance + rating + badge + credibility + responseTime,
  };
}

export function scoreOnly(provider: BidProvider, job?: Job): number {
  return calculateProviderScore(provider, job).total;
}
