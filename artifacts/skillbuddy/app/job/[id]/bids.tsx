import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import BottomSheet from '@/components/BottomSheet';
import CountdownTimer from '@/components/CountdownTimer';
import EmptyState from '@/components/EmptyState';
import BidOfferCard from '@/components/BidOfferCard';
import { useJobDetail } from '@/hooks/useJobDetail';
import { BIDS_POLL_MS, useJobBids } from '@/hooks/useJobBids';
import { biddingDeadline, formatDateTime } from '@/lib/jobDetail';
import {
  BID_SORT_IDS,
  BID_SORT_LABEL_KEY,
  bidEtaParts,
  bidStatusLabelKey,
  formatBidDistanceLocale,
  formatBidPriceLocale,
  isBiddingOpen,
  sortBids,
  type BidLocale,
  type BidSortId,
} from '@/lib/bid';
import type { BidResponse } from '@/types';

/** The server's `recommended` block is already the top 3; this is a hard cap. */
const RECOMMENDED_MAX = 3;

/**
 * The provider sheet for one offer.
 *
 * Built ONLY from the fields the bid already carries — it makes no request of
 * any kind, and it deliberately renders NO *_score field (those are the
 * platform's ranking inputs, admin-only). See the task report for the one
 * spec-listed field this excludes and why.
 */
