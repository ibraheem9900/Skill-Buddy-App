/**
 * SpecialOffers — the Home section that replaced the old bottom Badges block
 * (Fix 4b). It reuses AutoSlidingCarousel, with a small peek of the next card.
 *
 * The three cards come from `lib/homeContent` (the same data seam as the top
 * banners), and every string is a translation key. TODO(content): the offers
 * are brand-neutral placeholders — no discount, percentage, price or promise —
 * until the boss supplies the real content; each card then just needs a
 * `target` to become tappable.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AutoSlidingCarousel from '@/components/AutoSlidingCarousel';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import type { HomeOffer } from '@/lib/homeContent';

/** Visible sliver of the next card, so the swipe affordance is obvious. */
const PEEK = 26;

export default function SpecialOffers({ offers }: { offers: HomeOffer[] }) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  if (offers.length === 0) return null;

  const accentOf = (offer: HomeOffer) =>
    offer.accent === 'amber' ? c.gold : offer.accent === 'ink' ? c.primaryDark : c.primary;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>{t('home_special_offers')}</Text>
      </View>
      <View style={{ paddingLeft: 16 }}>
        <AutoSlidingCarousel
          data={offers}
          keyExtractor={(offer) => offer.id}
          height={150}
          peek={PEEK}
          gap={12}
          radius={18}
          accessibilityLabel={t('home_special_offers')}
          renderItem={(offer) => (
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={styles.cardTop}>
                <View style={[styles.iconWrap, { backgroundColor: c.primaryLight }]}>
                  <MaterialCommunityIcons
                    name={offer.icon as never}
                    size={20}
                    color={accentOf(offer)}
                  />
                </View>
                {offer.tagKey ? (
                  <View style={[styles.tag, { backgroundColor: c.muted }]}>
                    <Text style={[styles.tagText, { color: c.mutedForeground }]} numberOfLines={1}>
                      {t(offer.tagKey)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
                {t(offer.titleKey)}
              </Text>
              <Text style={[styles.desc, { color: c.mutedForeground }]} numberOfLines={3}>
                {t(offer.descriptionKey)}
              </Text>
            </View>
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 22 },
  header: { paddingHorizontal: 16, marginBottom: 10 },
  sectionTitle: { fontFamily: 'Manrope_700Bold', fontSize: 17 },
  card: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  tagText: { fontFamily: 'Manrope_500Medium', fontSize: 10 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  desc: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16 },
});
