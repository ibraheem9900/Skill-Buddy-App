import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import {
  bidEtaParts,
  formatBidDistanceLocale,
  formatBidPriceLocale,
  type BidLocale,
} from '@/lib/bid';
import type { BidResponse } from '@/types';

interface Props {
  bid: BidResponse;
  /** The app's current language — money/distance are formatted for it. */
  locale: BidLocale;
  /**
   * The bid came from the server's `recommended` block. Never decided here: the
   * backend owns the split (schema JobBidsResponse), so the badge cannot drift
   * from what the client is actually being told.
   */
  recommended?: boolean;
  /** Arrived with the latest refresh — plays the arrival animation once. */
  isNew?: boolean;
  onPress: () => void;
}

/**
 * One incoming offer, as the CLIENT sees it.
 *
 * Shown: photo, name, offered price, arrival time, star rating, badge count and
 * badge tier, plus a Recommended badge for the server's top-3 block and an
 * Accepted marker on the offer that was accepted.
 *
 * NOT shown, on purpose: every *_score field and total_score. Those are the
 * platform's ranking inputs (admin data), so the card is deliberately unable to
 * render them — it only reads the provider snapshot and the offer itself.
 *
 * The only action is opening the provider sheet. Accept / reject / chat belong to
 * later tasks and are not rendered here, disabled or otherwise.
 */
export default function BidOfferCard({ bid, locale, recommended, isNew, onPress }: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const [photoFailed, setPhotoFailed] = useState(false);

  const { provider } = bid;
  const price = formatBidPriceLocale(bid.offered_price, locale);
  const distance = formatBidDistanceLocale(bid.distance_km, locale);
  const eta = bidEtaParts(bid.eta_minutes);
  const etaText = eta
    ? eta.kind === 'now'
      ? t('jobd_bid_eta_now')
      : eta.kind === 'minutes'
        ? t('jobd_bid_eta_min', { n: eta.minutes })
        : t('jobd_bid_eta_hm', { h: eta.hours, m: eta.minutes })
    : null;
  const rating =
    typeof provider.star_rating === 'number' ? provider.star_rating.toFixed(1) : null;
  const photo = provider.profile_photo_url;
  const showPhoto = !!photo && !photoFailed;
  const accepted = bid.status === 'ACCEPTED';

  return (
    <Animated.View entering={isNew ? FadeInDown.duration(320) : undefined}>
      <TouchableOpacity
        style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={provider.name}
      >
        {recommended || accepted ? (
          <View style={styles.tagRow}>
            {recommended ? (
              <View style={[styles.tag, { backgroundColor: c.primaryLight }]}>
                <MaterialCommunityIcons name="star" size={11} color={c.primary} />
                <Text style={[styles.tagText, { color: c.primary }]}>
                  {t('cbids_recommended')}
                </Text>
              </View>
            ) : null}
            {accepted ? (
              <View style={[styles.tag, { backgroundColor: c.successLight }]}>
                <Feather name="check-circle" size={11} color={c.success} />
                <Text style={[styles.tagText, { color: c.success }]}>
                  {t('bid_status_accepted')}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.topRow}>
          {showPhoto ? (
            <Image
              source={{ uri: photo as string }}
              style={styles.avatar}
              contentFit="cover"
              onError={() => setPhotoFailed(true)}
            />
          ) : (
            // Same fallback language as the rest of the app: the initial on a
            // tinted disc when there is no photo (or it fails to load).
            <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: c.muted }]}>
              <Text style={[styles.avatarInitial, { color: c.primary }]}>
                {provider.name.trim().charAt(0).toUpperCase() || '?'}
              </Text>
            </View>
          )}

          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
              {provider.name}
            </Text>
            <View style={styles.metaRow}>
              {rating ? (
                <>
                  <Feather name="star" size={12} color={c.rating} />
                  <Text style={[styles.metaText, { color: c.mutedForeground }]}>{rating}</Text>
                </>
              ) : null}
              {typeof provider.badge_count === 'number' ? (
                <>
                  {rating ? <View style={[styles.dot, { backgroundColor: c.mutedForeground }]} /> : null}
                  <MaterialCommunityIcons
                    name="shield-check-outline"
                    size={13}
                    color={c.mutedForeground}
                  />
                  <Text style={[styles.metaText, { color: c.mutedForeground }]}>
                    {provider.badge_count}
                  </Text>
                </>
              ) : null}
              {distance ? (
                <>
                  <View style={[styles.dot, { backgroundColor: c.mutedForeground }]} />
                  <Feather name="map-pin" size={11} color={c.mutedForeground} />
                  <Text style={[styles.metaText, { color: c.mutedForeground }]}>{distance}</Text>
                </>
              ) : null}
            </View>
            {provider.badge_tier ? (
              <Text style={[styles.tier, { color: c.primary }]} numberOfLines={1}>
                {provider.badge_tier}
              </Text>
            ) : null}
          </View>

          <View style={styles.offerWrap}>
            {price ? (
              <Text style={[styles.price, { color: c.primary }]}>{price}</Text>
            ) : null}
            {etaText ? (
              <Text style={[styles.eta, { color: c.mutedForeground }]}>
                {t('jobd_bid_summary_eta')} · {etaText}
              </Text>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 10, marginBottom: 12 },
  tagRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  tagText: { fontFamily: 'Manrope_600SemiBold', fontSize: 10 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: 'Manrope_700Bold', fontSize: 17 },
  name: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginBottom: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  metaText: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  dot: { width: 2.5, height: 2.5, borderRadius: 1.25, marginHorizontal: 2 },
  tier: { fontFamily: 'Manrope_500Medium', fontSize: 11, marginTop: 3 },
  offerWrap: { alignItems: 'flex-end', maxWidth: '42%' },
  price: { fontFamily: 'Manrope_700Bold', fontSize: 17 },
  eta: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2, textAlign: 'right' },
});
