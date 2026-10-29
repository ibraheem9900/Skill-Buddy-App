/**
 * homeContent.ts — the ONE data seam for the client Home's promotional surface.
 *
 * WHY THIS FILE EXISTS (boss): "none of this may be hardcoded inside screens.
 * It must be data-driven and built properly."
 *
 * The app has NO banners/offers/promotions endpoint (checked GET /api/v1/* in
 * services/api.ts and the web app's hooks — the web's offers are a local
 * fixture with invented discounts, which we must not copy). So today the
 * content lives here, typed, versioned and behind ONE async function:
 *
 *     loadHomeContent()  ← the only call the screens make
 *
 * When a real endpoint ships, ONLY this function changes (map the response into
 * HomeBanner[]/HomeOffer[]) — the screens, the carousel and the translations
 * stay exactly as they are.
 *
 * CONTENT RULES honoured here:
 *   • no invented discounts, percentages, prices, dates or partnerships;
 *   • no third-party logos or trademarked artwork — every slide is built from
 *     a theme color + an icon;
 *   • every user-visible string is a translation key (never a literal);
 *   • the Uber and IKEA slides and all three offers are marked TODO(content):
 *     the boss's final copy/artwork has not been provided yet, so they say so
 *     plainly instead of pretending to be a real promotion.
 */

import type { TranslationKey } from '@/context/LanguageContext';

/** Where a slide can go. `null` means it is NOT tappable (no CTA rendered). */
export type HomeContentTarget =
  | { kind: 'route'; href: string }
  | { kind: 'url'; href: string }
  | null;

/** Which palette role the slide's placeholder artwork uses. */
export type HomeContentAccent = 'primary' | 'amber' | 'ink';

export interface HomeBanner {
  id: string;
  /** `badges` slides read live progress from the client dashboard. */
  type: 'badges' | 'promo';
  titleKey: TranslationKey;
  subtitleKey: TranslationKey;
  /** Rendered only when `target` exists — no dead-looking tap areas. */
  buttonKey?: TranslationKey;
  icon: string;
  accent: HomeContentAccent;
  target: HomeContentTarget;
  enabled: boolean;
  /** TODO(content): placeholder copy/artwork, waiting for the boss. */
  placeholder?: boolean;
  /** Lower first. */
  order: number;
}

export interface HomeOffer {
  id: string;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  tagKey?: TranslationKey;
  icon: string;
  accent: HomeContentAccent;
  target: HomeContentTarget;
  enabled: boolean;
  /** TODO(content): placeholder copy, waiting for the boss. */
  placeholder?: boolean;
  order: number;
}

export interface HomeContent {
  banners: HomeBanner[];
  offers: HomeOffer[];
}

/**
 * The three top banners, in the boss's order: Badges → Uber → IKEA.
 *
 * The Badges slide is REAL: its progress text comes from
 * GET /api/v1/clients/dashboard (total_completed_jobs) at render time.
 * TODO(content): the Uber and IKEA copy, images and links are placeholders —
 * replace the *_uber_* / *_ikea_* translations and give each entry a target
 * once the boss provides them.
 */
export const HOME_BANNERS: readonly HomeBanner[] = [
  {
    id: 'badges',
    type: 'badges',
    titleKey: 'home_earn_badges',
    subtitleKey: 'home_unlock_rewards',
    icon: 'award-outline',
    accent: 'primary',
    // No badges screen exists yet, so there is nothing honest to link to.
    target: null,
    enabled: true,
    order: 1,
  },
  {
    id: 'uber',
    type: 'promo',
    titleKey: 'home_banner_transport_title',
    subtitleKey: 'home_banner_transport_sub',
    icon: 'car-outline',
    accent: 'amber',
    target: null,
    enabled: true,
    placeholder: true,
    order: 2,
  },
  {
    id: 'ikea',
    type: 'promo',
    titleKey: 'home_banner_partner_title',
    subtitleKey: 'home_banner_partner_sub',
    icon: 'gift-outline',
    accent: 'ink',
    target: null,
    enabled: true,
    placeholder: true,
    order: 3,
  },
];

/**
 * The three Special Offers cards (they replace the old bottom Badges block).
 * TODO(content): brand-neutral placeholders — no discount, no percentage, no
 * price, no promise. Replace these translations (and give each entry a target)
 * when the boss supplies the real offers.
 */
export const HOME_OFFERS: readonly HomeOffer[] = [
  {
    id: 'offer-1',
    titleKey: 'home_offer_1_title',
    descriptionKey: 'home_offer_1_desc',
    tagKey: 'home_offer_placeholder_tag',
    icon: 'tag-outline',
    accent: 'primary',
    target: null,
    enabled: true,
    placeholder: true,
    order: 1,
  },
  {
    id: 'offer-2',
    titleKey: 'home_offer_2_title',
    descriptionKey: 'home_offer_2_desc',
    tagKey: 'home_offer_placeholder_tag',
    icon: 'clock-outline',
    accent: 'amber',
    target: null,
    enabled: true,
    placeholder: true,
    order: 2,
  },
  {
    id: 'offer-3',
    titleKey: 'home_offer_3_title',
    descriptionKey: 'home_offer_3_desc',
    tagKey: 'home_offer_placeholder_tag',
    icon: 'sparkles',
    accent: 'ink',
    target: null,
    enabled: true,
    placeholder: true,
    order: 3,
  },
];

function byOrder<T extends { order: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.order - b.order);
}

/**
 * The single fetch seam. Today it resolves the typed config above; tomorrow it
 * calls GET /api/v1/home/content (spec in the delivery report) and maps the
 * response into the same shapes. Screens never read the constants directly.
 */
export async function loadHomeContent(): Promise<HomeContent> {
  return {
    banners: byOrder(HOME_BANNERS.filter((banner) => banner.enabled)),
    offers: byOrder(HOME_OFFERS.filter((offer) => offer.enabled)),
  };
}

export default loadHomeContent;
