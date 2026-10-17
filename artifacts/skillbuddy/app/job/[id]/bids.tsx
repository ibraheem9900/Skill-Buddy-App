import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useRole } from '@/context/RoleContext';
import { useAppAlert } from '@/context/AlertModalContext';
import BackButton from '@/components/BackButton';
import BottomSheet from '@/components/BottomSheet';
import CountdownTimer from '@/components/CountdownTimer';
import EmptyState from '@/components/EmptyState';
import AcceptBidSheet from '@/components/AcceptBidSheet';
import RejectBidSheet from '@/components/RejectBidSheet';
import BidOfferCard from '@/components/BidOfferCard';
import { useJobDetail } from '@/hooks/useJobDetail';
import { useJobBids } from '@/hooks/useJobBids';
import { useJobBiddingRealtime } from '@/hooks/useJobBiddingRealtime';
import { useOnRealtimeReconnect } from '@/context/RealtimeContext';
import { useAcceptBid } from '@/hooks/useAcceptBid';
import { useRejectBid } from '@/hooks/useRejectBid';
import { useRestartJobTimer } from '@/hooks/useRestartJobTimer';
import { useConvertJobToRegular } from '@/hooks/useConvertJobToRegular';
import { useConvertJobToUrgent } from '@/hooks/useConvertJobToUrgent';
import { biddingDeadline, formatDateTime } from '@/lib/jobDetail';
import { isPaymentPending } from '@/lib/jobPayment';
import { bidCreatedNoticeText } from '@/lib/jobBidsLive';
import {
  canRestartJobTimer,
  isRestartNotAllowed,
  restartTimerFailureMessage,
} from '@/lib/jobRestartTimer';
import {
  canConvertJobToRegular,
  canConvertJobToUrgent,
  convertToRegularFailureMessage,
  convertToUrgentFailureMessage,
  isConvertNotAllowed,
} from '@/lib/jobConvert';
import { isJobActionRefused, type JobActionFailureKind } from '@/lib/jobAction';
import { biddingOptionsModel, BIDDING_WINDOW_MINUTES, type BiddingOptionAction } from '@/lib/jobBiddingOptions';
import {
  acceptBidFailureMessage,
  BID_SORT_IDS,
  BID_SORT_LABEL_KEY,
  bidEtaParts,
  bidRejectReasonFieldError,
  bidSelectionMatches,
  bidStatusLabelKey,
  bidStatusStamp,
  canAcceptBid,
  canRejectBid,
  formatBidDistanceLocale,
  formatBidPriceLocale,
  isBidPending,
  isBiddingOpen,
  rejectBidFailureMessage,
  shouldResyncAfterAcceptFailure,
  shouldResyncAfterRejectFailure,
  sortBids,
  validateBidRejectReason,
  type BidLocale,
  type BidSortId,
} from '@/lib/bid';
import type { BidResponse, JobResponse } from '@/types';

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
  onAccept,
  onReject,
  onClose,
}: {
  bid: BidResponse | null;
  locale: BidLocale;
  /**
   * The CLIENT's Accept action for THIS offer, or null when it may not be
   * offered (not the client's job, an offer already decided, a job that has
   * moved on). Decided by lib/bid.canAcceptBid at the call site — this sheet
   * renders the button, it never decides whether the action is allowed.
   */
  onAccept: (() => void) | null;
  /**
   * The CLIENT's Decline action for THIS offer, or null when it may not be
   * offered. Same rule, decided by lib/bid.canRejectBid at the call site and
   * rendered here as the secondary action next to Accept.
   */
  onReject: (() => void) | null;
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

          {(onAccept || onReject) && (
            <View style={styles.sheetActions}>
              {onAccept ? (
                <TouchableOpacity
                  style={[styles.sheetAccept, { backgroundColor: c.primary }]}
                  onPress={onAccept}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                >
                  <Feather name="check" size={16} color={c.primaryForeground} />
                  <Text style={[styles.sheetAcceptText, { color: c.primaryForeground }]}>
                    {t('cbids_accept')}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {onReject ? (
                <TouchableOpacity
                  style={[styles.sheetReject, { borderColor: c.destructive }]}
                  onPress={onReject}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                >
                  <Feather name="x" size={16} color={c.destructive} />
                  <Text style={[styles.sheetRejectText, { color: c.destructive }]}>
                    {t('cbids_reject')}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

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
 * THE TWO ACTIONS ON THIS SCREEN are the CLIENT's Accept Bid (POST
 * /api/v1/jobs/{job_id}/bids/{bid_id}/accept) and the CLIENT's Decline (Reject)
 * Bid (POST …/reject). Both are offered only to the job's own client, only for an
 * offer that is still PENDING, and only while the job is still OPEN with nobody
 * assigned — decided in lib/bid from the server's own fields (canAcceptBid,
 * canRejectBid), so no button can appear anywhere else.
 *
 * ACCEPT goes through its own confirmation sheet, re-reads the offer (price /
 * expected time / updated_at) before sending anything, and afterwards shows the
 * picked provider's real status and accepted time.
 *
 * DECLINE is the SECONDARY action in the same row as Accept (card and provider
 * sheet — the doc's quick-action list does not mention Decline, so no new card
 * layout was invented; see the task report). It opens its own confirmation sheet
 * that names the provider and the offered price and collects an OPTIONAL free-text
 * reason (the live schema allows a blank one), then posts the decline. On success
 * the returned bid is dropped from the list at once and the offers are re-read, so
 * the backend's own ordering and its recommended/other_offers split — not the app
 * — promote the next-best offer into the top 3. A REJECTED bid can never come
 * back: hooks/useJobBids filters the three non-visible statuses out of every
 * response it holds.
 *
 * Chat/call, restart timer, convert and cancel belong to other tasks and have NO
 * button here — not even a disabled placeholder.
 */
/**
 * One action on the Bidding options card. While the window is still running the
 * buttons are compact secondary actions; once it has ended they become the
 * primary actions (filled with the theme's accent). A running request disables
 * its siblings, and its own button swaps the icon for a spinner, so nothing can
 * be double-submitted.
 */
function OptionActionButton({
  label,
  icon,
  primary,
  busy,
  disabled,
  onPress,
  colors,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  primary: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  colors: { accent: string; onAccent: string; border: string };
}) {
  const locked = disabled || busy;
  return (
    <TouchableOpacity
      style={[
        styles.optionAction,
        primary
          ? { backgroundColor: colors.accent, borderColor: colors.accent }
          : { backgroundColor: 'transparent', borderColor: colors.border },
        locked && !busy ? { opacity: 0.55 } : null,
      ]}
      onPress={onPress}
      disabled={locked}
      accessibilityRole="button"
      accessibilityState={{ disabled: locked, busy }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={primary ? colors.onAccent : colors.accent} />
      ) : (
        <Feather name={icon} size={14} color={primary ? colors.onAccent : colors.accent} />
      )}
      <Text style={[styles.optionActionText, { color: primary ? colors.onAccent : colors.accent }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export default function JobBidsScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const jobId = rawId && /^\d+$/.test(rawId) ? Number(rawId) : null;
  const locale = language as BidLocale;

  const { job, status: jobStatus, refetch: refetchJob, applyJob } = useJobDetail(jobId);
  const { activeRole } = useRole();
  const showAlert = useAppAlert();

  /**
   * The offer the confirmation sheet is about — null while the sheet is closed.
   * Held as one object rather than a flag so the sheet always renders the offer
   * it was opened with, and so a reconciliation (below) can replace it with the
   * fresh one the server just sent.
   */
  const [acceptTarget, setAcceptTarget] = useState<BidResponse | null>(null);
  /** The offer was EDITED while the sheet was open: confirm again. */
  const [acceptChanged, setAcceptChanged] = useState(false);
  /** The server's own accepted bid, until a re-read of the offers confirms it. */
  const [acceptedBid, setAcceptedBid] = useState<BidResponse | null>(null);
  const { acceptBid, accepting } = useAcceptBid();

  /** The offer the DECLINE confirmation is about — null while that sheet is closed. */
  const [rejectTarget, setRejectTarget] = useState<BidResponse | null>(null);
  /**
   * Which bidding-options confirmation dialog is open (null = none). It pauses
   * live updates exactly like the Accept/Decline sheets: the decision in front
   * of the client must never be rewritten underneath it.
   */
  const [optionsAction, setOptionsAction] = useState<BiddingOptionAction | null>(null);
  /**
   * The client's typed reason. Held by the SCREEN on purpose: a failed request
   * must not lose it (the retry then sends exactly what was written), and the
   * 422 for `reason` is rendered on the same input.
   */
  const [rejectReason, setRejectReason] = useState('');
  /** The server's own message for `reason`, shown on the input. */
  const [rejectReasonError, setRejectReasonError] = useState<string | null>(null);
  /**
   * A transport failure sent the offers back to the server; the dialog stays
   * locked until that answer lands, so a retry can never be issued before the
   * screen knows whether the first request went through.
   */
  const [rejectRecheck, setRejectRecheck] = useState(false);
  const { rejectBid, rejecting } = useRejectBid();

  const biddingOpen = job ? isBiddingOpen(job) : false;

  /**
   * Is realtime live on this screen?
   *
   * True while the job can still change — still OPEN with nobody assigned. URGENT
   * and REGULAR behave identically now: the old 8 s URGENT poll is gone, and the
   * socket (plus its 30 s safety net while it is down) is what keeps the list
   * current for both. Accepting a provider turns it off for good: the watch is
   * released, the safety net stops and the live notices disappear, because from
   * that moment the screen shows a decision rather than a race.
   */
  const live =
    acceptedBid === null && job != null && job.assigned_provider_id == null && job.status === 'OPEN';

  /**
   * The confirmation dialogs PAUSE the list, exactly as the old poll was paused:
   * while Accept or Decline is open, neither a bid event nor the safety net may
   * rewrite the offers under the client's finger. The decision in front of them
   * has to be the decision they were shown — the dialogs' own reconciliation
   * (which follows a list that changed by other means, e.g. a pull-to-refresh)
   * stays in place.
   */
  const dialogsClosed =
    acceptTarget === null && rejectTarget === null && optionsAction === null;

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
    createdEvent,
    refresh,
    dropBid,
  } = useJobBids(jobId, { live: live && dialogsClosed });

  /**
   * The job-level half of the live screen: the watch, the bidding window events
   * and the socket status the notices below are driven by.
   */
  const { stale, endsAtOverride, extendedNotice } = useJobBiddingRealtime({
    jobId,
    enabled: live,
    biddingEndsAt: job?.bidding_ends_at ?? null,
    biddingOpen,
    refetchJob,
  });

  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<BidSortId>('api');
  const [sheetBid, setSheetBid] = useState<BidResponse | null>(null);

  // A 401 that survived the shared client's refresh + single replay means the
  // session is gone; the same rule the other job screens follow.
  useEffect(() => {
    if (bidsStatus === 'unauthorized') router.replace('/(auth)/login' as any);
  }, [bidsStatus, router]);

  /**
   * The countdown's deadline — an ABSOLUTE timestamp, so the remaining time is
   * recomputed on every tick and can never drift (remaining_bidding_seconds is a
   * convenience the screen does not need while this field is present).
   *
   * Normally it is the job's own bidding_ends_at (UTC). For the moment between a
   * job.bidding_extended event and the re-read job that carries the new value,
   * the deadline announced by the event itself is used instead — the countdown
   * must never briefly show the OLD window after the backend moved it.
   */
  const deadline = useMemo(
    () => endsAtOverride ?? (job ? biddingDeadline(job, Date.now()) : null),
    [endsAtOverride, job]
  );

  /** The window is live if the API says so, or if an extension just moved it. */
  const windowOpen = biddingOpen || endsAtOverride !== null;

  /** A window can be extended: the same deadline must expire exactly once. */
  const lastExpiredDeadline = useRef<number | null>(null);

  /** The countdown reached zero: re-read the JOB so the closed state is the
   *  backend's, not a guess — the bids themselves follow from the socket/safety
   *  net. Guarded per deadline so a re-render cannot refetch in a loop. */
  const handleBiddingExpired = useCallback(() => {
    if (deadline === null || lastExpiredDeadline.current === deadline) return;
    lastExpiredDeadline.current = deadline;
    void refetchJob();
  }, [deadline, refetchJob]);

  /**
   * Realtime (re)connected — including the first connect.
   *
   * Events are NOT stored by the server, so anything that happened while the
   * socket was down is gone: the offers AND the job are re-read at once. This is
   * also what repairs the list after the app returns from the background.
   */
  useOnRealtimeReconnect(
    useCallback(() => {
      if (!live) return;
      void refresh();
      void refetchJob();
    }, [live, refresh, refetchJob])
  );

  /** The "new offer" toast, built from the event's own data in the app locale. */
  const createdNotice = useMemo(
    () => (createdEvent ? bidCreatedNoticeText(createdEvent.data, locale) : null),
    [createdEvent, locale]
  );

  /* ─────────────────────────── Bidding options (restart / convert) ── */

  const { restartTimer, restarting } = useRestartJobTimer();
  const { convertToRegular, converting: convertingToRegular } = useConvertJobToRegular();
  const { convertToUrgent, converting: convertingToUrgent } = useConvertJobToUrgent();
  const optionsBusy = restarting || convertingToRegular || convertingToUrgent;

  /**
   * What the card offers for THIS job right now. Every flag comes from the
   * backend (can_restart_timer / can_convert_to_*); the only client-side facts
   * are the verified window lengths (Regular 180 min, Urgent 30 min — measured
   * live from remaining_bidding_seconds) and the restart counter display.
   */
  const options = biddingOptionsModel(job, {
    isClient: activeRole === 'CLIENT',
    nowMs: Date.now(),
  });

  /**
   * A restart/convert succeeded: the SERVER's job replaces ours whole (new
   * bidding_ends_at, request_type, timer_restart_count and every re-evaluated
   * flag), which re-anchors the countdown, flips the badge and rewrites the
   * card; the offers are re-read through the same sequenced loader (stale
   * responses stay ignored); the hooks already invalidated the job list and
   * job-detail caches so every other screen refreshes too.
   */
  const adoptOptionJob = useCallback(
    (next: JobResponse) => {
      applyJob(next);
      void refresh();
    },
    [applyJob, refresh]
  );

  /**
   * Re-read the job after a failure only where the backend's own rules say the
   * cached flags are stale (a refusal, or a request that timed out or dropped
   * and may therefore have LANDED) — the shared library's rule for converts,
   * applied to restarts as well.
   */
  const shouldResyncOptionsJob = useCallback(
    (kind: JobActionFailureKind | 'limit'): boolean => {
      // The restart cap being reached IS the backend's flags having moved.
      if (kind === 'limit') return true;
      // No response came back, so the action may have landed after all.
      if (kind === 'network') return true;
      return isJobActionRefused(kind);
    },
    []
  );

  const doRestart = useCallback(async () => {
    if (jobId === null || optionsBusy) return;
    const outcome = await restartTimer(jobId);
    if (outcome.ok) {
      adoptOptionJob(outcome.job);
      showAlert({
        title: t('jobd_restart_success_title'),
        message: outcome.message ?? t('jobd_restart_success_msg'),
        icon: 'refresh-cw',
        buttons: [{ text: t('cbids_opts_ok'), style: 'cancel' }],
      });
      return;
    }
    if (outcome.kind === 'busy') return;
    // A 401 that survived the shared refresh + replay ends the session — the
    // same rule the job detail screen follows.
    if (outcome.kind === 'unauthorized') {
      router.replace('/(auth)/login' as any);
      return;
    }
    if (shouldResyncOptionsJob(outcome.kind)) void refetchJob();
    if (isRestartNotAllowed(outcome.kind)) {
      showAlert({
        title: t('jobd_restart_limit_title'),
        // The backend's own text wins — live: "The bidding timer can only be
        // restarted for open jobs, up to 3 times."
        message: outcome.message ?? t('jobd_restart_limit_msg'),
        icon: 'slash',
        buttons: [{ text: t('cbids_opts_ok'), style: 'cancel' }],
      });
      return;
    }
    if (outcome.kind === 'network') {
      // No response came back: the job was re-read above (the action may have
      // landed), and only a genuine connectivity failure may claim it.
      showAlert({
        title: t('jobd_restart_err_title'),
        message: t('jobd_restart_err_network'),
        icon: 'wifi-off',
        buttons: [
          { text: t('jobs_retry'), onPress: () => void doRestart() },
          { text: t('action_cancel'), style: 'cancel' },
        ],
      });
      return;
    }
    showAlert({
      title: t('jobd_restart_err_title'),
      message: restartTimerFailureMessage(outcome, t),
      icon: 'alert-triangle',
      buttons: [{ text: t('cbids_opts_ok'), style: 'cancel' }],
    });
  }, [jobId, optionsBusy, restartTimer, adoptOptionJob, shouldResyncOptionsJob, refetchJob, showAlert, t, router]);

  const doConvertToRegular = useCallback(async () => {
    if (jobId === null || optionsBusy) return;
    const outcome = await convertToRegular(jobId);
    if (outcome.ok) {
      adoptOptionJob(outcome.job);
      showAlert({
        title: t('jobd_convert_success_title'),
        message: outcome.message ?? t('jobd_convert_success_msg'),
        icon: 'check-circle',
        buttons: [{ text: t('cbids_opts_ok'), style: 'cancel' }],
      });
      return;
    }
    if (outcome.kind === 'busy') return;
    if (outcome.kind === 'unauthorized') {
      router.replace('/(auth)/login' as any);
      return;
    }
    if (shouldResyncOptionsJob(outcome.kind)) void refetchJob();
    if (isConvertNotAllowed(outcome.kind)) {
      showAlert({
        title: t('jobd_convert_notallowed_title'),
        message: outcome.message ?? t('jobd_convert_notallowed_msg'),
        icon: 'slash',
        buttons: [{ text: t('cbids_opts_ok'), style: 'cancel' }],
      });
      return;
    }
    if (outcome.kind === 'network') {
      showAlert({
        title: t('jobd_convert_err_title'),
        message: t('jobd_convert_err_network'),
        icon: 'wifi-off',
        buttons: [
          { text: t('jobs_retry'), onPress: () => void doConvertToRegular() },
          { text: t('action_cancel'), style: 'cancel' },
        ],
      });
      return;
    }
    showAlert({
      title: t('jobd_convert_err_title'),
      message: convertToRegularFailureMessage(outcome, t),
      icon: 'alert-triangle',
      buttons: [{ text: t('cbids_opts_ok'), style: 'cancel' }],
    });
  }, [jobId, optionsBusy, convertToRegular, adoptOptionJob, shouldResyncOptionsJob, refetchJob, showAlert, t, router]);

  const doConvertToUrgent = useCallback(async () => {
    if (jobId === null || optionsBusy) return;
    const outcome = await convertToUrgent(jobId);
    if (outcome.ok) {
      adoptOptionJob(outcome.job);
      showAlert({
        title: t('jobd_urgent_success_title'),
        message: outcome.message ?? t('jobd_urgent_success_msg'),
        icon: 'check-circle',
        buttons: [{ text: t('cbids_opts_ok'), style: 'cancel' }],
      });
      return;
    }
    if (outcome.kind === 'busy') return;
    if (outcome.kind === 'unauthorized') {
      router.replace('/(auth)/login' as any);
      return;
    }
    if (shouldResyncOptionsJob(outcome.kind)) void refetchJob();
    if (isConvertNotAllowed(outcome.kind)) {
      showAlert({
        title: t('jobd_urgent_notallowed_title'),
        message: outcome.message ?? t('jobd_urgent_notallowed_msg'),
        icon: 'slash',
        buttons: [{ text: t('cbids_opts_ok'), style: 'cancel' }],
      });
      return;
    }
    if (outcome.kind === 'network') {
      showAlert({
        title: t('jobd_urgent_err_title'),
        message: t('jobd_urgent_err_network'),
        icon: 'wifi-off',
        buttons: [
          { text: t('jobs_retry'), onPress: () => void doConvertToUrgent() },
          { text: t('action_cancel'), style: 'cancel' },
        ],
      });
      return;
    }
    showAlert({
      title: t('jobd_urgent_err_title'),
      message: convertToUrgentFailureMessage(outcome, t),
      icon: 'alert-triangle',
      buttons: [{ text: t('cbids_opts_ok'), style: 'cancel' }],
    });
  }, [jobId, optionsBusy, convertToUrgent, adoptOptionJob, shouldResyncOptionsJob, refetchJob, showAlert, t, router]);

  /**
   * Every option is confirmed first, and each dialog states ONLY what was
   * verified live: a fresh window of the current/new type's verified length
   * (Regular 180 min, Urgent 30 min) and the restart counter. "Back" sends
   * nothing; any dismissal (button, backdrop, system back) unpauses the screen
   * through the alert's onDismissed.
   */
  const confirmOptionsAction = useCallback(
    (action: BiddingOptionAction) => {
      if (optionsBusy || job === null) return;
      setOptionsAction(action);
      const onDismissed = () => setOptionsAction(null);
      if (action === 'restart') {
        showAlert({
          title: t('cbids_opts_restart_confirm_title'),
          message: t('cbids_opts_restart_confirm_msg', {
            minutes: options.windowMinutes,
            n: options.restartsUsed,
            max: options.restartsMax,
          }),
          icon: 'refresh-cw',
          onDismissed,
          buttons: [
            { text: t('jobd_restart_confirm_cta'), onPress: () => void doRestart() },
            { text: t('cbids_opts_back'), style: 'cancel' },
          ],
        });
        return;
      }
      if (action === 'to_regular') {
        showAlert({
          title: t('cbids_opts_reg_confirm_title'),
          message: t('cbids_opts_reg_confirm_msg', {
            minutes: BIDDING_WINDOW_MINUTES.regular,
          }),
          icon: 'repeat',
          onDismissed,
          buttons: [
            { text: t('jobd_convert_confirm_cta'), onPress: () => void doConvertToRegular() },
            { text: t('cbids_opts_back'), style: 'cancel' },
          ],
        });
        return;
      }
      showAlert({
        title: t('cbids_opts_urg_confirm_title'),
        message: t('cbids_opts_urg_confirm_msg', {
          minutes: BIDDING_WINDOW_MINUTES.urgent,
        }),
        icon: 'zap',
        onDismissed,
        buttons: [
          { text: t('jobd_urgent_confirm_cta'), onPress: () => void doConvertToUrgent() },
          { text: t('cbids_opts_back'), style: 'cancel' },
        ],
      });
    },
    [optionsBusy, job, options, showAlert, t, doRestart, doConvertToRegular, doConvertToUrgent]
  );

  const sortedAll = useMemo(() => sortBids(all, sort), [all, sort]);
  const recommendedTop = recommended.slice(0, RECOMMENDED_MAX);
  const hasMoreOffers = otherOffers.length > 0;

  /* ───────────────────────────────────────────────────────── accept bid ── */

  /**
   * The provider the client has picked, read from the server's OWN answer: the
   * offer whose status is ACCEPTED. Until the re-read list carries it, the bid
   * the accept returned is used — and it is used only when its status is the
   * accepted one, so a status the enum does not call "accepted" can never be
   * rendered as a selection.
   */
  const selectedBid = useMemo(() => {
    const accepted = all.find((bid) => bid.status === 'ACCEPTED');
    if (accepted) return accepted;
    return acceptedBid && acceptedBid.status === 'ACCEPTED' ? acceptedBid : null;
  }, [all, acceptedBid]);

  const openAcceptSheet = useCallback((bid: BidResponse) => {
    setAcceptChanged(false);
    setAcceptTarget(bid);
  }, []);

  /**
   * Close the dialog because the offer it was about can no longer be accepted
   * (withdrawn, edited away, or the job was decided elsewhere). Nothing is sent
   * on this path — the client is told why and the screen re-reads the truth.
   */
  const closeAcceptSheet = useCallback(() => {
    setAcceptTarget(null);
    setAcceptChanged(false);
  }, []);

  const discardAcceptSheet = useCallback(() => {
    closeAcceptSheet();
    setSheetBid(null);
    showAlert({
      title: t('cbids_accept_gone_title'),
      message: t('cbids_accept_err_notallowed'),
      icon: 'alert-circle',
    });
  }, [closeAcceptSheet, showAlert, t]);

  /**
   * The confirmation itself. Every answer the endpoint can give is handled HERE,
   * so the sheet stays a pure renderer:
   *
   *   ok          the server's own bid is adopted, then the job AND the offers are
   *               re-read — nothing on screen is assumed
   *   changed     the provider edited the offer while the sheet was open: the new
   *               values are shown and a FRESH confirmation is required
   *   stale       the offer is gone or already decided: the sheet closes
   *   unauthorized the session ended — the shared client already refreshed once
   *   network     the reply was lost: the hook re-read the JOB, and a pick that is
   *               already standing is reported as done instead of retried
   *   anything else  the backend's own text when it sent one, then a re-read
   */
  const runAccept = useCallback(async () => {
    const target = acceptTarget;
    if (!job || !target || accepting) return;

    const outcome = await acceptBid(job.id, target.id, target);

    if (outcome.ok) {
      setAcceptedBid(outcome.bid);
      closeAcceptSheet();
      setSheetBid(null);
      await Promise.all([refetchJob(), refresh()]);
      return;
    }

    if (outcome.kind === 'busy') return;

    if (outcome.kind === 'unauthorized') {
      router.replace('/(auth)/login' as any);
      return;
    }

    if (outcome.kind === 'changed') {
      // The offer under the client's finger is not the offer the server holds:
      // show the new one and make them confirm it again. Nothing was accepted.
      setAcceptTarget(outcome.bid);
      setAcceptChanged(true);
      void refresh();
      return;
    }

    if (outcome.kind === 'stale') {
      discardAcceptSheet();
      void Promise.all([refresh(), refetchJob()]);
      return;
    }

    if (outcome.kind === 'network') {
      // A lost reply is NOT a failure: the hook re-read the job. When the pick is
      // already standing there is nothing to retry — the screen follows it.
      if (outcome.resolved === true) {
        closeAcceptSheet();
        setSheetBid(null);
        await Promise.all([refetchJob(), refresh()]);
        return;
      }
      // A genuine connectivity failure (or a lost reply whose job re-read also
      // failed). The job is re-read either way before anything is offered again.
      void Promise.all([refetchJob(), refresh()]);
      showAlert({
        title: t('cbids_accept_err_title'),
        message: acceptBidFailureMessage(outcome, t),
        icon: 'wifi-off',
      });
      return;
    }

    // 422 / 400 / 403 / 404 / 409 / 5xx / unknown: the server's own words when it
    // sent any, otherwise the translated copy for the bucket — and the screen
    // re-reads the job and the offers so it shows the real state afterwards.
    const message = acceptBidFailureMessage(outcome, t);
    if (shouldResyncAfterAcceptFailure(outcome.kind)) {
      closeAcceptSheet();
      setSheetBid(null);
      void Promise.all([refresh(), refetchJob()]);
    }
    showAlert({ title: t('cbids_accept_err_title'), message, icon: 'alert-circle' });
  }, [
    acceptTarget,
    accepting,
    acceptBid,
    job,
    closeAcceptSheet,
    discardAcceptSheet,
    refetchJob,
    refresh,
    router,
    showAlert,
    t,
  ]);

  /**
   * Live reconciliation while the sheet is open.
   *
   * The poll is suspended for the dialog, but a pull-to-refresh (or the return
   * from the background) can still deliver a newer list. The dialog follows that
   * data instead of the data following the dialog: a different offer being
   * ACCEPTED, this offer disappearing or leaving PENDING, or this offer being
   * edited all close or update it, with a translated explanation.
   */
  useEffect(() => {
    if (!acceptTarget || accepting) return;
    const fresh = all.find((bid) => bid.id === acceptTarget.id) ?? null;
    const decidedElsewhere = all.some(
      (bid) => bid.status === 'ACCEPTED' && bid.id !== acceptTarget.id
    );
    if (decidedElsewhere) {
      discardAcceptSheet();
      return;
    }
    if (!fresh) {
      discardAcceptSheet();
      return;
    }
    if (!isBidPending(fresh.status)) {
      // ACCEPTED on THIS offer is our own accept landing: the handler closes the
      // sheet in the same update, so it is not reported as a problem.
      if (fresh.status !== 'ACCEPTED') discardAcceptSheet();
      return;
    }
    if (!bidSelectionMatches(acceptTarget, fresh)) {
      setAcceptTarget(fresh);
      setAcceptChanged(true);
    }
  }, [all, acceptTarget, accepting, discardAcceptSheet]);

  /* ─────────────────────────────────────────────────────── decline bid ── */

  const openRejectSheet = useCallback((bid: BidResponse) => {
    setRejectReason('');
    setRejectReasonError(null);
    setRejectRecheck(false);
    setRejectTarget(bid);
  }, []);

  /** Close the Decline dialog WITHOUT sending anything. */
  const closeRejectSheet = useCallback(() => {
    setRejectTarget(null);
    setRejectReasonError(null);
    setRejectRecheck(false);
  }, []);

  /** The offer the dialog was about is gone or already decided. */
  const discardRejectSheet = useCallback(() => {
    closeRejectSheet();
    setSheetBid(null);
    void refresh();
    showAlert({
      title: t('cbids_reject_gone_title'),
      message: t('cbids_reject_err_notallowed'),
      icon: 'alert-circle',
    });
  }, [closeRejectSheet, refresh, showAlert, t]);

  /**
   * The DECLINE itself. Every answer the endpoint can give is handled HERE, so
   * the sheet stays a pure renderer:
   *
   *   ok          the server's own bid names the id that leaves the list, the
   *               bid is dropped at once and the offers are re-read
   *   422         the server's message for `reason` lands on the input; the typed
   *               text is never cleared
   *   400 / 409   the offer is no longer declinable (withdrawn, already decided,
   *               or the job moved on): the sheet closes and the list is re-read
   *   403 / 404   not this job's client, or the job/bid is gone: same treatment
   *   network/5xx the bid stays visible, the sheet stays open with a retry and
   *               the typed reason preserved — a lost reply may still have gone
   *               through, and the next refresh reports the truth either way
   *   401         the shared client already refreshed once; the session is over
   */
  const runReject = useCallback(async () => {
    const target = rejectTarget;
    if (!job || !target || rejecting || rejectRecheck) return;

    const validation = validateBidRejectReason(rejectReason);
    if (!validation.ok) {
      setRejectReasonError(t(validation.errorKey));
      return;
    }
    setRejectReasonError(null);

    const outcome = await rejectBid(job.id, target.id, validation.value);

    if (outcome.ok) {
      closeRejectSheet();
      setSheetBid(null);
      // The SERVER's returned bid decides what leaves the list — the id it names,
      // nothing recomputed here. The refetch afterwards is what promotes the
      // next-best offer into the Recommended block: the app never re-ranks.
      dropBid(outcome.bid.id);
      void refresh();
      showAlert({
        title: t('cbids_reject_done_title'),
        message: t('cbids_reject_done_msg'),
        icon: 'check-circle',
      });
      return;
    }

    if (outcome.kind === 'busy') return;

    if (outcome.kind === 'unauthorized') {
      router.replace('/(auth)/login' as any);
      return;
    }

    if (outcome.kind === 'invalid') {
      // 422 for the reason field goes ON the input (the server's own words).
      const fieldMessage = bidRejectReasonFieldError(outcome.detail);
      if (fieldMessage) {
        setRejectReasonError(fieldMessage);
        return;
      }
      // Anything else 422 (a rejected path id) falls through to the alert.
    }

    // A transport failure (timeout, dropped connection): a lost reply may still
    // have gone through, so the offers and the job are RE-READ while the dialog
    // stays locked (`confirming`), and only when that lands is the retry offered.
    // The typed reason survives; if the read shows the bid already decided, the
    // reconciliation above closes the dialog with its own explanation instead.
    const message = rejectBidFailureMessage(outcome, t);
    if (outcome.kind === 'network') {
      setRejectRecheck(true);
      void Promise.all([refresh(), refetchJob()]).finally(() => setRejectRecheck(false));
      showAlert({
        title: t('cbids_reject_err_title'),
        message,
        icon: 'wifi-off',
      });
      return;
    }

    // A state refusal means the card on screen is not the truth, so the sheet
    // closes and the list (and the job) are re-read. Any other failure keeps
    // everything the client typed and offers a retry instead.
    if (shouldResyncAfterRejectFailure(outcome.kind)) {
      closeRejectSheet();
      setSheetBid(null);
      void Promise.all([refresh(), refetchJob()]);
    }
    showAlert({
      title: t('cbids_reject_err_title'),
      message,
      icon: 'alert-circle',
    });
  }, [
    rejectTarget,
    rejectReason,
    rejecting,
    rejectRecheck,
    rejectBid,
    job,
    closeRejectSheet,
    dropBid,
    refresh,
    refetchJob,
    router,
    showAlert,
    t,
  ]);

  /**
   * Live reconciliation while the Decline dialog is open.
   *
   * Polling is suspended for the dialog, but a pull-to-refresh (or the return
   * from the background) can still deliver a newer list. When the offer the
   * dialog is about has gone or is no longer PENDING — the provider withdrew it,
   * another offer was accepted, or the window ended — the dialog closes with a
   * translated explanation, so a decline is never sent for an offer that is no
   * longer on the table.
   */
  useEffect(() => {
    if (!rejectTarget || rejecting) return;
    const fresh = all.find((bid) => bid.id === rejectTarget.id) ?? null;
    if (!fresh || !isBidPending(fresh.status)) discardRejectSheet();
  }, [all, rejectTarget, rejecting, discardRejectSheet]);

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

      {selectedBid ? (
        /* A provider has been picked: the countdown and the other offers are
           gone, and the client sees WHO was selected with the server's own
           status and accepted time — plus the real next step, which is payment
           only when the JOB says it is payment-pending. No "Pay" button: the
           payment flow is a separate task. */
        <View style={{ marginTop: 12 }}>
          <View
            style={[
              styles.selectedBanner,
              { backgroundColor: c.successLight, borderColor: c.success },
            ]}
          >
            <Feather name="check-circle" size={14} color={c.success} />
            <Text style={[styles.selectedTitle, { color: c.text }]}>
              {t('cbids_selected_title')}
            </Text>
          </View>
          <BidOfferCard bid={selectedBid} locale={locale} onPress={() => setSheetBid(selectedBid)} />
          {(() => {
            const stamp = bidStatusStamp(selectedBid);
            const stampText = stamp ? formatDateTime(stamp.value) : null;
            const statusKey = bidStatusLabelKey(selectedBid.status);
            return (
              <View style={[styles.selectedMeta, { borderColor: c.border, backgroundColor: c.muted }]}>
                <View style={styles.selectedMetaRow}>
                  {statusKey ? (
                    <Text style={[styles.selectedMetaText, { color: c.text }]}>
                      {t(statusKey)}
                    </Text>
                  ) : null}
                  {stamp && stampText ? (
                    <Text style={[styles.selectedMetaText, { color: c.mutedForeground }]}>
                      {t(stamp.labelKey)} · {stampText}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.selectedNote, { color: c.mutedForeground }]}>
                  {job && isPaymentPending(job)
                    ? t('cbids_payment_required')
                    : t('cbids_selected_note')}
                </Text>
              </View>
            );
          })()}
        </View>
      ) : windowOpen && deadline !== null ? (
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

      {/* Bidding options — the job owner's own actions on THIS job's window,
          client mode only and only while the backend's flags allow at least one
          of them. The dialogs state only live-verified facts (fresh Regular
          180-minute / Urgent 30-minute window, restarts used of the limit). */}
      {options.visible ? (
        <View style={[styles.optionsCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.optionsHeaderRow}>
            <Feather name="sliders" size={15} color={c.text} />
            <Text style={[styles.optionsTitle, { color: c.text }]}>{t('cbids_opts_title')}</Text>
          </View>
          <Text style={[styles.optionsCounter, { color: c.mutedForeground }]}>
            {t('cbids_opts_restarts', { n: options.restartsUsed, max: options.restartsMax })}
          </Text>
          {options.windowEnded ? (
            <View
              style={[styles.optionsEnded, { backgroundColor: c.muted, borderColor: c.border }]}
            >
              <Feather name="clock" size={13} color={c.mutedForeground} />
              <Text style={[styles.optionsEndedText, { color: c.mutedForeground }]}>
                {t('cbids_opts_ended')}
              </Text>
            </View>
          ) : null}
          <View style={styles.optionsButtons}>
            {options.restart ? (
              <OptionActionButton
                label={t('cbids_opts_restart')}
                icon="refresh-cw"
                primary={options.windowEnded}
                busy={restarting}
                disabled={optionsBusy}
                onPress={() => confirmOptionsAction('restart')}
                colors={{ accent: c.primary, onAccent: c.primaryForeground, border: c.border }}
              />
            ) : null}
            {options.toRegular ? (
              <OptionActionButton
                label={t('cbids_opts_to_regular')}
                icon="repeat"
                primary={options.windowEnded}
                busy={convertingToRegular}
                disabled={optionsBusy}
                onPress={() => confirmOptionsAction('to_regular')}
                colors={{ accent: c.primary, onAccent: c.primaryForeground, border: c.border }}
              />
            ) : null}
            {options.toUrgent ? (
              <OptionActionButton
                label={t('cbids_opts_to_urgent')}
                icon="zap"
                primary={options.windowEnded}
                busy={convertingToUrgent}
                disabled={optionsBusy}
                onPress={() => confirmOptionsAction('to_urgent')}
                colors={{ accent: c.primary, onAccent: c.primaryForeground, border: c.border }}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      {refreshFailed ? (
        <View style={[styles.refreshNotice, { backgroundColor: c.muted, borderColor: c.border }]}>
          <Feather name="alert-circle" size={12} color={c.mutedForeground} />
          <Text style={[styles.refreshNoticeText, { color: c.mutedForeground }]}>
            {t('cbids_refresh_failed')}
          </Text>
        </View>
      ) : null}

      {/* Live notices: three small, non-blocking rows under the job card. They
          never cover the list and never open a dialog — an offer arriving, the
          timer moving or the socket being down must not interrupt the client's
          reading of the offers. Same row shape as the refresh notice above, so
          the screen keeps one visual language (existing theme tokens only). */}
      {createdNotice ? (
        <View
          style={[styles.refreshNotice, { backgroundColor: c.primaryLight, borderColor: c.primary }]}
          accessibilityLiveRegion="polite"
        >
          <Feather name="bell" size={12} color={c.primary} />
          <Text style={[styles.refreshNoticeText, { color: c.primary }]} numberOfLines={2}>
            {createdNotice.eta
              ? t('cbids_live_new_bid', {
                  price: createdNotice.price,
                  eta:
                    createdNotice.eta.kind === 'now'
                      ? t('jobd_bid_eta_now')
                      : createdNotice.eta.kind === 'minutes'
                        ? t('jobd_bid_eta_min', { n: createdNotice.eta.minutes })
                        : t('jobd_bid_eta_hm', {
                            h: createdNotice.eta.hours,
                            m: createdNotice.eta.minutes,
                          }),
                })
              : t('cbids_live_new_bid_no_eta', { price: createdNotice.price })}
          </Text>
        </View>
      ) : null}

      {extendedNotice ? (
        <View
          style={[styles.refreshNotice, { backgroundColor: c.muted, borderColor: c.border }]}
          accessibilityLiveRegion="polite"
        >
          <Feather name="clock" size={12} color={c.warning} />
          <Text style={[styles.refreshNoticeText, { color: c.text }]}>
            {t('cbids_live_timer_extended')}
          </Text>
        </View>
      ) : null}

      {stale ? (
        <View
          style={[styles.refreshNotice, { backgroundColor: c.muted, borderColor: c.border }]}
          accessibilityLiveRegion="polite"
        >
          <Feather name="wifi-off" size={12} color={c.mutedForeground} />
          <Text style={[styles.refreshNoticeText, { color: c.mutedForeground }]}>
            {t('cbids_live_reconnecting')}
          </Text>
        </View>
      ) : null}

      {/* ONE list, two titles. Collapsed it is the server's `recommended` block
          (max 3, API order); expanded it is every offer, sorted by the chips.
          The cards themselves are rendered by the FlatList below, never here,
          so a bid can never appear twice on screen. */}
      {selectedBid ? null : (
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
      )}
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
        icon={windowOpen ? 'inbox' : 'clock'}
        title={
          windowOpen ? t('cbids_empty_open_title') : t('cbids_empty_closed_title')
        }
        subtitle={windowOpen ? t('cbids_empty_open_msg') : t('cbids_empty_closed_msg')}
      />
    );
  };

  // The full list (recommended + the rest) once "View all offers" is open. With
  // a provider selected the other offers are closed (module spec: they disappear
  // after the accept), so the list is empty — the picked offer is rendered in the
  // header above, with its real status and accepted time.
  const listData = selectedBid ? [] : showAll ? sortedAll : recommendedTop;

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
          // The Accept action is decided by lib/bid.canAcceptBid: the CLIENT's
          // role, an offer still PENDING, and a job still OPEN with nobody
          // assigned. Every other case passes undefined, so no button exists.
          onAccept={
            canAcceptBid(item, job, activeRole) ? () => openAcceptSheet(item) : undefined
          }
          // The Decline action is decided the same way, by lib/bid.canRejectBid
          // (CLIENT role, PENDING offer, job still open with nobody assigned) and
          // is rendered as the SECONDARY button in the same row. Every other case
          // passes undefined, so no button exists.
          onReject={
            canRejectBid(item, job, activeRole) ? () => openRejectSheet(item) : undefined
          }
        />
      )}
      ListHeaderComponent={jobHeader}
      ListEmptyComponent={
        selectedBid ? null : <View style={{ paddingHorizontal: 16 }}>{emptyState()}</View>
      }
      ListFooterComponent={
        // The remaining offers live behind this button, BELOW the cards; it only
        // exists when the backend actually sent some (JobBidsResponse.other_offers),
        // and it is gone once a provider has been picked.
        hasMoreOffers && !selectedBid ? (
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
      <ProviderSheet
        bid={sheetBid}
        locale={locale}
        onAccept={
          sheetBid && canAcceptBid(sheetBid, job, activeRole)
            ? () => {
                setSheetBid(null);
                openAcceptSheet(sheetBid);
              }
            : null
        }
        onReject={
          sheetBid && canRejectBid(sheetBid, job, activeRole)
            ? () => {
                setSheetBid(null);
                openRejectSheet(sheetBid);
              }
            : null
        }
        onClose={() => setSheetBid(null)}
      />
      <AcceptBidSheet
        visible={acceptTarget !== null}
        bid={acceptTarget}
        job={job}
        locale={locale}
        changed={acceptChanged}
        confirming={accepting}
        onBack={closeAcceptSheet}
        onConfirm={() => void runAccept()}
      />
      <RejectBidSheet
        visible={rejectTarget !== null}
        bid={rejectTarget}
        locale={locale}
        reason={rejectReason}
        onReasonChange={(value) => {
          setRejectReason(value);
          // A new keystroke clears a stale 422 — the server already said it about
          // the previous text, and the typed reason must survive every failure.
          if (rejectReasonError) setRejectReasonError(null);
        }}
        reasonError={rejectReasonError}
        confirming={rejecting || rejectRecheck}
        onBack={closeRejectSheet}
        onConfirm={() => void runReject()}
      />
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
  optionsCard: { marginTop: 12, borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  optionsHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  optionsTitle: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  optionsCounter: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  optionsEnded: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  optionsEndedText: { fontFamily: 'Manrope_500Medium', fontSize: 12, flex: 1 },
  optionsButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexGrow: 1,
    flexBasis: '46%',
  },
  optionActionText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
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
  sheetActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  sheetAccept: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 24, paddingVertical: 12 },
  sheetAcceptText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  sheetReject: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 24, paddingVertical: 12 },
  sheetRejectText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  selectedBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 16, paddingVertical: 10, marginBottom: 12 },
  selectedTitle: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
  selectedMeta: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 6, marginTop: -4, marginBottom: 4 },
  selectedMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  selectedMetaText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  selectedNote: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 18 },
});
