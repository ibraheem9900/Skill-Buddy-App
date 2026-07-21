import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useRole } from '@/context/RoleContext';
import { CURRENT_USER, PROVIDER_JOB_HISTORY } from '@/data/mockData';
import { calculateProviderScore } from '@/lib/scoring';
import BackButton from '@/components/BackButton';
import type { BidProvider } from '@/types';

const ME_AS_PROVIDER: BidProvider = {
  id: 'me-provider',
  name: CURRENT_USER.name,
  rating: 4.7,
  reviewCount: 58,
  jobsDone: 41,
  badge: 2,
  credibility: 90,
  specialty: CURRENT_USER.primarySkill,
  location: CURRENT_USER.address,
  isOnline: true,
  distanceKm: 3.1,
  responseTimeMin: 9,
};

export default function ProfessionalInfoScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { activeRole } = useRole();
  const isProvider = activeRole === 'PROVIDER';
  const score = calculateProviderScore(ME_AS_PROVIDER);

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>Professional Info</Text>
        <View style={{ width: 40 }} />
      </View>

      {!isProvider ? (
        <View style={{ padding: 20 }}>
          <View style={styles.statGrid}>
            {[
              { label: 'Jobs Done', value: CURRENT_USER.jobsDone, icon: 'check-circle' as const },
              { label: 'Active Jobs', value: CURRENT_USER.activeJobs, icon: 'clock' as const },
              { label: 'Due Payments', value: `€${CURRENT_USER.duePayments}`, icon: 'dollar-sign' as const },
            ].map((s) => (
              <View key={s.label} style={[styles.statCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <Feather name={s.icon} size={18} color={c.primary} />
                <Text style={[styles.statValue, { color: c.text }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: c.mutedForeground }]}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          ListHeaderComponent={
            <View style={{ padding: 20, paddingBottom: 0 }}>
              <View style={[styles.skillsCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <View style={styles.skillRow}>
                  <MaterialCommunityIcons name="star-circle-outline" size={18} color={c.primary} />
                  <View>
                    <Text style={[styles.skillLabel, { color: c.mutedForeground }]}>Primary Skill</Text>
                    <Text style={[styles.skillValue, { color: c.text }]}>{CURRENT_USER.primarySkill}</Text>
                  </View>
                </View>
                <View style={[styles.skillRow, { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12, marginTop: 12 }]}>
                  <MaterialCommunityIcons name="star-outline" size={18} color={c.mutedForeground} />
                  <View>
                    <Text style={[styles.skillLabel, { color: c.mutedForeground }]}>Secondary Skill</Text>
                    <Text style={[styles.skillValue, { color: c.text }]}>{CURRENT_USER.secondarySkill}</Text>
                  </View>
                </View>
              </View>

              <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>Performance Metrics</Text>
              <View style={styles.statGrid}>
                <View style={[styles.statCard, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Feather name="star" size={18} color={c.rating} />
                  <Text style={[styles.statValue, { color: c.text }]}>{ME_AS_PROVIDER.rating}</Text>
                  <Text style={[styles.statLabel, { color: c.mutedForeground }]}>Rating</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Feather name="check-circle" size={18} color={c.primary} />
                  <Text style={[styles.statValue, { color: c.text }]}>{ME_AS_PROVIDER.jobsDone}</Text>
                  <Text style={[styles.statLabel, { color: c.mutedForeground }]}>Jobs Done</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Feather name="zap" size={18} color={c.warning} />
                  <Text style={[styles.statValue, { color: c.text }]}>{ME_AS_PROVIDER.responseTimeMin}m</Text>
                  <Text style={[styles.statLabel, { color: c.mutedForeground }]}>Avg. Response</Text>
                </View>
              </View>

              <View style={[styles.scoreCard, { backgroundColor: c.primaryLight }]}>
                <Text style={[styles.scoreLabel, { color: c.primary }]}>Your overall match score</Text>
                <Text style={[styles.scoreValue, { color: c.primary }]}>{score.total}/100</Text>
              </View>

              <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>Job History</Text>
            </View>
          }
          data={PROVIDER_JOB_HISTORY}
          keyExtractor={(j) => j.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <View style={[styles.historyRow, { borderBottomColor: c.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.historyClient, { color: c.text }]}>{item.clientName}</Text>
                <Text style={[styles.historyMeta, { color: c.mutedForeground }]}>{item.category} · {item.date}</Text>
              </View>
              <View style={styles.historyRating}>
                <Feather name="star" size={13} color={c.rating} />
                <Text style={[styles.historyRatingText, { color: c.text }]}>{item.ratingGiven.toFixed(1)}</Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  statGrid: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 14, alignItems: 'center', gap: 6 },
  statValue: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  statLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'center' },
  skillsCard: { borderWidth: 1, borderRadius: 14, padding: 16 },
  skillRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  skillLabel: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  skillValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginTop: 2 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 22, marginBottom: 10 },
  scoreCard: { borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 14 },
  scoreLabel: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  scoreValue: { fontFamily: 'Inter_700Bold', fontSize: 22, marginTop: 2 },
  historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1 },
  historyClient: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  historyMeta: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  historyRating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  historyRatingText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});