function ProviderSheet({
  bid,
  locale,
  onClose,
}: {
  bid: BidResponse | null;
  locale: BidLocale;
  onClose: () => void;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  const row = (label: string, value: string | null) =>
    value === null ? null : (
      <View key={label} style={[styles.sheetRow, { borderTopColor: c.border }]}>
        <Text style={[styles.sheetLabel, { color: c.mutedForeground }]}>{label}</Text>
        <Text style={[styles.sheetValue, { color: c.text }]}>{value}</Text>
      </View>
    );

  const eta = bid ? bidEtaParts(bid.eta_minutes) : null;
  const etaText = eta
    ? eta.kind === 'now'
      ? t('jobd_bid_eta_now')
      : eta.kind === 'minutes'
        ? t('jobd_bid_eta_min', { n: eta.minutes })
        : t('jobd_bid_eta_hm', { h: eta.hours, m: eta.minutes })
    : null;
  const statusKey = bid ? bidStatusLabelKey(bid.status) : null;
  const submitted = bid ? formatDateTime(bid.created_at) : null;

  return (
    <BottomSheet visible={!!bid} onClose={onClose} title={t('cbids_provider_title')}>
      {bid ? (
        <View style={{ paddingBottom: 8 }}>
          <View style={styles.sheetHead}>
            <View style={[styles.sheetAvatar, { backgroundColor: c.muted }]}>
              <Text style={[styles.sheetInitial, { color: c.primary }]}>
                {bid.provider.name.trim().charAt(0).toUpperCase() || '?'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sheetName, { color: c.text }]}>{bid.provider.name}</Text>
              {bid.provider.badge_tier ? (
                <Text style={[styles.sheetTier, { color: c.primary }]}>
                  {bid.provider.badge_tier}
                </Text>
              ) : null}
            </View>
          </View>

          {row(t('cbids_provider_price'), formatBidPriceLocale(bid.offered_price, locale))}
          {row(t('jobd_bid_summary_eta'), etaText)}
          {row(
            t('cbids_provider_rating'),
            typeof bid.provider.star_rating === 'number'
              ? bid.provider.star_rating.toFixed(1)
              : null
          )}
          {row(t('cbids_provider_badges'), String(bid.provider.badge_count))}
          {row(t('cbids_provider_jobs'), String(bid.provider.total_jobs_completed))}
          {row(t('cbids_provider_acceptance'), `${bid.provider.acceptance_rate}%`)}
          {row(t('cbids_provider_response'), String(bid.provider.response_time_avg))}
          {row(t('cbids_provider_distance'), formatBidDistanceLocale(bid.distance_km, locale))}
          {row(t('jobd_bid_summary_status'), statusKey ? t(statusKey) : null)}
          {row(t('jobd_bid_summary_submitted'), submitted)}

          <View style={[styles.sheetRow, { borderTopColor: c.border }]}>
            <Text style={[styles.sheetLabel, { color: c.mutedForeground }]}>
              {t('cbids_provider_message')}
            </Text>
            <Text style={[styles.sheetMessage, { color: c.text }]}>
              {bid.message && bid.message.trim().length > 0
                ? bid.message
                : t('cbids_provider_no_message')}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.sheetClose, { borderColor: c.border }]}
            onPress={onClose}
          >
            <Text style={[styles.sheetCloseText, { color: c.primary }]}>{t('cbids_close')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </BottomSheet>
  );
}

/**
 * The CLIENT's Bids screen for ONE job (GET /api/v1/jobs/{job_id}/bids).
 *
 * Opened from the job's own details screen. What it shows, top to bottom: the
 * job's title with its urgent/regular badge and the live bidding countdown, the
 * server's total bid count, the Recommended SkillBuddies block (the server's
 * `recommended` array, at most 3, in the server's order) and — behind "View all
 * offers" — every remaining offer with the sort chips.
 *
 * NOTHING HERE RANKS ANYTHING. There is no local scoring, no re-sorting on load
 * and no score anywhere on screen: the split and the order come from the backend
 * (schema JobBidsResponse), and the sort chips only rearrange what the API
 * already returned. See lib/bid.ts for the pure helpers this screen renders.
 *
 * NOTHING HERE MUTATES ANYTHING EITHER: no accept, reject, chat, restart timer,
 * convert or cancel action exists on this screen — those are separate tasks, and
 * no placeholder button for them is rendered.
 */
export default function JobBidsScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const jobId = rawId && /^\d+$/.test(rawId) ? Number(rawId) : null;
  const locale = language as BidLocale;

  const { job, status: jobStatus, refetch: refetchJob } = useJobDetail(jobId);

  const biddingOpen = job ? isBiddingOpen(job) : false;
  // URGENT jobs are live: re-read the offers every 8 s while the screen is
  // focused and the app is foregrounded. A REGULAR job (or a closed window)
  // passes null, which stops the interval entirely — see hooks/useJobBids.
  const pollMs = job && job.is_urgent && biddingOpen ? BIDS_POLL_MS : null;
  const {
    status: bidsStatus,
    serverMessage,
    recommended,
    otherOffers,
    all,
    total,
    refreshing,
    refreshFailed,
    newBidIds,
    refresh,
  } = useJobBids(jobId, { pollMs });

  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<BidSortId>('api');
  const [sheetBid, setSheetBid] = useState<BidResponse | null>(null);

  // A 401 that survived the shared client's refresh + single replay means the
  // session is gone; the same rule the other job screens follow.
  useEffect(() => {
    if (bidsStatus === 'unauthorized') router.replace('/(auth)/login' as any);
  }, [bidsStatus, router]);

  const deadline = useMemo(() => (job ? biddingDeadline(job, Date.now()) : null), [job]);

  /** The countdown reached zero: re-read the JOB so the closed state is the
   *  backend's, not a guess — the bids themselves follow from `pollMs`. */
  const handleBiddingExpired = useCallback(() => {
    void refetchJob();
  }, [refetchJob]);

  const sortedAll = useMemo(() => sortBids(all, sort), [all, sort]);
  const recommendedTop = recommended.slice(0, RECOMMENDED_MAX);
  const hasMoreOffers = otherOffers.length > 0;

  /* ─────────────────────────────────────────────────────── shared chrome ── */

  const shell = (children: React.ReactNode) => (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>
          {t('cbids_title')}
        </Text>
        <View style={styles.headerSpacer} />
      </View>
      {children}
    </View>
  );

  const stateCard = (
    icon: keyof typeof Feather.glyphMap,
    title: string,
    message: string,
    action?: { label: string; onPress: () => void }
  ) => (
    <View
      style={[
        styles.stateCard,
        { backgroundColor: c.card, borderColor: c.border, marginBottom: insets.bottom + 16 },
      ]}
    >
      <Feather name={icon} size={28} color={c.destructive} />
      <Text style={[styles.stateTitle, { color: c.text }]}>{title}</Text>
      <Text style={[styles.stateMsg, { color: c.mutedForeground }]}>{message}</Text>
      {action ? (
        <TouchableOpacity
          style={[styles.stateBtn, { backgroundColor: c.primary }]}
          onPress={action.onPress}
        >
          <Text style={[styles.stateBtnText, { color: c.primaryForeground }]}>{action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  /* ───────────────────────────────────────────────────────────── errors ── */

  // The JOB itself could not be read (its title and window live there).
  if (jobStatus === 'notfound' || jobStatus === 'forbidden') {
    return shell(
      <View style={styles.centered}>
        {stateCard('slash', t('jobd_unavailable_title'), t('jobd_unavailable_msg'), {
          label: t('cbids_back_to_job'),
          onPress: () => router.back(),
        })}
      </View>
    );
  }

  if (bidsStatus === 'notfound' || bidsStatus === 'forbidden' || bidsStatus === 'error' || bidsStatus === 'invalid') {
    const notfound = bidsStatus === 'notfound';
    const forbidden = bidsStatus === 'forbidden';
    return shell(
      <View style={styles.centered}>
        {stateCard(
          notfound ? 'slash' : forbidden ? 'lock' : 'wifi-off',
          notfound
            ? t('cbids_err_notfound_title')
            : forbidden
              ? t('cbids_err_forbidden_title')
              : t('cbids_err_title'),
          // The backend's own text always wins when it sent one.
          serverMessage ??
            (notfound
              ? t('cbids_err_notfound_msg')
              : forbidden
                ? t('cbids_err_forbidden_msg')
                : t('cbids_err_network')),
          { label: t('cbids_retry'), onPress: () => void refresh() }
        )}
      </View>
    );
  }

  /* ────────────────────────────────────────────────────────────── header ── */

  const totalLabel =
    total === 1 ? t('cbids_total_one', { n: 1 }) : t('cbids_total_other', { n: total });

  const jobHeader = (
    <View>
      <View style={[styles.jobCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.jobTitle, { color: c.text }]}>{job?.title ?? ''}</Text>
        <View style={styles.jobMetaRow}>
          {job?.is_urgent ? (
            <View style={[styles.urgentTag, { backgroundColor: c.urgentLight }]}>
              <Feather name="zap" size={12} color={c.urgent} />
              <Text style={[styles.urgentText, { color: c.urgent }]}>{t('cbids_urgent')}</Text>
            </View>
          ) : (
            <View style={[styles.urgentTag, { backgroundColor: c.successLight }]}>
              <Feather name="clock" size={12} color={c.success} />
              <Text style={[styles.urgentText, { color: c.success }]}>{t('cbids_regular')}</Text>
            </View>
          )}
          <Text style={[styles.totalText, { color: c.mutedForeground }]}>{totalLabel}</Text>
        </View>
      </View>

      {biddingOpen && deadline !== null ? (
        <View style={{ marginTop: 12 }}>
          <CountdownTimer
            endsAt={deadline}
            urgency={job?.is_urgent ? 'urgent' : 'regular'}
            onExpire={handleBiddingExpired}
          />
        </View>
      ) : (
        <View
          style={[
            styles.closedBanner,
            { backgroundColor: c.muted, borderColor: c.border, marginTop: 12 },
          ]}
        >
          <Feather name="lock" size={14} color={c.mutedForeground} />
          <Text style={[styles.closedText, { color: c.mutedForeground }]}>{t('cbids_closed')}</Text>
        </View>
      )}

      {refreshFailed ? (
        <View style={[styles.refreshNotice, { backgroundColor: c.muted, borderColor: c.border }]}>
          <Feather name="alert-circle" size={12} color={c.mutedForeground} />
          <Text style={[styles.refreshNoticeText, { color: c.mutedForeground }]}>
            {t('cbids_refresh_failed')}
          </Text>
        </View>
      ) : null}

      {/* ONE list, two titles. Collapsed it is the server's `recommended` block
          (max 3, API order); expanded it is every offer, sorted by the chips.
          The cards themselves are rendered by the FlatList below, never here,
          so a bid can never appear twice on screen. */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>
          {showAll && hasMoreOffers ? t('cbids_all_section') : t('cbids_recommended_section')}
        </Text>
        {showAll && hasMoreOffers ? (
          <View style={styles.chipRow}>
            {BID_SORT_IDS.map((id) => {
              const active = sort === id;
              return (
                <TouchableOpacity
                  key={id}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? c.primary : c.border,
                      backgroundColor: active ? c.primaryLight : 'transparent',
                    },
                  ]}
                  onPress={() => setSort(id)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.chipText, { color: active ? c.primary : c.text }]}>
                    {t(BID_SORT_LABEL_KEY[id])}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </View>
    </View>
  );

  /* ────────────────────────────────────────────────────────────── lists ── */

  const emptyState = () => {
    if (bidsStatus === 'loading' || bidsStatus === 'idle') {
      return (
        <View style={styles.section}>
          {[0, 1].map((key) => (
            <View
              key={`sk-${key}`}
              style={[styles.skeleton, { backgroundColor: c.skeletonBase, borderColor: c.border }]}
            >
              <View style={[styles.skelAvatar, { backgroundColor: c.skeletonHighlight }]} />
              <View style={{ flex: 1, gap: 8 }}>
                <View
                  style={[styles.skelLine, { backgroundColor: c.skeletonHighlight, width: '55%' }]}
                />
                <View
                  style={[styles.skelLine, { backgroundColor: c.skeletonHighlight, width: '35%' }]}
                />
              </View>
            </View>
          ))}
        </View>
      );
    }
    return (
      <EmptyState
        icon={biddingOpen ? 'inbox' : 'clock'}
        title={
          biddingOpen ? t('cbids_empty_open_title') : t('cbids_empty_closed_title')
        }
        subtitle={biddingOpen ? t('cbids_empty_open_msg') : t('cbids_empty_closed_msg')}
      />
    );
  };

  // The full list (recommended + the rest) once "View all offers" is open.
  const listData = showAll ? sortedAll : recommendedTop;

  return shell(
    <>
    <FlatList
      data={listData}
      keyExtractor={(bid) => String(bid.id)}
      renderItem={({ item }) => (
        <BidOfferCard
          bid={item}
          locale={locale}
          recommended={recommendedTop.some((r) => r.id === item.id)}
          isNew={newBidIds.includes(item.id)}
          onPress={() => setSheetBid(item)}
        />
      )}
      ListHeaderComponent={jobHeader}
      ListEmptyComponent={
        <View style={{ paddingHorizontal: 16 }}>{emptyState()}</View>
      }
      ListFooterComponent={
        // The remaining offers live behind this button, BELOW the cards; it only
        // exists when the backend actually sent some (JobBidsResponse.other_offers).
        hasMoreOffers ? (
          <TouchableOpacity
            style={[styles.viewAllBtn, { borderColor: c.primary }]}
            onPress={() => setShowAll((prev) => !prev)}
            accessibilityRole="button"
          >
            <Text style={[styles.viewAllText, { color: c.primary }]}>
              {showAll ? t('cbids_show_recommended') : t('cbids_view_all')}
            </Text>
            <Feather
              name={showAll ? 'chevron-up' : 'chevron-down'}
              size={15}
              color={c.primary}
            />
          </TouchableOpacity>
        ) : null
      }
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={c.primary}
          colors={[c.primary]}
        />
      }
      removeClippedSubviews={false}
    />
      <ProviderSheet bid={sheetBid} locale={locale} onClose={() => setSheetBid(null)} />
    </>
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  stateCard: { width: '100%', borderWidth: 1, borderRadius: 16, padding: 20, alignItems: 'center', gap: 8 },
  stateTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16, textAlign: 'center' },
  stateMsg: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  stateBtn: { marginTop: 10, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 24 },
  stateBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  jobCard: { marginHorizontal: 16, marginTop: 16, borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  jobTitle: { fontFamily: 'Manrope_700Bold', fontSize: 17 },
  jobMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  urgentTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  urgentText: { fontFamily: 'Manrope_600SemiBold', fontSize: 10 },
  totalText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  closedBanner: { marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 16, paddingVertical: 12 },
  closedText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  refreshNotice: { marginHorizontal: 16, marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  refreshNoticeText: { fontFamily: 'Manrope_400Regular', fontSize: 11, flex: 1 },
  section: { paddingHorizontal: 16, marginTop: 16 },
  sectionTitle: { fontFamily: 'Manrope_700Bold', fontSize: 15, marginBottom: 10 },
  viewAllBtn: { marginHorizontal: 16, marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 12, paddingVertical: 11 },
  viewAllText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  skeleton: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
  skelAvatar: { width: 46, height: 46, borderRadius: 23 },
  skelLine: { height: 10, borderRadius: 5 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  sheetAvatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  sheetInitial: { fontFamily: 'Manrope_700Bold', fontSize: 17 },
  sheetName: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  sheetTier: { fontFamily: 'Manrope_500Medium', fontSize: 11, marginTop: 2 },
  sheetRow: { borderTopWidth: 1, paddingVertical: 10, gap: 3 },
  sheetLabel: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  sheetValue: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  sheetMessage: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19 },
  sheetClose: { marginTop: 16, borderWidth: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  sheetCloseText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
