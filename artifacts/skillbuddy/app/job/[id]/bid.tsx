import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useRole } from '@/context/RoleContext';
import { useAppAlert } from '@/context/AlertModalContext';
import BackButton from '@/components/BackButton';
import BidArrivalTimes from '@/components/BidArrivalTimes';
import BidFormFields from '@/components/BidFormFields';
import BottomSheet from '@/components/BottomSheet';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import BrandedLoader from '@/components/BrandedLoader';
import CountdownTimer from '@/components/CountdownTimer';
import { useJobDetail } from '@/hooks/useJobDetail';
import { useBidSubmit } from '@/hooks/useBidSubmit';
import { MY_BID_POLL_MS, useMyBid } from '@/hooks/useMyBid';
import { biddingDeadline, formatDateTime } from '@/lib/jobDetail';
import {
  BID_ADJUST_STEPS,
  adjustBidPrice,
  bidDraftEtaMinutes,
  bidDraftFromBid,
  bidEtaParts,
  bidFieldError,
  bidNextStepKey,
  bidRejectionReason,
  bidStatusLabelKey,
  bidStatusStamp,
  bidSubmitFailureMessage,
  bidUpdateFailureMessage,
  buildBidUpdateRequest,
  canApplyBidAdjust,
  canEditBid,
  canProviderSubmitBid,
  formatAdjustChipLabel,
  formatBidPrice,
  hasBidDraftChanged,
  isBidDraftValid,
  isBiddingOpen,
  shouldOfferBidAdjust,
  shouldResyncAfterBidFailure,
  validateBidMessage,
  validateBidPrice,
  validateEtaMinutes,
  type BidDraft,
  type BidFieldName,
} from '@/lib/bid';
import {
  composeBidMessage,
  etaMinutesForFirstArrival,
  firstMissingArrival,
  hasBidMessageChanged,
  hasEveryArrival,
  jobTaskWindows,
  messageRoomFor,
  parseProposedTimeLine,
  proposedTimesSummary,
  stripProposedTimeLine,
  type ProposedArrival,
} from '@/lib/bidTimes';
import type { BidResponse } from '@/types';
import useNearbyJobGone from '@/hooks/useNearbyJobGone';
import { markNearbyJobGone } from '@/lib/nearbyAvailability';

/**
 * Place Your Bid / Your Bid — the provider's own bid on ONE job.
 *
 *   POST /api/v1/jobs/{job_id}/bids       → submit (schema BidCreate)
 *   GET  /api/v1/jobs/{job_id}/bids/mine  → this provider's own bid (useMyBid)
 *
 * REACHED from Job Details → its provider-only card, which offers "Place a Bid"
 * while the backend still reports the window open and "View your bid" once it
 * does not. The id is the JOB id.
 *
 * WHAT THE SCREEN OPENS AS (decided by /bids/mine, never by a guess):
 *   - a bid exists  → the "Your bid" card, status-aware, with the countdown while
 *                     the window is open and a "Bidding closed" chip after it
 *   - no bid, open  → the form
 *   - no bid, shut  → the closed state (no form, no buttons)
 *   - unanswered    → an honest "could not be checked" state with a retry, so a
 *                     provider can never submit a duplicate on a failed read
 * A 404 from /bids/mine means "no bid" AND is also what an unknown job id
 * returns; the job detail this screen already loaded is what tells them apart
 * (see lib/bid.myBidLookupFromError and hooks/useMyBid).
 *
 * THE PRICE IS THE FINAL TOTAL THE CLIENT PAYS, VAT included — the client is
 * charged nothing on top. The label and hint say exactly that, translated. No
 * payout, commission or VAT arithmetic appears anywhere in this app: the spec's
 * own example maths is inconsistent and those rules may change, so nothing is
 * derived from a price here.
 *
 * eta_minutes IS THE ESTIMATED TIME OF ARRIVAL, NOT THE JOB'S DURATION. The spec
 * describes the same field as the provider's "expected job time" and the
 * client's "estimated time of arrival"; the LIVE SCHEMA resolves it — BidCreate's
 * own description reads "Estimated time of arrival, in minutes", 0..1440. The
 * schema is authoritative, so the copy asks how long until the provider can
 * arrive, and the same label is used for the bid that was submitted. The spec
 * conflict is recorded in the report for the backend owner.
 *
 * MODIFY BID IS THIS SCREEN'S SECOND ACTION (PUT /jobs/{job_id}/bids/{bid_id}).
 * Offered on the "Your bid" card ONLY while the backend still reports the bid
 * PENDING and the job's window open, it opens the SAME form component the submit
 * flow renders, prefilled from the bid the server sent, and Save stays disabled
 * until a value actually changed. The quick-adjust chips (−10 / −5 / +5 / +10,
 * EURO amounts) appear only once the client has restarted the timer. While the
 * sheet is open, polling is paused so a poll tick can never overwrite what the
 * provider is typing.
 *
 * WHAT IS DELIBERATELY ABSENT:
 *   - the score fields, total_score and is_recommended. They are internal
 *     ranking data for the client's dashboard and admin, so nothing here reads
 *     them off a response;
 *   - Withdraw Bid, Accept Bid, Reject Bid and Chat — separate tasks. No
 *     disabled placeholder is rendered for any of them either;
 *   - any client snapshot, photos or budget. JobResponse has no such fields, so
 *     no placeholder is invented for them.
 *
 * THE COUNTDOWN IS THE JOB'S OWN. `biddingDeadline` returns null unless the
 * backend says `is_bidding_open === true`, and the CountdownTimer renders from
 * an ABSOLUTE deadline so a suspend cannot drift it. Reaching zero does not
 * invent a state: the job is re-read and its flags decide what is shown.
 */
