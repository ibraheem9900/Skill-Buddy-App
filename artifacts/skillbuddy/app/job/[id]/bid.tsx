import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useRole } from '@/context/RoleContext';
import { useAppAlert } from '@/context/AlertModalContext';
import BackButton from '@/components/BackButton';
import BrandedLoader from '@/components/BrandedLoader';
import CountdownTimer from '@/components/CountdownTimer';
import { useJobDetail } from '@/hooks/useJobDetail';
import { useBidSubmit, type MyBidState } from '@/hooks/useBidSubmit';
import { biddingDeadline, formatDateTime } from '@/lib/jobDetail';
import {
  BID_MESSAGE_MAX_CHARS,
  bidEtaParts,
  bidFieldError,
  formatBidPrice,
  bidStatusLabelKey,
  bidSubmitFailureMessage,
  canProviderSubmitBid,
  isBiddingOpen,
  shouldResyncAfterBidFailure,
  validateBidMessage,
  validateBidPrice,
  validateEtaMinutes,
  type BidFieldName,
} from '@/lib/bid';
import type { BidResponse } from '@/types';

/**
 * Place Your Bid — POST /api/v1/jobs/{job_id}/bids (schema BidCreate).
 *
 * REACHED from Job Details → its provider-only "Place a Bid" / "Your Bid" card
 * (see the entry point there), which is gated on the active PROVIDER role plus a
 * job whose bidding window is still open. The id is the JOB id.
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
 * arrive. The spec conflict is recorded in the report for the backend owner.
 *
 * WHAT IS DELIBERATELY ABSENT:
 *   - the score fields, total_score and is_recommended. They are internal
 *     ranking data for the client's dashboard and admin, so nothing here reads
 *     them off a response;
 *   - Modify / Cancel Bid and the −5/−10/+5/+10 suggestions — later tasks;
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
  const { t } = useLanguage();
  const { activeRole } = useRole();
  const showAlert = useAppAlert();

  const numericId = /^\d+$/.test(id ?? '') ? Number(id) : null;

  const { status: jobStatus, job, serverMessage, retry, refetch } = useJobDetail(numericId);
  const { createBidForJob, bidSubmitting, loadMyBid } = useBidSubmit();

  const [myBid, setMyBid] = useState<MyBidState | null>(null);
  const [price, setPrice] = useState('');
  const [etaHours, setEtaHours] = useState(0);
  const [etaMinutes, setEtaMinutes] = useState(0);
  const [message, setMessage] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);
  const [etaError, setEtaError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  /** The bid we just created — adopted from the 201, never from a guess. */
  const [createdBid, setCreatedBid] = useState<BidResponse | null>(null);

  /**
   * The countdown anchor is captured ONCE: the deadline must not be recomputed
   * from a shrinking `remaining_bidding_seconds` every render.
   */
  const anchorRef = useRef(Date.now());
  const deadline = useMemo(
    () => (job ? biddingDeadline(job, anchorRef.current) : null),
    [job]
  );

  /* --------------------------------------------------------- /bids/mine load */

  const refreshMyBid = useCallback(async () => {
    if (numericId === null) return;
    setMyBid(null);
    const result = await loadMyBid(numericId);
    setMyBid(result);
  }, [numericId, loadMyBid]);

  useEffect(() => {
    void refreshMyBid();
  }, [refreshMyBid]);

  /** Reaching zero is not a client-side verdict — re-read the job. */
  const handleBiddingExpired = useCallback(() => {
    void refetch();
  }, [refetch]);

  /* ------------------------------------------------------------------ submit */

  const etaTotalMinutes = Math.min(etaHours * 60 + etaMinutes, 24 * 60);

  const validateAll = useCallback((): boolean => {
    const priceResult = validateBidPrice(price);
    const etaResult = validateEtaMinutes(String(etaTotalMinutes));
    const messageResult = validateBidMessage(message);

    setPriceError(priceResult.ok ? null : t(priceResult.errorKey));
    setEtaError(etaResult.ok ? null : t(etaResult.errorKey));
    setMessageError(messageResult.ok ? null : t(messageResult.errorKey));
    return priceResult.ok && etaResult.ok && messageResult.ok;
  }, [price, etaTotalMinutes, message, t]);

  const submit = useCallback(async () => {
    if (numericId === null || bidSubmitting) return;
    setFormError(null);
    setRetryable(false);
    if (!validateAll()) return;

    const outcome = await createBidForJob(numericId, price, String(etaTotalMinutes), message);

    if (outcome.ok) {
      // The summary is built from the 201 — status included. "PENDING" is never
      // hardcoded anywhere; an unrecognised status simply renders no chip.
      setCreatedBid(outcome.bid);
      setMyBid({ state: 'exists', bid: outcome.bid });
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
      setEtaError(etaMsg);
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
    etaTotalMinutes,
    message,
    showAlert,
    t,
    router,
    refetch,
    refreshMyBid,
  ]);

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

  /** A summary of ONE bid, rendered only from the fields it actually carries. */
  const bidSummary = (bid: BidResponse) => {
    // offered_price arrives as a NUMERIC STRING (Decimal) on the wire, so it is
    // parsed defensively — the docs' own example generator emits 300-digit values.
    const priceText = formatBidPrice(bid.offered_price);
    const eta = bidEtaParts(bid.eta_minutes);
    const statusKey = bidStatusLabelKey(bid.status);
    const submitted = formatDateTime(bid.created_at);
    return (
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.cardTitle, { color: c.text }]}>{t('jobd_bid_your_bid')}</Text>

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

        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>
            {t('jobd_bid_summary_message')}
          </Text>
          <Text style={[styles.rowValue, { color: c.text }]}>
            {bid.message && bid.message.trim().length > 0 ? bid.message : t('jobd_bid_no_message')}
          </Text>
        </View>

        {statusKey ? (
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>
              {t('jobd_bid_summary_status')}
            </Text>
            <Text style={[styles.rowValue, { color: c.text }]}>{t(statusKey)}</Text>
          </View>
        ) : null}

        {submitted ? (
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>
              {t('jobd_bid_summary_submitted')}
            </Text>
            <Text style={[styles.rowValue, { color: c.text }]}>{submitted}</Text>
          </View>
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

  const canBid = canProviderSubmitBid(job, activeRole);
  const biddingOpen = isBiddingOpen(job);
  const held = createdBid ?? (myBid?.state === 'exists' ? myBid.bid : null);

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

  /* ---------------------------------------------------------------- summary */

  if (held) {
    return shell(
      t('jobd_bid_screen_title'),
      <ScrollView contentContainerStyle={styles.form}>
        {deadline !== null ? (
          <CountdownTimer
            endsAt={deadline}
            urgency={job.is_urgent ? 'urgent' : 'regular'}
            onExpire={handleBiddingExpired}
          />
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
    );
  }

  // The bid state could not be established — this is NOT "no bid yet", so no
  // form is shown and a duplicate bid cannot be created by accident.
  if (myBid?.state === 'error') {
    return shell(
      t('jobd_bid_screen_title'),
      centered('wifi-off', t('jobd_bid_locked_title'), t('jobd_bid_locked_msg'), {
        label: t('jobs_retry'),
        onPress: () => void refreshMyBid(),
      })
    );
  }

  if (myBid === null) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <BrandedLoader size={44} />
      </View>
    );
  }

  /* ------------------------------------------------------------------- form */

  /**
   * One stepper: a −/+ pair around the current value. `onStep` receives the
   * DELTA, and the caller clamps — the buttons are also disabled at the ends so
   * the value can never leave the schema's 0..1440 window at all.
   */
  const stepper = (
    label: string,
    value: number,
    display: string,
    step: number,
    min: number,
    max: number,
    onStep: (delta: number) => void
  ) => (
    <View style={styles.stepper}>
      <Text style={[styles.stepperLabel, { color: c.mutedForeground }]}>{label}</Text>
      <View style={styles.stepperRow}>
        <TouchableOpacity
          style={[styles.stepBtn, { borderColor: c.border }]}
          onPress={() => onStep(-step)}
          disabled={value <= min || bidSubmitting}
        >
          <Feather name="minus" size={16} color={value <= min ? c.mutedForeground : c.text} />
        </TouchableOpacity>
        <Text style={[styles.stepValue, { color: c.text }]}>{display}</Text>
        <TouchableOpacity
          style={[styles.stepBtn, { borderColor: c.border }]}
          onPress={() => onStep(step)}
          disabled={value >= max || bidSubmitting}
        >
          <Feather name="plus" size={16} color={value >= max ? c.mutedForeground : c.text} />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      {header(t('jobd_bid_screen_title'))}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={24}
      >
        <ScrollView
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

          {/* Offered price — the final total the client pays, VAT included. */}
          <Text style={[styles.label, { color: c.text }]}>{t('jobd_bid_price_label')}</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: c.card,
                color: c.text,
                borderColor: priceError ? c.destructive : c.border,
              },
            ]}
            value={price}
            onChangeText={(v) => {
              setPrice(v);
              if (priceError) setPriceError(null);
            }}
            placeholder={t('jobd_bid_price_ph')}
            placeholderTextColor={c.mutedForeground}
            keyboardType="decimal-pad"
            editable={!bidSubmitting}
          />
          <Text style={[styles.hint, { color: priceError ? c.destructive : c.mutedForeground }]}>
            {priceError ?? t('jobd_bid_price_vat_note')}
          </Text>

          {/* Expected time → eta_minutes (the schema's "estimated time of arrival"). */}
          <Text style={[styles.label, { color: c.text }]}>{t('jobd_bid_eta_label')}</Text>
          <View style={styles.stepperRowWrap}>
            {stepper(
              t('jobd_bid_eta_hours_label'),
              etaHours,
              String(etaHours),
              1,
              0,
              24,
              (delta) => {
                const next = Math.max(0, Math.min(24, etaHours + delta));
                setEtaHours(next);
                // 24 h is the schema's ceiling, so no minutes can join it.
                if (next === 24) setEtaMinutes(0);
                if (etaError) setEtaError(null);
              }
            )}
            {stepper(
              t('jobd_bid_eta_minutes_label'),
              etaMinutes,
              String(etaMinutes),
              5,
              0,
              etaHours === 24 ? 0 : 55,
              (delta) => {
                const next = Math.max(0, Math.min(55, etaMinutes + delta));
                setEtaMinutes(next);
                if (etaError) setEtaError(null);
              }
            )}
          </View>
          <Text style={[styles.hint, { color: etaError ? c.destructive : c.mutedForeground }]}>
            {etaError ?? t('jobd_bid_eta_hint')}
          </Text>

          {/* Optional message, with a counter against the real limit. */}
          <Text style={[styles.label, { color: c.text }]}>{t('jobd_bid_message_label')}</Text>
          <TextInput
            style={[
              styles.input,
              styles.textarea,
              {
                backgroundColor: c.card,
                color: c.text,
                borderColor: messageError ? c.destructive : c.border,
              },
            ]}
            value={message}
            onChangeText={(v) => {
              setMessage(v);
              if (messageError) setMessageError(null);
            }}
            placeholder={t('jobd_bid_message_ph')}
            placeholderTextColor={c.mutedForeground}
            multiline
            textAlignVertical="top"
            maxLength={BID_MESSAGE_MAX_CHARS}
            editable={!bidSubmitting}
          />
          <View style={styles.metaRow}>
            <Text
              style={[styles.hint, { color: messageError ? c.destructive : c.mutedForeground }]}
            >
              {messageError ?? t('jobd_bid_message_optional')}
            </Text>
            <Text style={[styles.counter, { color: c.mutedForeground }]}>
              {message.length}/{BID_MESSAGE_MAX_CHARS}
            </Text>
          </View>

          {formError ? (
            <View style={[styles.errorBox, { borderColor: c.destructive }]}>
              <Feather name="alert-circle" size={16} color={c.destructive} />
              <Text style={[styles.errorText, { color: c.destructive }]}>{formError}</Text>
            </View>
          ) : null}
        </ScrollView>

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
            style={[styles.submit, { backgroundColor: c.primary }, bidSubmitting && styles.submitBusy]}
            onPress={() => void submit()}
            disabled={bidSubmitting}
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
      </KeyboardAvoidingView>
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
  cardTitle: { fontFamily: 'Manrope_700Bold', fontSize: 15, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  rowLabel: { fontFamily: 'Manrope_400Regular', fontSize: 13, flex: 1 },
  rowValue: { fontFamily: 'Manrope_500Medium', fontSize: 13, flex: 1.4, textAlign: 'right' },
  rowValueStrong: { fontFamily: 'Manrope_700Bold', fontSize: 16, flex: 1.4, textAlign: 'right' },
  label: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginTop: 18, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
  },
  textarea: { minHeight: 96 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16, marginTop: 6 },
  stepperRowWrap: { flexDirection: 'row', gap: 12 },
  stepper: { flex: 1 },
  stepperLabel: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginBottom: 6 },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { fontFamily: 'Manrope_700Bold', fontSize: 18, minWidth: 40, textAlign: 'center' },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  counter: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
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
