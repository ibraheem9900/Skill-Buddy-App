import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useRole } from '@/context/RoleContext';
import { CURRENT_USER, PROVIDER_JOB_HISTORY } from '@/data/mockData';
import BackButton from '@/components/BackButton';
import { authApi } from '@/services/api';
import useProviderProfile, { formatHourlyRate } from '@/hooks/useProviderProfile';
import useProviderDashboard from '@/hooks/useProviderDashboard';
import useProviderStatusHistory from '@/hooks/useProviderStatusHistory';
import type { TranslationKey } from '@/context/LanguageContext';

/**
 * Professional info screen.
 * - CLIENT branch: unchanged (mock client stats — no endpoint in this task).
 * - PROVIDER branch: live GET /api/v1/providers/profile via useProviderProfile
 *   (fetched once per session on entry; refresh button for manual reload).
 *   Status editor (POST /api/v1/providers/status) lives on the availability
 *   card; the Activity Overview card reads GET /providers/dashboard.
 *   Known mock leftovers in the ready state, flagged for follow-up tasks:
 *   primary/secondary skills and the job-history list (no endpoints yet).
 */

/** Status values the web app already ships against POST /providers/status
 * (dashboard.index.tsx STATUS_OPTIONS). The live schema has NO server-side
 * enum (free string 1–30) — this set keeps mobile and web consistent.
 * Flagged for team confirmation before locking the vocabulary.
 */
const STATUS_OPTIONS = ['active', 'on_leave', 'unavailable'] as const;

type StatusOption = (typeof STATUS_OPTIONS)[number];

/** Dot color per status value (matches the web app's vocabulary). */
function statusDotColor(s: string, c: { success: string; warning: string; destructive: string }): string {
  if (s === 'active') return c.success;
  if (s === 'on_leave') return c.warning;
  return c.destructive; // unavailable / unknown
}

