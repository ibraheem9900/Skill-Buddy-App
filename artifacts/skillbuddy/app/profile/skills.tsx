import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import BackButton from '@/components/BackButton';
import EmptyState from '@/components/EmptyState';
import ServicePickerSheet from '@/components/ServicePickerSheet';
import { SkeletonBox } from '@/components/SkeletonCard';
import { useAppAlert } from '@/context/AlertModalContext';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme } from '@/context/ThemeContext';
import useProviderSkills from '@/hooks/useProviderSkills';
import { countActiveSkills, sortSkills } from '@/lib/providerSkills';
import type { ProviderSkill } from '@/types';

/**
 * My Skills — the provider's own skills (GET/POST/PATCH/DELETE
 * /providers/me/skills), reachable from the provider profile and from the
 * Available-jobs onboarding card / nudge that Chunk 5 put in the feed.
 *
 * WHY THIS SCREEN EXISTS (guide §4.1): a job whose service is one of the
 * provider's ACTIVE skills ranks first in the nearby feed (`matches_skill`).
 * Adding the first skill is what makes that ranking appear, and deactivating or
 * removing the last one takes it away — so every write here marks the feed
 * stale, and the feed re-reads on its next focus (the provider never has to
 * refresh it by hand).
 *
 * ADD: the cascading Category → Service picker the rest of the app uses
 * (components/ServicePickerSheet — never a flat list of every service on the
 * platform). The POST body is `service_id` alone: the live backend applies its
 * own defaults (skill_type PRIMARY, years_of_experience 0, is_active true) and
 * returns the finished row, which is what gets rendered.
 *
 * TOGGLE: PATCH with ONLY `is_active` — the one field this app writes. Provider
 * (profile) `is_active` is the backend's activation flag and is never sent from
 * anywhere in the app.
 *
 * REMOVE: translated destructive confirm, then DELETE; the row disappears only
 * after the confirmed 204. Nothing on this screen is optimistic.
 *
 * ERRORS: a refused write is NON-BLOCKING — the list stays exactly as the server
 * last described it and the backend's own sentence (the live 409 and 404 both
 * carry one) is shown in a dismissible banner above it.
 */
