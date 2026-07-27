import type { OrderBreakdown, PayoutBreakdown } from '@/types';

const VAT_RATE = 0.24;
const PLATFORM_FEE = 0.99;
const COMMISSION_RATE = 0.05;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Client-side order breakdown. VAT is calculated backward from the final
 * bid price so the client never pays more than the agreed amount — the
 * platform fee is shown as an informational line (a discount/transparency
 * note), it does not change what the client owes.
 *
 * Example for a €30 bid: beforeVat €24.19, VAT €5.81, platformFee -€0.99,
 * total €30.00 (matches the spec's worked example exactly).
 */
export function calculateOrderBreakdown(bidPrice: number): OrderBreakdown {
  const beforeVat = round2(bidPrice / (1 + VAT_RATE));
  const vat = round2(bidPrice - beforeVat);
  return {
    bidPrice: round2(bidPrice),
    beforeVat,
    vat,
    platformFee: PLATFORM_FEE,
    total: round2(bidPrice),
  };
}

/**
 * Provider-side payout breakdown once a job is assigned — the platform fee
 * and SkillBuddy commission (5%) are both deducted from the bid price to
 * arrive at the final payout.
 */
export function calculatePayoutBreakdown(bidPrice: number): PayoutBreakdown {
  const beforeVat = round2(bidPrice / (1 + VAT_RATE));
  const vat = round2(bidPrice - beforeVat);
  const commission = round2(bidPrice * COMMISSION_RATE);
  const payout = round2(bidPrice - PLATFORM_FEE - commission);
  return {
    bidPrice: round2(bidPrice),
    beforeVat,
    vat,
    platformFee: PLATFORM_FEE,
    commission,
    payout,
  };
}

export const CANCELLATION_FEE = 5.0;
export const POINTS_TO_EUR = 0.1; // 1 credit point = €0.10

export function pointsToEuro(points: number): number {
  return round2(points * POINTS_TO_EUR);
}

/** Pay Later requires 20+ completed tasks. */
export function canUsePayLater(completedTasks: number): boolean {
  return completedTasks >= 20;
}

/** Pay in Instalments requires 20+ completed tasks AND a bill over €100. */
export function canUseInstalments(completedTasks: number, billAmount: number): boolean {
  return completedTasks >= 20 && billAmount > 100;
}
