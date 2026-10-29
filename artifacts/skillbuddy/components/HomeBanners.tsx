/**
 * HomeBanners — the top-of-Home carousel (Fix 3).
 *
 * Three slides in the boss's order: Badges → transport (Uber placeholder) →
 * partner (IKEA placeholder). The CONTENT is data (`lib/homeContent`), the
 * SLIDING is `AutoSlidingCarousel`, and this file only renders a banner.
 *
 * The Badges slide is REAL: progress comes from
 * GET /api/v1/clients/dashboard `total_completed_jobs` (the same live summary
 * the stats card uses). Two services use it:
 *   • completed jobs below SILVER_TARGET → "N / 10 tasks to Silver";
 *   • at or above it                     → "Silver tier unlocked".
 * Gold has no documented threshold, so no number is invented for it — only the
 * three tier icons and their translated labels are shown.
 *
 * TODO(content): the second and third slides are brand-neutral placeholders
 * (icon + theme color, NO logos, no partnership claim) until the boss supplies
 * copy, artwork and links. They render no button while `target` is null.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import AutoSlidingCarousel from '@/components/AutoSlidingCarousel';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import type { HomeBanner } from '@/lib/homeContent';

/** The only threshold the app documents today (from the old "3 / 10" copy). */
export const SILVER_TARGET = 10;

const TIERS = [
  { id: 'bronze', labelKey: 'badge_tier_bronze' as const },
  { id: 'silver', labelKey: 'badge_tier_silver' as const },
  { id: 'gold', labelKey: 'badge_tier_gold' as const },
];

export default function HomeBanners({
  banners,
  completedJobs,
}: {
  banners: HomeBanner[];
  /** From GET /api/v1/clients/dashboard; null while loading. */
  completedJobs: number | null;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  if (banners.length === 0) return null;

  const renderBadges = (banner: HomeBanner) => {
    const done = typeof completedJobs === 'number' && Number.isFinite(completedJobs)
      ? Math.max(0, Math.floor(completedJobs))
      : null;
    const pct = done === null ? 0 : Math.min(1, done / SILVER_TARGET);
    const unlocked = done !== null && done >= SILVER_TARGET;

    return (
      <View style={[styles.slide, { backgroundColor: c.heroCard }]}>
        <View style={styles.badgeTopRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.titleRow}>
              <Feather name="award" size={14} color={c.gold} />
              <Text style={[styles.title, { color: c.primaryForeground }]} numberOfLines={1}>
                {t(banner.titleKey)}
              </Text>
            </View>
            <Text style={[styles.subtitle, { color: c.primaryForeground }]} numberOfLines={2}>
              {t(banner.subtitleKey)}
            </Text>
          </View>
          <View style={styles.tiers}>
            {TIERS.map((tier) => (
              <View key={tier.id} style={styles.tierItem}>
                <Feather name="award" size={17} color={c.gold} />
                <Text style={[styles.tierLabel, { color: c.primaryForeground }]} numberOfLines={1}>
                  {t(tier.labelKey)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.trackRow}>
          <View style={[styles.track, { backgroundColor: c.primaryForeground, opacity: 1 }]}>
            <View
              style={[
                styles.trackFill,
                { backgroundColor: c.gold, width: `${Math.round(pct * 100)}%` },
              ]}
            />
          </View>
        </View>
        <Text style={[styles.progress, { color: c.primaryForeground }]} numberOfLines={1}>
          {done === null
            ? t('home_badge_loading')
            : unlocked
              ? t('home_badge_silver_unlocked')
              : t('home_badge_to_silver', { n: done, total: SILVER_TARGET })}
        </Text>
      </View>
    );
  };

  const renderPromo = (banner: HomeBanner) => {
    const amber = banner.accent === 'amber';
    const ink = banner.accent === 'ink';
    const background = amber ? c.gold : ink ? c.card : c.heroCard;
    const foreground = amber ? c.goldForeground : ink ? c.text : c.primaryForeground;

    return (
      <View
        style={[
          styles.slide,
          { backgroundColor: background },
          ink && { borderWidth: 1, borderColor: c.border },
        ]}
      >
        <View style={styles.promoRow}>
          <View
            style={[
              styles.promoIcon,
              { backgroundColor: amber ? c.goldLight : c.primaryLight },
            ]}
          >
            <MaterialCommunityIcons
              name={banner.icon as never}
              size={22}
              color={amber ? c.goldForeground : c.primary}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.title, { color: foreground }]} numberOfLines={1}>
              {t(banner.titleKey)}
            </Text>
            <Text style={[styles.subtitle, { color: foreground }]} numberOfLines={3}>
              {t(banner.subtitleKey)}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <AutoSlidingCarousel
      data={banners}
      keyExtractor={(banner) => banner.id}
      height={148}
      radius={20}
      accessibilityLabel={t('home_banners_a11y')}
      renderItem={(banner) => (banner.type === 'badges' ? renderBadges(banner) : renderPromo(banner))}
    />
  );
}

const styles = StyleSheet.create({
  slide: {
    flex: 1,
    borderRadius: 20,
    padding: 14,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  badgeTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  subtitle: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 15, marginTop: 2, opacity: 0.9 },
  tiers: { flexDirection: 'row', gap: 8 },
  tierItem: { alignItems: 'center', gap: 2 },
  tierLabel: { fontFamily: 'Manrope_500Medium', fontSize: 9, opacity: 0.9 },
  trackRow: { marginTop: 8 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', opacity: 0.35 },
  trackFill: { height: 6, borderRadius: 3 },
  progress: { fontFamily: 'Manrope_500Medium', fontSize: 10, marginTop: 6, opacity: 0.95 },
  promoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  promoIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
