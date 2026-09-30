import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import { BID_PROVIDERS, MOCK_BIDS, MOCK_JOBS } from '@/data/mockData';
import { calculateProviderScore } from '@/lib/scoring';
import CountdownTimer from '@/components/CountdownTimer';
import BidCard from '@/components/BidCard';
import EmptyState from '@/components/EmptyState';
import BrandedLoader from '@/components/BrandedLoader';
import { useAppAlert } from '@/context/AlertModalContext';
import { useJobDetail } from '@/hooks/useJobDetail';
import { usePublishJob } from '@/hooks/usePublishJob';
import { useRestartJobTimer } from '@/hooks/useRestartJobTimer';
import { useConvertJobToRegular } from '@/hooks/useConvertJobToRegular';
import { useConvertJobToUrgent } from '@/hooks/useConvertJobToUrgent';
import { useAssignProvider } from '@/hooks/useAssignProvider';
import { useConfirmPayment } from '@/hooks/useConfirmPayment';
import { useStartJob } from '@/hooks/useStartJob';
import { useCompleteJob } from '@/hooks/useCompleteJob';
import { useProviderCancelJob } from '@/hooks/useProviderCancelJob';
import { useRole } from '@/context/RoleContext';
import { useAuth } from '@/context/AuthContext';
import { jobStatusLabelKey, parseExpectedHours } from '@/lib/jobList';
import { isDraftJob, publishErrorKey } from '@/lib/jobPublish';
import { canAddJobAddress } from '@/lib/jobAddress';
import { canClientCancelJob } from '@/lib/jobCancel';
import {
  canProviderCancelJob,
  isProviderCancelNotAllowed,
  isProviderCancelUnauthorized,
  providerCancelFailureMessage,
  providerCancelResolvedAfterResync,
  providerCancelSuccessMessage,
  shouldResyncAfterProviderCancelFailure,
} from '@/lib/providerCancel';
import { canDeclineJob } from '@/lib/providerDecline';
import { canPauseJob } from '@/lib/jobPause';
import { canProviderPauseJob } from '@/lib/providerPause';
import { canReportBlocker } from '@/lib/jobBlocker';
import { canAddJobAttachment } from '@/lib/jobAttachment';
import { classifyMediaType, hasUsableUrl } from '@/lib/serviceMedia';
import { canUpdateJobAddress, jobHasAddress } from '@/lib/jobAddressUpdate';
import { isRestartNotAllowed, restartTimerFailureMessage } from '@/lib/jobRestartTimer';
import {
  canConvertJobToRegular,
  canConvertJobToUrgent,
  convertToRegularFailureMessage,
  convertToUrgentFailureMessage,
  isConvertNotAllowed,
  isConvertUnauthorized,
  shouldResyncAfterConvertFailure,
} from '@/lib/jobConvert';
import {
  assignProviderFailureMessage,
  canAssignProvider,
  isAssignNotAllowed,
  isAssignUnauthorized,
  isValidProviderId,
  shouldResyncAfterAssignFailure,
} from '@/lib/jobAssign';
import {
  canConfirmPayment,
  confirmPaymentFailureMessage,
  isPaymentNotAllowed,
  isPaymentUnauthorized,
  paymentResolvedAfterResync,
  shouldResyncAfterPaymentFailure,
} from '@/lib/jobPayment';
import {
  canStartJob,
  isStartNotAllowed,
  isStartUnauthorized,
  shouldResyncAfterStartFailure,
  startJobFailureMessage,
  startResolvedAfterResync,
} from '@/lib/jobStart';
import {
  canCompleteJob,
  completeJobFailureMessage,
  completeResolvedAfterResync,
  isCompleteNotAllowed,
  isCompleteUnauthorized,
  shouldResyncAfterCompleteFailure,
} from '@/lib/jobComplete';
import {
  JOB_ACTION_LABEL_KEY,
  biddingDeadline,
  formatDate,
  formatDateTime,
  isJobCancelledStatus,
  isJobCompleted,
  isJobPausedStatus,
  isProviderAssigned,
  milestoneStatusLabelKey,
  parseIsoDate,
  visibleJobActions,
  type JobActionId,
} from '@/lib/jobDetail';
import { sanitizeRichText } from '@/lib/sanitizeRichText';
import type { Bid, BidProvider } from '@/types';

type SortMode = 'recommended' | 'lowPrice' | 'highRating' | 'distance' | 'badge';

function makeMockBid(jobId: string, provider: BidProvider): Bid {
  const basePrice = 40 + Math.round(Math.random() * 40);
  return {
    id: `bid_${jobId}_${provider.id}_${Date.now()}`,
    jobId,
    provider,
    price: basePrice,
    eta: `${15 + Math.round(Math.random() * 45)} min`,
    createdAt: Date.now(),
    score: calculateProviderScore(provider).total,
  };
}

