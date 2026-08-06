import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { BID_PROVIDERS, MOCK_JOBS } from '@/data/mockData';
import BackButton from '@/components/BackButton';

export default function BookingSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  const job = useMemo(() => MOCK_JOBS.find((j) => j.id === id), [id]);
  const provider = useMemo(
    () => BID_PROVIDERS.find((p) => p.id === job?.assignedProviderId),
    [job]
  );

  if (!job) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <Text style={{ color: c.text, padding: 20 }}>{t('summary_not_found')}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('summary_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={ZoomIn.duration(300).springify()} style={[styles.successCard, { backgroundColor: c.successLight }]}>
          <Feather name="check-circle" size={40} color={c.success} />
          <Text style={[styles.successTitle, { color: c.success }]}>{t('summary_payment')}</Text>
          <Text style={[styles.successSub, { color: c.text }]}>{t('summary_pilot')}</Text>
        </Animated.View>

        {provider && (
          <Animated.View entering={FadeIn.delay(150)} style={[styles.providerCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={[styles.avatar, { backgroundColor: c.primaryLight }]}>
              <Text style={[styles.avatarText, { color: c.primary }]}>{provider.name.charAt(0)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.providerName, { color: c.text }]}>{provider.name}</Text>
              <View style={styles.providerMeta}>
                <Feather name="star" size={12} color={c.rating} />
                <Text style={[styles.providerMetaText, { color: c.mutedForeground }]}>{provider.rating?.toFixed(1)}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.iconAction, { backgroundColor: c.muted }]}
              onPress={() => router.push(`/chat/${provider.id}` as any)}
            >
              <Feather name="message-circle" size={18} color={c.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconAction, { backgroundColor: c.primaryLight }]}
              onPress={() => router.push(`/call/${provider.id}` as any)}
            >
              <Feather name="phone" size={18} color={c.primary} />
            </TouchableOpacity>
          </Animated.View>
        )}

        <View style={[styles.detailsCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.jobTitle, { color: c.text }]}>{job.title}</Text>
          <View style={styles.detailRow}>
            <Feather name="map-pin" size={14} color={c.mutedForeground} />
            <Text style={[styles.detailText, { color: c.mutedForeground }]}>{job.location}</Text>
          </View>
          <View style={styles.detailRow}>
            <Feather name="calendar" size={14} color={c.mutedForeground} />
            <Text style={[styles.detailText, { color: c.mutedForeground }]}>{job.date}, {job.time}</Text>
          </View>
          <View style={styles.detailRow}>
            <Feather name="dollar-sign" size={14} color={c.mutedForeground} />
            <Text style={[styles.detailText, { color: c.mutedForeground }]}>€{job.assignedPrice?.toFixed(2)}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.doneBtn, { backgroundColor: c.primary }]}
          onPress={() => router.replace('/(tabs)/jobs' as any)}
        >
          <Text style={styles.doneText}>{t('summary_go_jobs')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  successCard: { borderRadius: 20, padding: 24, alignItems: 'center', gap: 6 },
  successTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  successSub: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center' },
  providerCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 16 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  providerName: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  providerMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  providerMetaText: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  iconAction: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  detailsCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 16, gap: 10 },
  jobTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16, marginBottom: 4 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailText: { fontFamily: 'Manrope_400Regular', fontSize: 13 },
  doneBtn: { marginTop: 24, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  doneText: { fontFamily: 'Manrope_700Bold', fontSize: 15, color: '#FFF' },
});