export default function ProfessionalInfoScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { activeRole } = useRole();
  const isProvider = activeRole === 'PROVIDER';
  const { status, profile, errorMessage, load, refresh, seedProfile, seedCurrentStatus } = useProviderProfile();
  // GET /providers/status-current — synced into the profile cache on entry.
  // 'notset' = provider has no status yet (404-style, undocumented shape).
  const [statusSync, setStatusSync] = useState<'idle' | 'loading' | 'synced' | 'notset' | 'error'>('idle');
  // READ-ONLY summary (GET /providers/dashboard) — separate hook/cache from
  // the profile; never merged into it, never used to pre-fill the edit form.
  const { status: dashStatus, summary: dashSummary, load: loadDashboard, refresh: refreshDashboard } = useProviderDashboard();
  // Status change log (GET /providers/status-history) — separate cache.
  const { state: histState, entries: histEntries, errorMessage: histError, load: loadHistory, refresh: refreshHistory } = useProviderStatusHistory();
  const router = useRouter();
  // ── Status editor state (POST /providers/status) ──
  const [statusEditorOpen, setStatusEditorOpen] = useState(false);
  const [statusValue, setStatusValue] = useState<StatusOption | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  const currentStatus = profile?.current_status?.status ?? null;

  const openStatusEditor = () => {
    setStatusValue((currentStatus as StatusOption) ?? null);
    setStatusReason(profile?.current_status?.reason ?? '');
    setStatusEditorOpen(true);
  };

  /**
   * POST /api/v1/providers/status — on 200 the response IS the new current
   * status; seed it into the cached profile's current_status (server truth,
   * no optimistic guess) and refresh the read-only dashboard card so the
   * snapshot's is_available falls in line. 422 detail[] logged + surfaced.
   */
  const handleStatusSave = async () => {
    if (!statusValue || statusSaving) return;
    if (statusValue !== 'active' && !statusReason.trim()) {
      Alert.alert(t('ps_title'), t('ps_reason_required'));
      return;
    }
    if (statusReason.trim().length > 500) return;
    setStatusSaving(true);
    try {
      const { data } = await authApi.updateProviderStatus(statusValue, statusReason.trim() || undefined);
      seedProfile({ ...profile!, current_status: { status: data.status, reason: data.reason ?? null, is_current: data.is_current ?? true } });
      setStatusEditorOpen(false);
      setStatusValue(null);
      setStatusReason('');
      Alert.alert(t('ps_title'), t('ps_success'));
      void refreshDashboard();
      void refreshHistory(); // newest entry == POST response; refresh keeps the log honest
    } catch (err: any) {
      if (err?.response?.status === 422) {
        console.warn('[providers/status] 422 detail:', err.response.data?.detail);
        Alert.alert(t('ps_title'), t('ps_err_invalid'));
      } else if (err?.response) {
        Alert.alert(t('ps_title'), t('ps_err_generic'));
      } else {
        Alert.alert(t('ps_title'), t('ps_err_network'));
      }
    } finally {
      setStatusSaving(false);
    }
  };

  useEffect(() => {
    if (isProvider) void load();
  }, [isProvider, load]);

  // Summary fetched once per session on dashboard entry (no per-render
  // refetches); manual refresh via the card's button or the screen refresh.
  useEffect(() => {
    if (isProvider) void loadDashboard();
  }, [isProvider, loadDashboard]);

  // History fetched once per session on dashboard entry (no per-render
  // refetches); refreshed manually and after a successful status change.
  useEffect(() => {
    if (isProvider) void loadHistory();
  }, [isProvider, loadHistory]);

  // Current-status sync (GET /providers/status-current): one fetch per
  // dashboard entry, seeded into the shared profile cache so the status
  // editor pre-fills from it. POST /providers/status success seeds the same
  // cache directly — the two never fetch over each other.
  useEffect(() => {
    if (!isProvider || statusSync !== 'idle') return;
    let cancelled = false;
    setStatusSync('loading');
    (async () => {
      try {
        const { data } = await authApi.getCurrentProviderStatus();
        if (!cancelled) {
          seedCurrentStatus(data);
          setStatusSync('synced');
        }
      } catch (err: any) {
        if (cancelled) return;
        if (err?.response?.status === 404) {
          // "No status set yet" (response shape undocumented — 404 assumed).
          // Fall back to whatever the profile object already carries.
          setStatusSync('notset');
        } else if (err?.response?.status === 401) {
          setStatusSync('error'); // interceptor handles refresh/redirect
        } else {
          setStatusSync('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isProvider, statusSync, seedCurrentStatus]);

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('prof_title')}</Text>
        {isProvider && status === 'ready' ? (
          <TouchableOpacity onPress={() => router.push('/profile/edit-provider')} accessibilityLabel={t('ep_title')}>
            <Text style={[styles.editBtnText, { color: c.primary }]}>{t('prov_edit')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {!isProvider ? (
        <View style={{ padding: 20 }}>
          <View style={styles.statGrid}>
            {[
              { label: t('prof_jobs_done'), value: CURRENT_USER.jobsDone, icon: 'check-circle' as const },
              { label: t('prof_active_jobs'), value: CURRENT_USER.activeJobs, icon: 'clock' as const },
              { label: t('prof_due_payments'), value: `€${CURRENT_USER.duePayments}`, icon: 'dollar-sign' as const },
            ].map((s) => (
              <View key={s.label} style={[styles.statCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <Feather name={s.icon} size={18} color={c.primary} />
                <Text style={[styles.statValue, { color: c.text }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: c.mutedForeground }]}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : status === 'idle' || status === 'loading' ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      ) : status === 'none' ? (
        // "No provider profile yet" — NOT a broken dashboard. The mobile
        // create-profile flow doesn't exist yet (POST task pending), so show
        // an explanatory state instead of routing.
        <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="user-plus" size={28} color={c.primary} />
          <Text style={[styles.stateTitle, { color: c.text }]}>{t('prov_none_title')}</Text>
          <Text style={[styles.stateMsg, { color: c.mutedForeground }]}>{t('prov_none_msg')}</Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: c.primary, borderColor: c.primary }]}
            onPress={() => router.push('/profile/create-provider')}
          >
            <Text style={[styles.retryText, { color: '#FFF' }]}>{t('prov_none_cta')}</Text>
          </TouchableOpacity>
        </View>
      ) : status === 'error' ? (
        <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="wifi-off" size={28} color={c.destructive} />
          <Text style={[styles.stateTitle, { color: c.text }]}>{t('prov_err_title')}</Text>
          <Text style={[styles.stateMsg, { color: c.mutedForeground }]}>{t(errorMessage ?? 'prov_err_generic')}</Text>
          <TouchableOpacity style={[styles.retryBtn, { borderColor: c.border }]} onPress={refresh}>
            <Text style={[styles.retryText, { color: c.primary }]}>{t('prov_retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : profile ? (
        <FlatList
          ListHeaderComponent={
            <View style={{ padding: 20, paddingBottom: 0 }}>
              {/* Availability from current_status (falls back to is_available).
                  "Change" opens the inline status editor (POST /providers/status). */}
              <View style={[styles.availCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <View style={[styles.availDot, { backgroundColor: currentStatus ? statusDotColor(currentStatus, c) : profile.is_available ? c.success : c.warning }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.availLabel, { color: c.mutedForeground }]}>{t('prov_availability')}</Text>
                  <Text style={[styles.availValue, { color: c.text }]}>
                    {currentStatus ?? (profile.is_available ? t('prov_available') : t('prov_unavailable'))}
                  </Text>
                  {statusSync === 'loading' && !currentStatus ? (
                    <View style={[styles.statusSyncSkeleton, { backgroundColor: c.border }]} />
                  ) : statusSync === 'notset' && !currentStatus ? (
                    <Text style={[styles.availReason, { color: c.mutedForeground }]}>{t('cst_not_set')}</Text>
                  ) : profile.current_status?.reason ? (
                    <Text style={[styles.availReason, { color: c.mutedForeground }]}>{profile.current_status.reason}</Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  style={[styles.statusChangeBtn, { borderColor: c.border }]}
                  onPress={statusEditorOpen ? () => setStatusEditorOpen(false) : openStatusEditor}
                  disabled={statusSaving}
                  accessibilityLabel={t('ps_change')}
                >
                  {statusSaving ? (
                    <ActivityIndicator size="small" color={c.primary} />
                  ) : (
                    <Text style={[styles.statusChangeText, { color: c.primary }]}>{statusEditorOpen ? t('ps_cancel') : t('ps_change')}</Text>
                  )}
                </TouchableOpacity>
              </View>

              {statusEditorOpen && profile ? (
                <View style={[styles.statusEditor, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Text style={[styles.statusEditorLabel, { color: c.mutedForeground }]}>{t('ps_pick_status')}</Text>
                  <View style={styles.statusChips}>
                    {STATUS_OPTIONS.map((opt) => {
                      const selected = statusValue === opt;
                      return (
                        <TouchableOpacity
                          key={opt}
                          style={[
                            styles.statusChip,
                            { borderColor: selected ? c.primary : c.border, backgroundColor: selected ? c.primaryLight : 'transparent' },
                          ]}
                          onPress={() => setStatusValue(opt)}
                          disabled={statusSaving}
                        >
                          <View style={[styles.statusChipDot, { backgroundColor: statusDotColor(opt, c) }]} />
                          <Text style={[styles.statusChipText, { color: selected ? c.primary : c.text }]}>{t(`ps_status_${opt}` as TranslationKey)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={[styles.statusEditorLabel, { color: c.mutedForeground }]}>
                    {t('ps_reason_label')}
                    {statusValue && statusValue !== 'active' ? ` (${t('ps_reason_required_mark')})` : ''}
                  </Text>
                  <TextInput
                    style={[styles.statusReasonInput, { borderColor: c.border, color: c.text, backgroundColor: c.background }]}
                    value={statusReason}
                    onChangeText={setStatusReason}
                    placeholder={t('ps_reason_placeholder')}
                    placeholderTextColor={c.mutedForeground}
                    multiline
                    maxLength={500}
                    editable={!statusSaving}
                  />
                  <TouchableOpacity
                    style={[styles.statusSaveBtn, { backgroundColor: c.primary, opacity: !statusValue || statusSaving ? 0.5 : 1 }]}
                    onPress={handleStatusSave}
                    disabled={!statusValue || statusSaving}
                  >
                    {statusSaving ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text style={styles.statusSaveText}>{t('ps_save')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* Status History — live GET /providers/status-history log.
                  Entries have NO id/timestamp (live-spec verified): keyed by
                  index, no "when" shown — flagged to the team. Current entry
                  gets a badge. */}
              <View style={[styles.skillsCard, { backgroundColor: c.card, borderColor: c.border, marginTop: 12 }]}>
                <View style={styles.dashHeader}>
                  <Text style={[styles.sectionTitle, { color: c.mutedForeground, marginTop: 0, marginBottom: 0 }]}>{t('sh_title')}</Text>
                  {histState === 'loading' ? (
                    <ActivityIndicator size="small" color={c.primary} />
                  ) : (
                    <TouchableOpacity style={styles.dashRefresh} onPress={refreshHistory} accessibilityLabel={t('prov_refresh')}>
                      <Feather name="refresh-cw" size={12} color={c.mutedForeground} />
                    </TouchableOpacity>
                  )}
                </View>
                {histState === 'error' ? (
                  <View style={styles.dashStateRow}>
                    <Text style={[styles.dashError, { color: c.destructive }]}>{t(histError ?? 'prov_err_generic')}</Text>
                    <TouchableOpacity onPress={refreshHistory}>
                      <Text style={[styles.dashRetry, { color: c.primary }]}>{t('prov_retry')}</Text>
                    </TouchableOpacity>
                  </View>
                ) : histState === 'ready' && histEntries && histEntries.length === 0 ? (
                  <Text style={[styles.shEmpty, { color: c.mutedForeground }]}>{t('sh_empty')}</Text>
                ) : histState === 'ready' && histEntries ? (
                  <View style={{ marginTop: 10 }}>
                    {histEntries.map((entry, idx) => (
                      <View key={`sh-${idx}`} style={[styles.shRow, idx > 0 && { borderTopWidth: 1, borderTopColor: c.border }]}>
                        <View style={[styles.statusChipDot, { backgroundColor: statusDotColor(entry.status, c), marginTop: 5 }]} />
                        <View style={{ flex: 1 }}>
                          <View style={styles.shRowTop}>
                            <Text style={[styles.shStatus, { color: c.text }]}>{entry.status.replace(/_/g, ' ')}</Text>
                            {entry.is_current ? (
                              <View style={[styles.shBadge, { backgroundColor: c.primaryLight }]}>
                                <Text style={[styles.shBadgeText, { color: c.primary }]}>{t('sh_current')}</Text>
                              </View>
                            ) : null}
                          </View>
                          {entry.reason ? (
                            <Text style={[styles.shReason, { color: c.mutedForeground }]}>{entry.reason}</Text>
                          ) : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>

              {/* Activity Overview — live GET /providers/dashboard summary
                  (user_id, job counts, is_available, is_active only).
                  Rendered strictly from that response — no fabricated fields. */}
              {dashSummary && (
                <View style={[styles.skillsCard, { backgroundColor: c.card, borderColor: c.border, marginTop: 12 }]}>
                  <View style={styles.dashHeader}>
                    <Text style={[styles.sectionTitle, { color: c.mutedForeground, marginTop: 0, marginBottom: 0 }]}>{t('db_title')}</Text>
                    {dashStatus === 'loading' ? (
                      <ActivityIndicator size="small" color={c.primary} />
                    ) : (
                      <TouchableOpacity style={styles.dashRefresh} onPress={refreshDashboard} accessibilityLabel={t('prov_refresh')}>
                        <Feather name="refresh-cw" size={12} color={c.mutedForeground} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={[styles.dashGrid, { marginTop: 12 }]}>
                    <View style={[styles.dashCell, { backgroundColor: c.background, borderColor: c.border }]}>
                      <Feather name="check-circle" size={16} color={c.primary} />
                      <Text style={[styles.dashCellLabel, { color: c.mutedForeground }]}>{t('db_jobs_completed')}</Text>
                      <Text style={[styles.dashCellValue, { color: c.text }]}>{dashSummary.total_jobs_completed}</Text>
                    </View>
                    <View style={[styles.dashCell, { backgroundColor: c.background, borderColor: c.border }]}>
                      <Feather name="zap" size={16} color={c.warning} />
                      <Text style={[styles.dashCellLabel, { color: c.mutedForeground }]}>{t('db_jobs_inprogress')}</Text>
                      <Text style={[styles.dashCellValue, { color: c.text }]}>{dashSummary.total_jobs_inprogress}</Text>
                    </View>
                  </View>
                  <View style={[styles.dashGrid, { marginTop: 10 }]}>
                    <View style={[styles.dashCell, { backgroundColor: c.background, borderColor: c.border }]}>
                      <View style={[styles.dashDot, { backgroundColor: dashSummary.is_available ? c.success : c.mutedForeground }]} />
                      <Text style={[styles.dashCellLabel, { color: c.mutedForeground }]}>{t('db_is_available')}</Text>
                      <Text style={[styles.dashCellValue, { color: c.text }]}>{dashSummary.is_available ? t('dash_yes') : t('dash_no')}</Text>
                    </View>
                    <View style={[styles.dashCell, { backgroundColor: c.background, borderColor: c.border }]}>
                      <View style={[styles.dashDot, { backgroundColor: dashSummary.is_active ? c.success : c.destructive }]} />
                      <Text style={[styles.dashCellLabel, { color: c.mutedForeground }]}>{t('db_is_active')}</Text>
                      <Text style={[styles.dashCellValue, { color: c.text }]}>{dashSummary.is_active ? t('dash_yes') : t('dash_no')}</Text>
                    </View>
                  </View>
                  {dashStatus === 'error' ? (
                    <View style={styles.dashStateRow}>
                      <Text style={[styles.dashError, { color: c.destructive }]}>{t('db_err_generic')}</Text>
                      <TouchableOpacity onPress={refreshDashboard}>
                        <Text style={[styles.dashRetry, { color: c.primary }]}>{t('prov_retry')}</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              )}

              <View style={[styles.skillsCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <View style={styles.skillRow}>
                  <MaterialCommunityIcons name="badge-account-outline" size={18} color={c.primary} />
                  <View>
                    <Text style={[styles.skillLabel, { color: c.mutedForeground }]}>{t('prov_type')}</Text>
                    <Text style={[styles.skillValue, { color: c.text }]}>{profile.provider_type}</Text>
                  </View>
                </View>
                <View style={[styles.skillRow, { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12, marginTop: 12 }]}>
                  <MaterialCommunityIcons name="star-circle-outline" size={18} color={c.primary} />
                  <View>
                    <Text style={[styles.skillLabel, { color: c.mutedForeground }]}>{t('prof_primary_skill')}</Text>
                    <Text style={[styles.skillValue, { color: c.text }]}>{CURRENT_USER.primarySkill}</Text>
                  </View>
                </View>
              </View>

              <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>{t('prof_metrics')}</Text>
              <View style={styles.statGrid}>
                <View style={[styles.statCard, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Feather name="star" size={18} color={c.rating} />
                  <Text style={[styles.statValue, { color: c.text }]}>{profile.star_rating.toFixed(1)}</Text>
                  <Text style={[styles.statLabel, { color: c.mutedForeground }]}>{t('prof_rating')}</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Feather name="check-circle" size={18} color={c.primary} />
                  <Text style={[styles.statValue, { color: c.text }]}>{profile.total_jobs_completed}</Text>
                  <Text style={[styles.statLabel, { color: c.mutedForeground }]}>{t('prof_jobs_done')}</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Feather name="zap" size={18} color={c.warning} />
                  <Text style={[styles.statValue, { color: c.text }]}>{profile.response_time_avg}m</Text>
                  <Text style={[styles.statLabel, { color: c.mutedForeground }]}>{t('prof_avg_response')}</Text>
                </View>
              </View>

              {/* Credibility score straight from the API (was mock-calculated). */}
              <View style={[styles.scoreCard, { backgroundColor: c.primaryLight }]}>
                <Text style={[styles.scoreLabel, { color: c.primary }]}>{t('prof_score')}</Text>
                <Text style={[styles.scoreValue, { color: c.primary }]}>{profile.credibility_score}/100</Text>
              </View>

              <TouchableOpacity style={[styles.refreshBtn, { borderColor: c.border }]} onPress={refresh}>
                <Feather name="refresh-cw" size={13} color={c.mutedForeground} />
                <Text style={[styles.refreshText, { color: c.mutedForeground }]}>{t('prov_refresh')}</Text>
              </TouchableOpacity>

              <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>{t('prof_history')}</Text>
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
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stateCard: { margin: 20, borderWidth: 1, borderRadius: 14, padding: 24, alignItems: 'center', gap: 10 },
  stateTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16, textAlign: 'center' },
  stateMsg: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  editBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  retryBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 9, marginTop: 6 },
  retryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  availCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12 },
  availDot: { width: 10, height: 10, borderRadius: 5 },
  availLabel: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  availValue: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginTop: 2, textTransform: 'capitalize' },
  availReason: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 4 },
  rateValue: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  rateLabel: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2 },
  statGrid: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 14, alignItems: 'center', gap: 6 },
  statValue: { fontFamily: 'Manrope_700Bold', fontSize: 17 },
  statLabel: { fontFamily: 'Manrope_400Regular', fontSize: 11, textAlign: 'center' },
  skillsCard: { borderWidth: 1, borderRadius: 14, padding: 16 },
  skillRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  skillLabel: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  skillValue: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginTop: 2 },
  sectionTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 22, marginBottom: 10 },
  scoreCard: { borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 14 },
  scoreLabel: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  scoreValue: { fontFamily: 'Manrope_700Bold', fontSize: 22, marginTop: 2 },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, marginTop: 14 },
  refreshText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  dashHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dashRefresh: { padding: 4 },
  dashGrid: { flexDirection: 'row', gap: 10 },
  dashCell: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center', gap: 4 },
  dashCellLabel: { fontFamily: 'Manrope_400Regular', fontSize: 10.5, textAlign: 'center' },
  dashCellValue: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  dashDot: { width: 9, height: 9, borderRadius: 4.5 },
  dashStateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  dashError: { fontFamily: 'Manrope_400Regular', fontSize: 11, flex: 1 },
  dashRetry: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, marginLeft: 8 },
  statusSyncSkeleton: { width: 120, height: 12, borderRadius: 6, marginTop: 4 },
  statusChangeBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, minWidth: 74, alignItems: 'center' },
  statusChangeText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  statusEditor: { borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 10, gap: 10 },
  statusEditorLabel: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  statusChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  statusChipDot: { width: 8, height: 8, borderRadius: 4 },
  statusChipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, textTransform: 'capitalize' },
  statusReasonInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontFamily: 'Manrope_400Regular', fontSize: 13, minHeight: 60, textAlignVertical: 'top' },
  statusSaveBtn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 2 },
  statusSaveText: { fontFamily: 'Manrope_700Bold', fontSize: 14, color: '#FFF' },
  shEmpty: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 10 },
  shRow: { flexDirection: 'row', gap: 10, paddingVertical: 10 },
  shRowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shStatus: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, textTransform: 'capitalize' },
  shBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  shBadgeText: { fontFamily: 'Manrope_600SemiBold', fontSize: 10 },
  shReason: { fontFamily: 'Manrope_400Regular', fontSize: 11.5, marginTop: 3, lineHeight: 16 },
  historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1 },
  historyClient: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  historyMeta: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2 },
  historyRating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  historyRatingText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
