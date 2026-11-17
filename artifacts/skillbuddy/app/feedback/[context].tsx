import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { useRole } from '@/context/RoleContext';
import { useAppAlert } from '@/context/AlertModalContext';
import BackButton from '@/components/BackButton';
import DotsLoader from '@/components/DotsLoader';
import FeedbackForm from '@/components/FeedbackForm';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import {
  feedbackKind,
  feedbackRole,
  isFeedbackContext,
  type FeedbackContext,
} from '@/lib/feedback';
import { POPUP_FADE_IN_MS } from '@/lib/motion';
import MyReviewCard from '@/components/MyReviewCard';
import MediaViewer, { type MediaViewerItem } from '@/components/MediaViewer';
import { useJobReviews } from '@/hooks/useJobReviews';
import { useFeedbackOptionLabels } from '@/hooks/useFeedbackOptionLabels';
import { formatReviewDeadline, reviewState, timeLeft } from '@/lib/reviews';
import type { FeedbackSide } from '@/lib/taskFeedback';

/**
 * One feedback route for all seven contexts: /feedback/{context}
 *
 * Optional query params, all from data the Job Details screen already has:
 *   jobId / milestoneId      — the record being reviewed / reported
 *   role                     — the side of the JOB the viewer is on
 *   jobTitle / jobDate       — the job context card (review only)
 *   counterpart              — the other party's display name, when known
 *
 * REVIEW MODE (CLIENT_REVIEW / PROVIDER_REVIEW) is fully wired:
 * POST /api/v1/jobs/{job_id}/reviews, through FeedbackForm +
 * hooks/useSubmitReview. The screen adds what is screen-level only: the job
 * context card, the sticky Submit footer (the form's button is suppressed and
 * the screen calls the same handler) and the fade-in "Discard review?" check
 * before leaving a half-filled review.
 *
 * ROLE SEPARATION: lib/feedback.feedbackRole maps each context to the side of
 * the marketplace it belongs to, and the active role is checked BEFORE anything
 * renders. A client can never open a pilot context by editing the URL, and the
 * reverse holds too.
 *
 * ENTRY POINTS WIRED:
 *   • Job Details → "Rate your pilot / Rate your client" when the job is CLOSED
 *   • Job Details → cancellation feedback link (both roles)
 * ENTRY POINTS STILL TODO (route exists, nothing links to it yet):
 *   • MILESTONE_DENIAL — the app has no Task review/approval screen yet
 *   • DISPUTE_BY_CLIENT / DISPUTE_BY_PROVIDER — no dispute entry in the Task flow yet
 */

const TITLE_KEY: Record<FeedbackContext, TranslationKey> = {
  CLIENT_REVIEW: 'fb_title_client_review',
  PROVIDER_REVIEW: 'fb_title_provider_review',
  MILESTONE_DENIAL: 'fb_title_denial',
  DISPUTE_BY_CLIENT: 'fb_title_dispute',
  DISPUTE_BY_PROVIDER: 'fb_title_dispute',
  CLIENT_CANCELLATION: 'fb_title_cancel',
  PROVIDER_CANCELLATION: 'fb_title_cancel',
};

const SUBTITLE_KEY: Record<FeedbackContext, TranslationKey> = {
  CLIENT_REVIEW: 'fb_sub_client_review',
  PROVIDER_REVIEW: 'fb_sub_provider_review',
  MILESTONE_DENIAL: 'fb_sub_denial',
  DISPUTE_BY_CLIENT: 'fb_sub_dispute',
  DISPUTE_BY_PROVIDER: 'fb_sub_dispute',
  CLIENT_CANCELLATION: 'fb_sub_cancel',
  PROVIDER_CANCELLATION: 'fb_sub_cancel',
};

const SUBMIT_LABEL_KEY: Record<FeedbackContext, TranslationKey> = {
  CLIENT_REVIEW: 'fb_submit_review',
  PROVIDER_REVIEW: 'fb_submit_review',
  MILESTONE_DENIAL: 'fb_submit_submit',
  DISPUTE_BY_CLIENT: 'fb_submit_dispute',
  DISPUTE_BY_PROVIDER: 'fb_submit_dispute',
  CLIENT_CANCELLATION: 'fb_submit_cancel',
  PROVIDER_CANCELLATION: 'fb_submit_cancel',
};

