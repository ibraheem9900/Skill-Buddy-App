import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import RatingStars from '@/components/RatingStars';
import type { ReviewSubject } from '@/hooks/useReviewsPage';
import {
  formatReviewAverage,
  hasProviderReviews,
  reviewAverageForDisplay,
  reviewCountKey,
  type ReviewsSummary,
} from '@/lib/reviews';

/**
 * The rating summary block, shared by BOTH review subjects:
 *   • subject="provider" — the pilot's public profile and reviews screen
 *   • subject="client"   — the client profile a pilot sees and the client's own
 *                          "My reviews" screen
 *
 * Big average (one decimal, active locale) + gold stars + "N reviews"; with no
 * published reviews it says "No reviews yet" and draws no stars. `review_average`
 * is the displayed number (the documented mean); the stored `star_rating` is only
 * a fallback when a count exists without an average — measured live, both
 * endpoints return `{star_rating: 4, review_average: null, review_count: 0}` for
 * a profile with no reviews, so a stored 4 is never printed as earned.
 *
 * No star distribution is drawn: the API's summary has no 5/4/3/2/1 counts and
 * none is computed from the loaded page.
 */
interface Props {
  summary: ReviewsSummary;
  subject?: ReviewSubject;
  /** Slightly smaller padding for the preview on a profile screen. */
  compact?: boolean;
}

export default function RatingSummary({ summary, subject = 'provider', compact = false }: Props) {
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();

  const hasReviews = hasProviderReviews(summary);
  const average = reviewAverageForDisplay(summary);
  const averageText = formatReviewAverage(average, language);
  const emptyMessage = subject === 'provider' ? 'fb_prov_empty_msg' : 'fb_rev_client_empty_msg';

  return (
    <View
      style={[
        styles.card,
        compact ? styles.cardCompact : null,
        { backgroundColor: c.card, borderColor: c.border },
      ]}
    >
      {hasReviews && average !== null ? (
        <>
          <View style={styles.avgRow}>
            <Text style={[styles.avg, { color: c.text }]}>{averageText}</Text>
            <View style={styles.stars}>
              <RatingStars rating={average} size={compact ? 15 : 17} showValue={false} color={c.gold} />
            </View>
          </View>
          <Text style={[styles.count, { color: c.mutedForeground }]}>
            {t(reviewCountKey(summary.review_count, language), { n: summary.review_count })}
          </Text>
        </>
      ) : (
        <View style={styles.emptyRow}>
          <Feather name="star" size={16} color={c.mutedForeground} />
          <Text style={[styles.noReviews, { color: c.mutedForeground }]}>
            {t('fb_prov_no_reviews')}
          </Text>
        </View>
      )}
      {!hasReviews && compact ? (
        <Text style={[styles.emptyMsg, { color: c.mutedForeground }]}>{t(emptyMessage)}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 6 },
  cardCompact: { padding: 14, borderRadius: 16 },
  avgRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  avg: { fontFamily: 'Manrope_700Bold', fontSize: 34 },
  stars: { flexShrink: 1 },
  count: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noReviews: { fontFamily: 'Manrope_500Medium', fontSize: 13, flexShrink: 1 },
  emptyMsg: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 18 },
});
