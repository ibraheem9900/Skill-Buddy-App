import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
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
import NearbyJobsFeed from '@/components/NearbyJobsFeed';
import MyBidsFeed from '@/components/MyBidsFeed';
import JobsFilterSheet from '@/components/JobsFilterSheet';
import TabGreenHeader from '@/components/TabGreenHeader';
import {
  EMPTY_JOB_FILTERS,
  activeFilterCount,
  activeFilterIds,
  filterJobsBySearch,
  isClientProfileMissing,
  jobStatusLabelKey,
  removeFilter,
  resolveJobsViewState,
  type JobFilterId,
} from '@/lib/jobList';
import useJobList, { hasActiveFilters } from '@/hooks/useJobList';
import { useRole } from '@/context/RoleContext';
import type { JobListItem } from '@/types';
import type { TranslationKey } from '@/context/LanguageContext';
import { withTabPagerPage } from '@/components/tabBar/TabPagerPage';

/**
 * The client's job list, backed by GET /api/v1/jobs.
 *
 * The list endpoint returns a bare array of the LIGHT job summary, so each card
 * renders only those fields; tapping a card opens the details screen, which
 * is the screen that loads GET /api/v1/jobs/{job_id}.
 *
 * Pagination is offset-based (limit 20), and a page shorter than the limit ends
 * the list — there is no total count to read (see hooks/useJobList).
 *
 * HEADER (FIX): the SAME green TabGreenHeader the Services tab uses — green
 * behind the status bar, rounded bottom, light status-bar icons, "Jobs /
 * My Jobs" on the left, the white "Post a Job" pill on the right, and the
 * white search bar + square filter button underneath (client mode only). The
 * filter button opens the SAME JobsFilterSheet as before.
 *
 * SEARCH: debounced 300 ms, client-side over the loaded pages, matching the
 * job title and the READABLE, translated status label — combined with (never
 * replacing) the server-side filters, because the filters already shaped
 * `jobs` before search runs. A search with no hits shows its own "No jobs
 * found" state, distinct from the fetch-error card.
 *
 * FILTERS: one slim row below the header — the active-filter chips (each
 * removable), a Reset action, and the result count. The filters themselves
 * live in a single bottom sheet (components/JobsFilterSheet) built with the
 * same sheet component as every other picker, and the sheet edits a local
 * draft so opening it can never change the list.
 *
 * STATES: a 200 with an empty array is an EMPTY state (with and without filters),
 * and an error card appears only for a real failure — with a message that matches
 * the actual cause ('network' is the only one allowed to mention the connection).
 *
 * The provider-side view has TWO tabs, each with a real source behind it:
 *   Available  GET /api/v1/providers/me/nearby-jobs (components/NearbyJobsFeed)
 *   My Bids    GET /api/v1/bids/mine                (components/MyBidsFeed)
 * "Active" stays HIDDEN: no endpoint lists a provider's active jobs yet.
 * Provider mode uses the same green header (title + subtitle), but no search,
 * no Post button and no client filters — its own chip row below drives it.
 */

/**
 * The provider's own tabs: "Available" and "My Bids". Both have an endpoint they
 * can fill. "Active" is deliberately NOT here — see the file header.
 */
type ProviderTab = 'available' | 'myBids';

/** The provider's chips, in order. Only tabs with an endpoint behind them. */
const PROVIDER_TABS: { key: ProviderTab; labelKey: TranslationKey }[] = [
  { key: 'available', labelKey: 'nearby_tab_available' },
  { key: 'myBids', labelKey: 'mybids_tab' },
];

function JobsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { activeRole } = useRole();
  const [providerTab, setProviderTab] = useState<ProviderTab>('available');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  /** What the user typed — updates instantly so every keystroke is visible. */
  const [searchText, setSearchText] = useState('');
  /** The filtering query — a 300 ms-debounced copy of searchText. */
  const [query, setQuery] = useState('');
  const providerMode = activeRole === 'PROVIDER';
  const TAB_HEIGHT = Platform.OS === 'web' ? 84 : 60;

  const {
    status,
    jobs,
    hasMore,
    loadingMore,
    refreshing,
    inlineError,
    serverMessage,
    failure,
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

  // Search debounce — same 300 ms rhythm as the Services tab.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const filtered = hasActiveFilters(filters);
  const filterCount = activeFilterCount(filters);
  const filterIds = activeFilterIds(filters);
  const searchActive = query.trim().length > 0;

  // ONE decision for the whole screen: a 200 + [] is an empty state (never an
  // error), and an error card only appears when nothing is on screen.
  const view = resolveJobsViewState({ status, jobCount: jobs.length, hasFilters: filtered });

  /**
   * The visible rows: the server-filtered list narrowed by the search text.
   * The label resolver injects the READABLE translated status label (the same
   * one the cards show), keeping the filter rule a pure helper in lib/jobList.
   */
  const searched = useMemo(() => {
    if (!searchActive) return jobs;
    return filterJobsBySearch(jobs, query, (statusValue) => {
      const key = jobStatusLabelKey(statusValue);
      return key ? t(key) : String(statusValue ?? '');
    });
  }, [jobs, query, searchActive, t]);

  /** The label of one active-filter chip (translated, never a raw enum). */
  const filterChipLabel = (id: JobFilterId): string => {
    if (id === 'status') {
      const key = filters.status ? jobStatusLabelKey(filters.status) : null;
      return key ? t(key) : '';
    }
    if (id === 'requestType') {
      return filters.requestType === 'URGENT' ? t('jobs_urgent') : t('jobs_regular');
    }
    return t('jobs_filter_bidding');
  };

  const clearSearch = () => {
    setSearchText('');
    setQuery('');
  };

  /** One action for the Reset button and the search-empty state. */
  const clearAll = () => {
    clearSearch();
    setFilters(EMPTY_JOB_FILTERS);
  };

  const openJob = (job: JobListItem) => {
    // Details come from GET /api/v1/jobs/{job_id} on that screen — the list
    // item has no description or address to pass along.
    router.push(`/job/${job.id}` as any);
  };

  /**
   * The failure card: ONE message per real cause. Only a genuine connectivity
   * failure may say "check your connection"; a rejected request shows the
   * backend's own text, and "Client profile not found" gets its own explanation
   * (the app cannot create that profile — the live API has no endpoint for it).
   */
  const errorCard = useMemo(() => {
    const kind = failure?.kind ?? 'unknown';
    const message = failure?.message ?? null;

    let titleKey: TranslationKey = 'jobs_error_unknown_title';
    let bodyKey: TranslationKey | null = 'jobs_error_unknown_msg';
    let icon: keyof typeof Feather.glyphMap = 'alert-triangle';
    let body = t('jobs_error_unknown_msg');

    if (kind === 'network') {
      titleKey = 'jobs_error_network_title';
      bodyKey = 'jobs_error_network_msg';
      icon = 'wifi-off';
    } else if (kind === 'timeout') {
      titleKey = 'jobs_error_timeout_title';
      bodyKey = 'jobs_error_timeout_msg';
      icon = 'clock';
    } else if (kind === 'server') {
      titleKey = 'jobs_error_server_title';
      bodyKey = 'jobs_error_server_msg';
    } else if (kind === 'unauthorized' || status === 'unauthorized') {
      titleKey = 'jobs_session_title';
      bodyKey = 'jobs_unauthorized_msg';
      icon = 'lock';
    } else if (kind === 'client-profile' || isClientProfileMissing(message)) {
      titleKey = 'jobs_error_profile_title';
      bodyKey = 'jobs_error_profile_msg';
      icon = 'user-x';
    } else if (
      kind === 'badrequest' ||
      kind === 'forbidden' ||
      kind === 'notfound' ||
      kind === 'conflict' ||
      kind === 'invalid'
    ) {
      // The backend's own readable text is the most useful copy for a rejected
      // request; the generic line is only the fallback.
      titleKey = 'jobs_load_error';
      bodyKey = null;
      icon = 'alert-circle';
    }

    if (bodyKey) body = t(bodyKey);
    else body = message ?? serverMessage ?? t('jobs_load_error_sub');

    return (
      <View style={styles.stateWrap}>
        <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name={icon} size={28} color={c.destructive} />
          <Text style={[styles.stateTitle, { color: c.text }]}>{t(titleKey)}</Text>
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>{body}</Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: c.primary }]}
            onPress={retry}
            accessibilityRole="button"
          >
            <Text style={[styles.retryText, { color: c.primaryForeground }]}>{t('jobs_retry')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [c, failure, retry, serverMessage, status, t]);

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
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* ── SHARED green header — the same surface the Services tab uses ──── */}
      <TabGreenHeader
        title={t('jobs_title')}
        subtitle={providerMode ? t('nearby_header_subtitle') : t('jobs_my_jobs')}
        right={
          providerMode ? null : (
            <TouchableOpacity
              style={styles.postBtn}
              onPress={() => router.push('/job/post' as any)}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Feather name="plus" size={16} color={c.headerBg} />
              <Text style={[styles.postBtnText, { color: c.headerBg }]}>{t('post_a_job')}</Text>
            </TouchableOpacity>
          )
        }
        search={
          providerMode
            ? null
            : {
                value: searchText,
                onChange: setSearchText,
                onClear: clearSearch,
                placeholder: t('jobs_search_placeholder'),
              }
        }
        filter={
          providerMode
            ? null
            : {
                count: filterCount,
                onPress: () => setFilterSheetOpen(true),
                label: t('jobs_filter_title'),
              }
        }
      />

      {providerMode ? (
        <>
          {/* The provider's tabs — see ProviderTab for why "Active" is absent. */}
          <View style={[styles.filterBlock, { borderBottomColor: c.border }]}>
            <View style={styles.filterRow}>
              {PROVIDER_TABS.map(({ key, labelKey }) => {
                const active = providerTab === key;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.chip, { backgroundColor: active ? c.primary : c.muted }]}
                    onPress={() => setProviderTab(key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: active ? c.primaryForeground : c.mutedForeground },
                      ]}
                    >
                      {t(labelKey)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Both feeds stay MOUNTED (the rules of hooks) and the `enabled` flag
              decides which one performs requests — switching a chip therefore
              keeps the other list's data for the way back. */}
          {providerTab === 'available' ? (
            <NearbyJobsFeed enabled bottomInset={TAB_HEIGHT + insets.bottom} />
          ) : (
            <MyBidsFeed enabled bottomInset={TAB_HEIGHT + insets.bottom} />
          )}
        </>
      ) : (
        <>
          {/* ONE slim summary row: the active-filter chips (each removable) with
              a Reset action, and the result count. It wraps, so it can never
              push anything off-screen however long a translated label is. */}
          <View style={[styles.summaryRow, { borderBottomColor: c.border }]}>
            <View style={styles.summaryChips}>
              {filterIds.length === 0 ? (
                <Text style={[styles.allJobs, { color: c.mutedForeground }]}>
                  {t('jobs_all_jobs_quiet')}
                </Text>
              ) : (
                filterIds.map((id) => (
                  <TouchableOpacity
                    key={id}
                    style={[styles.activeChip, { backgroundColor: c.primaryLight, borderColor: c.primary }]}
                    onPress={() => setFilters(removeFilter(filters, id))}
                    accessibilityRole="button"
                    accessibilityLabel={`${filterChipLabel(id)} — ${t('jobs_filter_remove')}`}
                  >
                    <Text
                      style={[styles.activeChipText, { color: c.primary }]}
                      numberOfLines={1}
                    >
                      {filterChipLabel(id)}
                    </Text>
                    <Feather name="x" size={12} color={c.primary} />
                  </TouchableOpacity>
                ))
              )}
              {filterCount > 0 || searchActive ? (
                <TouchableOpacity
                  onPress={clearAll}
                  accessibilityRole="button"
                  accessibilityLabel={t('jobs_search_clear')}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={[styles.resetLink, { color: c.primary }]}>
                    {t('jobs_filter_reset')}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <Text style={[styles.resultCount, { color: c.mutedForeground }]}>
              {t('jobs_result_count', { n: searched.length })}
            </Text>
          </View>

          {view === 'loading' ? (
            <View style={styles.stateWrap}>
              <ActivityIndicator color={c.primary} size="large" />
            </View>
          ) : view === 'error' ? (
            errorCard
          ) : (
            <FlatList
              data={searched}
              keyExtractor={(job) => String(job.id)}
              contentContainerStyle={{
                padding: 20,
                // Leave room for the tab bar AND the Android navigation bar.
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
                view === 'empty' ? (
                  <EmptyState
                    icon="briefcase"
                    title={t('jobs_empty_title')}
                    subtitle={t('jobs_empty_hint')}
                    actionLabel={t('post_a_job')}
                    onAction={() => router.push('/job/post' as any)}
                  />
                ) : searchActive ? (
                  <EmptyState
                    icon="search"
                    title={t('jobs_search_empty_title')}
                    subtitle={t('jobs_search_empty_sub')}
                    actionLabel={t('jobs_search_clear')}
                    onAction={clearAll}
                  />
                ) : (
                  <EmptyState
                    icon="filter"
                    title={t('jobs_empty_filtered_title')}
                    subtitle={t('jobs_empty_filtered_sub')}
                    actionLabel={t('jobs_filter_reset')}
                    onAction={() => setFilters(EMPTY_JOB_FILTERS)}
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

          <JobsFilterSheet
            visible={filterSheetOpen}
            onClose={() => setFilterSheetOpen(false)}
            value={filters}
            onApply={(next) => {
              setFilterSheetOpen(false);
              setFilters(next);
            }}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // White "Post a Job" pill on the green header (a green button would
  // disappear on green) — same action as before.
  postBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: '#FFF',
  },
  postBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },

  // Slim summary row below the header.
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  summaryChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    flex: 1,
  },
  resetLink: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  resultCount: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  allJobs: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    maxWidth: '100%',
  },
  activeChipText: { fontFamily: 'Manrope_500Medium', fontSize: 12, flexShrink: 1 },

  // Provider chip row (unchanged).
  filterBlock: { borderBottomWidth: 1, paddingVertical: 10, gap: 8 },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
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

export default withTabPagerPage(JobsScreen, 2);