export default function BiddingDashboardScreen() {
  // `providerId` is optional and only ever comes from the offers/bids list the
  // client picked a provider on (see the Assign Provider block below).
  const { id, providerId: providerIdParam } = useLocalSearchParams<{
    id: string;
    providerId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const showAlert = useAppAlert();

  // A NUMERIC id is a server job (navigated to as `/job/<id>`); the mock
  // catalogue uses 'j1'/'j2' and keeps the local bidding dashboard below,
  // untouched. The list card carries only the LIGHT summary, so the detail
  // is fetched here in full — never seeded from the list row.
  const numericId = /^\d+$/.test(id ?? '') ? Number(id) : null;
  const isServer = numericId !== null;
  const {
    status: detailStatus,
    job: serverJob,
    serverMessage,
    retry: retryServerJob,
    refetch: refetchServerJob,
    applyJob: applyServerJob,
  } = useJobDetail(isServer ? numericId : null);

  // PART 5: refetch whenever the screen regains focus, so returning from any
  // other screen never leaves stale data on display. This doubles as the
  // initial load; `refetch` only shows the full-screen loader when there is
  // nothing cached to render, so a focus refresh never blanks the view.
  useFocusEffect(
    useCallback(() => {
      if (!isServer) return;
      void refetchServerJob();
    }, [isServer, refetchServerJob])
  );

  // ── Publish a DRAFT job (POST /api/v1/jobs/{job_id}/publish) ─────────────
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { publish, publishing } = usePublishJob();

  // A 401 is only observable here AFTER the shared client refreshed the token
  // and replayed once; if that refresh failed the session has already been
  // cleared. Server jobs then belong to nobody, so send the user to login
  // rather than leaving a screen that can neither load nor publish. Mock
  // 'j1'/'j2' jobs are deliberately unaffected.
  useEffect(() => {
    if (!isServer || authLoading) return;
    if (!isAuthenticated) router.replace('/(auth)/login' as any);
  }, [isServer, authLoading, isAuthenticated, router]);

  const doPublish = useCallback(async () => {
    if (numericId === null) return;
    const outcome = await publish(numericId);

    if (outcome.ok) {
      // The server's own object replaces ours: status, is_bidding_open and the
      // bidding window all come from the response, so the countdown starts
      // from the real remaining_bidding_seconds / bidding_ends_at.
      applyServerJob(outcome.job);
      showAlert({
        title: t('post_publish_title'),
        message: t('post_publish_msg'),
        icon: 'check-circle',
      });
      return;
    }

    // A publish is already running — the caller must not treat this as an error.
    if (outcome.kind === 'busy') return;
    if (outcome.kind === 'unauthorized') {
      router.replace('/(auth)/login' as any);
      return;
    }

    // The job stays DRAFT (nothing local was touched) and the button stays
    // enabled, so the user can simply try again.
    showAlert({
      title: t('pub_err_title'),
      // The backend's own readable text wins when it sent one.
      message: outcome.message ?? t(publishErrorKey(outcome.kind)),
      icon: 'alert-triangle',
    });
  }, [numericId, publish, applyServerJob, showAlert, t, router]);

  // Publishing opens bidding and is not reversible from here, so it always
  // goes through an explicit confirmation.
  const confirmPublish = useCallback(() => {
    if (publishing) return;
    showAlert({
      title: t('pub_confirm_title'),
      message: t('pub_confirm_msg'),
      icon: 'radio',
      buttons: [
        { text: t('pub_confirm_cta'), onPress: () => void doPublish() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [publishing, showAlert, t, doPublish]);

  // ── Restart the bidding timer (POST /api/v1/jobs/{job_id}/restart-timer) ─
  // The action is only offered while the BACKEND's can_restart_timer is true
  // (see visibleJobActions below), so the restart limit is enforced by the
  // server's own flag — never by counting restarts on the client.
  // (`requestRestartTimer` is the server call; the mock catalogue further down
  // keeps its own local `restartTimer` and is deliberately untouched.)
  const { restartTimer: requestRestartTimer, restarting } = useRestartJobTimer();

  const doRestartTimer = useCallback(async () => {
    if (numericId === null) return;
    const outcome = await requestRestartTimer(numericId);

    if (outcome.ok) {
      // The server's own job replaces ours: the new bidding_ends_at,
      // remaining_bidding_seconds, timer_restart_count and the re-evaluated
      // can_restart_timer are ALL read from the response. Nothing is incremented
      // or recomputed here, and the countdown re-anchors to the new deadline.
      applyServerJob(outcome.job);
      showAlert({
        title: t('jobd_restart_success_title'),
        // The backend's own message wins when it sent one.
        message: outcome.message ?? t('jobd_restart_success_msg'),
        icon: 'refresh-cw',
      });
      return;
    }

    // A restart is already running — the caller must not report it as an error.
    if (outcome.kind === 'busy') return;
    if (outcome.kind === 'unauthorized') {
      router.replace('/(auth)/login' as any);
      return;
    }

    // The job and the running countdown are left EXACTLY as they were on any
    // failure, so retrying is always safe.
    if (isRestartNotAllowed(outcome.kind)) {
      // Distinct copy for the "not allowed right now" case instead of a generic
      // error, since that is a different kind of outcome for the user.
      showAlert({
        title: t('jobd_restart_limit_title'),
        message: outcome.message ?? t('jobd_restart_limit_msg'),
        icon: 'slash',
      });
      return;
    }

    showAlert({
      title: t('jobd_restart_err_title'),
      message: restartTimerFailureMessage(outcome, t),
      icon: 'alert-triangle',
      buttons: [
        { text: t('jobs_retry'), onPress: () => void doRestartTimer() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [numericId, requestRestartTimer, applyServerJob, showAlert, t, router]);

  // Restarting moves the bidding deadline, so it is confirmed first — the same
  // pattern the Publish action uses for its one-shot, not-trivial action.
  const confirmRestartTimer = useCallback(() => {
    if (restarting) return;
    showAlert({
      title: t('jobd_restart_confirm_title'),
      message: t('jobd_restart_confirm_msg'),
      icon: 'refresh-cw',
      buttons: [
        { text: t('jobd_restart_confirm_cta'), onPress: () => void doRestartTimer() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [restarting, showAlert, t, doRestartTimer]);

  // ── Convert an URGENT job back to REGULAR ─────────────────────────────────
  // (POST /api/v1/jobs/{job_id}/convert-to-regular.) Same shape of action as
  // Restart Timer: protected, body-less, returns { message, job }.
  // (`requestConvertToRegular` is the server call; the mock catalogue further down
  // keeps its own local `convertToRegular` and is deliberately untouched.)
  const { convertToRegular: requestConvertToRegular, converting } = useConvertJobToRegular();

  const doConvertToRegular = useCallback(async () => {
    if (numericId === null) return;
    const outcome = await requestConvertToRegular(numericId);

    if (outcome.ok) {
      // The WHOLE job from the response replaces ours — request_type / is_urgent
      // plus every derived flag (is_bidding_open, can_restart_timer,
      // can_convert_to_urgent, remaining_bidding_seconds). Nothing is patched
      // locally, and the timer/terms re-render from the response's own fields.
      applyServerJob(outcome.job);
      showAlert({
        title: t('jobd_convert_success_title'),
        // The backend's own message wins when it sent one.
        message: outcome.message ?? t('jobd_convert_success_msg'),
        icon: 'clock',
      });
      return;
    }

    // A conversion is already running — not an error.
    if (outcome.kind === 'busy') return;
    if (isConvertUnauthorized(outcome.kind)) {
      router.replace('/(auth)/login' as any);
      return;
    }

    // A refusal means the flags we gated on are stale (that is why the server said
    // no), so re-read the job. Nothing is patched optimistically in the meantime.
    if (shouldResyncAfterConvertFailure(outcome.kind)) {
      void refetchServerJob();
    }

    if (isConvertNotAllowed(outcome.kind)) {
      showAlert({
        title: t('jobd_convert_notallowed_title'),
        message: convertToRegularFailureMessage(outcome, t),
        icon: 'slash',
      });
      return;
    }

    showAlert({
      title: t('jobd_convert_err_title'),
      message: convertToRegularFailureMessage(outcome, t),
      icon: 'alert-triangle',
      buttons: [
        { text: t('jobs_retry'), onPress: () => void doConvertToRegular() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [numericId, requestConvertToRegular, applyServerJob, showAlert, t, router, refetchServerJob]);

  // Converting changes the job's terms (urgency, and with it the bidding window the
  // backend applies), so it is confirmed first — the same pattern Publish and
  // Restart Timer use.
  const confirmConvertToRegular = useCallback(() => {
    if (converting) return;
    showAlert({
      title: t('jobd_convert_confirm_title'),
      message: t('jobd_convert_confirm_msg'),
      icon: 'clock',
      buttons: [
        { text: t('jobd_convert_confirm_cta'), onPress: () => void doConvertToRegular() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [converting, showAlert, t, doConvertToRegular]);

  // ── Convert a REGULAR job to URGENT ───────────────────────────────────────
  // (POST /api/v1/jobs/{job_id}/convert-to-urgent.) The exact reverse of the
  // conversion above: same shape of action, opposite flag, its own copy.
  const { convertToUrgent: requestConvertToUrgent, converting: convertingToUrgent } =
    useConvertJobToUrgent();

  const doConvertToUrgent = useCallback(async () => {
    if (numericId === null) return;
    const outcome = await requestConvertToUrgent(numericId);

    if (outcome.ok) {
      // The WHOLE job from the response replaces ours — request_type / is_urgent
      // plus every derived flag AND the bidding window the backend applied for the
      // new urgency (bidding_ends_at / remaining_bidding_seconds). Nothing about the
      // new terms is computed here: convert-to-urgent's effect on timing and fees is
      // not documented, so the response's own fields are what the screen renders.
      applyServerJob(outcome.job);
      showAlert({
        title: t('jobd_urgent_success_title'),
        // The backend's own message wins when it sent one.
        message: outcome.message ?? t('jobd_urgent_success_msg'),
        icon: 'zap',
      });
      return;
    }

    // A conversion is already running — not an error.
    if (outcome.kind === 'busy') return;
    if (isConvertUnauthorized(outcome.kind)) {
      router.replace('/(auth)/login' as any);
      return;
    }

    // A refusal means the flags we gated on are stale (that is why the server said
    // no), so re-read the job. Nothing is patched optimistically in the meantime.
    if (shouldResyncAfterConvertFailure(outcome.kind)) {
      void refetchServerJob();
    }

    if (isConvertNotAllowed(outcome.kind)) {
      showAlert({
        title: t('jobd_urgent_notallowed_title'),
        message: convertToUrgentFailureMessage(outcome, t),
        icon: 'slash',
      });
      return;
    }

    showAlert({
      title: t('jobd_urgent_err_title'),
      message: convertToUrgentFailureMessage(outcome, t),
      icon: 'alert-triangle',
      buttons: [
        { text: t('jobs_retry'), onPress: () => void doConvertToUrgent() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [numericId, requestConvertToUrgent, applyServerJob, showAlert, t, router, refetchServerJob]);

  // Converting to urgent changes the job's terms (urgency, and the bidding window
  // the backend applies), so it is confirmed first — the same pattern Publish,
  // Restart Timer and Convert to Regular use.
  const confirmConvertToUrgent = useCallback(() => {
    if (convertingToUrgent) return;
    showAlert({
      title: t('jobd_urgent_confirm_title'),
      message: t('jobd_urgent_confirm_msg'),
      icon: 'zap',
      buttons: [
        { text: t('jobd_urgent_confirm_cta'), onPress: () => void doConvertToUrgent() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [convertingToUrgent, showAlert, t, doConvertToUrgent]);

  // ── Assign a provider to this job ─────────────────────────────────────────
  // (POST /api/v1/jobs/{job_id}/assign-provider.) The provider id is NOT invented
  // here: it arrives on the route (`/job/{id}?providerId=<id>`) from the screen
  // that lists the job's offers — GET /api/v1/jobs/{job_id}/bids returns
  // BidResponse.provider.id. That list is not connected yet (a separate task), so
  // until it is, the action only appears when a real id is handed in.
  const rawProviderId = Array.isArray(providerIdParam) ? providerIdParam[0] : providerIdParam;
  const providerId = /^\d+$/.test(rawProviderId ?? '') ? Number(rawProviderId) : null;
  const { assignProvider, assigning } = useAssignProvider();

  const doAssignProvider = useCallback(async () => {
    if (numericId === null || !isValidProviderId(providerId)) return;
    const outcome = await assignProvider(numericId, providerId);

    if (outcome.ok) {
      // The 200 body IS the job (no { message, job } envelope on this endpoint), so
      // it is adopted directly: assigned_provider_id / assigned_at plus everything
      // that changes with them — status, is_bidding_open, is_editable, the can_*
      // flags and therefore the action buttons and the bidding timer.
      applyServerJob(outcome.job);
      showAlert({
        title: t('jobd_assign_success_title'),
        message: t('jobd_assign_success_msg', { id: outcome.providerId }),
        icon: 'user-check',
      });
      return;
    }

    // An assignment is already running — not an error.
    if (outcome.kind === 'busy') return;
    if (isAssignUnauthorized(outcome.kind)) {
      router.replace('/(auth)/login' as any);
      return;
    }

    // A refusal means the state we gated on is stale (already assigned is the likely
    // reason), so re-read the job. Nothing local was changed in the meantime.
    if (shouldResyncAfterAssignFailure(outcome.kind)) {
      void refetchServerJob();
    }

    if (isAssignNotAllowed(outcome.kind)) {
      showAlert({
        title: t('jobd_assign_notallowed_title'),
        message: assignProviderFailureMessage(outcome, t),
        icon: 'slash',
      });
      return;
    }

    // 422 (e.g. an unknown/ineligible provider) — the backend's own message wins,
    // so the client sees exactly why the provider was rejected.
    showAlert({
      title: t('jobd_assign_err_title'),
      message: assignProviderFailureMessage(outcome, t),
      icon: 'alert-triangle',
      buttons: [
        { text: t('jobs_retry'), onPress: () => void doAssignProvider() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [numericId, providerId, assignProvider, applyServerJob, showAlert, t, router, refetchServerJob]);

  // Assigning hands the job to a provider and closes bidding — significant and not
  // reversible from here, so it is confirmed first.
  const confirmAssignProvider = useCallback(() => {
    if (assigning) return;
    showAlert({
      title: t('jobd_assign_confirm_title'),
      message: t('jobd_assign_confirm_msg', { id: providerId ?? 0 }),
      icon: 'user-plus',
      buttons: [
        { text: t('jobd_assign_confirm_cta'), onPress: () => void doAssignProvider() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [assigning, showAlert, t, providerId, doAssignProvider]);

  // ── Confirm payment for this job ───────────────────────────────────────────
  // (POST /api/v1/jobs/{job_id}/confirm-payment.) NO body is sent: the live spec
  // declares only the job_id path parameter and no amount / payment method is
  // accepted, so none is invented here. The action is offered only while the
  // backend's own status is PAYMENT_PENDING (there is no can_confirm_payment flag),
  // and the 200 body IS the job — no { message, job } envelope — so it is adopted
  // directly and the countdown re-anchors to the new bidding window by itself.
  const { confirmPayment, confirming } = useConfirmPayment();

  const doConfirmPayment = useCallback(async () => {
    if (numericId === null) return;
    const outcome = await confirmPayment(numericId);

    if (outcome.ok) {
      applyServerJob(outcome.job);
      showAlert({
        title: t('jobd_pay_success_title'),
        message: t('jobd_pay_success_msg'),
        icon: 'check-circle',
      });
      return;
    }

    // A confirmation is already running — not an error.
    if (outcome.kind === 'busy') return;
    if (isPaymentUnauthorized(outcome.kind)) {
      router.replace('/(auth)/login' as any);
      return;
    }

    // A lost response is NOT a blind retry: money is involved, so the job is
    // re-read first. If it is no longer PAYMENT_PENDING the confirmation already
    // went through — say so instead of offering a Retry that would fire a second
    // confirmation at an already-paid job.
    if (outcome.kind === 'network') {
      const refetched = await refetchServerJob();
      if (paymentResolvedAfterResync(refetched)) {
        showAlert({
          title: t('jobd_pay_already_title'),
          message: t('jobd_pay_already_msg'),
          icon: 'info',
        });
        return;
      }
    }

    // A refusal means the status this screen gated on is stale (already confirmed
    // is the likely reason), so re-sync. Nothing local was changed meanwhile.
    if (shouldResyncAfterPaymentFailure(outcome.kind)) {
      void refetchServerJob();
    }

    if (isPaymentNotAllowed(outcome.kind)) {
      showAlert({
        title: t('jobd_pay_notallowed_title'),
        message: confirmPaymentFailureMessage(outcome, t),
        icon: 'slash',
      });
      return;
    }

    // 422 / 403 / 404 / 5xx / network — the backend's own message wins when it
    // sent one, so the client reads exactly why the payment was rejected.
    showAlert({
      title: t('jobd_pay_err_title'),
      message: confirmPaymentFailureMessage(outcome, t),
      icon: 'alert-triangle',
      buttons: [
        { text: t('jobs_retry'), onPress: () => void doConfirmPayment() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [numericId, confirmPayment, applyServerJob, showAlert, t, router, refetchServerJob]);

  // This action moves money, so it is confirmed first and can never fire twice
  // (the button is disabled while in flight and the hook rejects a second call).
  const confirmConfirmPayment = useCallback(() => {
    if (confirming) return;
    showAlert({
      title: t('jobd_pay_confirm_title'),
      message: t('jobd_pay_confirm_msg'),
      icon: 'credit-card',
      buttons: [
        { text: t('jobd_pay_confirm_cta'), onPress: () => void doConfirmPayment() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [confirming, showAlert, t, doConfirmPayment]);

  // ── Start the job (PROVIDER only) ──────────────────────────────────────────
  // (POST /api/v1/jobs/{job_id}/start.) NO body is sent — the live spec declares
  // only the job_id path parameter. This is the provider's action (see
  // app/job/[id]/track.tsx, where start sits behind `isProvider`, between "I've
  // arrived" and "Mark as done"), so it is gated on the active role AND on the job
  // still sitting in PROVIDER_ASSIGNED — the one lifecycle status that means
  // "provider assigned, payment settled, work not started" (there is no
  // can_start_job flag). The 200 IS the job, so it is adopted directly.
  const { activeRole } = useRole();
  const { startJob, starting } = useStartJob();

  const doStartJob = useCallback(async () => {
    if (numericId === null) return;
    const outcome = await startJob(numericId);

    if (outcome.ok) {
      applyServerJob(outcome.job);
      showAlert({
        title: t('jobd_start_success_title'),
        message: t('jobd_start_success_msg'),
        icon: 'play-circle',
      });
      return;
    }

    // A start is already running — not an error.
    if (outcome.kind === 'busy') return;
    if (isStartUnauthorized(outcome.kind)) {
      router.replace('/(auth)/login' as any);
      return;
    }

    // A lost response is NOT a blind retry: the job is re-read first and, if it has
    // left the startable state, the request is treated as already carried out rather
    // than offered again (a second start is what the backend rejects).
    if (outcome.kind === 'network') {
      const refetched = await refetchServerJob();
      if (startResolvedAfterResync(refetched)) {
        showAlert({
          title: t('jobd_start_moved_title'),
          message: t('jobd_start_moved_msg'),
          icon: 'info',
        });
        return;
      }
    }

    // A refusal means the state we gated on is stale (already started is the likely
    // reason), so re-read the job. Nothing local was changed in the meantime.
    if (shouldResyncAfterStartFailure(outcome.kind)) {
      void refetchServerJob();
    }

    if (isStartNotAllowed(outcome.kind)) {
      showAlert({
        title: t('jobd_start_notallowed_title'),
        message: startJobFailureMessage(outcome, t),
        icon: 'slash',
      });
      return;
    }

    // 422 / 403 / 404 / 5xx / network — the backend's own message wins when it sent
    // one (e.g. "you are not the assigned provider"), so it reads exactly as sent.
    showAlert({
      title: t('jobd_start_err_title'),
      message: startJobFailureMessage(outcome, t),
      icon: 'alert-triangle',
      buttons: [
        { text: t('jobs_retry'), onPress: () => void doStartJob() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [numericId, startJob, applyServerJob, showAlert, t, router, refetchServerJob]);

  // Starting begins the work and is not undone from here, so it is confirmed first
  // and can never fire twice (the button is disabled while in flight and the hook
  // rejects a second call).
  const confirmStartJob = useCallback(() => {
    if (starting) return;
    showAlert({
      title: t('jobd_start_confirm_title'),
      message: t('jobd_start_confirm_msg'),
      icon: 'play-circle',
      buttons: [
        { text: t('jobd_start_confirm_cta'), onPress: () => void doStartJob() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [starting, showAlert, t, doStartJob]);

  // ── Mark the job done (PROVIDER only) ──────────────────────────────────────
  // (POST /api/v1/jobs/{job_id}/complete.) NO body is sent — the live spec declares
  // only the job_id path parameter, so nothing (`completed_at`, a rating, a review) is
  // invented. This is the provider's action (app/job/[id]/track.tsx gates "Mark as
  // Done" behind `isProvider` at `in_progress`, and its own copy tells the client it
  // will be asked to review afterwards), so it is gated on the active role AND on the
  // job still being IN_PROGRESS — the state Start Job produces. The 200 IS the job,
  // so it is adopted directly and the follow-up review is left to its own task.
  const { completeJob, completing } = useCompleteJob();

  const doCompleteJob = useCallback(async () => {
    if (numericId === null) return;
    const outcome = await completeJob(numericId);

    if (outcome.ok) {
      applyServerJob(outcome.job);
      showAlert({
        title: t('jobd_complete_success_title'),
        message: t('jobd_complete_success_msg'),
        icon: 'check-circle',
      });
      return;
    }

    // A completion is already running — not an error.
    if (outcome.kind === 'busy') return;
    if (isCompleteUnauthorized(outcome.kind)) {
      router.replace('/(auth)/login' as any);
      return;
    }

    // A lost response is NOT a blind retry: the job is re-read first and, if it has
    // left the completable state, the request is treated as already carried out rather
    // than offered again (a second completion is what the backend rejects).
    if (outcome.kind === 'network') {
      const refetched = await refetchServerJob();
      if (completeResolvedAfterResync(refetched)) {
        showAlert({
          title: t('jobd_complete_moved_title'),
          message: t('jobd_complete_moved_msg'),
          icon: 'info',
        });
        return;
      }
    }

    // A refusal means the state we gated on is stale (already completed is the likely
    // reason), so re-read the job. Nothing local was changed in the meantime.
    if (shouldResyncAfterCompleteFailure(outcome.kind)) {
      void refetchServerJob();
    }

    if (isCompleteNotAllowed(outcome.kind)) {
      showAlert({
        title: t('jobd_complete_notallowed_title'),
        message: completeJobFailureMessage(outcome, t),
        icon: 'slash',
      });
      return;
    }

    // 422 / 403 / 404 / 5xx / network — the backend's own message wins when it sent
    // one (e.g. "you are not the assigned provider"), so it reads exactly as sent.
    showAlert({
      title: t('jobd_complete_err_title'),
      message: completeJobFailureMessage(outcome, t),
      icon: 'alert-triangle',
      buttons: [
        { text: t('jobs_retry'), onPress: () => void doCompleteJob() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [numericId, completeJob, applyServerJob, showAlert, t, router, refetchServerJob]);

  // Finishing the work is not undone from here, so it is confirmed first and can never
  // fire twice (the button is disabled while in flight and the hook rejects a second
  // call).
  const confirmCompleteJob = useCallback(() => {
    if (completing) return;
    showAlert({
      title: t('jobd_complete_confirm_title'),
      message: t('jobd_complete_confirm_msg'),
      icon: 'check-circle',
      buttons: [
        { text: t('jobd_complete_confirm_cta'), onPress: () => void doCompleteJob() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [completing, showAlert, t, doCompleteJob]);

  // ── Withdraw from an assigned job (PROVIDER only) ──────────────────────────
  // (POST /api/v1/jobs/{job_id}/provider-cancel — Swagger "Provider Cancel After
  // Acceptance".) NO body is sent (the live spec declares only the job_id path
  // parameter), and the 200 is the WRAPPED { message, job } envelope — unlike the
  // client's /cancel, whose 200 IS the job — so the job is read from data.job and the
  // backend's own message is used for the toast. This is the provider's route (the
  // client's cancellation is POST /jobs/{id}/cancel, opened as its own screen), so it
  // is gated on the active role AND on the job still being assigned and unfinished.
  // Whether the job reopens for bidding or becomes cancelled is whatever the response
  // says — nothing is assumed.
  const { providerCancelJob, providerCancelling } = useProviderCancelJob();

  const doProviderCancel = useCallback(async () => {
    if (numericId === null) return;
    const outcome = await providerCancelJob(numericId);

    if (outcome.ok) {
      // The returned job is the source of truth: status, assigned_provider_id,
      // is_bidding_open, the can_* flags, cancelled_at and cancellation_fee_charged
      // all come from it — the provider-only actions disappear from those flags.
      applyServerJob(outcome.job);
      // The backend's own message wins; a fee is only ever REPORTED, never guessed.
      const feeNotice = outcome.job.cancellation_fee_charged
        ? `\n\n${t('jobd_cancel_fee')}`
        : '';
      showAlert({
        title: t('jobd_pcancel_success_title'),
        message: `${providerCancelSuccessMessage(outcome.message, t)}${feeNotice}`,
        icon: 'check-circle',
      });
      return;
    }

    // A cancellation is already running — not an error.
    if (outcome.kind === 'busy') return;
    if (isProviderCancelUnauthorized(outcome.kind)) {
      router.replace('/(auth)/login' as any);
      return;
    }

    // A lost response is NOT a blind retry: the job is re-read first and, if it has
    // left the provider-cancellable window, the request is treated as already carried
    // out rather than offered again (a second cancel is what the backend rejects).
    if (outcome.kind === 'network') {
      const refetched = await refetchServerJob();
      if (providerCancelResolvedAfterResync(refetched)) {
        showAlert({
          title: t('jobd_pcancel_moved_title'),
          message: t('jobd_pcancel_moved_msg'),
          icon: 'info',
        });
        return;
      }
    }

    // A refusal means the assignment/state we gated on is stale, so re-read the job.
    if (shouldResyncAfterProviderCancelFailure(outcome.kind)) {
      void refetchServerJob();
    }

    if (isProviderCancelNotAllowed(outcome.kind)) {
      showAlert({
        title: t('jobd_pcancel_notallowed_title'),
        message: providerCancelFailureMessage(outcome, t),
        icon: 'slash',
      });
      return;
    }

    // 422 / 403 / 404 / 5xx / network — the backend's own message wins when it sent
    // one (e.g. "you are not the assigned provider"), so it reads exactly as sent.
    showAlert({
      title: t('jobd_pcancel_err_title'),
      message: providerCancelFailureMessage(outcome, t),
      icon: 'alert-triangle',
      buttons: [
        { text: t('jobs_retry'), onPress: () => void doProviderCancel() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [numericId, providerCancelJob, applyServerJob, showAlert, t, router, refetchServerJob]);

  // Withdrawing notifies the client and may affect the account, so it is confirmed
  // first and can never fire twice (the button is disabled while in flight and the
  // hook rejects a second call).
  const confirmProviderCancel = useCallback(() => {
    if (providerCancelling) return;
    showAlert({
      title: t('jobd_pcancel_confirm_title'),
      message: t('jobd_pcancel_confirm_msg'),
      icon: 'alert-triangle',
      buttons: [
        { text: t('jobd_pcancel_confirm_cta'), onPress: () => void doProviderCancel() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [providerCancelling, showAlert, t, doProviderCancel]);

  // A STABLE expiry callback: CountdownTimer re-runs its effect whenever this
  // identity changes, so an inline arrow would reset the interval on every
  // render of this screen.
  const handleBiddingExpired = useCallback(() => {
    void refetchServerJob();
  }, [refetchServerJob]);

  const job = useMemo(() => MOCK_JOBS.find((j) => j.id === id), [id]);
  const [bids, setBids] = useState<Bid[]>(() => MOCK_BIDS.filter((b) => b.jobId === id));
  const [expired, setExpired] = useState(job ? job.biddingEndsAt <= Date.now() : false);
  const [showAll, setShowAll] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('recommended');
  const spawnedProviderIds = useRef(new Set(bids.map((b) => b.provider.id)));
  const [screenLoading, setScreenLoading] = useState(true);

  const sortedForAll = useMemo(() => {
    const arr = [...bids];
    switch (sortMode) {
      case 'lowPrice': return arr.sort((a, b) => a.price - b.price);
      case 'highRating': return arr.sort((a, b) => (b.provider.rating ?? 0) - (a.provider.rating ?? 0));
      case 'distance': return arr.sort((a, b) => a.provider.distanceKm - b.provider.distanceKm);
      case 'badge': return arr.sort((a, b) => (b.provider.badge ?? 0) - (a.provider.badge ?? 0));
      default: return arr.sort((a, b) => b.score - a.score);
    }
  }, [bids, sortMode]);

  useEffect(() => {
    const t = setTimeout(() => setScreenLoading(false), 400);
    return () => clearTimeout(t);
  }, []);

  // Simulate live bids trickling in while the dashboard is open.
  useEffect(() => {
    if (!job || expired || job.status !== 'bidding') return;
    const interval = setInterval(() => {
      const remainingProviders = BID_PROVIDERS.filter((p) => !spawnedProviderIds.current.has(p.id));
      if (remainingProviders.length === 0) return;
      const next = remainingProviders[Math.floor(Math.random() * remainingProviders.length)];
      spawnedProviderIds.current.add(next.id);
      setBids((prev) => [...prev, makeMockBid(job.id, next)]);
    }, 6000);
    return () => clearInterval(interval);
  }, [job, expired]);

  if (isServer) {
    const serverHeader = (title: string) => (
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>{title}</Text>
        <View style={styles.backBtn} />
      </View>
    );

    if (detailStatus === 'idle' || detailStatus === 'loading') {
      return (
        <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
          <BrandedLoader size={44} />
        </View>
      );
    }

    // Everything that is not a renderable job lands here: 404 (gone), 403 (not
    // this account's job), 422 (rejected id), 401 (session over) and
    // network/5xx. None of them may produce a blank screen, so each gets
    // readable copy and a way back to the jobs list, plus a Retry button when
    // retrying could actually help.
    if (detailStatus !== 'ready' || !serverJob) {
      const gone = detailStatus === 'notfound' || detailStatus === 'forbidden';
      const retryable =
        detailStatus === 'error' || detailStatus === 'invalid' || detailStatus === 'unauthorized';
      const title =
        detailStatus === 'unauthorized'
          ? t('jobd_session_expired')
          : detailStatus === 'invalid'
            ? t('jobd_not_valid')
            : gone
              ? t('jobd_unavailable_title')
              : t('jobd_load_error');
      const message =
        detailStatus === 'unauthorized'
          ? t('jobd_session_msg')
          : detailStatus === 'invalid'
            ? serverMessage ?? t('jobd_not_valid')
            : gone
              ? serverMessage ?? t('jobd_unavailable_msg')
              : t('jobd_load_error_sub');
      return (
        <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
          {serverHeader(t('jobs_title'))}
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <View
              style={[
                styles.noBidsCard,
                { backgroundColor: c.card, borderColor: c.border, marginTop: 0, width: '100%' },
              ]}
            >
              <Feather
                name={
                  gone ? 'slash' : detailStatus === 'unauthorized' ? 'lock' : 'alert-circle'
                }
                size={28}
                color={c.destructive}
              />
              <Text style={[styles.noBidsTitle, { color: c.text }]}>{title}</Text>
              <Text style={[styles.noBidsSub, { color: c.mutedForeground }]}>{message}</Text>
              <View style={[styles.noBidsActions, { marginTop: 12, flexDirection: 'column' }]}>
                {retryable ? (
                  <TouchableOpacity
                    style={[styles.restartBtnFull, { backgroundColor: c.primary }]}
                    onPress={retryServerJob}
                  >
                    <Text style={[styles.restartFullText, { color: c.primaryForeground }]}>
                      {t('jobs_retry')}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.restartBtnFull,
                    { backgroundColor: retryable ? c.muted : c.primary },
                  ]}
                  onPress={() => router.replace('/(tabs)/jobs' as any)}
                >
                  <Text
                    style={[
                      styles.restartFullText,
                      { color: retryable ? c.text : c.primaryForeground },
                    ]}
                  >
                    {t('jobd_back_to_jobs')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      );
    }

    // ── Everything below renders the LIVE response. No field is invented, and
    //    every nullable field is guarded before it is displayed. ──────────────
    const statusKey = jobStatusLabelKey(serverJob.status);
    const hours = parseExpectedHours(serverJob.expected_hours);
    const scheduledAt = parseIsoDate(serverJob.scheduled_at);
    const createdOn = formatDate(serverJob.created_at);
    const assignedOn = formatDate(serverJob.assigned_at);
    const providerAssigned = isProviderAssigned(serverJob);
    const completedOn = isJobCompleted(serverJob) ? formatDate(serverJob.completed_at) : null;
    const cancelled = isJobCancelledStatus(serverJob);
    const cancelledOn = cancelled ? formatDateTime(serverJob.cancelled_at) : null;
    // Countdown anchor from the backend's own bidding window (null = no timer).
    const deadline = biddingDeadline(serverJob, Date.now());
    const description = sanitizeRichText(serverJob.description);
    const addr = serverJob.address ?? null;
    const milestones = [...(serverJob.milestones ?? [])].sort(
      (a, b) => a.sequence - b.sequence || a.id - b.id
    );
    const history = [...(serverJob.status_history ?? [])].sort(
      (a, b) =>
        (parseIsoDate(a.created_at)?.getTime() ?? 0) -
          (parseIsoDate(b.created_at)?.getTime() ?? 0) || a.id - b.id
    );
    const attachments = [...(serverJob.attachments ?? [])].sort(
      (a, b) => a.position - b.position || a.id - b.id
    );
    // Visibility comes from the BACKEND's permission flags only. The one extra
    // condition on each convert action is direction: "Convert to Regular" is never
    // offered on a job that is already regular, and "Convert to Urgent" never on one
    // that is already urgent — the flags themselves still decide whether each
    // transition is allowed at all.
    const actions = visibleJobActions(serverJob).filter((action) => {
      if (action === 'convertToRegular') return canConvertJobToRegular(serverJob);
      if (action === 'convertToUrgent') return canConvertJobToUrgent(serverJob);
      // The "cancel" row here is the CLIENT's route (/job/{id}/cancel with a reason,
      // POST /api/v1/jobs/{job_id}/cancel). A provider's withdrawal is a different
      // endpoint rendered as its own provider-only button below, so this row must
      // never appear for a provider even while is_cancellable is true.
      if (action === 'cancel') return canClientCancelJob(serverJob, activeRole);
      return true;
    });
    const actionIcon: Record<JobActionId, keyof typeof Feather.glyphMap> = {
      edit: 'edit-2',
      cancel: 'x-circle',
      restartTimer: 'refresh-cw',
      convertToRegular: 'clock',
      convertToUrgent: 'zap',
    };
    const addressLine = addr
      ? [
          addr.formatted_address,
          [addr.street_address, addr.house_number].filter(Boolean).join(' '),
          addr.city?.name,
          addr.county?.name,
          addr.country?.name,
          addr.postal_code,
        ]
          .filter((part) => !!part && String(part).trim().length > 0)
          .join(', ')
      : null;
    // latitude/longitude exist on the payload, but this screen has no map, so
    // they are deliberately not rendered — no fake map and no placeholder pin.

    const runAction = (action: JobActionId) => {
      // Edit is wired: the button only appears when the backend's is_editable is
      // true, and the edit screen re-checks that flag before rendering a form.
      if (action === 'edit') {
        router.push(`/job/${serverJob.id}/edit` as any);
        return;
      }
      // Restart Timer is wired: it is offered only while the backend's
      // can_restart_timer is true, confirms first, and adopts the job returned by
      // the endpoint (new deadline).
      if (action === 'restartTimer') {
        confirmRestartTimer();
        return;
      }
      // Convert to Regular is wired: offered only while the backend's
      // can_convert_to_regular is true (and the job is still urgent), confirms,
      // and adopts the whole job returned by the endpoint.
      if (action === 'convertToRegular') {
        confirmConvertToRegular();
        return;
      }
      // Convert to Urgent is wired the same way in the other direction: offered only
      // while the backend's can_convert_to_urgent is true (and the job is still
      // regular), confirms, and adopts the whole job returned by the endpoint.
      if (action === 'convertToUrgent') {
        confirmConvertToUrgent();
        return;
      }
      // Cancel is wired: it only appears while the backend's is_cancellable is true,
      // and it opens its own screen because POST /api/v1/jobs/{job_id}/cancel REQUIRES
      // a 3–255 character reason (schema JobCancelRequest) — a form this screen has no
      // room for. That screen adopts the returned job, so the Cancellation section
      // below (reason, notes, cancelled_at and the fee flag) comes straight from the
      // response.
      if (action === 'cancel') {
        router.push(`/job/${serverJob.id}/cancel` as any);
        return;
      }
      showAlert({
        title: t(JOB_ACTION_LABEL_KEY[action]),
        message: t('jobd_action_soon'),
        icon: 'tool',
      });
    };

    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        {serverHeader(serverJob.title)}

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          {/* A paused job has no connected resume endpoint yet, so say so plainly
              instead of leaving the client on a dead end. The paused state comes from
              the backend's own status (PAUSED_BY_CLIENT / PAUSED_BY_PROVIDER) — never a
              hardcoded string. */}
          {isJobPausedStatus(serverJob) ? (
            <View
              style={[
                styles.noBidsCard,
                {
                  backgroundColor: c.card,
                  borderColor: c.border,
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 8,
                  marginTop: 0,
                  marginBottom: 14,
                },
              ]}
            >
              <Feather name="pause-circle" size={18} color={c.mutedForeground} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.sectionTitle, { color: c.text }]}>
                  {t('jobd_paused_notice_title')}
                </Text>
                <Text style={[styles.bodyLine, { color: c.mutedForeground }]}>
                  {t('jobd_paused_notice_msg')}
                </Text>
              </View>
            </View>
          ) : null}

          {/* request_type, status and booking_type — all three enums are the
              server's, and an unrecognised status falls back to the raw value
              in a neutral chip rather than disappearing. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <View
              style={[
                styles.sortChip,
                {
                  backgroundColor: serverJob.is_urgent ? c.urgentLight : c.successLight,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                },
              ]}
            >
              <Feather
                name={serverJob.is_urgent ? 'zap' : 'clock'}
                size={11}
                color={serverJob.is_urgent ? c.urgent : c.success}
              />
              <Text
                style={[
                  styles.sortChipText,
                  { color: serverJob.is_urgent ? c.urgent : c.success },
                ]}
              >
                {t(serverJob.request_type === 'URGENT' ? 'jobs_urgent' : 'jobs_regular')}
              </Text>
            </View>
            <View style={[styles.sortChip, { backgroundColor: c.muted }]}>
              <Text style={[styles.sortChipText, { color: c.mutedForeground }]}>
                {statusKey ? t(statusKey) : serverJob.status}
              </Text>
            </View>
            <View style={[styles.sortChip, { backgroundColor: c.muted }]}>
              <Text style={[styles.sortChipText, { color: c.mutedForeground }]}>
                {t(
                  serverJob.booking_type === 'MULTI_DAY' ? 'booking_multi_day' : 'booking_one_time'
                )}
              </Text>
            </View>
          </View>

          {/* DRAFT-only: publishing a job that is already out there makes no
              sense, and the endpoint is only for turning a draft into a live,
              bidding job. Hidden entirely for every other status. */}
          {isDraftJob(serverJob) ? (
            <TouchableOpacity
              style={[
                styles.publishBtn,
                { backgroundColor: c.primary },
                publishing && styles.publishBtnBusy,
              ]}
              onPress={confirmPublish}
              disabled={publishing}
              activeOpacity={0.85}
            >
              {publishing ? (
                <ActivityIndicator size="small" color={c.primaryForeground} />
              ) : (
                <Feather name="radio" size={15} color={c.primaryForeground} />
              )}
              <Text style={[styles.publishText, { color: c.primaryForeground }]}>
                {publishing ? t('pub_publishing') : t('pub_btn')}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Rendered only when the backend says bidding is open AND a usable
              deadline exists; `endsAt` is the absolute deadline, so the timer
              stays correct across a suspend. Reaching zero refetches the job so
              the status and flags come from the backend, not from a guess. */}
          {deadline !== null ? (
            <View style={{ marginTop: 14 }}>
              <CountdownTimer
                endsAt={deadline}
                urgency={serverJob.is_urgent ? 'urgent' : 'regular'}
                onExpire={handleBiddingExpired}
              />
            </View>
          ) : null}

          {/* Assign Provider. There is NO backend flag for assignment (JobResponse
              has none), so the gate is derived conservatively: the job must still be
              open for assignment (bidding open, not cancelled/completed) and not
              already assigned — see lib/jobAssign. It also needs a real provider id,
              which only the offers list can supply, so no button renders without one. */}
          {canAssignProvider(serverJob) && isValidProviderId(providerId) ? (
            <TouchableOpacity
              style={[
                styles.publishBtn,
                { backgroundColor: c.primary, marginTop: 14 },
                assigning && styles.publishBtnBusy,
              ]}
              onPress={confirmAssignProvider}
              disabled={assigning}
              activeOpacity={0.85}
            >
              {assigning ? (
                <ActivityIndicator size="small" color={c.primaryForeground} />
              ) : (
                <Feather name="user-plus" size={15} color={c.primaryForeground} />
              )}
              <Text style={[styles.publishText, { color: c.primaryForeground }]}>
                {assigning
                  ? t('jobd_assign_busy')
                  : t('jobd_assign_provider', { id: providerId })}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Confirm Payment. There is NO can_confirm_payment flag on JobResponse,
              so the gate is the backend's own status: only a job sitting in
              PAYMENT_PENDING is payable (lib/jobPayment). It enables/disables itself
              from the response — nothing about the post-payment status is assumed. */}
          {canConfirmPayment(serverJob) ? (
            <TouchableOpacity
              style={[
                styles.publishBtn,
                { backgroundColor: c.primary, marginTop: 14 },
                confirming && styles.publishBtnBusy,
              ]}
              onPress={confirmConfirmPayment}
              disabled={confirming}
              activeOpacity={0.85}
            >
              {confirming ? (
                <ActivityIndicator size="small" color={c.primaryForeground} />
              ) : (
                <Feather name="credit-card" size={15} color={c.primaryForeground} />
              )}
              <Text style={[styles.publishText, { color: c.primaryForeground }]}>
                {confirming ? t('jobd_pay_busy') : t('jobd_pay_confirm_payment')}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Start Job — the PROVIDER's action on a job that already has a provider
              and is sitting in PROVIDER_ASSIGNED (payment settled, work not begun).
              There is no can_start_job flag, so the gate is the backend's own status
              plus the role; it disappears by itself once the response moves the job
              on, because nothing about the new status is assumed. */}
          {canStartJob(serverJob, activeRole) ? (
            <TouchableOpacity
              style={[
                styles.publishBtn,
                { backgroundColor: c.primary, marginTop: 14 },
                starting && styles.publishBtnBusy,
              ]}
              onPress={confirmStartJob}
              disabled={starting}
              activeOpacity={0.85}
            >
              {starting ? (
                <ActivityIndicator size="small" color={c.primaryForeground} />
              ) : (
                <Feather name="play" size={15} color={c.primaryForeground} />
              )}
              <Text style={[styles.publishText, { color: c.primaryForeground }]}>
                {starting ? t('jobd_start_busy') : t('jobd_start_job')}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Complete Job — the PROVIDER's action on a job that is IN_PROGRESS (it was
              started and is not finished). There is no can_complete_job flag, so the
              gate is the backend's own status plus the role; once the response marks
              the job done, the returned flags/status remove it together with Start,
              Convert and Cancel. */}
          {canCompleteJob(serverJob, activeRole) ? (
            <TouchableOpacity
              style={[
                styles.publishBtn,
                { backgroundColor: c.primary, marginTop: 14 },
                completing && styles.publishBtnBusy,
              ]}
              onPress={confirmCompleteJob}
              disabled={completing}
              activeOpacity={0.85}
            >
              {completing ? (
                <ActivityIndicator size="small" color={c.primaryForeground} />
              ) : (
                <Feather name="check-circle" size={15} color={c.primaryForeground} />
              )}
              <Text style={[styles.publishText, { color: c.primaryForeground }]}>
                {completing ? t('jobd_complete_busy') : t('jobd_complete_job')}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Pause Job — the CLIENT's action on a job that is under way
              (POST /api/v1/jobs/{job_id}/pause-by-client, Swagger "Pause By Client").
              It REQUIRES a free-text `details` body, so it opens its own form screen
              (like the cancel/decline forms). Offered only for the client side, and only
              while the job is IN_PROGRESS; it disappears by itself once the response
              moves the job to the paused status — nothing about that status is assumed,
              and no Resume action is built here. */}
          {canPauseJob(serverJob, activeRole) ? (
            <TouchableOpacity
              style={[styles.restartBtn, { borderColor: c.primary, marginTop: 14 }]}
              onPress={() => router.push(`/job/${serverJob.id}/pause` as any)}
              activeOpacity={0.85}
            >
              <Feather name="pause-circle" size={15} color={c.primary} />
              <Text style={[styles.restartText, { color: c.primary }]}>
                {t('jobd_pause_action')}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Pause Job (provider) — the PROVIDER putting a job they are working on on hold
              (POST /api/v1/jobs/{job_id}/pause-by-provider, Swagger "Pause By Provider").
              Same shape and window as the client's pause above, but role-gated to the
              provider side, so exactly one of the two pause buttons can ever show. It
              REQUIRES a free-text `details` body, hence its own form screen. */}
          {canProviderPauseJob(serverJob, activeRole) ? (
            <TouchableOpacity
              style={[styles.restartBtn, { borderColor: c.primary, marginTop: 14 }]}
              onPress={() => router.push(`/job/${serverJob.id}/provider-pause` as any)}
              activeOpacity={0.85}
            >
              <Feather name="pause-circle" size={15} color={c.primary} />
              <Text style={[styles.restartText, { color: c.primary }]}>
                {t('jobd_ppause_action')}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Decline By Provider — the PROVIDER's rejection of a job it was assigned but
              had NOT started (POST /api/v1/jobs/{job_id}/decline-by-provider, Swagger
              "Decline By Provider"). It REQUIRES a free-text `details` body, so it opens
              its own form screen (like the client's cancel). It is offered only in the
              PROVIDER_ASSIGNED window — the sibling provider-cancel action owns
              IN_PROGRESS — so the two can never appear together. */}
          {canDeclineJob(serverJob, activeRole) ? (
            <TouchableOpacity
              style={[styles.restartBtn, { borderColor: c.destructive, marginTop: 14 }]}
              onPress={() => router.push(`/job/${serverJob.id}/decline` as any)}
              activeOpacity={0.85}
            >
              <Feather name="x-octagon" size={15} color={c.destructive} />
              <Text style={[styles.restartText, { color: c.destructive }]}>
                {t('jobd_decline_action')}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Provider Cancel After Acceptance — the PROVIDER's withdrawal from a job the
              client already assigned to them (POST /api/v1/jobs/{job_id}/provider-cancel,
              Swagger "Provider Cancel After Acceptance"). It sends NO body and returns
              the WRAPPED { message, job } envelope, so the returned job is adopted whole
              and the backend's own message is the toast. Offered only for the provider
              role on a job that still has a provider assigned and is not finished; it
              disappears by itself once the response clears the assignment or cancels the
              job, because nothing about the resulting state is assumed. */}
          {canProviderCancelJob(serverJob, activeRole) ? (
            <TouchableOpacity
              style={[
                styles.restartBtn,
                { borderColor: c.destructive, marginTop: 14 },
                providerCancelling && styles.publishBtnBusy,
              ]}
              onPress={confirmProviderCancel}
              disabled={providerCancelling}
              activeOpacity={0.85}
            >
              {providerCancelling ? (
                <ActivityIndicator size="small" color={c.destructive} />
              ) : (
                <Feather name="x-circle" size={15} color={c.destructive} />
              )}
              <Text style={[styles.restartText, { color: c.destructive }]}>
                {providerCancelling ? t('jobd_pcancel_busy') : t('jobd_pcancel_action')}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Report Blocker — the ONE job action the API does NOT split per role:
              either party to an active job describes what is stopping it from going
              ahead (POST /api/v1/jobs/{job_id}/blocker, Swagger "Report Blocker", body
              JobDetailsRequest {details}). There is deliberately NO role check here, so
              this button is offered to the client and the provider alike — the backend
              authorises the real party. It REQUIRES a free-text `details` body, so it
              opens its own form screen (the blocker route). Offered only while the job is
              in an active window (PROVIDER_ASSIGNED / IN_PROGRESS with a real assigned
              provider) and not already blocked/cancelled/completed, so it disappears by
              itself once the response moves the job on — nothing about that resulting
              state is assumed, and no "view blockers" list is invented (the API has no
              blockers collection endpoint). */}
          {canReportBlocker(serverJob) ? (
            <TouchableOpacity
              style={[styles.restartBtn, { borderColor: c.primary, marginTop: 14 }]}
              onPress={() => router.push(`/job/${serverJob.id}/blocker` as any)}
              activeOpacity={0.85}
            >
              <Feather name="alert-octagon" size={15} color={c.primary} />
              <Text style={[styles.restartText, { color: c.primary }]}>
                {t('jobd_blocker_action')}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Add Attachment — attaches ONE file to this job
              (POST /api/v1/jobs/{job_id}/attachments, Swagger "Add Attachment").
              MULTIPART, not JSON, so it opens its own upload screen which owns the
              picker, the local type/size guard, the in-flight state and the retry. No
              role check: the contract never says whether the client or the provider may
              attach, and the uploader's identity is derived server-side from the Bearer
              token. Offered on any non-terminal job (cancelled/completed are ruled out
              client-side; every other status is left to the backend to accept or
              refuse). Like every other job action the response is the FULL job, so the
              attachments list below re-renders from the server's own copy — nothing is
              ever appended locally. */}
          {canAddJobAttachment(serverJob) ? (
            <TouchableOpacity
              style={[styles.restartBtn, { borderColor: c.primary, marginTop: 14 }]}
              onPress={() => router.push(`/job/${serverJob.id}/attachment` as any)}
              activeOpacity={0.85}
            >
              <Feather name="paperclip" size={15} color={c.primary} />
              <Text style={[styles.restartText, { color: c.primary }]}>
                {t('jobd_attach_action')}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Which actions exist is decided by is_editable / is_cancellable /
              can_restart_timer / can_convert_to_regular / can_convert_to_urgent
              exactly as returned — never re-derived from status or dates. */}
          {actions.length > 0 ? (
            <View style={{ marginTop: 14, gap: 8 }}>
              {actions.map((action) => {
                const danger = action === 'cancel';
                const tint = danger ? c.destructive : c.text;
                // Disabled for the duration of the call so a double tap cannot fire
                // the same state-changing action twice (each hook rejects a second
                // call regardless).
                const busy =
                  (action === 'restartTimer' && restarting) ||
                  (action === 'convertToRegular' && converting) ||
                  (action === 'convertToUrgent' && convertingToUrgent);
                const busyLabel =
                  action === 'restartTimer'
                    ? 'jobd_restart_busy'
                    : action === 'convertToUrgent'
                      ? 'jobd_urgent_busy'
                      : 'jobd_convert_busy';
                return (
                  <TouchableOpacity
                    key={action}
                    style={[styles.restartBtn, { borderColor: danger ? c.destructive : c.border, marginTop: 0 }]}
                    onPress={() => runAction(action)}
                    disabled={busy}
                    activeOpacity={0.85}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={tint} />
                    ) : (
                      <Feather name={actionIcon[action]} size={14} color={tint} />
                    )}
                    <Text style={[styles.restartText, { color: tint }]}>
                      {busy ? t(busyLabel) : t(JOB_ACTION_LABEL_KEY[action])}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          <View style={{ marginTop: 16, gap: 8 }}>
            {scheduledAt ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="calendar" size={13} color={c.mutedForeground} />
                <Text style={[styles.metaLine, { color: c.mutedForeground }]}>
                  {formatDateTime(serverJob.scheduled_at)}
                </Text>
              </View>
            ) : null}
            {hours !== null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="clock" size={13} color={c.mutedForeground} />
                <Text style={[styles.metaLine, { color: c.mutedForeground }]}>
                  {hours === 1
                    ? t('post_hours_value', { n: hours })
                    : t('post_hours_value_plural', { n: hours })}
                </Text>
              </View>
            ) : null}
            {createdOn ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="info" size={13} color={c.mutedForeground} />
                <Text style={[styles.metaLine, { color: c.mutedForeground }]}>
                  {t('jobd_created', { date: createdOn })}
                </Text>
              </View>
            ) : null}
            {providerAssigned && serverJob.assigned_provider_id != null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="user-check" size={13} color={c.mutedForeground} />
                <Text style={[styles.metaLine, { color: c.mutedForeground }]}>
                  {t('jobd_provider_n', { id: serverJob.assigned_provider_id })}
                  {assignedOn ? ` · ${t('jobd_assigned_on', { date: assignedOn })}` : ''}
                </Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="user-x" size={13} color={c.mutedForeground} />
                <Text style={[styles.metaLine, { color: c.mutedForeground }]}>
                  {t('jobd_not_assigned')}
                </Text>
              </View>
            )}
            {completedOn ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="check-circle" size={13} color={c.mutedForeground} />
                <Text style={[styles.metaLine, { color: c.mutedForeground }]}>
                  {t('jobd_completed_on', { date: completedOn })}
                </Text>
              </View>
            ) : null}
          </View>

          {description ? (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: c.text }]}>{t('jobd_description')}</Text>
              </View>
              <Text style={[styles.bodyLine, { color: c.text }]}>{description}</Text>
            </>
          ) : null}

          {addressLine ? (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: c.text }]}>{t('jobd_address')}</Text>
              </View>
              <View
                style={[
                  styles.noBidsCard,
                  { backgroundColor: c.card, borderColor: c.border, alignItems: 'flex-start', marginTop: 0 },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, width: '100%' }}>
                  <Feather name="map-pin" size={14} color={c.mutedForeground} />
                  <Text style={[styles.bodyLine, { color: c.text, flex: 1 }]}>{addressLine}</Text>
                </View>
                {addr?.landmark ? (
                  <Text style={[styles.metaLine, { color: c.mutedForeground }]}>{addr.landmark}</Text>
                ) : null}
                {/* Update Job Address (PATCH) is EDIT-ONLY: shown when the job
                    already carries an address and is still editable. */}
                {canUpdateJobAddress(serverJob) ? (
                  <TouchableOpacity
                    style={[styles.publishBtn, { backgroundColor: c.primary, alignSelf: 'stretch' }]}
                    onPress={() => router.push(`/job/${serverJob.id}/edit-address` as any)}
                    activeOpacity={0.85}
                  >
                    <Feather name="edit-2" size={15} color={c.primaryForeground} />
                    <Text style={[styles.publishText, { color: c.primaryForeground }]}>
                      {t('jobaddr_update_title')}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          ) : (
            <>
              {/* No address on the job. Add address is CREATE-ONLY, so it is
                  offered only while the job is still editable — an existing
                  address is changed through Update Job Address instead. */}
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: c.text }]}>{t('jobd_address')}</Text>
              </View>
              <View
                style={[
                  styles.noBidsCard,
                  { backgroundColor: c.card, borderColor: c.border, alignItems: 'flex-start', marginTop: 0 },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, width: '100%' }}>
                  <Feather name="map-pin" size={14} color={c.mutedForeground} />
                  <Text style={[styles.bodyLine, { color: c.mutedForeground, flex: 1 }]}>
                    {t('jobd_no_address')}
                  </Text>
                </View>
                {jobHasAddress(serverJob) && canUpdateJobAddress(serverJob) ? (
                  <TouchableOpacity
                    style={[styles.publishBtn, { backgroundColor: c.primary, alignSelf: 'stretch' }]}
                    onPress={() => router.push(`/job/${serverJob.id}/edit-address` as any)}
                    activeOpacity={0.85}
                  >
                    <Feather name="edit-2" size={15} color={c.primaryForeground} />
                    <Text style={[styles.publishText, { color: c.primaryForeground }]}>
                      {t('jobaddr_update_title')}
                    </Text>
                  </TouchableOpacity>
                ) : canAddJobAddress(serverJob) ? (
                  <TouchableOpacity
                    style={[styles.publishBtn, { backgroundColor: c.primary, alignSelf: 'stretch' }]}
                    onPress={() => router.push(`/job/${serverJob.id}/address` as any)}
                    activeOpacity={0.85}
                  >
                    <Feather name="plus" size={15} color={c.primaryForeground} />
                    <Text style={[styles.publishText, { color: c.primaryForeground }]}>
                      {t('jobd_add_address')}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          )}

          {/* JobMilestoneResponse shape confirmed from the live schema: id,
              sequence, scheduled_at (required), expected_hours, status,
              started_at, completed_at, note. */}
          {milestones.length > 0 ? (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: c.text }]}>{t('jobd_milestones')}</Text>
              </View>
              {milestones.map((m, i) => {
                const mHours = parseExpectedHours(m.expected_hours);
                const mDate = formatDateTime(m.scheduled_at);
                const mStatusKey = milestoneStatusLabelKey(m.status);
                const mHoursText =
                  mHours === null
                    ? ''
                    : ` · ${mHours === 1
                        ? t('post_hours_value', { n: mHours })
                        : t('post_hours_value_plural', { n: mHours })}`;
                return (
                  <View
                    key={m.id}
                    style={[
                      styles.noBidsCard,
                      {
                        backgroundColor: c.card,
                        borderColor: c.border,
                        alignItems: 'flex-start',
                        marginTop: i === 0 ? 0 : 10,
                        gap: 4,
                      },
                    ]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text style={[styles.milestoneTitle, { color: c.text }]}>
                        {t('jobd_milestone_n', { n: i + 1 })}
                      </Text>
                      {mStatusKey ? (
                        <View
                          style={[
                            styles.sortChip,
                            { backgroundColor: c.muted, paddingHorizontal: 8, paddingVertical: 3 },
                          ]}
                        >
                          <Text style={[styles.sortChipText, { color: c.mutedForeground }]}>
                            {t(mStatusKey)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {mDate ? (
                      <Text style={[styles.metaLine, { color: c.mutedForeground }]}>
                        {mDate + mHoursText}
                      </Text>
                    ) : null}
                    {m.note ? (
                      <Text style={[styles.bodyLine, { color: c.mutedForeground }]}>{m.note}</Text>
                    ) : null}
                  </View>
                );
              })}
            </>
          ) : null}

          {/* JobStatusHistoryResponse shape confirmed from the live schema: id,
              status (JobStatus), note, changed_by, created_at. */}
          {history.length > 0 ? (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: c.text }]}>{t('jobd_history')}</Text>
              </View>
              {history.map((h, i) => {
                const hKey = jobStatusLabelKey(h.status);
                const when = formatDateTime(h.created_at);
                return (
                  <View
                    key={h.id}
                    style={[
                      styles.noBidsCard,
                      {
                        backgroundColor: c.card,
                        borderColor: c.border,
                        alignItems: 'flex-start',
                        marginTop: i === 0 ? 0 : 10,
                        gap: 2,
                      },
                    ]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Feather name="git-commit" size={13} color={c.mutedForeground} />
                      <Text style={[styles.milestoneTitle, { color: c.text }]}>
                        {hKey ? t(hKey) : h.status}
                      </Text>
                    </View>
                    {when ? (
                      <Text style={[styles.metaLine, { color: c.mutedForeground }]}>{when}</Text>
                    ) : null}
                    {h.note ? (
                      <Text style={[styles.bodyLine, { color: c.mutedForeground }]}>{h.note}</Text>
                    ) : null}
                  </View>
                );
              })}
            </>
          ) : null}

          {/* JobAttachmentResponse shape confirmed from the spec's own schema (NOT from
              the placeholder [] in the 201 example): id, media_type (an UNCONSTRAINED
              string — the document defines no enum), media_url (nullable), position,
              created_at. Entries are shown in position order, and an image-like entry
              with a usable URL renders a real thumbnail — the same media_type rule the
              service galleries use, so nothing about the shape is guessed. */}
          {attachments.length > 0 ? (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: c.text }]}>{t('jobd_attachments')}</Text>
              </View>
              {attachments.map((a) => (
                <View
                  key={a.id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}
                >
                  {hasUsableUrl(a.media_url) && classifyMediaType(a.media_type) === 'image' ? (
                    <Image
                      source={{ uri: a.media_url as string }}
                      style={{ width: 36, height: 36, borderRadius: 8 }}
                      contentFit="cover"
                      transition={150}
                    />
                  ) : (
                    <Feather name="paperclip" size={13} color={c.mutedForeground} />
                  )}
                  <Text style={[styles.bodyLine, { color: c.text, flex: 1 }]} numberOfLines={1}>
                    {a.media_url ?? a.media_type}
                  </Text>
                </View>
              ))}
            </>
          ) : null}

          {/* Cancellation details only exist once the job is cancelled. */}
          {cancelled ? (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: c.text }]}>
                  {t('jobd_cancel_section')}
                </Text>
              </View>
              <View
                style={[
                  styles.noBidsCard,
                  {
                    backgroundColor: c.card,
                    borderColor: c.border,
                    alignItems: 'flex-start',
                    marginTop: 0,
                    gap: 4,
                  },
                ]}
              >
                {serverJob.cancellation_reason ? (
                  <Text style={[styles.bodyLine, { color: c.text }]}>
                    {t('jobd_cancel_reason')}: {serverJob.cancellation_reason}
                  </Text>
                ) : null}
                {serverJob.cancellation_notes ? (
                  <Text style={[styles.bodyLine, { color: c.text }]}>
                    {t('jobd_cancel_notes')}: {serverJob.cancellation_notes}
                  </Text>
                ) : null}
                {cancelledOn ? (
                  <Text style={[styles.metaLine, { color: c.mutedForeground }]}>{cancelledOn}</Text>
                ) : null}
                <Text style={[styles.metaLine, { color: c.mutedForeground }]}>
                  {serverJob.cancellation_fee_charged
                    ? t('jobd_cancel_fee')
                    : t('jobd_cancel_no_fee')}
                </Text>
              </View>
            </>
          ) : null}

          {/* Offers/bids are NOT part of this endpoint's contract, so nothing is
              invented here. The mock bidding dashboard below stays mock-only. */}
          <View
            style={[styles.noBidsCard, { backgroundColor: c.card, borderColor: c.border, marginTop: 20 }]}
          >
            <Feather name="trending-up" size={26} color={c.mutedForeground} />
            <Text style={[styles.noBidsSub, { color: c.mutedForeground }]}>
              {t('jobd_offers_unavailable')}
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }


  if (screenLoading) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <BrandedLoader size={44} />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <EmptyState icon="alert-circle" title={t('job_not_found')} />
      </View>
    );
  }

  const sortedByScore = [...bids].sort((a, b) => b.score - a.score);
  const top3 = sortedByScore.slice(0, 3);

  const restartTimer = () => {
    job.biddingEndsAt = Date.now() + job.biddingDurationMs;
    setExpired(false);
  };

  const convertToRegular = () => {
    job.urgency = 'regular';
    job.biddingDurationMs = 3 * 60 * 60 * 1000;
    job.biddingEndsAt = Date.now() + job.biddingDurationMs;
    setExpired(false);
  };

  const cancelJob = () => {
    showAlert({
      title: t('job_cancel_title'),
      message: t('job_cancel_msg'),
      icon: 'alert-triangle',
      buttons: [
        { text: t('job_keep'), style: 'cancel' },
        {
          text: t('job_cancel_title'),
          style: 'destructive',
          onPress: () => {
            job.status = 'cancelled';
            router.back();
          },
        },
      ],
    });
  };

  const acceptBid = (bid: Bid) => {
    showAlert({
      title: t('job_accept_title'),
      message: `${bid.provider.name} — €${bid.price}, ${t('bidcard_eta', { eta: bid.eta })}\n${job.date}, ${job.time}\n${job.title}`,
      icon: 'check-circle',
      buttons: [
        { text: t('action_cancel'), style: 'cancel' },
        {
          text: t('job_accept_btn'),
          onPress: () => {
            job.status = 'pending_payment';
            job.assignedProviderId = bid.provider.id;
            job.assignedPrice = bid.price;
            job.paymentDeadline = Date.now() + 10 * 60 * 1000;
            router.push(`/job/${job.id}/payment` as any);
          },
        },
      ],
    });
  };

  const openChat = (provider: BidProvider) => {
    router.push(`/chat/${provider.id}` as any);
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>{job.title}</Text>
        <TouchableOpacity onPress={cancelJob} style={styles.backBtn}>
          <Feather name="x-circle" size={20} color={c.destructive} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {job.status === 'bidding' && (
          <>
            <CountdownTimer endsAt={job.biddingEndsAt} urgency={job.urgency} onExpire={() => setExpired(true)} />

            {!expired && (
              <TouchableOpacity style={[styles.restartBtn, { borderColor: c.border }]} onPress={restartTimer}>
                <Feather name="refresh-cw" size={14} color={c.text} />
                <Text style={[styles.restartText, { color: c.text }]}>{t('job_restart_timer')}</Text>
              </TouchableOpacity>
            )}

            {expired && bids.length === 0 ? (
              <View style={[styles.noBidsCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <Feather name="inbox" size={32} color={c.mutedForeground} />
                <Text style={[styles.noBidsTitle, { color: c.text }]}>{t('job_no_bids_title')}</Text>
                <Text style={[styles.noBidsSub, { color: c.mutedForeground }]}>
                  {t('job_no_bids_sub')}{job.urgency === 'urgent' ? t('job_no_bids_sub_urgent') : t('job_no_bids_sub_period')}
                </Text>
                <View style={styles.noBidsActions}>
                  <TouchableOpacity style={[styles.restartBtnFull, { backgroundColor: c.primary }]} onPress={restartTimer}>
                    <Text style={styles.restartFullText}>{t('job_restart_timer')}</Text>
                  </TouchableOpacity>
                  {job.urgency === 'urgent' && (
                    <TouchableOpacity style={[styles.restartBtnFull, { backgroundColor: c.muted }]} onPress={convertToRegular}>
                      <Text style={[styles.restartFullText, { color: c.text }]}>{t('job_convert_regular')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ) : (
              <>
                {top3.length > 0 && (
                  <>
                    <View style={styles.sectionHeaderRow}>
                      <Text style={[styles.sectionTitle, { color: c.text }]}>{t('job_recommended')}</Text>
                      <TouchableOpacity onPress={() => setShowAll(true)}>
                        <Text style={[styles.viewAll, { color: c.primary }]}>{t('job_view_all_offers', { n: bids.length })}</Text>
                      </TouchableOpacity>
                    </View>
                    {top3.map((bid, i) => (
                      <Animated.View key={bid.id} entering={FadeInDown.delay(i * 80).duration(350)}>
                        <BidCard
                          bid={bid}
                          rank={i + 1}
                          onViewProfile={() => {}}
                          onChat={() => openChat(bid.provider)}
                          onAccept={() => acceptBid(bid)}
                        />
                      </Animated.View>
                    ))}
                  </>
                )}

                {showAll && (
                  <View style={{ marginTop: 8 }}>
                    <View style={styles.sectionHeaderRow}>
                      <Text style={[styles.sectionTitle, { color: c.text }]}>{t('job_all_offers')}</Text>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                      {([
                        ['recommended', 'job_sort_best'],
                        ['lowPrice', 'job_sort_lowest'],
                        ['highRating', 'job_sort_highest'],
                        ['distance', 'job_sort_nearest'],
                        ['badge', 'job_sort_badge'],
                      ] as [SortMode, string][]).map(([mode, labelKey]) => (
                        <TouchableOpacity
                          key={mode}
                          style={[styles.sortChip, { backgroundColor: sortMode === mode ? c.primary : c.muted, marginRight: 8 }]}
                          onPress={() => setSortMode(mode)}
                        >
                          <Text style={[styles.sortChipText, { color: sortMode === mode ? '#FFF' : c.text }]}>{t(labelKey as any)}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    {sortedForAll.map((bid) => (
                      <BidCard
                        key={bid.id}
                        bid={bid}
                        onViewProfile={() => {}}
                        onChat={() => openChat(bid.provider)}
                        onAccept={() => acceptBid(bid)}
                      />
                    ))}
                  </View>
                )}
              </>
            )}
          </>
        )}

        {job.status !== 'bidding' && (
          <View style={[styles.statusCard, { backgroundColor: c.primaryLight }]}>
            <Feather name="check-circle" size={28} color={c.primary} />
            <Text style={[styles.statusText, { color: c.primary }]}>
              {job.status === 'task_assigned' ? t('job_status_assigned') : job.status === 'cancelled' ? t('job_status_cancelled') : t('job_status_progress')}
            </Text>
          </View>
        )}

        <TouchableOpacity style={[styles.cancelBtn, { borderColor: c.border }]} onPress={cancelJob}>
          <Text style={[styles.cancelText, { color: c.destructive }]}>{t('job_cancel')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: 'Manrope_700Bold', fontSize: 16, marginHorizontal: 8 },
  restartBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 10, marginTop: 10 },
  restartText: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
  noBidsCard: { borderWidth: 1, borderRadius: 16, padding: 20, alignItems: 'center', gap: 8, marginTop: 20 },
  noBidsTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  noBidsSub: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  noBidsActions: { flexDirection: 'row', gap: 10, marginTop: 10, width: '100%' },
  restartBtnFull: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10 },
  restartFullText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: '#FFF' },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 10 },
  sectionTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  viewAll: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  sortChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  sortChipText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  statusCard: { alignItems: 'center', gap: 8, borderRadius: 16, padding: 24, marginTop: 10 },
  statusText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  cancelBtn: { marginTop: 24, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  publishBtn: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  publishBtnBusy: { opacity: 0.6 },
  publishText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  metaLine: { fontFamily: 'Manrope_400Regular', fontSize: 12, textAlign: 'left' },
  bodyLine: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 20, textAlign: 'left' },
  milestoneTitle: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
});
