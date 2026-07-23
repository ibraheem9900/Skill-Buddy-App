import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import type { Job } from '@/types';
import CountdownTimer from './CountdownTimer';

interface Props {
  job: Job;
  onPress: () => void;
}

const STATUS_LABEL: Record<Job['status'], string> = {
  bidding: 'Bidding Open',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export default function JobCard({ job, onPress }: Props) {
  const { colors: c } = useTheme();
  const accent = job.urgency === 'urgent' ? c.urgent : c.success;
  const accentLight = job.urgency === 'urgent' ? c.urgentLight : c.successLight;
  const isBidding = job.status === 'bidding';

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.topRow}>
        <View style={[styles.urgencyChip, { backgroundColor: accentLight }]}>
          <Feather name={job.urgency === 'urgent' ? 'zap' : 'clock'} size={11} color={accent} />
          <Text style={[styles.urgencyText, { color: accent }]}>
            {job.urgency === 'urgent' ? 'Urgent' : 'Regular'}
          </Text>
        </View>
        <View style={[styles.statusChip, { backgroundColor: c.muted }]}>
          <Text style={[styles.statusText, { color: c.mutedForeground }]}>{STATUS_LABEL[job.status]}</Text>
        </View>
      </View>

      <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>{job.title}</Text>

      <View style={styles.metaRow}>
        <MaterialCommunityIcons name="tag-outline" size={13} color={c.mutedForeground} />
        <Text style={[styles.metaText, { color: c.mutedForeground }]}>{job.category}</Text>
        <View style={[styles.dot, { backgroundColor: c.mutedForeground }]} />
        <Text style={[styles.metaText, { color: c.mutedForeground }]}>€{job.expectedPrice}</Text>
      </View>

      {isBidding ? (
        <CountdownTimer endsAt={job.biddingEndsAt} urgency={job.urgency} compact />
      ) : (
        <Text style={[styles.dateText, { color: c.mutedForeground }]}>{job.date} · {job.time}</Text>
      )}
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
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  dot: { width: 3, height: 3, borderRadius: 1.5 },
  dateText: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
});
