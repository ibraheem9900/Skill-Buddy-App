/**
 * publicProfiles.ts — the little we know about ANOTHER person's profile.
 *
 * WHY A CACHE AND NOT A FETCH: the live API has no public profile endpoint —
 * only /providers/me/* (your own) and /providers/{id}/skills. The bid payload's
 * `provider` block (BidProviderSummary) is the ONLY other-party snapshot the
 * backend sends, and it is enough for a read-only profile: name, photo, rating,
 * badge count/tier, completed jobs, credibility, acceptance rate, response time.
 *
 * So the bid list REMEMBERS the snapshot it received (in memory, for this
 * session only) and the public-profile screen reads it back. On logout the map
 * is cleared with every other user-scoped cache.
 *
 * Nothing is persisted: a stale profile must never follow an account switch.
 */

import type { BidProviderSummary } from '@/types';
import { registerSessionReset } from '@/lib/sessionReset';

const providers = new Map<number, BidProviderSummary>();

/** Store the server's snapshot for one provider (idempotent). */
export function rememberProvider(summary: BidProviderSummary | null | undefined): void {
  if (!summary || typeof summary.id !== 'number') return;
  providers.set(summary.id, summary);
}

/** The last snapshot seen this session, or null. */
export function getRememberedProvider(providerId: number | null | undefined): BidProviderSummary | null {
  if (typeof providerId !== 'number' || !Number.isFinite(providerId)) return null;
  return providers.get(providerId) ?? null;
}

/** Only for tests / an explicit refresh. */
export function clearRememberedProviders(): void {
  providers.clear();
}

registerSessionReset(() => {
  providers.clear();
});
