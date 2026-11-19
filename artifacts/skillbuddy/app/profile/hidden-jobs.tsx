/**
 * Hidden Jobs — the client's own "Removed from My Jobs" list.
 *
 * WHY LOCAL: no hide/archive endpoint exists (lib/jobRemoval documents the
 * evidence), so the ids live in AsyncStorage per user (lib/hiddenJobs). This
 * screen is the visible half of that stopgap: it reads the ids, looks the jobs
 * up in the SAME list endpoint My Jobs uses, and restores one with Unhide.
 *
 * LOOKUP: GET /api/v1/jobs pages at 100 while hidden ids remain unfound, up to
 * five pages. A hidden id whose job no longer exists simply has no card; the
 * stored id is harmless and stays until restored.
 *
 * STATES: loading spinner → list; an empty id set (or no readable rows) is a
 * calm EMPTY state, never an error; only a real request failure shows the error
 * card with Retry. Restore writes storage FIRST and removes the card only after
 * the write succeeded, so a failed write can never look like a success.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import BackButton from '@/components/BackButton';
import EmptyState from '@/components/EmptyState';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import {
  readHiddenJobIds,
  removeHiddenId,
  writeHiddenJobIds,
} from '@/lib/hiddenJobs';
import { resolveJobStatus } from '@/lib/jobStatus';
import { parseExpectedHours } from '@/lib/jobList';
import { formatDate, taskExpectedHours, totalTaskHours } from '@/lib/jobDetail';
import { jobDetailsRoute } from '@/lib/jobRoute';
import type { JobListItem } from '@/types';

const LOOKUP_PAGE_SIZE = 100;
const LOOKUP_MAX_PAGES = 5;

function HiddenJobCard({
  job,
  restoring,
  onRestore,
  onOpen,
}: {
  job: JobListItem;
  restoring: boolean;
  onRestore: () => void;
  onOpen: () => void;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const status = resolveJobStatus(job);
  const tone = status.tone;
  const scheduled = formatDate(job.scheduled_at);
  const hours =
    totalTaskHours(job.milestones) ??
    (job.milestones && job.milestones.length > 0
      ? job.milestones.reduce((sum, milestone) => {
          const value = taskExpectedHours(milestone);
          return value === null ? sum : sum + value;
        }, 0)
      : parseExpectedHours(job.expected_hours));
  const taskCount = job.milestones?.length ?? 0;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      onPress={onOpen}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      <View style={styles.cardTop}>
        <View style={[styles.tag, { backgroundColor: job.is_urgent ? c.urgentBg : c.successLight }]}>
          <Feather
            name={job.is_urgent ? 'zap' : 'clock'}
            size={11}
            color={job.is_urgent ? c.urgentText : c.success}
          />
          <Text
            style={[styles.tagText, { color: job.is_urgent ? c.urgentText : c.success }]}
          >
            {job.is_urgent ? t('jobs_urgent') : t('jobs_regular')}
          </Text>
        </View>
        <View
          style={[
            styles.statusChip,
            {
              backgroundColor:
                tone === 'destructive'
                  ? c.destructiveLight
                  : tone === 'success'
                    ? c.successLight
                    : c.muted,
            },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              {
                color:
                  tone === 'destructive'
                    ? c.destructive
                    : tone === 'success'
                      ? c.success
                      : c.mutedForeground,
              },
            ]}
          >
            {t(status.labelKey)}
          </Text>
        </View>
      </View>

      <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
        {job.title}
      </Text>

      <View style={styles.metaRow}>
        {scheduled ? (
          <View style={styles.metaItem}>
            <Feather name="calendar" size={12} color={c.mutedForeground} />
            <Text style={[styles.metaText, { color: c.mutedForeground }]}>{scheduled}</Text>
          </View>
        ) : null}
        {typeof hours === 'number' && hours > 0 ? (
          <View style={styles.metaItem}>
            <Feather name="clock" size={12} color={c.mutedForeground} />
            <Text style={[styles.metaText, { color: c.mutedForeground }]}>
              {hours === 1
                ? t('post_hours_value', { n: hours })
                : t('post_hours_value_plural', { n: hours })}
            </Text>
          </View>
        ) : null}
        {taskCount > 0 ? (
          <View style={styles.metaItem}>
            <Feather name="list" size={12} color={c.mutedForeground} />
            <Text style={[styles.metaText, { color: c.mutedForeground }]}>
              {t('jobs_milestones_count', { n: taskCount })}
            </Text>
          </View>
        ) : null}
      </View>

      <TouchableOpacity
        style={[styles.restoreBtn, { borderColor: c.primary, opacity: restoring ? 0.5 : 1 }]}
        onPress={onRestore}
        disabled={restoring}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={t('hidden_jobs_restore')}
      >
        {restoring ? (
          <ActivityIndicator size="small" color={c.primary} />
        ) : (
          <Feather name="eye" size={14} color={c.primary} />
        )}
        <Text style={[styles.restoreText, { color: c.primary }]}>
          {t('hidden_jobs_restore')}
        </Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export default function HiddenJobsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [hiddenIds, setHiddenIds] = useState<number[]>([]);
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  const showToast = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2400);
  }, []);

  const load = useCallback(
    async (mode: 'open' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
      setFailed(false);
      try {
        const ids = await readHiddenJobIds(userId);
        setHiddenIds(ids);
        if (ids.length === 0) {
          setJobs([]);
          return;
        }
        const wanted = new Set(ids);
        const found: JobListItem[] = [];
        const seen = new Set<number>();
        for (let page = 0; page < LOOKUP_MAX_PAGES && found.length < ids.length; page += 1) {
          const { data } = await authApi.listJobs({
            limit: LOOKUP_PAGE_SIZE,
            offset: page * LOOKUP_PAGE_SIZE,
          });
          const rows = Array.isArray(data) ? data : [];
          for (const job of rows) {
            if (!job || !wanted.has(job.id) || seen.has(job.id)) continue;
            seen.add(job.id);
            found.push(job);
          }
          if (rows.length < LOOKUP_PAGE_SIZE) break;
        }
        setJobs(found);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    void load('open');
  }, [load]);

  const restore = useCallback(
    async (job: JobListItem) => {
      if (restoringId !== null) return;
      setRestoringId(job.id);
      const next = removeHiddenId(hiddenIds, job.id);
      const stored = await writeHiddenJobIds(userId, next);
      if (stored) {
        setHiddenIds(next);
        setJobs((prev) => prev.filter((entry) => entry.id !== job.id));
        showToast(t('hidden_jobs_restored'));
      } else {
        showToast(t('hidden_jobs_restore_failed'), 'error');
      }
      setRestoringId(null);
    },
    [hiddenIds, restoringId, showToast, t, userId]
  );

  const empty = useMemo(() => jobs.length === 0, [jobs.length]);

  const openJob = (job: JobListItem) => {
    router.push(jobDetailsRoute({ id: job.id }) as any);
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>
          {t('hidden_jobs_title')}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} size="large" />
        </View>
      ) : failed ? (
        <View style={styles.center}>
          <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="alert-triangle" size={26} color={c.destructive} />
            <Text style={[styles.stateTitle, { color: c.text }]}>
              {t('hidden_jobs_error_title')}
            </Text>
            <Text style={[styles.stateText, { color: c.mutedForeground }]}>
              {t('hidden_jobs_error_msg')}
            </Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: c.primary }]}
              onPress={() => void load('open')}
              accessibilityRole="button"
            >
              <Text style={[styles.retryText, { color: c.primaryForeground }]}>
                {t('hidden_jobs_retry')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(job) => String(job.id)}
          contentContainerStyle={{
            padding: 20,
            paddingBottom: insets.bottom + 24,
            flexGrow: 1,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor={c.primary}
              colors={[c.primary]}
            />
          }
          ListEmptyComponent={
            empty ? (
              <EmptyState
                icon="eye-off"
                title={t('hidden_jobs_empty_title')}
                subtitle={t('hidden_jobs_empty_msg')}
              />
            ) : null
          }
          renderItem={({ item }) => (
            <HiddenJobCard
              job={item}
              restoring={restoringId === item.id}
              onRestore={() => void restore(item)}
              onOpen={() => openJob(item)}
            />
          )}
        />
      )}

      {toast ? (
        <View
          pointerEvents="none"
          style={[
            styles.toast,
            {
              backgroundColor: c.card,
              borderColor: toast.tone === 'error' ? c.destructive : c.primary,
              bottom: insets.bottom + 16,
            },
          ]}
        >
          <Feather
            name={toast.tone === 'error' ? 'alert-circle' : 'check-circle'}
            size={14}
            color={toast.tone === 'error' ? c.destructive : c.primary}
          />
          <Text style={[styles.toastText, { color: c.text }]} numberOfLines={2}>
            {toast.text}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { flex: 1, fontFamily: 'Manrope_700Bold', fontSize: 16 },
  headerSpacer: { width: 36 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  stateCard: {
    width: '100%',
    alignItems: 'center',
    gap: 10,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
  },
  stateTitle: { fontFamily: 'Manrope_700Bold', fontSize: 15, textAlign: 'center' },
  stateText: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  retryBtn: { marginTop: 4, paddingHorizontal: 24, paddingVertical: 11, borderRadius: 22 },
  retryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 8, marginBottom: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tagText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
  statusChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  restoreBtn: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
  },
  restoreText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  toastText: { fontFamily: 'Manrope_500Medium', fontSize: 12, flex: 1 },
});