function toId(value: string | undefined): number | null {
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

function text(value: string | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

export default function FeedbackScreen() {
  const {
    context: rawContext,
    jobId,
    milestoneId,
    role: rawRole,
    jobTitle,
    jobDate,
    counterpart,
  } = useLocalSearchParams<{
    context?: string;
    jobId?: string;
    milestoneId?: string;
    role?: string;
    jobTitle?: string;
    jobDate?: string;
    counterpart?: string;
  }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();
  const { activeRole } = useRole();
  const showAlert = useAppAlert();

  const context = isFeedbackContext(rawContext) ? rawContext : null;
  // Entry points pass the side they know from the JOB (owner vs assigned pilot),
  // which is the truth even when the role switch is on the other mode; a direct
  // route without it falls back to the active role.
  const routeRole = rawRole === 'CLIENT' || rawRole === 'PROVIDER' ? rawRole : activeRole;
  const wrongRole = context !== null && feedbackRole(context) !== routeRole;
  const isReview = context !== null && feedbackKind(context) === 'review';

  const [dirty, setDirty] = useState(false);
  const [formState, setFormState] = useState({ canSubmit: false, busy: false });
  const submitAction = useRef<(() => void) | null>(null);
  const [guardViewer, setGuardViewer] = useState<{
    items: MediaViewerItem[];
    index: number;
  } | null>(null);

  /**
   * GUARD. Opening the review screen first asks the job itself
   * (GET /jobs/{id}/reviews) whether a review may still be written: already
   * reviewed, window over, or not available. Without a job id there is nothing
   * to ask, so the form opens and the server decides.
   */
  const reviewJobId = toId(jobId);
  const reviewGuard = useJobReviews(isReview ? reviewJobId : null);
  const { labels: reviewOptionLabels } = useFeedbackOptionLabels();
  const [forceForm, setForceForm] = useState(false);
  const guardState = reviewState(reviewGuard.data);
  const guardChecked = isReview && reviewJobId !== null && !forceForm;
  const guardLoading =
    guardChecked && (reviewGuard.status === 'idle' || reviewGuard.status === 'loading');
  const guardFailed =
    guardChecked && (reviewGuard.status === 'error' || reviewGuard.status === 'notavailable');
  const showForm = !guardChecked || guardState === 'CAN_REVIEW';
  const reviewDeadline = formatReviewDeadline(reviewGuard.data?.review_deadline, language);
  const deadlineLeft = timeLeft(reviewGuard.data?.review_deadline);
  const viewerSide: FeedbackSide = routeRole === 'PROVIDER' ? 'PROVIDER' : 'CLIENT';

  const title = useMemo(() => text(jobTitle), [jobTitle]);
  const date = useMemo(() => text(jobDate), [jobDate]);
  const other = useMemo(() => text(counterpart), [counterpart]);

  const leave = useCallback(() => {
    router.back();
  }, [router]);

  /** Half-filled review → ask first (fade-in dialog, never a slide). */
  const requestLeave = useCallback(() => {
    if (!isReview || !dirty) {
      leave();
      return;
    }
    showAlert({
      title: t('fb_rev_discard_title'),
      message: t('fb_rev_discard_msg'),
      icon: 'alert-triangle',
      buttons: [
        { text: t('fb_rev_discard_keep'), style: 'cancel' },
        { text: t('fb_rev_discard_cta'), style: 'destructive', onPress: leave },
      ],
    });
  }, [dirty, isReview, leave, showAlert, t]);

  // Android hardware back goes through the same check.
  useEffect(() => {
    if (!isReview || !dirty) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      requestLeave();
      return true;
    });
    return () => sub.remove();
  }, [dirty, isReview, requestLeave]);

  const header = (
    <View style={[styles.header, { backgroundColor: c.headerBg, paddingTop: insets.top + 10 }]}>
      <StatusBar style="light" />
      <View style={styles.headerRow}>
        <BackButton onPress={requestLeave} />
        <Text style={styles.headerTitle} numberOfLines={2}>
          {context ? t(TITLE_KEY[context]) : t('fb_header')}
        </Text>
        <View style={styles.headerSpacer} />
      </View>
    </View>
  );

  if (!context || wrongRole) {
    const blocked = !context;
    return (
      <View style={[styles.root, { backgroundColor: c.background }]}>
        {header}
        <View style={styles.stateWrap}>
          <Feather
            name={blocked ? 'slash' : 'lock'}
            size={28}
            color={blocked ? c.mutedForeground : c.destructive}
          />
          <Text style={[styles.stateTitle, { color: c.text }]}>
            {blocked ? t('fb_notfound_title') : t('fb_role_blocked_title')}
          </Text>
          <Text style={[styles.stateMsg, { color: c.mutedForeground }]}>
            {blocked ? t('fb_notfound_msg') : t('fb_role_blocked_msg')}
          </Text>
          <TouchableOpacity
            style={[styles.stateBtn, { backgroundColor: c.primary }]}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <Text style={[styles.stateBtnText, { color: c.primaryForeground }]}>
              {t('fb_back')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  /* The guard's own states: never the form when a review cannot be written. */
  if (guardLoading) {
    return (
      <View style={[styles.root, { backgroundColor: c.background }]}>
        {header}
        <View style={styles.stateWrap}>
          <DotsLoader color={c.primary} />
        </View>
      </View>
    );
  }

  if (guardFailed) {
    return (
      <View style={[styles.root, { backgroundColor: c.background }]}>
        {header}
        <View style={styles.guardWrap}>
          <View style={[styles.guardCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="alert-circle" size={24} color={c.destructive} />
            <Text style={[styles.stateTitle, { color: c.text }]}>
              {t('fb_rev_guard_failed')}
            </Text>
            <Text style={[styles.stateMsg, { color: c.mutedForeground }]}>
              {reviewGuard.status === 'notavailable'
                ? t('fb_rev_not_available')
                : t('fb_rev_load_error')}
            </Text>
            <TouchableOpacity
              style={[styles.guardBtn, { borderColor: c.border }]}
              onPress={() => void reviewGuard.refetch('retry')}
              activeOpacity={0.85}
            >
              <Feather name="refresh-cw" size={15} color={c.text} />
              <Text style={[styles.guardBtnText, { color: c.text }]}>{t('fb_try_again')}</Text>
            </TouchableOpacity>
            {/* The server is the final authority — a failed CHECK must not
                permanently lock the form (e.g. a flaky network on open). */}
            <TouchableOpacity onPress={() => setForceForm(true)} activeOpacity={0.8}>
              <Text style={[styles.guardLink, { color: c.primary }]}>
                {t('fb_rev_continue_anyway')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  if (!showForm) {
    return (
      <View style={[styles.root, { backgroundColor: c.background }]}>
        {header}
        <ScrollView
          contentContainerStyle={[
            styles.guardWrap,
            { paddingBottom: insets.bottom + 28 },
          ]}
        >
          {guardState === 'REVIEWED' && reviewGuard.data?.my_review ? (
            <>
              <View style={[styles.guardCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <View style={styles.guardTitleRow}>
                  <View style={[styles.guardCheck, { backgroundColor: c.successLight }]}>
                    <Feather name="check" size={13} color={c.success} />
                  </View>
                  <Text style={[styles.stateTitle, { color: c.text }]}>
                    {t('fb_rev_submitted')}
                  </Text>
                </View>
                <Text style={[styles.stateMsg, { color: c.mutedForeground }]}>
                  {t('fb_rev_visibility')}
                </Text>
              </View>
              <MyReviewCard
                review={reviewGuard.data.my_review}
                viewerSide={viewerSide}
                title={t('fb_rev_your')}
                optionLookup={reviewOptionLabels}
                onOpenMedia={(items, index) => setGuardViewer({ items, index })}
              />
            </>
          ) : (
            <View style={[styles.guardCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Feather
                name={guardState === 'EXPIRED' ? 'clock' : 'info'}
                size={24}
                color={c.mutedForeground}
              />
              <Text style={[styles.stateTitle, { color: c.text }]}>
                {guardState === 'EXPIRED' ? t('fb_rev_period_ended') : t('fb_rev_not_available')}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.stateBtn, { backgroundColor: c.primary }]}
            onPress={leave}
            activeOpacity={0.85}
          >
            <Text style={[styles.stateBtnText, { color: c.primaryForeground }]}>
              {t('fb_rev_success_done')}
            </Text>
          </TouchableOpacity>
        </ScrollView>

        <MediaViewer
          visible={guardViewer !== null}
          items={guardViewer?.items ?? []}
          initialIndex={guardViewer?.index ?? 0}
          onClose={() => setGuardViewer(null)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {header}
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Keyboard: the shared aware scroller lifts the focused field above the
            keyboard, and tapping outside dismisses it. */}
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={[
            styles.content,
            { paddingBottom: (isReview ? 108 : 32) + insets.bottom },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          bottomOffset={16}
        >
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
            {t(SUBTITLE_KEY[context])}
          </Text>

          {/* Deadline at the top of the form, when the job reports one. Gold
              inside the last 24 hours, exactly like the Job Details card. */}
          {isReview && reviewDeadline ? (
            <Text
              style={[
                styles.reviewHint,
                { color: deadlineLeft.underDay ? c.gold : c.mutedForeground },
              ]}
            >
              {t('fb_rev_until', { date: reviewDeadline })}
              {deadlineLeft.known
                ? ` · ${
                    deadlineLeft.underDay
                      ? t('fb_rev_less_than_day')
                      : t('fb_rev_days_left', { n: Math.max(1, deadlineLeft.days) })
                  }`
                : ''}
            </Text>
          ) : null}

          {/* Job context — everything here comes from the Job Details screen,
              which already had it; no extra request is made. The other party's
              avatar is a TODO: the job payload only carries
              `assigned_provider_id`, not a name or a picture. */}
          {isReview && (title || date || other) ? (
            <Animated.View
              entering={FadeIn.duration(POPUP_FADE_IN_MS)}
              style={[styles.jobCard, { backgroundColor: c.card, borderColor: c.border }]}
            >
              <View style={[styles.jobIcon, { backgroundColor: c.primaryLight }]}>
                <Feather name="briefcase" size={18} color={c.primary} />
              </View>
              <View style={styles.jobBody}>
                {title ? (
                  <Text style={[styles.jobTitle, { color: c.text }]} numberOfLines={2}>
                    {title}
                  </Text>
                ) : null}
                {date ? (
                  <Text style={[styles.jobMeta, { color: c.mutedForeground }]} numberOfLines={1}>
                    {date}
                  </Text>
                ) : null}
                {other ? (
                  <View style={styles.jobPerson}>
                    <Feather name="user" size={13} color={c.mutedForeground} />
                    <Text style={[styles.jobMeta, { color: c.mutedForeground }]} numberOfLines={1}>
                      {other}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Animated.View>
          ) : null}

          <FeedbackForm
            context={context}
            jobId={toId(jobId)}
            milestoneId={toId(milestoneId)}
            onDone={leave}
            onDirtyChange={isReview ? setDirty : undefined}
            onStateChange={isReview ? setFormState : undefined}
            submitAction={isReview ? submitAction : undefined}
          />
        </KeyboardAwareScrollViewCompat>

        {/* Sticky review footer: the same submit handler, always reachable while
            the form scrolls (and above the keyboard via the wrapper above). */}
        {isReview ? (
          <View
            style={[
              styles.footer,
              {
                backgroundColor: c.background,
                borderTopColor: c.border,
                paddingBottom: insets.bottom + 12,
              },
            ]}
          >
            {formState.busy ? (
              <View
                style={[styles.footerBtn, { backgroundColor: c.primary }]}
                accessibilityState={{ busy: true }}
              >
                <DotsLoader color={c.primaryForeground} />
              </View>
            ) : (
              <TouchableOpacity
                style={[
                  styles.footerBtn,
                  { backgroundColor: c.primary },
                  !formState.canSubmit && styles.footerBtnDisabled,
                ]}
                onPress={() => submitAction.current?.()}
                disabled={!formState.canSubmit}
                activeOpacity={0.85}
                accessibilityState={{ disabled: !formState.canSubmit }}
              >
                <Feather name="send" size={16} color={c.primaryForeground} />
                <Text style={[styles.footerBtnText, { color: c.primaryForeground }]}>
                  {t(SUBMIT_LABEL_KEY[context])}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: {
    flex: 1,
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  headerSpacer: { width: 40 },
  content: { padding: 20, gap: 14 },
  subtitle: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19 },
  jobCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  jobIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobBody: { flex: 1, gap: 3 },
  jobTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, lineHeight: 19 },
  jobMeta: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 17, flexShrink: 1 },
  jobPerson: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    minHeight: 52,
    paddingVertical: 15,
  },
  footerBtnDisabled: { opacity: 0.5 },
  footerBtnText: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  guardWrap: { padding: 20, gap: 12 },
  guardCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    gap: 10,
  },
  guardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  guardCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 18,
  },
  guardBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  guardLink: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, marginTop: 2 },
  reviewHint: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 18 },
  stateTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16, textAlign: 'center' },
  stateMsg: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  stateBtn: { marginTop: 8, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22 },
  stateBtnText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
});
