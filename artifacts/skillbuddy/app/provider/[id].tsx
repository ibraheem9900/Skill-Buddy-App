import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import BackButton from '@/components/BackButton';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import { getRememberedProvider } from '@/lib/publicProfiles';
import { initialsFor, providerDisplayName } from '@/lib/profileDisplay';
import type { ProviderSkill } from '@/types';

/**
 * A PILOT's read-only public profile, opened from a bid card.
 *
 * WHAT IT CAN SHOW — and why that is the whole list: the live API has NO public
 * provider-profile endpoint. The only other-party data the backend sends is the
 * bid's `provider` snapshot (BidProviderSummary: name, photo, star rating, badge
 * count/tier, completed jobs, credibility, acceptance rate, response time) plus
 * GET /providers/{id}/skills. So:
 *
 *   shown   avatar, display name, rating, completed jobs, badge tier/count,
 *           credibility, acceptance rate, response time, skills
 *   hidden  reviews (no endpoint), member since (no field), verification
 *           (no field), bio (only on the provider's OWN profile), languages
 *           (no field), service area (only on the provider's OWN profile)
 *
 * Empty sections are omitted entirely — no placeholder rows, no invented
 * numbers. The missing endpoints are listed in the delivery report.
 */
export default function PublicProviderProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  const providerId = /^\d+$/.test(id ?? '') ? Number(id) : null;
  const snapshot = getRememberedProvider(providerId);

  const [skills, setSkills] = useState<ProviderSkill[] | null>(null);
  const [skillsStatus, setSkillsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [photoFailed, setPhotoFailed] = useState(false);

  const loadSkills = useCallback(async () => {
    if (providerId === null) return;
    setSkillsStatus('loading');
    try {
      const { data } = await authApi.getPublicProviderSkills(providerId);
      setSkills(Array.isArray(data) ? data : []);
      setSkillsStatus('ready');
    } catch {
      setSkills(null);
      setSkillsStatus('error');
    }
  }, [providerId]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <BackButton />
      <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>
        {t('provider_profile_title')}
      </Text>
      <View style={{ width: 40 }} />
    </View>
  );

  if (!snapshot) {
    return (
      <View style={[styles.root, { backgroundColor: c.background }]}>
        {header}
        <View style={styles.stateWrap}>
          <Feather name="user-x" size={30} color={c.mutedForeground} />
          <Text style={[styles.stateTitle, { color: c.text }]}>{t('profile_unavailable_title')}</Text>
          <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
            {t('profile_unavailable_sub')}
          </Text>
        </View>
      </View>
    );
  }

  const displayName = providerDisplayName(snapshot.name, t('pilot_fallback_name'));
  const rating = typeof snapshot.star_rating === 'number' ? snapshot.star_rating.toFixed(1) : null;
  const photo = snapshot.profile_photo_url;
  const showPhoto = !!photo && !photoFailed;
  const activeSkills = (skills ?? []).filter((skill) => skill.is_active !== false);

  const stat = (label: string, value: string) => (
    <View key={label} style={[styles.stat, { backgroundColor: c.card, borderColor: c.border }]}>
      <Text style={[styles.statValue, { color: c.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: c.mutedForeground }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {header}
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { backgroundColor: c.card, borderColor: c.border }]}>
          {showPhoto ? (
            <Image
              source={{ uri: photo as string }}
              style={styles.avatar}
              contentFit="cover"
              onError={() => setPhotoFailed(true)}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: c.muted }]}>
              <Text style={[styles.avatarInitial, { color: c.primary }]}>
                {initialsFor(snapshot.name)}
              </Text>
            </View>
          )}
          <Text style={[styles.name, { color: c.text }]} numberOfLines={2}>
            {displayName}
          </Text>
          <View style={styles.ratingRow}>
            {rating ? (
              <>
                <Feather name="star" size={14} color={c.rating} />
                <Text style={[styles.ratingText, { color: c.text }]}>{rating}</Text>
              </>
            ) : null}
            {snapshot.badge_tier ? (
              <View style={[styles.tierChip, { backgroundColor: c.primaryLight }]}>
                <MaterialCommunityIcons name="shield-check-outline" size={12} color={c.primary} />
                <Text style={[styles.tierText, { color: c.primary }]}>{snapshot.badge_tier}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.statGrid}>
          {stat(t('profile_jobs_done_label'), String(snapshot.total_jobs_completed ?? 0))}
          {stat(t('profile_badges_label'), String(snapshot.badge_count ?? 0))}
          {stat(t('profile_credibility'), `${snapshot.credibility_score ?? 0}%`)}
          {stat(t('profile_acceptance'), `${snapshot.acceptance_rate ?? 0}%`)}
          {stat(t('profile_response_time'), t('profile_minutes', { n: snapshot.response_time_avg ?? 0 }))}
        </View>

        <Text style={[styles.sectionTitle, { color: c.text }]}>{t('profile_skills')}</Text>
        {skillsStatus === 'loading' ? (
          <View style={{ gap: 8 }}>
            {[0, 1, 2].map((row) => (
              <View
                key={row}
                style={[styles.skeleton, { backgroundColor: c.muted, borderColor: c.border }]}
              />
            ))}
          </View>
        ) : skillsStatus === 'error' ? (
          <View style={[styles.errorBox, { borderColor: c.border, backgroundColor: c.card }]}>
            <Feather name="alert-circle" size={16} color={c.mutedForeground} />
            <Text style={[styles.errorText, { color: c.mutedForeground }]}>
              {t('profile_skills_error')}
            </Text>
            <TouchableOpacity
              style={[styles.retryBtn, { borderColor: c.primary }]}
              onPress={() => void loadSkills()}
              activeOpacity={0.8}
            >
              <Text style={[styles.retryText, { color: c.primary }]}>{t('profile_try_again')}</Text>
            </TouchableOpacity>
          </View>
        ) : activeSkills.length === 0 ? (
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>{t('profile_skills_empty')}</Text>
        ) : (
          <View style={styles.skillWrap}>
            {activeSkills.map((skill) => (
              <View
                key={skill.id}
                style={[styles.skillChip, { backgroundColor: c.card, borderColor: c.border }]}
              >
                <Text style={[styles.skillText, { color: c.text }]} numberOfLines={1}>
                  {skill.service_title || skill.category_name || `#${skill.service_id}`}
                </Text>
                {skill.is_verified ? (
                  <Feather name="check-circle" size={12} color={c.primary} />
                ) : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 17, flex: 1, textAlign: 'center' },
  hero: { borderWidth: 1, borderRadius: 20, padding: 20, alignItems: 'center', gap: 10 },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: 'Manrope_700Bold', fontSize: 30 },
  name: { fontFamily: 'Manrope_700Bold', fontSize: 20, textAlign: 'center' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ratingText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  tierChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  tierText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  stat: {
    flexGrow: 1,
    flexBasis: '30%',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 4,
  },
  statValue: { fontFamily: 'Manrope_700Bold', fontSize: 17 },
  statLabel: { fontFamily: 'Manrope_400Regular', fontSize: 10, textAlign: 'center' },
  sectionTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16, marginTop: 22, marginBottom: 10 },
  skeleton: { height: 44, borderWidth: 1, borderRadius: 12, opacity: 0.6 },
  errorBox: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8, alignItems: 'flex-start' },
  errorText: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 17 },
  retryBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  retryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  emptyText: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  skillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  skillChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    maxWidth: '100%',
  },
  skillText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 8 },
  stateTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16, textAlign: 'center' },
  stateSub: { fontFamily: 'Manrope_400Regular', fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
