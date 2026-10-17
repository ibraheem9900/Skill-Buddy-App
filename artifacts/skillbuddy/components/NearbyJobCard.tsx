import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import CountdownTimer from '@/components/CountdownTimer';
import { formatDistanceKm, isUrgentRequest, nearbyDeadline, type NearbyJob } from '@/lib/nearbyJobs';

/**
 * One card of the provider "Available jobs" feed.
 *
 * WHAT IS ON THE CARD COMES STRAIGHT FROM NearbyJobResponse: title, urgency,
 * the bidding deadline, the distance, and (when the backend says so) the
 * matches_skill flag. There is NO description, price/rate, client snapshot or
 * address text on that schema, so no placeholder is rendered for any of them —
 * the card simply has fewer rows.
 *
 * URGENT vs REGULAR is unmistakable and uses ONLY existing theme tokens: the
 * urgent card takes the theme's `urgent` accent (its border and an urgentLight
 * badge with a clock icon), the regular card takes the brand green
 * (`primary`/`primaryLight`). The theme has no orange token — its urgent colour
 * is the theme's own red (#E74C3C), which is what the Pilot dashboard note asks
 * for (red border + clock icon) and what the rest of the app already uses for
 * urgency.
 *
 * Category/service names are resolved by the caller from its own caches and are
 * omitted when unknown; an unresolvable name never becomes a fake label.
 */
interface Props {
  job: NearbyJob;
  categoryName?: string | null;
  serviceName?: string | null;
  onPress: () => void;
}

export default function NearbyJobCard({ job, categoryName, serviceName, onPress }: Props) {
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();

  const urgent = isUrgentRequest(job.request_type);
  const deadline = nearbyDeadline(job);
  const distance = formatDistanceKm(job.distance_km, language);
  const category = (categoryName ?? '').trim();
  const service = (serviceName ?? '').trim();

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: c.card, borderColor: urgent ? c.urgent : c.border },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
      testID={`nearby-card-${job.job_id}`}
    >
      <View style={styles.topRow}>
        <View
          style={[
            styles.badge,
            {
              backgroundColor: urgent ? c.urgentLight : c.primaryLight,
              borderColor: urgent ? c.urgent : c.primary,
            },
          ]}
        >
          <Feather
            name={urgent ? 'clock' : 'calendar'}
            size={11}
            color={urgent ? c.urgent : c.primary}
          />
          <Text style={[styles.badgeText, { color: urgent ? c.urgent : c.primary }]}>
            {urgent ? t('jobs_urgent') : t('jobs_regular')}
          </Text>
        </View>

        {distance ? (
          <View style={styles.distanceWrap}>
            <Feather name="map-pin" size={12} color={c.mutedForeground} />
            <Text style={[styles.distanceText, { color: c.mutedForeground }]}>{distance}</Text>
          </View>
        ) : null}
      </View>

      <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
        {job.title}
      </Text>

      {category || service ? (
        <View style={styles.metaRow}>
          {category ? (
            <View style={styles.metaItem}>
              <Feather name="grid" size={12} color={c.mutedForeground} />
              <Text style={[styles.metaText, { color: c.mutedForeground }]} numberOfLines={1}>
                {category}
              </Text>
            </View>
          ) : null}
          {service ? (
            <View style={styles.metaItem}>
              <Feather name="briefcase" size={12} color={c.mutedForeground} />
              <Text style={[styles.metaText, { color: c.mutedForeground }]} numberOfLines={1}>
                {service}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {job.matches_skill ? (
        <View style={[styles.skillBadge, { backgroundColor: c.primaryLight }]}>
          <Feather name="award" size={12} color={c.primary} />
          <Text style={[styles.skillText, { color: c.primary }]}>{t('nearby_card_skill_match')}</Text>
        </View>
      ) : null}

      <View style={[styles.timerRow, { borderTopColor: c.border }]}>
        <Text style={[styles.timerLabel, { color: c.mutedForeground }]}>
          {t('nearby_card_bidding_ends')}
        </Text>
        {deadline !== null ? (
          <CountdownTimer endsAt={deadline} urgency={urgent ? 'urgent' : 'regular'} compact />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { fontFamily: 'Manrope_700Bold', fontSize: 11, letterSpacing: 0.3 },
  distanceWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distanceText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 15, lineHeight: 20 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' },
  metaText: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  skillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  skillText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderTopWidth: 1,
    paddingTop: 10,
  },
  timerLabel: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
});
