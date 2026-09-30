import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import JobCard from '@/components/JobCard';
import EmptyState from '@/components/EmptyState';
import { JOB_STATUS_VALUES, jobStatusLabelKey } from '@/lib/jobList';
import useJobList, { hasActiveFilters } from '@/hooks/useJobList';
import type { JobApiStatus, JobListItem, JobRequestType } from '@/types';

/**
 * The client's job list, backed by GET /api/v1/jobs.
 *
 * The list endpoint returns a bare array of the LIGHT job summary, so each card
 * renders only those fields; tapping a card opens the details screen, which is
 * the screen that loads GET /api/v1/jobs/{job_id}.
 *
 * Pagination is offset-based (limit 20), and a page shorter than the limit ends
 * the list — there is no total count to read (see hooks/useJobList).
 *
 * The provider-side view (Available / My Bids / Active) is intentionally gone:
 * GET /api/v1/jobs returns the authenticated user's own jobs, and there is no
 * endpoint that lists jobs open for bidding, so those controls had no real data
 * source. They will come back with the provider-jobs endpoint rather than
 * showing placeholders.
 */

const REQUEST_TYPES: JobRequestType[] = ['URGENT', 'REGULAR'];

export default function JobsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const TAB_HEIGHT = Platform.OS === 'web' ? 84 : 60;

  const {
    status,
    jobs,
    hasMore,
    loadingMore,
    refreshing,
    inlineError,
    serverMessage,
    filters,
    setFilters,
    refresh,
    retry,
    loadMore,
  } = useJobList();

  // 401 handling. The shared axios client already refreshes the access token
  // and replays the request once; if that refresh fails the session is over and
  // AuthContext clears the user. Send the user to login rather than leaving a
  // dead list behind a Retry button that can only fail the same way.
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) router.replace('/(auth)/login' as any);
  }, [authLoading, isAuthenticated, router]);

  const filtered = hasActiveFilters(filters);
  const firstLoad = status === 'loading' && jobs.length === 0;
  const hardFailed =
    jobs.length === 0 &&
    (status === 'error' || status === 'invalid' || status === 'unauthorized');

  const openJob = (job: JobListItem) => {
    // Details come from GET /api/v1/jobs/{job_id} on that screen — the list
    // item has no description or address to pass along.
    router.push(`/job/${job.id}` as any);
  };

  const statusChip = (value: JobApiStatus | null, label: string) => {
    const active = filters.status === value;
    return (
      <TouchableOpacity
        key={value ?? 'all'}
        style={[styles.chip, { backgroundColor: active ? c.primary : c.muted }]}
        onPress={() => setFilters({ ...filters, status: value })}
      >
        <Text style={[styles.chipText, { color: active ? c.primaryForeground : c.mutedForeground }]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const errorCard = () => {
    const title = status === 'unauthorized' ? t('jobs_session_title') : t('jobs_load_error');
    const message =
      status === 'invalid'
        ? serverMessage ?? t('jobs_filter_invalid')
        : status === 'unauthorized'
          ? t('jobs_unauthorized_msg')
          : t('jobs_load_error_sub');
    return (
      <View style={styles.stateWrap}>
        <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather
            name={status === 'unauthorized' ? 'lock' : 'alert-circle'}
            size={28}
            color={c.destructive}
          />
          <Text style={[styles.stateTitle, { color: c.text }]}>{title}</Text>
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>{message}</Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: c.primary }]}
            onPress={retry}
          >
            <Text style={[styles.retryText, { color: c.primaryForeground }]}>{t('jobs_retry')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const footer = () => {
    if (loadingMore) {
      return (
        <View style={styles.footer}>
          <ActivityIndicator color={c.primary} />
        </View>
      );
    }
    if (inlineError) {
      return (
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: c.mutedForeground }]}>
            {t('jobs_inline_error')}
          </Text>
        </View>
      );
    }
    return null;
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.text }]}>{t('jobs_title')}</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('jobs_my_jobs')}</Text>
        </View>
        <TouchableOpacity
          style={[styles.postBtn, { backgroundColor: c.primary }]}
          onPress={() => router.push('/job/post' as any)}
        >
          <Feather name="plus" size={16} color={c.primaryForeground} />
          <Text style={[styles.postBtnText, { color: c.primaryForeground }]}>{t('post_a_job')}</Text>
        </TouchableOpacity>
      </View>

      {/* Status filter — every documented JobStatus value, nothing invented. */}
      <View style={[styles.filterBlock, { borderBottomColor: c.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {statusChip(null, t('jobs_filter_all'))}
          {JOB_STATUS_VALUES.map((value) => {
            const key = jobStatusLabelKey(value);
            return key ? statusChip(value, t(key)) : null;
          })}
        </ScrollView>

        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[
              styles.chip,
              {
                backgroundColor: filters.requestType === null ? c.primary : c.muted,
              },
            ]}
            onPress={() => setFilters({ ...filters, requestType: null })}
          >
            <Text
              style={[
                styles.chipText,
                {
                  color:
                    filters.requestType === null ? c.primaryForeground : c.mutedForeground,
                },
              ]}
            >
              {t('jobs_filter_all_types')}
            </Text>
          </TouchableOpacity>

          {REQUEST_TYPES.map((value) => {
            const active = filters.requestType === value;
            return (
              <TouchableOpacity
                key={value}
                style={[styles.chip, { backgroundColor: active ? c.primary : c.muted }]}
                onPress={() => setFilters({ ...filters, requestType: value })}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: active ? c.primaryForeground : c.mutedForeground },
                  ]}
                >
                  {value === 'URGENT' ? t('jobs_urgent') : t('jobs_regular')}
                </Text>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            style={[
              styles.chip,
              styles.biddingChip,
              {
                backgroundColor: filters.onlyActivelyBidding ? c.primary : c.muted,
                borderColor: filters.onlyActivelyBidding ? c.primary : c.border,
              },
            ]}
            onPress={() =>
              setFilters({ ...filters, onlyActivelyBidding: !filters.onlyActivelyBidding })
            }
          >
            <Feather
              name="radio"
              size={12}
              color={filters.onlyActivelyBidding ? c.primaryForeground : c.mutedForeground}
            />
            <Text
              style={[
                styles.chipText,
                {
                  color: filters.onlyActivelyBidding
                    ? c.primaryForeground
                    : c.mutedForeground,
                },
              ]}
            >
              {t('jobs_filter_bidding')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {firstLoad ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={c.primary} size="large" />
        </View>
      ) : hardFailed ? (
        errorCard()
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(job) => String(job.id)}
          contentContainerStyle={{
            padding: 20,
            paddingBottom: TAB_HEIGHT + insets.bottom + 20,
            flexGrow: 1,
          }}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.4}
          onEndReached={() => loadMore()}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={c.primary}
              colors={[c.primary]}
            />
          }
          ListEmptyComponent={
            filtered ? (
              <EmptyState
                icon="filter"
                title={t('jobs_empty_filtered_title')}
                subtitle={t('jobs_empty_filtered_sub')}
                actionLabel={t('jobs_clear_filters')}
                onAction={() =>
                  setFilters({ status: null, requestType: null, onlyActivelyBidding: false })
                }
              />
            ) : (
              <EmptyState
                icon="briefcase"
                title={t('jobs_no_jobs_client')}
                subtitle={t('jobs_empty_client_sub')}
                actionLabel={t('post_a_job')}
                onAction={() => router.push('/job/post' as any)}
              />
            )
          }
          ListFooterComponent={footer()}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 6) * 60).duration(350)}>
              <JobCard job={item} onPress={() => openJob(item)} />
            </Animated.View>
          )}
        />
      )}
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
    gap: 12,
    borderBottomWidth: 1,
  },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 22 },
  subtitle: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 2 },
  postBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
  },
  postBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  filterBlock: { borderBottomWidth: 1, paddingVertical: 10, gap: 8 },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  biddingChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1 },
  chipText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
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
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center' },
  retryBtn: { marginTop: 4, paddingHorizontal: 24, paddingVertical: 11, borderRadius: 22 },
  retryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  footer: { paddingVertical: 16, alignItems: 'center' },
  footerText: { fontFamily: 'Manrope_400Regular', fontSize: 12, textAlign: 'center' },
});