export default function PlaceBidScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();
  const { activeRole } = useRole();
  const showAlert = useAppAlert();

  const numericId = /^\d+$/.test(id ?? '') ? Number(id) : null;

  const { status: jobStatus, job, serverMessage, retry, refetch } = useJobDetail(numericId);
  const { createBidForJob, bidSubmitting } = useBidSubmit();

  const biddingOpen = job ? isBiddingOpen(job) : false;

  /**
   * THIS provider's own bid. The hook owns the three-state answer (exists /
   * none / unanswered), the per-account cache and the polling rules; the screen
   * only renders what it says. Polling is requested ONLY while the window is
   * open — the hook additionally requires a PENDING bid, focus and a foreground
   * app, and tears the interval down the moment the status stops being PENDING.
   */
  /**
   * The Edit bid sheet's own draft — null while the sheet is closed. It is a
   * COPY of the bid in lib/bid.BidDraft form, so nothing the provider types can
   * reach the card until the server has confirmed it.
   */
  const [editDraft, setEditDraft] = useState<BidDraft | null>(null);
  const [editPriceError, setEditPriceError] = useState<string | null>(null);
  const [editMessageError, setEditMessageError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const {
    lookup: myBid,
    refreshing: myBidRefreshing,
    refreshFailed: myBidRefreshFailed,
    changedStatus,
    clearChangedStatus,
    savingEdit,
    saveEdit: saveEditBid,
    refresh: refreshMyBid,
    reload: reloadMyBid,
    adopt: adoptCreatedBid,
  } = useMyBid(numericId, {
    pollMs: biddingOpen ? MY_BID_POLL_MS : null,
    // A sheet the provider is typing in must never be overwritten by a poll
    // tick. Focus/pull-to-refresh still work; the interval waits.
    paused: editDraft !== null,
  });

  const [price, setPrice] = useState('');
  const [message, setMessage] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);

  /**
   * THE pilot's arrival times — one chosen half-hour per task, prefilled from
   * the bid when editing. They are the ONLY time control on this screen: the
   * old ETA steppers are gone, and `eta_minutes` (still required by the schema)
   * is derived from the earliest chosen start by lib/bidTimes.
   */
  const [arrivals, setArrivals] = useState<ProposedArrival[]>([]);
  const [arrivalError, setArrivalError] = useState<string | null>(null);
  const [editArrivals, setEditArrivals] = useState<ProposedArrival[]>([]);
  const [editArrivalError, setEditArrivalError] = useState<string | null>(null);

  const meridiem = useMemo(
    () => ({ am: t('post_sched_am'), pm: t('post_sched_pm') }),
    [t]
  );

  /** One row per task of the job (single day = 1, multiple days = 1..7). */
  const tasks = useMemo(() => jobTaskWindows(job), [job]);

  /** The schema's 1000 characters, minus the line the chosen times occupy. */
  const messageRoom = messageRoomFor(arrivals, meridiem);
  const editMessageRoom = messageRoomFor(editArrivals, meridiem);

  /**
   * The countdown anchor is captured ONCE: the deadline must not be recomputed
   * from a shrinking `remaining_bidding_seconds` every render.
   */
  const anchorRef = useRef(Date.now());
  const deadline = useMemo(
    () => (job ? biddingDeadline(job, anchorRef.current) : null),
    [job]
  );

  /* ------------------------------------------------------------- connectivity */

  /**
   * A genuine connectivity failure is the ONE failure that gets a dialog (the
   * screen would otherwise silently sit on "could not be checked"), and it is
   * raised once per failure rather than on every poll tick. Every other failure
   * stays inline, with the backend's own text when it sent one.
   */
  const offlineDialogShown = useRef(false);
  useEffect(() => {
    if (myBid?.state !== 'error' || myBid.kind !== 'network') {
      offlineDialogShown.current = false;
      return;
    }
    if (offlineDialogShown.current) return;
    offlineDialogShown.current = true;
    showAlert({
      title: t('jobd_bid_offline_title'),
      message: t('jobd_bid_offline_msg'),
      icon: 'wifi-off',
    });
  }, [myBid, showAlert, t]);

  /**
   * A 401 that survived the shared client's refresh + single replay means the
   * session is gone — the same rule every other job screen follows. The tokens
   * have already been cleared by the axios layer, so this only finishes the job.
   */
  useEffect(() => {
    if (myBid?.state === 'error' && myBid.kind === 'unauthorized') {
      router.replace('/(auth)/login' as any);
    }
  }, [myBid, router]);

  /** Reaching zero is not a client-side verdict — re-read the job. */
  /**
   * A job that left the provider's near-by feed (`job.nearby_closed`: taken,
   * cancelled, or no longer OPEN) arriving on the feed while this screen is
   * open. The feed remembers it in lib/nearbyAvailability, which is what this
   * flag reads — the job's own GET can lag behind the event. The form is
   * disabled rather than unmounted, so anything already typed stays on screen.
   */
  const nearbyGone = useNearbyJobGone(numericId);

  const handleBiddingExpired = useCallback(() => {
    // The window ending here is the same fact the feed acts on: the job can no
    // longer be bid on, so it is marked gone for this screen too. The re-read
    // below still decides what the job itself says.
    if (numericId !== null) markNearbyJobGone(numericId);
    void refetch();
  }, [numericId, refetch]);

  /* ------------------------------------------------------------------ submit */

  /**
   * Every rule the wire checks, checked before the request: the price, the
   * derived eta, the COMBINED message (the provider's words plus the time line),
   * and one chosen arrival per task.
   */
  const validateAll = useCallback((): boolean => {
    const priceResult = validateBidPrice(price);
    const etaResult = validateEtaMinutes(
      String(etaMinutesForFirstArrival(arrivals, tasks))
    );
    const messageResult = validateBidMessage(
      composeBidMessage(message, arrivals, meridiem) ?? ''
    );
    const missing = firstMissingArrival(arrivals, tasks);

    setPriceError(priceResult.ok ? null : t(priceResult.errorKey));
    setMessageError(messageResult.ok ? null : t(messageResult.errorKey));
    setArrivalError(
      missing === null ? null : t('jobd_bid_arrival_required', { n: missing })
    );
    return priceResult.ok && etaResult.ok && messageResult.ok && missing === null;
  }, [price, message, arrivals, tasks, meridiem, t]);

  const submit = useCallback(async () => {
    if (numericId === null || bidSubmitting) return;
    setFormError(null);
    setRetryable(false);
    if (!validateAll()) return;

    // eta_minutes is derived from the EARLIEST chosen arrival; the message is
    // the provider's words plus the one fixed time line lib/bidTimes owns.
    const outcome = await createBidForJob(
      numericId,
      price,
      String(etaMinutesForFirstArrival(arrivals, tasks)),
      composeBidMessage(message, arrivals, meridiem) ?? ''
    );

    if (outcome.ok) {
      // The card comes from the 201 itself — status included — and the hook then
      // re-reads /bids/mine to confirm it, so the provider never sees a
      // form→card flash and never sees a status the server did not send.
      adoptCreatedBid(outcome.bid);
      showAlert({
        title: t('jobd_bid_success_title'),
        message: t('jobd_bid_success_msg'),
        icon: 'check-circle',
      });
      return;
    }

    if (outcome.kind === 'busy') return;
    if (outcome.kind === 'unauthorized') {
      router.replace('/(auth)/login' as any);
      return;
    }

    // 422 → put each rejected field's own message back on that input.
    if (outcome.kind === 'invalid' && outcome.detail) {
      const priceField: BidFieldName = 'offered_price';
      const etaField: BidFieldName = 'eta_minutes';
      const messageField: BidFieldName = 'message';
      const priceMsg = bidFieldError(outcome.detail, priceField);
      const etaMsg = bidFieldError(outcome.detail, etaField);
      const messageMsg = bidFieldError(outcome.detail, messageField);
      setPriceError(priceMsg ?? (outcome.message || null));
      setArrivalError(etaMsg);
      setMessageError(messageMsg);
      if (priceMsg || etaMsg || messageMsg) return;
    }

    // A refusal means the state this screen gated on is stale (the window
    // closed, someone else was picked, a bid already exists), so both the job
    // AND this provider's bid are re-read. The typed values are untouched.
    if (shouldResyncAfterBidFailure(outcome.kind)) {
      void refetch();
      void refreshMyBid();
    }

    setFormError(bidSubmitFailureMessage(outcome, t));
    setRetryable(outcome.kind !== 'invalid');
  }, [
    numericId,
    bidSubmitting,
    validateAll,
    createBidForJob,
    price,
    message,
    arrivals,
    tasks,
    meridiem,
    adoptCreatedBid,
    showAlert,
    t,
    router,
    refetch,
    refreshMyBid,
  ]);

  /* --------------------------------------------------------------- edit bid */

  /**
   * Open the sheet on the bid the server sent. The prefill comes from the bid
   * itself (lib/bid.bidDraftFromBid) — an unreadable price prefills empty, which
   * leaves Save disabled until a real one is typed.
   */
  const openEdit = useCallback((bid: BidResponse) => {
    // The saved line is parsed back so the sheet opens on the times the pilot
    // really chose; the message field shows only the pilot's own words.
    const parsed = parseProposedTimeLine(bid.message);
    const eta = etaMinutesForFirstArrival(parsed.arrivals, tasks);
    setEditDraft({
      ...bidDraftFromBid(bid),
      message: parsed.userMessage,
      etaHours: Math.floor(eta / 60),
      etaMinutes: eta % 60,
    });
    setEditArrivals(parsed.arrivals);
    setEditPriceError(null);
    setEditMessageError(null);
    setEditError(null);
    setEditArrivalError(
      parsed.arrivals.length === 0 && tasks.length > 0
        ? t('jobd_bid_arrival_legacy')
        : null
    );
  }, [tasks, t]);

  /**
   * Close and DISCARD — the provider's way out without a request (lib/bid keeps
   * the "did anything change" question, so nothing is lost silently).
   */
  const closeEdit = useCallback(() => {
    setEditDraft(null);
    setEditArrivals([]);
    setEditArrivalError(null);
    setEditPriceError(null);
    setEditMessageError(null);
    setEditError(null);
  }, []);

  /* ------------------------------------------------------------------ states */

  const header = (title: string) => (
    <View style={styles.header}>
      <BackButton />
      <Text style={[styles.headerTitle, { color: c.text }]}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );

  const centered = (icon: React.ComponentProps<typeof Feather>['name'], title: string, sub: string, cta?: { label: string; onPress: () => void }) => (
    <View style={styles.stateWrap}>
      <Feather name={icon} size={28} color={c.mutedForeground} />
      <Text style={[styles.stateTitle, { color: c.text }]}>{title}</Text>
      <Text style={[styles.stateSub, { color: c.mutedForeground }]}>{sub}</Text>
      {cta ? (
        <TouchableOpacity
          style={[styles.stateBtn, { backgroundColor: c.primary }]}
          onPress={cta.onPress}
        >
          <Text style={[styles.stateBtnText, { color: c.primaryForeground }]}>{cta.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const shell = (title: string, body: React.ReactNode) => (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      {header(title)}
      {body}
    </View>
  );

  /** Accent/icon for a status, used by the change banner. */
  const statusAccent = (status: string | null | undefined) =>
    status === 'ACCEPTED' ? c.success : status === 'REJECTED' ? c.destructive : c.mutedForeground;
  const statusIcon = (
    status: string | null | undefined
  ): React.ComponentProps<typeof Feather>['name'] =>
    status === 'ACCEPTED'
      ? 'check-circle'
      : status === 'REJECTED'
        ? 'x-circle'
        : status === 'WITHDRAWN'
          ? 'corner-up-left'
          : 'clock';

  /** A summary of ONE bid, rendered only from the fields it actually carries. */
  const bidSummary = (bid: BidResponse) => {
    // offered_price arrives as a NUMERIC STRING (Decimal) on the wire, so it is
    // parsed defensively — the docs' own example generator emits 300-digit values.
    const priceText = formatBidPrice(bid.offered_price);
    const eta = bidEtaParts(bid.eta_minutes);
    const statusKey = bidStatusLabelKey(bid.status);
    const submitted = formatDateTime(bid.created_at);
    // Only the stamp that belongs to THIS status — the docs' example fills all
    // three on a PENDING bid, which is exactly what must not be rendered.
    const stamp = bidStatusStamp(bid);
    const stampText = stamp ? formatDateTime(stamp.value) : null;
    const reason = bidRejectionReason(bid);
    const nextStepKey = bidNextStepKey(bid.status);
    return (
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={styles.cardHead}>
          <Text style={[styles.cardTitle, { color: c.text }]}>{t('jobd_bid_your_bid')}</Text>
          {statusKey ? (
            <View style={[styles.statusChip, { backgroundColor: c.muted, borderColor: statusAccent(bid.status) }]}>
              <Feather name={statusIcon(bid.status)} size={12} color={statusAccent(bid.status)} />
              <Text style={[styles.statusChipText, { color: statusAccent(bid.status) }]}>
                {t(statusKey)}
              </Text>
            </View>
          ) : null}
        </View>

        {priceText ? (
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>
              {t('jobd_bid_summary_price')}
            </Text>
            <Text style={[styles.rowValueStrong, { color: c.text }]}>{priceText}</Text>
          </View>
        ) : null}

        {eta ? (
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>
              {t('jobd_bid_summary_eta')}
            </Text>
            <Text style={[styles.rowValue, { color: c.text }]}>
              {eta.kind === 'now'
                ? t('jobd_bid_eta_now')
                : eta.kind === 'minutes'
                  ? t('jobd_bid_eta_min', { n: eta.minutes })
                  : t('jobd_bid_eta_hm', { h: eta.hours, m: eta.minutes })}
            </Text>
          </View>
        ) : null}

        {/* The pilot's proposed start(s) — parsed out of the stored message,
            whose technical line is never displayed. */}
        {(() => {
          const summary = proposedTimesSummary(
            parseProposedTimeLine(bid.message).arrivals,
            meridiem
          );
          if (!summary) return null;
          return (
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>
                {t('jobd_bid_arrival_title')}
              </Text>
              <Text style={[styles.rowValue, { color: c.text }]}>
                {summary.single ? t('bid_starts', { time: summary.text }) : summary.text}
              </Text>
            </View>
          );
        })()}

        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>
            {t('jobd_bid_summary_message')}
          </Text>
          <Text style={[styles.rowValue, { color: c.text }]}>
            {stripProposedTimeLine(bid.message).length > 0
              ? stripProposedTimeLine(bid.message)
              : t('jobd_bid_no_message')}
          </Text>
        </View>

        {submitted ? (
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>
              {t('jobd_bid_summary_submitted')}
            </Text>
            <Text style={[styles.rowValue, { color: c.text }]}>{submitted}</Text>
          </View>
        ) : null}

        {stamp && stampText ? (
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>
              {t(stamp.labelKey)}
            </Text>
            <Text style={[styles.rowValue, { color: c.text }]}>{stampText}</Text>
          </View>
        ) : null}

        {reason ? (
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>
              {t('jobd_bid_reject_reason')}
            </Text>
            <Text style={[styles.rowValue, { color: c.text }]}>{reason}</Text>
          </View>
        ) : null}

        {nextStepKey ? (
          <View style={[styles.nextStep, { borderTopColor: c.border }]}>
            <Text style={[styles.nextStepText, { color: c.mutedForeground }]}>
              {t(nextStepKey)}
            </Text>
          </View>
        ) : null}

        {/*
         * Edit bid (PUT /jobs/{job_id}/bids/{bid_id}) — offered ONLY while the
         * backend still reports this bid PENDING and the job's bidding window
         * open (lib/bid.canEditBid). Every other state keeps its own status
         * message and no form, so the provider is never invited to change a bid
         * the server would refuse.
         */}
        {canEditBid(bid, job, activeRole) ? (
          <TouchableOpacity
            style={[styles.editBtn, { borderColor: c.primary }]}
            onPress={() => openEdit(bid)}
            activeOpacity={0.85}
          >
            <Feather name="edit-2" size={14} color={c.primary} />
            <Text style={[styles.editBtnText, { color: c.primary }]}>{t('jobd_bid_edit')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  if (numericId === null) {
    return shell(
      t('jobd_bid_screen_title'),
      centered('alert-circle', t('jobd_unavailable_title'), t('jobd_unavailable_msg'))
    );
  }

  if (jobStatus === 'idle' || jobStatus === 'loading') {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <BrandedLoader size={44} />
      </View>
    );
  }

  // The job is gone, or this account is not allowed to see it at all. The
  // backend's own message is preferred when it sent one.
  if (jobStatus === 'notfound' || jobStatus === 'forbidden') {
    return shell(
      t('jobd_bid_screen_title'),
      centered('slash', t('jobd_unavailable_title'), serverMessage ?? t('jobd_unavailable_msg'))
    );
  }

  // Nothing usable to gate on: a bad id, an expired session or a failed read.
  // No form is offered, because bidding on an unknown job state is exactly how a
  // provider ends up with a 409 or a duplicate.
  if (jobStatus !== 'ready' || !job) {
    return shell(
      t('jobd_bid_screen_title'),
      centered('alert-circle', t('jobd_load_error'), t('jobd_load_error_sub'), {
        label: t('jobs_retry'),
        onPress: retry,
      })
    );
  }

  // The lookup is still unanswered. The loader is shown BEFORE the gates below:
  // otherwise a closed window would flash "bidding is closed" for a provider who
  // in fact has a bid on the job, and only swap it for the card a moment later.
  if (myBid === null) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <BrandedLoader size={44} />
      </View>
    );
  }

  // The bid state could not be established — this is NOT "no bid yet", so no
  // form is shown and a duplicate bid cannot be created by accident. The
  // backend's own text wins when it sent one, except for a 403, where the app's
  // copy states the situation rather than the rule (same rule as a 403 submit).
  if (myBid.state === 'error') {
    return shell(
      t('jobd_bid_screen_title'),
      centered(
        'wifi-off',
        t('jobd_bid_locked_title'),
        myBid.kind === 'forbidden' ? t('jobd_bid_locked_msg') : myBid.message ?? t('jobd_bid_locked_msg'),
        { label: t('jobs_retry'), onPress: () => void reloadMyBid() }
      )
    );
  }

  const canBid = canProviderSubmitBid(job, activeRole);
  const held = myBid.state === 'exists' ? myBid.bid : null;

  // The window is shut, this provider has already been picked, or the account is
  // in client mode: no form, and the reason is named rather than guessed.
  if (!held && !canBid) {
    const unassigned = job.assigned_provider_id == null;
    const stillOpen = biddingOpen && unassigned;
    return shell(
      t('jobd_bid_screen_title'),
      centered(
        'lock',
        stillOpen ? t('jobd_bid_unavailable_title') : t('jobd_bid_closed_title'),
        stillOpen ? t('jobd_bid_unavailable_msg') : t('jobd_bid_closed_msg'),
        { label: t('jobd_bid_close_cta'), onPress: () => router.back() }
      )
    );
  }

  /* ---------------------------------------------------------------- my bid */

  if (held) {
    const changedLabel = changedStatus ? bidStatusLabelKey(changedStatus) : null;

    /**
     * The Edit bid gates, all decided in lib/bid so the screen invents nothing:
     * nothing changed / invalid / saving / the status left PENDING while the
     * sheet was open — which LOCKS the form instead of dropping the work.
     */
    const editLocked = editDraft !== null && held.status !== 'PENDING';
    /**
     * "Did anything change" is asked at the level the wire uses: the price and
     * the provider's own words through lib/bid, and the WHOLE message (words +
     * time line) through lib/bidTimes. The eta is never compared — it is derived
     * from the arrivals and would drift with the clock on every render.
     */
    const editChanged =
      editDraft !== null &&
      (hasBidDraftChanged(
        {
          offered_price: held.offered_price,
          eta_minutes: bidDraftEtaMinutes(editDraft),
          message: stripProposedTimeLine(held.message),
        },
        editDraft
      ) ||
        hasBidMessageChanged(held.message, editDraft.message, editArrivals, meridiem));
    const editValid = editDraft !== null && isBidDraftValid(editDraft);
    /** A bid saved before this feature has no time yet — one is required now. */
    const editArrivalsReady = hasEveryArrival(editArrivals, tasks);
    const canSaveEdit =
      !!editDraft && editChanged && editValid && editArrivalsReady && !savingEdit && !editLocked;

    const editFieldChange = (apply: (draft: BidDraft) => BidDraft, clear: () => void) => {
      setEditDraft((draft) => (draft ? apply(draft) : draft));
      clear();
    };

    /**
     * Save. The values are re-validated here as well as through the disabled
     * button, so a rejected price never reaches the network; every failure keeps
     * the draft exactly as typed.
     */
    const saveEditNow = async () => {
      if (!editDraft || savingEdit || editLocked) return;
      setEditError(null);
      const priceResult = validateBidPrice(editDraft.price);
      const eta = etaMinutesForFirstArrival(editArrivals, tasks);
      const etaResult = validateEtaMinutes(String(eta));
      const wireMessage = composeBidMessage(editDraft.message, editArrivals, meridiem);
      const messageResult = validateBidMessage(wireMessage ?? '');
      const missing = firstMissingArrival(editArrivals, tasks);
      setEditPriceError(priceResult.ok ? null : t(priceResult.errorKey));
      setEditMessageError(messageResult.ok ? null : t(messageResult.errorKey));
      setEditArrivalError(
        missing === null ? null : t('jobd_bid_arrival_required', { n: missing })
      );
      if (!priceResult.ok || !etaResult.ok || !messageResult.ok || missing !== null) return;

      // The PUT body keeps the schema's three fields; only the message differs
      // from the draft (the line is added here, never typed by the pilot).
      const body = buildBidUpdateRequest({
        ...editDraft,
        etaHours: Math.floor(eta / 60),
        etaMinutes: eta % 60,
      });
      const outcome = await saveEditBid(held.id, { ...body, message: wireMessage });

      if (outcome.ok) {
        // The card already follows the PUT response (hooks/useMyBid); the sheet
        // closes on the same answer.
        closeEdit();
        showAlert({
          title: t('jobd_bid_edit_success_title'),
          message: t('jobd_bid_edit_success_msg'),
          icon: 'check-circle',
        });
        return;
      }

      if (outcome.kind === 'busy') return;
      if (outcome.kind === 'unauthorized') {
        router.replace('/(auth)/login' as any);
        return;
      }

      // 422 → the server's own message on the field it rejected (FastAPI
      // reports a body field as loc ["body", "<field>"], verified live).
      if (outcome.kind === 'invalid' && outcome.detail) {
        const priceMsg = bidFieldError(outcome.detail, 'offered_price');
        const etaMsg = bidFieldError(outcome.detail, 'eta_minutes');
        const messageMsg = bidFieldError(outcome.detail, 'message');
        setEditPriceError(priceMsg);
        setEditArrivalError(etaMsg);
        setEditMessageError(messageMsg);
        if (priceMsg || etaMsg || messageMsg) return;
      }

      if (outcome.kind === 'network') {
        showAlert({
          title: t('jobd_bid_offline_title'),
          message: t('jobd_edit_err_network'),
          icon: 'wifi-off',
        });
      }

      // A refusal means this screen's own gates are stale (the window closed,
      // the client picked someone, the bid is gone), so the job AND the bid are
      // re-read before the provider decides what to do next.
      if (shouldResyncAfterBidFailure(outcome.kind)) {
        void refetch();
        void refreshMyBid();
      }

      setEditError(bidUpdateFailureMessage(outcome, t));
    };

    /**
     * The spec's quick adjust, shown ONLY once the client has restarted the
     * bidding timer (JobResponse.timer_restart_count > 0, verified live). Unit
     * confirmed by the product owner: EURO amounts. A chip edits the price field
     * and never submits.
     */
    const editChips =
      editDraft && shouldOfferBidAdjust(job) ? (
        <View style={styles.chipWrap}>
          <Text style={[styles.chipHint, { color: c.mutedForeground }]}>
            {t('jobd_bid_adjust_hint')}
          </Text>
          <View style={styles.chipRow}>
            {BID_ADJUST_STEPS.map((delta) => {
              const chipDisabled =
                savingEdit || editLocked || !canApplyBidAdjust(editDraft.price, delta);
              return (
                <TouchableOpacity
                  key={delta}
                  style={[styles.chip, { borderColor: c.border, opacity: chipDisabled ? 0.5 : 1 }]}
                  disabled={chipDisabled}
                  activeOpacity={0.85}
                  onPress={() =>
                    editFieldChange(
                      (draft) => ({ ...draft, price: adjustBidPrice(draft.price, delta) }),
                      () => setEditPriceError(null)
                    )
                  }
                >
                  <Text style={[styles.chipText, { color: c.text }]}>
                    {formatAdjustChipLabel(delta, language)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null;

    const editSheet = (
      <BottomSheet
        visible={editDraft !== null}
        onClose={closeEdit}
        title={t('jobd_bid_edit_title')}
        footer={
          <View style={[styles.sheetFooter, { borderTopColor: c.border }]}>
            {editError ? (
              <Text style={[styles.sheetNote, { color: c.destructive }]}>{editError}</Text>
            ) : !editChanged && editDraft ? (
              <Text style={[styles.sheetNote, { color: c.mutedForeground }]}>
                {t('jobd_bid_edit_unchanged')}
              </Text>
            ) : null}
            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={[styles.retry, { borderColor: c.border, flex: 1 }]}
                onPress={closeEdit}
                disabled={savingEdit}
                activeOpacity={0.85}
              >
                <Text style={[styles.retryText, { color: c.text }]}>{t('jobd_bid_edit_cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.submit,
                  { backgroundColor: c.primary, flex: 1 },
                  (savingEdit || !canSaveEdit) && styles.submitBusy,
                ]}
                onPress={() => void saveEditNow()}
                disabled={savingEdit || !canSaveEdit}
                activeOpacity={0.85}
              >
                {savingEdit ? (
                  <ActivityIndicator size="small" color={c.primaryForeground} />
                ) : (
                  <Feather name="save" size={16} color={c.primaryForeground} />
                )}
                <Text style={[styles.submitText, { color: c.primaryForeground }]}>
                  {savingEdit ? t('jobd_bid_edit_saving') : t('jobd_bid_edit_save')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        }
      >
        {/* FIX (keyboard): edge-to-edge Android does not resize the window; the
            shared aware scroller keeps the focused field above the keyboard. */}
        {editDraft ? (
          <KeyboardAwareScrollViewCompat
            style={{ flex: 1 }}
            contentContainerStyle={styles.sheetBody}
            keyboardShouldPersistTaps="handled"
          >
              {editLocked ? (
                <View
                  style={[styles.lockNote, { borderColor: c.border, backgroundColor: c.muted }]}
                >
                  <Feather name="lock" size={14} color={c.mutedForeground} />
                  <Text style={[styles.lockNoteText, { color: c.mutedForeground }]}>
                    {t('jobd_bid_edit_locked')}
                  </Text>
                </View>
              ) : null}
              <BidFormFields
                price={editDraft.price}
                onPriceChange={(value) =>
                  editFieldChange(
                    (draft) => ({ ...draft, price: value }),
                    () => setEditPriceError(null)
                  )
                }
                priceError={editPriceError}
                arrivalSection={
                  <BidArrivalTimes
                    tasks={tasks}
                    arrivals={editArrivals}
                    onChange={(next) => {
                      setEditArrivals(next);
                      setEditArrivalError(null);
                      // Keep eta in step with the chosen times so the draft and
                      // the PUT body agree; the field itself is no longer shown.
                      const eta = etaMinutesForFirstArrival(next, tasks);
                      setEditDraft((draft) =>
                        draft
                          ? { ...draft, etaHours: Math.floor(eta / 60), etaMinutes: eta % 60 }
                          : draft
                      );
                    }}
                    error={editArrivalError}
                    disabled={savingEdit || editLocked}
                  />
                }
                message={editDraft.message}
                onMessageChange={(value) =>
                  editFieldChange(
                    (draft) => ({ ...draft, message: value }),
                    () => setEditMessageError(null)
                  )
                }
                messageError={editMessageError}
                messageLimit={editMessageRoom}
                disabled={savingEdit || editLocked}
                priceExtra={editChips}
              />
          </KeyboardAwareScrollViewCompat>
        ) : null}
      </BottomSheet>
    );

    return shell(
      t('jobd_bid_screen_title'),
      <>
      <ScrollView
        contentContainerStyle={styles.form}
        refreshControl={
          <RefreshControl
            refreshing={myBidRefreshing}
            onRefresh={() => void refreshMyBid()}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      >
        {deadline !== null ? (
          <CountdownTimer
            endsAt={deadline}
            urgency={job.is_urgent ? 'urgent' : 'regular'}
            onExpire={handleBiddingExpired}
          />
        ) : (
          // The window ended: the bid stays, the promise of "waiting for the
          // client" does not. Only the closed notice is shown — no Restart /
          // Convert buttons, which belong to other tasks.
          <View style={[styles.closedBanner, { backgroundColor: c.muted, borderColor: c.border }]}>
            <Feather name="lock" size={14} color={c.mutedForeground} />
            <Text style={[styles.closedText, { color: c.mutedForeground }]}>
              {t('jobd_bid_closed_title')}
            </Text>
          </View>
        )}

        {changedStatus && changedLabel ? (
          <Animated.View
            entering={FadeInDown.duration(260)}
            style={[
              styles.changeBanner,
              { backgroundColor: c.muted, borderColor: statusAccent(changedStatus) },
            ]}
          >
            <Feather name={statusIcon(changedStatus)} size={15} color={statusAccent(changedStatus)} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.changeTitle, { color: c.text }]}>
                {t('jobd_bid_status_updated')}
              </Text>
              <Text style={[styles.changeSub, { color: c.mutedForeground }]}>
                {t(changedLabel)}
              </Text>
            </View>
            <TouchableOpacity onPress={clearChangedStatus} hitSlop={8} activeOpacity={0.7}>
              <Feather name="x" size={15} color={c.mutedForeground} />
            </TouchableOpacity>
          </Animated.View>
        ) : null}

        {myBidRefreshFailed ? (
          <View style={[styles.refreshNotice, { backgroundColor: c.muted, borderColor: c.border }]}>
            <Feather name="alert-circle" size={12} color={c.mutedForeground} />
            <Text style={[styles.refreshNoticeText, { color: c.mutedForeground }]}>
              {t('jobd_bid_refresh_failed')}
            </Text>
          </View>
        ) : null}

        {bidSummary(held)}
        <TouchableOpacity
          style={[styles.stateBtn, { backgroundColor: c.primary, marginTop: 4 }]}
          onPress={() => router.back()}
        >
          <Text style={[styles.stateBtnText, { color: c.primaryForeground }]}>
            {t('jobd_bid_close_cta')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
      {editSheet}
      </>
    );
  }

  /* ------------------------------------------------------------------- form */

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      {header(t('jobd_bid_screen_title'))}
      {/* FIX (keyboard): edge-to-edge Android does not resize the window; the
          shared aware scroller keeps the focused field above the keyboard. */}
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
          {deadline !== null ? (
            <CountdownTimer
              endsAt={deadline}
              urgency={job.is_urgent ? 'urgent' : 'regular'}
              onExpire={handleBiddingExpired}
            />
          ) : null}

          {nearbyGone ? (
            <View
              style={[
                styles.closedBanner,
                { backgroundColor: c.destructiveLight, borderColor: c.destructive, alignItems: 'flex-start' },
              ]}
            >
              <Feather name="alert-circle" size={14} color={c.destructive} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.closedText, { color: c.destructive }]}>
                  {t('nearby_unavailable_title')}
                </Text>
                <Text style={[styles.closedText, { color: c.destructive }]}>
                  {t('nearby_unavailable_sub')}
                </Text>
              </View>
            </View>
          ) : null}

          {myBidRefreshFailed ? (
            <View style={[styles.refreshNotice, { backgroundColor: c.muted, borderColor: c.border }]}>
              <Feather name="alert-circle" size={12} color={c.mutedForeground} />
              <Text style={[styles.refreshNoticeText, { color: c.mutedForeground }]}>
                {t('jobd_bid_refresh_failed')}
              </Text>
            </View>
          ) : null}

          {/*
           * THE bid form fields — literally the same component the Edit bid
           * sheet renders, so a rule can never apply to one flow and not the
           * other. It owns no validation of its own: every value is checked by
           * the lib/bid validators above, before this screen sends anything.
           */}
          <BidFormFields
            price={price}
            onPriceChange={(value) => {
              setPrice(value);
              if (priceError) setPriceError(null);
            }}
            priceError={priceError}
            arrivalSection={
              <BidArrivalTimes
                tasks={tasks}
                arrivals={arrivals}
                onChange={(next) => {
                  setArrivals(next);
                  setArrivalError(null);
                }}
                error={arrivalError}
                disabled={bidSubmitting || nearbyGone}
              />
            }
            message={message}
            onMessageChange={(value) => {
              setMessage(value);
              if (messageError) setMessageError(null);
            }}
            messageError={messageError}
            messageLimit={messageRoom}
            disabled={bidSubmitting}
          />

          {formError ? (
            <View style={[styles.errorBox, { borderColor: c.destructive }]}>
              <Feather name="alert-circle" size={16} color={c.destructive} />
              <Text style={[styles.errorText, { color: c.destructive }]}>{formError}</Text>
            </View>
          ) : null}
      </KeyboardAwareScrollViewCompat>

      <KeyboardStickyView>
        {/* Sticky footer, inside the safe area, above the keyboard. */}
        <View
          style={[
            styles.footer,
            { backgroundColor: c.background, borderTopColor: c.border, paddingBottom: insets.bottom + 12 },
          ]}
        >
          {retryable && !bidSubmitting ? (
            <TouchableOpacity
              style={[styles.retry, { borderColor: c.border }]}
              onPress={() => void submit()}
              activeOpacity={0.85}
            >
              <Feather name="refresh-cw" size={15} color={c.text} />
              <Text style={[styles.retryText, { color: c.text }]}>{t('jobs_retry')}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[
              styles.submit,
              { backgroundColor: c.primary },
              (bidSubmitting || nearbyGone) && styles.submitBusy,
            ]}
            onPress={() => void submit()}
            disabled={bidSubmitting || nearbyGone}
            activeOpacity={0.85}
          >
            {bidSubmitting ? (
              <ActivityIndicator size="small" color={c.primaryForeground} />
            ) : (
              <Feather name="send" size={16} color={c.primaryForeground} />
            )}
            <Text style={[styles.submitText, { color: c.primaryForeground }]}>
              {bidSubmitting ? t('jobd_bid_submitting') : t('jobd_bid_submit')}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 17, flex: 1, textAlign: 'center' },
  form: { padding: 16, paddingBottom: 24, gap: 4 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10, marginTop: 12 },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 2,
  },
  cardTitle: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  statusChipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  rowLabel: { fontFamily: 'Manrope_400Regular', fontSize: 13, flex: 1 },
  rowValue: { fontFamily: 'Manrope_500Medium', fontSize: 13, flex: 1.4, textAlign: 'right' },
  rowValueStrong: { fontFamily: 'Manrope_700Bold', fontSize: 16, flex: 1.4, textAlign: 'right' },
  nextStep: { borderTopWidth: 1, paddingTop: 10, marginTop: 2 },
  nextStepText: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 18 },
  closedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  closedText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  changeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
  },
  changeTitle: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
  changeSub: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 1 },
  refreshNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginTop: 10,
  },
  refreshNoticeText: { fontFamily: 'Manrope_400Regular', fontSize: 11, flex: 1 },
  /* The bid form fields themselves live in components/BidFormFields, shared by
     the submit screen and the Edit bid sheet — no field style is duplicated. */
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
    marginTop: 4,
  },
  editBtnText: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
  chipWrap: { marginTop: 10 },
  chipHint: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
  sheetBody: { padding: 16, paddingBottom: 20 },
  sheetFooter: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  sheetActions: { flexDirection: 'row', gap: 10 },
  sheetNote: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16 },
  lockNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  lockNoteText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 17 },
  errorBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 16,
  },
  errorText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19 },
  footer: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 15,
  },
  submitBusy: { opacity: 0.7 },
  submitText: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
  },
  retryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  stateTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16, textAlign: 'center' },
  stateSub: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  stateBtn: { marginTop: 8, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22 },
  stateBtnText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
});
