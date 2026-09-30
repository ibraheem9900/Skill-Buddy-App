import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import {
  jobStatusLabelKey,
  parseExpectedHours,
  resolveBiddingEndsAt,
} from '@/lib/jobList';
import type { JobListItem } from '@/types';
import CountdownTimer from './CountdownTimer';

/**
 * A card in the client job list.
 *
 * RENDERS ONLY WHAT GET /api/v1/jobs RETURNS: title, status, is_urgent,
 * scheduled_at, expected_hours, milestones and the bidding window. The list
 * schema has no description, no address, no price, no photos, no provider and
 * no category NAME — those live on GET /api/v1/jobs/{job_id} — so nothing here
 * fakes them; each row is simply omitted when its field is absent.
 *
 * The status label is always a translated string (never a raw enum), and an
 * unknown status omits the chip instead of printing the enum value.
 */
export default function JobCard({
  job,
  onPress,
}: {
  job: JobListItem;
  onPress: () => void;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  const urgent = job.is_urgent;
  const accent = urgent ? c.urgent : c.success;
  const accentLight = urgent ? c.urgentLight : c.successLight;

  const statusKey = jobStatusLabelKey(job.status);
  const hours = parseExpectedHours(job.expected_hours);
  const milestoneCount = job.milestones?.length ?? 0;

  const scheduled = job.scheduled_at ? new Date(job.scheduled_at) : null;
  const hasSchedule = !!scheduled && !Number.isNaN(scheduled.getTime());

  // A deadline is only meaningful while bidding is actually open. Prefer the
  // absolute bidding_ends_at; fall back to remaining_bidding_seconds.
  const deadline = useMemo(
    () => (job.is_bidding_open ? resolveBiddingEndsAt(job, Date.now()) : null),
    [job]
  );

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.topRow}>
        <View style={[styles.urgencyChip, { backgroundColor: accentLight }]}>
          <Feather name={urgent ? 'zap' : 'clock'} size={11} color={accent} />
          <Text style={[styles.urgencyText, { color: accent }]}>
            {urgent ? t('jobs_urgent') : t('jobs_regular')}
          </Text>
        </View>
        {statusKey ? (
          <View style={[styles.statusChip, { backgroundColor: c.muted }]}>
            <Text style={[styles.statusText, { color: c.mutedForeground }]}>
              {t(statusKey)}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
        {job.title}
      </Text>

      <View style={styles.metaRow}>
        {hasSchedule ? (
          <View style={styles.metaItem}>
            <Feather name="calendar" size={12} color={c.mutedForeground} />
            <Text style={[styles.metaText, { color: c.mutedForeground }]}>
              {scheduled!.toLocaleDateString()}
            </Text>
          </View>
        ) : null}

        {hours !== null ? (
          <View style={styles.metaItem}>
            <Feather name="clock" size={12} color={c.mutedForeground} />
            <Text style={[styles.metaText, { color: c.mutedForeground }]}>
              {hours === 1
                ? t('post_hours_value', { n: hours })
                : t('post_hours_value_plural', { n: hours })}
            </Text>
          </View>
        ) : null}

        {milestoneCount > 0 ? (
          <View style={styles.metaItem}>
            <Feather name="list" size={12} color={c.mutedForeground} />
            <Text style={[styles.metaText, { color: c.mutedForeground }]}>
              {t('jobs_milestones_count', { n: milestoneCount })}
            </Text>
          </View>
        ) : null}
      </View>

      {deadline !== null ? (
        <CountdownTimer
          endsAt={deadline}
          urgency={urgent ? 'urgent' : 'regular'}
          compact
        />
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 8, marginBottom: 12 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  urgencyChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  urgencyText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
  statusChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
});