export default function ProviderSkillsScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuth();
  const showAlert = useAppAlert();

  const {
    status,
    skills,
    errorMessage,
    writeFailure,
    dismissWriteFailure,
    pending,
    load,
    refresh,
    add,
    setActive,
    remove,
    failureText,
  } = useProviderSkills();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const isProvider = Array.isArray(user?.roles) && user!.roles!.includes('PROVIDER');
  const canLoad = !!user && isProvider;

  // The server list, ordered the way the screen reads it (category, then service).
  const rows = useMemo(() => sortSkills(skills ?? []), [skills]);
  const activeCount = useMemo(() => countActiveSkills(skills ?? []), [skills]);
  /** Every write is locked while one is in flight (double-tap lock). */
  const busy = pending !== null;

  useFocusEffect(
    useCallback(() => {
      if (canLoad) void load();
    }, [canLoad, load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refresh().finally(() => setRefreshing(false));
  }, [refresh]);

  /** Cascading picker selection → POST { service_id }. */
  const onPickService = useCallback(
    (serviceId: number) => {
      setPickerOpen(false);
      void add(serviceId);
    },
    [add]
  );

  /**
   * ACTIVE/INACTIVE toggle. The value sent is the opposite of what the server
   * reports (never a local guess), and a server that already reports the target
   * value produces no request at all — the hook decides that.
   */
  const onToggle = useCallback(
    (skill: ProviderSkill) => {
      void setActive(skill, skill.is_active !== true);
    },
    [setActive]
  );

  const confirmRemove = useCallback(
    (skill: ProviderSkill) => {
      const label = skill.service_title ?? skill.category_name ?? String(skill.service_id);
      showAlert({
        title: t('skills_delete_title'),
        message: t('skills_delete_msg', { service: label }),
        icon: 'trash-2',
        buttons: [
          { text: t('action_cancel'), style: 'cancel' },
          { text: t('skills_delete_confirm'), style: 'destructive', onPress: () => void remove(skill.id) },
        ],
      });
    },
    [remove, showAlert, t]
  );

  /* ------------------------------------------------------------- sub-views */

  const header = (
    <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
      <BackButton />
      <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>
        {t('skills_title')}
      </Text>
      {canLoad ? (
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: c.primary }, busy && styles.addBtnBusy]}
          onPress={() => setPickerOpen(true)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('skills_add')}
        >
          <Feather name="plus" size={17} color={c.primaryForeground} />
        </TouchableOpacity>
      ) : (
        <View style={styles.headerSpacer} />
      )}
    </View>
  );

  const skeleton = (
    <View style={styles.skeletonWrap}>
      <SkeletonBox height={14} style={{ width: '70%' }} />
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}>
          <SkeletonBox height={34} borderRadius={17} style={{ width: 34 }} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <SkeletonBox height={13} style={{ width: '55%' }} />
            <SkeletonBox height={10} style={{ width: '40%', marginTop: 6 }} />
          </View>
        </View>
      ))}
    </View>
  );

  const stateCard = (icon: keyof typeof Feather.glyphMap, title: string, sub: string, onRetry?: () => void) => (
    <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
      <Feather name={icon} size={22} color={onRetry ? c.destructive : c.mutedForeground} />
      <Text style={[styles.stateTitle, { color: c.text }]}>{title}</Text>
      <Text style={[styles.stateText, { color: c.mutedForeground }]}>{sub}</Text>
      {onRetry ? (
        <TouchableOpacity onPress={onRetry} style={[styles.stateBtn, { backgroundColor: c.primary }]}>
          <Text style={[styles.stateBtnText, { color: c.primaryForeground }]}>{t('skills_retry')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const failureBanner = writeFailure ? (
    <View style={[styles.banner, { backgroundColor: c.card, borderColor: c.destructive }]}>
      <Feather name="alert-triangle" size={14} color={c.destructive} />
      <Text style={[styles.bannerText, { color: c.text }]}>{failureText(writeFailure)}</Text>
      <Pressable hitSlop={8} onPress={dismissWriteFailure} accessibilityLabel={t('nearby_notice_dismiss')}>
        <Feather name="x" size={14} color={c.mutedForeground} />
      </Pressable>
    </View>
  ) : null;

  const row = (skill: ProviderSkill) => {
    const active = skill.is_active === true;
    const rowBusy = pending === skill.id;
    return (
      <View
        key={skill.id}
        style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}
        accessibilityRole="summary"
        accessibilityLabel={`${skill.service_title ?? ''} ${active ? t('skills_active') : t('skills_inactive')}`}
      >
        <View style={[styles.rowIcon, { backgroundColor: active ? c.successLight : c.accent }]}>
          <Feather name="award" size={16} color={active ? c.success : c.mutedForeground} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: c.text }]} numberOfLines={1}>
            {skill.service_title ?? t('skills_service_fallback', { id: skill.service_id })}
          </Text>
          {skill.category_name ? (
            <Text style={[styles.rowSub, { color: c.mutedForeground }]} numberOfLines={1}>
              {skill.category_name}
            </Text>
          ) : null}
          <View style={styles.rowMeta}>
            <View
              style={[
                styles.pill,
                { backgroundColor: active ? c.successLight : c.accent, borderColor: active ? c.success : c.border },
              ]}
            >
              <Text style={[styles.pillText, { color: active ? c.success : c.mutedForeground }]}>
                {active ? t('skills_active') : t('skills_inactive')}
              </Text>
            </View>
            {typeof skill.years_of_experience === 'number' && skill.years_of_experience > 0 ? (
              <Text style={[styles.rowYears, { color: c.mutedForeground }]}>
                {t('skills_years', { n: skill.years_of_experience })}
              </Text>
            ) : null}
          </View>
        </View>

        {rowBusy ? (
          <ActivityIndicator size="small" color={c.primary} />
        ) : (
          <View style={styles.rowActions}>
            <TouchableOpacity
              style={[styles.toggleBtn, { borderColor: c.primary }]}
              onPress={() => onToggle(skill)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={active ? t('skills_deactivate') : t('skills_activate')}
            >
              <Feather name={active ? 'pause-circle' : 'play-circle'} size={13} color={c.primary} />
              <Text style={[styles.toggleText, { color: c.primary }]}>
                {active ? t('skills_deactivate') : t('skills_activate')}
              </Text>
            </TouchableOpacity>
            <Pressable
              hitSlop={8}
              onPress={() => confirmRemove(skill)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('skills_delete_confirm')}
            >
              <Feather name="trash-2" size={16} color={c.destructive} />
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  /* ------------------------------------------------------------------ view */

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      {header}

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} />
        }
      >
        {!canLoad ? (
          stateCard('award', t('skills_forbidden_title'), t('skills_forbidden_sub'))
        ) : status === 'loading' && skills === null ? (
          skeleton
        ) : status === 'error' && skills === null ? (
          stateCard('wifi-off', t(errorMessage ?? 'skills_err_load'), t('skills_err_network'), () => void load(true))
        ) : (
          <>
            <Text style={[styles.intro, { color: c.mutedForeground }]}>{t('skills_subtitle')}</Text>

            {failureBanner}

            {status === 'error' ? (
              <View style={styles.inlineErrorRow}>
                <Feather name="wifi-off" size={12} color={c.mutedForeground} />
                <Text style={[styles.inlineErrorText, { color: c.mutedForeground }]}>
                  {t('skills_inline_error')}
                </Text>
              </View>
            ) : null}

            {rows.length === 0 ? (
              <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
                <EmptyState
                  icon="award"
                  title={t('skills_empty_title')}
                  subtitle={t('skills_empty_sub')}
                  actionLabel={t('skills_add')}
                  onAction={() => setPickerOpen(true)}
                />
              </View>
            ) : (
              <>
                <View style={styles.countRow}>
                  <Text style={[styles.countText, { color: c.text }]}>
                    {rows.length === 1
                      ? t('skills_count_one', { n: rows.length })
                      : t('skills_count_many', { n: rows.length })}
                  </Text>
                  <Text style={[styles.countActive, { color: c.success }]}>
                    {t('skills_active_count', { n: activeCount })}
                  </Text>
                </View>

                {rows.map(row)}

                <TouchableOpacity
                  style={[styles.addCta, { borderColor: c.primary }, busy && styles.addBtnBusy]}
                  onPress={() => setPickerOpen(true)}
                  disabled={busy}
                  accessibilityRole="button"
                >
                  {pending === 'add' ? (
                    <ActivityIndicator size="small" color={c.primary} />
                  ) : (
                    <Feather name="plus" size={15} color={c.primary} />
                  )}
                  <Text style={[styles.addCtaText, { color: c.primary }]}>
                    {pending === 'add' ? t('skills_add_busy') : t('skills_add')}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* The same cascading Category → Service picker the Post-a-Job flow uses. */}
      <ServicePickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        selectedId={null}
        onSelect={(service) => onPickService(service.id)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 40 },
  addBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  addBtnBusy: { opacity: 0.55 },
  scroll: { padding: 20, flexGrow: 1 },
  intro: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 18, marginBottom: 14 },
  skeletonWrap: { gap: 12 },
  card: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  stateWrap: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    gap: 8,
  },
  stateTitle: { fontFamily: 'Manrope_700Bold', fontSize: 15, textAlign: 'center' },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  stateBtn: { marginTop: 8, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 12 },
  stateBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  bannerText: { fontFamily: 'Manrope_400Regular', fontSize: 12, flex: 1, lineHeight: 18 },
  inlineErrorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  inlineErrorText: { fontFamily: 'Manrope_400Regular', fontSize: 11, flex: 1 },
  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  countText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  countActive: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  rowIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  rowSub: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 },
  pill: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontFamily: 'Manrope_600SemiBold', fontSize: 10 },
  rowYears: { fontFamily: 'Manrope_400Regular', fontSize: 10 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  toggleText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
  addCta: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 14,
    paddingVertical: 14,
  },
  addCtaText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
