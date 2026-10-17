import React, { useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import useCategories from '@/hooks/useCategories';
import useServices from '@/hooks/useServices';
import useNearbyJobs from '@/hooks/useNearbyJobs';
import NearbyJobCard from '@/components/NearbyJobCard';
import EmptyState from '@/components/EmptyState';
import { SkeletonBox } from '@/components/SkeletonCard';
import type { NearbyChecklistKey, NearbyJobKind } from '@/lib/nearbyJobs';
import type { TranslationKey } from '@/context/LanguageContext';

/**
 * The provider's "Available jobs" list: GET /api/v1/providers/me/nearby-jobs.
 *
 * Every state the endpoint can produce has its own screen-reader-visible form:
 *   loading      three skeleton cards (never an empty list flashing)
 *   jobs         the cards, matching skills first then closest
 *   empty        "No jobs near you right now" — a REAL answer for a visible
 *                provider, deliberately different from onboarding below
 *   onboarding   the backend's 400 is not an error: it means the provider is
 *                not visible yet, so the card lists the exact requirements with
 *                the missing one marked and the address row as its CTA
 *   forbidden    a client account reached the provider endpoint
 *   error        everything else, with the backend's own text when it sent one
 *
 * The names shown on a card come from the app's existing category/service
 * caches; an id that is not in them renders nothing rather than a raw number.
 */
interface Props {
  /** Provider mode with the Available chip selected. */
  enabled: boolean;
  /** Space the Android navigation bar + tab bar need at the bottom. */
  bottomInset: number;
}

const KIND_LABELS: { key: NearbyJobKind; labelKey: TranslationKey }[] = [
  { key: 'ALL', labelKey: 'nearby_filter_all' },
  { key: 'URGENT', labelKey: 'jobs_urgent' },
  { key: 'REGULAR', labelKey: 'jobs_regular' },
];

export default function NearbyJobsFeed({ enabled, bottomInset }: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const router = useRouter();

  const { categories, load: loadCategories } = useCategories();
  const { services, load: loadServices } = useServices();

  const {
    status,
    jobs,
    totalCount,
    filters,
    setFilters,
    refreshing,
    refresh,
    retry,
    inlineError,
    serverMessage,
    visibility,
    notice,
    dismissNotice,
    live,
    activeSkills,
  } = useNearbyJobs({ enabled });

  // The card's labels come from the caches the rest of the app already fills.
  useEffect(() => {
    if (!enabled) return;
    void loadCategories();
    void loadServices();
  }, [enabled, loadCategories, loadServices]);

  const categoryNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const category of categories ?? []) {
      if (typeof category?.id === 'number' && typeof category.name === 'string') {
        map.set(category.id, category.name);
      }
    }
    return map;
  }, [categories]);

  const serviceNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const service of services ?? []) {
      if (typeof service?.id === 'number' && typeof service.title === 'string') {
        map.set(service.id, service.title);
      }
    }
    return map;
  }, [services]);

  const filtered = filters.kind !== 'ALL' || filters.onlyMatchingSkills;

  /* ----------------------------------------------------------- sub-views */

  const chips = () => (
    <View style={styles.filterBlock}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {KIND_LABELS.map(({ key, labelKey }) => {
          const active = filters.kind === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.chip, { backgroundColor: active ? c.primary : c.muted }]}
              onPress={() => setFilters({ ...filters, kind: key })}
            >
              <Text style={[styles.chipText, { color: active ? c.primaryForeground : c.mutedForeground }]}>
                {t(labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[
            styles.chip,
            styles.skillChip,
            {
              backgroundColor: filters.onlyMatchingSkills ? c.primary : c.muted,
              borderColor: filters.onlyMatchingSkills ? c.primary : c.border,
            },
          ]}
          onPress={() => setFilters({ ...filters, onlyMatchingSkills: !filters.onlyMatchingSkills })}
        >
          <Feather
            name="award"
            size={12}
            color={filters.onlyMatchingSkills ? c.primaryForeground : c.mutedForeground}
          />
          <Text
            style={[
              styles.chipText,
              { color: filters.onlyMatchingSkills ? c.primaryForeground : c.mutedForeground },
            ]}
          >
            {t('nearby_filter_only_my_skills')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );

  const skeleton = () => (
    <View style={{ padding: 20, gap: 12 }}>
      {[0, 1, 2].map((index) => (
        <View key={index} style={[styles.skeletonCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <SkeletonBox height={16} style={{ width: '35%' }} />
          <SkeletonBox height={16} style={{ width: '75%', marginTop: 10 }} />
          <SkeletonBox height={12} style={{ width: '45%', marginTop: 8 }} />
          <SkeletonBox height={12} style={{ width: '30%', marginTop: 8 }} />
        </View>
      ))}
    </View>
  );

  const hardError = () => (
    <View style={styles.stateWrap}>
      <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Feather name="alert-circle" size={28} color={c.destructive} />
        <Text style={[styles.stateTitle, { color: c.text }]}>{t('nearby_load_error_title')}</Text>
        <Text style={[styles.stateText, { color: c.mutedForeground }]}>
          {serverMessage ?? t('nearby_load_error_sub')}
        </Text>
        <TouchableOpacity style={[styles.retryBtn, { backgroundColor: c.primary }]} onPress={retry}>
          <Text style={[styles.retryText, { color: c.primaryForeground }]}>{t('jobs_retry')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const forbidden = () => (
    <View style={styles.stateWrap}>
      <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Feather name="lock" size={28} color={c.mutedForeground} />
        <Text style={[styles.stateTitle, { color: c.text }]}>{t('nearby_forbidden_title')}</Text>
        <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('nearby_forbidden_sub')}</Text>
      </View>
    </View>
  );

  const onboardingRowText = (key: NearbyChecklistKey): { label: TranslationKey; note?: TranslationKey } => {
    switch (key) {
      case 'address':
        return { label: 'nearby_onboarding_address' };
      case 'approval':
        return { label: 'nearby_onboarding_approval', note: 'nearby_onboarding_approval_note' };
      default:
        return { label: 'nearby_onboarding_skills', note: 'nearby_onboarding_skills_note' };
    }
  };

  const onboarding = () => (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingBottom: bottomInset + 20, gap: 14 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} colors={[c.primary]} />
      }
    >
      <View style={[styles.onboardingCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={[styles.onboardingIcon, { backgroundColor: c.primaryLight }]}>
          <Feather name="eye-off" size={22} color={c.primary} />
        </View>
        <Text style={[styles.stateTitle, { color: c.text, textAlign: 'left' }]}>
          {t('nearby_onboarding_title')}
        </Text>
        <Text style={[styles.stateText, { color: c.mutedForeground, textAlign: 'left' }]}>
          {t('nearby_onboarding_sub')}
        </Text>

        {visibility === null ? (
          <View style={styles.checkingRow}>
            <ActivityIndicator size="small" color={c.primary} />
            <Text style={[styles.stateText, { color: c.mutedForeground }]}>
              {t('nearby_onboarding_loading')}
            </Text>
          </View>
        ) : (
          <View style={{ gap: 12, marginTop: 4 }}>
            {visibility.items.map((item) => {
              const { label, note } = onboardingRowText(item.key);
              return (
                <View key={item.key} style={styles.checkRow}>
                  <View
                    style={[
                      styles.checkDot,
                      {
                        borderColor: item.done ? c.success : c.border,
                        backgroundColor: item.done ? c.successLight : 'transparent',
                      },
                    ]}
                  >
                    {item.done ? <Feather name="check" size={12} color={c.success} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.checkLabel, { color: c.text }]}>{t(label)}</Text>
                    {note ? (
                      <Text style={[styles.checkNote, { color: c.mutedForeground }]}>{t(note)}</Text>
                    ) : null}
                    {/* Both onboarding steps that the provider can act on link to
                        their own screen (§4.1 skills, §4.3 address). The approval
                        row has no cta — it is an administrator's decision. */}
                    {!item.done && item.cta ? (
                      <TouchableOpacity
                        style={[styles.inlineCta, { backgroundColor: c.primary }]}
                        onPress={() =>
                          router.push((item.cta === 'skills' ? '/profile/skills' : '/profile/add-address') as any)
                        }
                      >
                        <Text style={[styles.inlineCtaText, { color: c.primaryForeground }]}>
                          {item.cta === 'skills'
                            ? t('nearby_onboarding_open_skills')
                            : t('nearby_onboarding_open_address')}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              );
            })}

            {visibility.cause === 'unknown' ? (
              <Text style={[styles.checkNote, { color: c.mutedForeground }]}>
                {t('nearby_onboarding_unknown', { detail: serverMessage ?? '' })}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </ScrollView>
  );

  /* --------------------------------------------------------------- notice */

  const noticeBanner = notice ? (
    <Pressable
      style={[styles.notice, { backgroundColor: c.card, borderColor: c.primary }]}
      onPress={dismissNotice}
      accessibilityRole="button"
      accessibilityLabel={t('nearby_notice_dismiss')}
    >
      <Feather name="bell" size={14} color={c.primary} />
      <Text style={[styles.noticeText, { color: c.text }]} numberOfLines={2}>
        {t('nearby_notice_new', { title: notice.title })}
      </Text>
      <Feather name="x" size={14} color={c.mutedForeground} />
    </Pressable>
  ) : null;

  /* ----------------------------------------------------------------- view */

  if (status === 'onboarding') return <View style={{ flex: 1 }}>{onboarding()}</View>;
  if (status === 'forbidden') return forbidden();
  if (status === 'error') return hardError();
  if (status === 'loading' && jobs.length === 0 && totalCount === 0) return skeleton();

  return (
    <View style={{ flex: 1 }}>
      {chips()}

      {/* The nudge is the second way into the skills screen, and it disappears by
          itself once the provider has at least one ACTIVE skill (activeSkills is
          re-read on every focus after a skills/address write). */}
      {activeSkills === 0 ? (
        <TouchableOpacity
          style={[styles.nudge, { backgroundColor: c.primaryLight }]}
          onPress={() => router.push('/profile/skills' as any)}
          accessibilityRole="button"
          accessibilityLabel={t('nearby_skills_nudge')}
        >
          <Feather name="award" size={13} color={c.primary} />
          <Text style={[styles.nudgeText, { color: c.primary }]}>{t('nearby_skills_nudge')}</Text>
          <Feather name="chevron-right" size={13} color={c.primary} />
        </TouchableOpacity>
      ) : null}

      {inlineError ? (
        <View style={styles.inlineErrorRow}>
          <Feather name="wifi-off" size={12} color={c.mutedForeground} />
          <Text style={[styles.inlineErrorText, { color: c.mutedForeground }]}>
            {t('nearby_inline_error')}
          </Text>
        </View>
      ) : null}

      {!live ? (
        <View style={styles.inlineErrorRow}>
          <Feather name="refresh-cw" size={12} color={c.mutedForeground} />
          <Text style={[styles.inlineErrorText, { color: c.mutedForeground }]}>{t('nearby_live_off')}</Text>
        </View>
      ) : null}

      <FlatList
        data={jobs}
        keyExtractor={(job) => String(job.job_id)}
        contentContainerStyle={{ padding: 20, paddingBottom: bottomInset + 20, gap: 12, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} colors={[c.primary]} />
        }
        ListHeaderComponent={
          totalCount > 0 ? (
            <Text style={[styles.countText, { color: c.mutedForeground }]}>
              {totalCount === 1
                ? t('nearby_count_one', { n: totalCount })
                : t('nearby_count_many', { n: totalCount })}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          filtered ? (
            <EmptyState
              icon="filter"
              title={t('nearby_empty_filtered_title')}
              subtitle={t('nearby_empty_filtered_sub')}
              actionLabel={t('nearby_clear_filters')}
              onAction={() => setFilters({ kind: 'ALL', onlyMatchingSkills: false })}
            />
          ) : (
            <EmptyState
              icon="map-pin"
              title={t('nearby_empty_title')}
              subtitle={t('nearby_empty_sub')}
            />
          )
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(Math.min(index, 6) * 60).duration(350)}>
            <NearbyJobCard
              job={item}
              categoryName={categoryNames.get(item.category_id) ?? null}
              serviceName={serviceNames.get(item.service_id) ?? null}
              onPress={() => router.push(`/job/${item.job_id}` as any)}
            />
          </Animated.View>
        )}
      />

      {noticeBanner}
    </View>
  );
}

const styles = StyleSheet.create({
  filterBlock: { paddingVertical: 10 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, alignItems: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  skillChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1 },
  chipText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  countText: { fontFamily: 'Manrope_500Medium', fontSize: 12, marginBottom: 4 },
  skeletonCard: { borderWidth: 1, borderRadius: 14, padding: 14 },
  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  stateCard: {
    alignItems: 'center',
    gap: 10,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    width: '100%',
  },
  stateTitle: { fontFamily: 'Manrope_700Bold', fontSize: 15, textAlign: 'center' },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  retryBtn: { marginTop: 4, paddingHorizontal: 24, paddingVertical: 11, borderRadius: 22 },
  retryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  onboardingCard: { borderWidth: 1, borderRadius: 16, padding: 20, gap: 10 },
  onboardingIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  checkNote: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 2, lineHeight: 17 },
  inlineCta: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  inlineCtaText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  nudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  nudgeText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 12 },
  inlineErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  inlineErrorText: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  notice: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    elevation: 3,
  },
  noticeText: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
});
