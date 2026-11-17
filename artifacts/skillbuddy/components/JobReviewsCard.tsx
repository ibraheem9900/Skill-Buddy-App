import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import DotsLoader from '@/components/DotsLoader';
import MediaViewer, { type MediaViewerItem } from '@/components/MediaViewer';
import MyReviewCard from '@/components/MyReviewCard';
import ReviewCard from '@/components/ReviewCard';
import { useJobReviews } from '@/hooks/useJobReviews';
import { POPUP_FADE_IN_MS } from '@/lib/motion';
import {
  formatReviewDeadline,
  reviewState,
  theirReviewVisible,
  timeLeft,
} from '@/lib/reviews';
import type { FeedbackFailureKind } from '@/lib/feedback';
import type { FeedbackSide } from '@/lib/taskFeedback';
import type { TranslationKey } from '@/context/LanguageContext';

/**
 * The Job Details "Reviews" card — the whole job review state, both roles.
 *
 * It is only rendered for a CLOSED job (the screen owns that check, so the card
 * never claims a closed state by itself). Four states, from lib/reviews
 * reviewState():
 *   CAN_REVIEW  → "Rate your Pilot/Client" + the deadline hint (gold under 24h)
 *   REVIEWED    → "Review submitted", my review summary, their review or the
 *                 locked 14-day explanation
 *   EXPIRED     → "The review period has ended", no button
 *   UNAVAILABLE → a neutral line (never a button)
 *
 * The card owns the image viewer for review attachments so Job Details needs
 * nothing but this component.
 */

const FAILURE_KEY: Record<FeedbackFailureKind, TranslationKey> = {
  unauthorized: 'fb_err_unauthorized',
  validation: 'fb_err_generic',
  network: 'fb_err_network',
  forbidden: 'fb_rev_not_available',
  notfound: 'fb_rev_not_available',
  server: 'fb_err_server',
  unknown: 'fb_err_generic',
};

interface Props {
  jobId: number;
  /** The viewer's side of THIS job (owner → CLIENT, assigned pilot → PROVIDER). */
  viewerSide: FeedbackSide;
  optionLookup: ReadonlyMap<number, string>;
  onRate: () => void;
  onViewReviews: () => void;
}

export default function JobReviewsCard({
  jobId,
  viewerSide,
  optionLookup,
  onRate,
  onViewReviews,
}: Props) {
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();
  const { data, status, failure, refetch } = useJobReviews(jobId);
  const [viewer, setViewer] = useState<{ items: MediaViewerItem[]; index: number } | null>(null);

  const state = reviewState(data);
  const left = timeLeft(data?.review_deadline);
  const deadlineText = formatReviewDeadline(data?.review_deadline, language);

  const myTitle = t('fb_rev_your');
  const theirTitle =
    viewerSide === 'CLIENT' ? t('fb_rev_from_pilot') : t('fb_rev_from_client');

  const roleLabel = useMemo(
    () => (viewerSide === 'CLIENT' ? t('fb_rev_entry_client') : t('fb_rev_entry_provider')),
    [t, viewerSide]
  );

  const openMedia = useCallback((items: MediaViewerItem[], index: number) => {
    setViewer({ items, index });
  }, []);

  const closeViewer = useCallback(() => setViewer(null), []);

  const shell = (children: React.ReactNode) => (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>{children}</View>
  );

  /* ------------------------------------------------------------- loading */
  if (status === 'idle' || status === 'loading') {
    return shell(
      <View style={styles.loadingRow}>
        <DotsLoader color={c.primary} size={5} gap={4} />
        <Text style={[styles.loadingText, { color: c.mutedForeground }]}>
          {t('fb_rev_card_title')}
        </Text>
      </View>
    );
  }

  /* --------------------------------------------------------------- error */
  if (status === 'error' || status === 'notavailable') {
    return shell(
      <>
        <View style={styles.headRow}>
          <Feather name="alert-circle" size={15} color={c.destructive} />
          <Text style={[styles.title, { color: c.text }]}>{t('fb_rev_card_title')}</Text>
        </View>
        <Text style={[styles.body, { color: c.mutedForeground }]}>
          {status === 'notavailable'
            ? t('fb_rev_not_available')
            : t(FAILURE_KEY[failure ?? 'unknown'])}
        </Text>
        {status === 'error' ? (
          <TouchableOpacity
            style={[styles.secondaryBtn, { borderColor: c.border }]}
            onPress={() => void refetch('retry')}
            activeOpacity={0.85}
          >
            <Feather name="refresh-cw" size={14} color={c.text} />
            <Text style={[styles.secondaryText, { color: c.text }]}>{t('fb_try_again')}</Text>
          </TouchableOpacity>
        ) : null}
      </>
    );
  }

  /* ------------------------------------------------------------ reviewed */
  if (state === 'REVIEWED' && data?.my_review) {
    return (
      <>
        {shell(
          <>
            <View style={styles.headRow}>
              <View style={[styles.checkCircle, { backgroundColor: c.successLight }]}>
                <Feather name="check" size={13} color={c.success} />
              </View>
              <Text style={[styles.title, { color: c.text }]}>{t('fb_rev_submitted')}</Text>
            </View>

            <MyReviewCard
              review={data.my_review}
              viewerSide={viewerSide}
              title={myTitle}
              optionLookup={optionLookup}
              onOpenMedia={openMedia}
              compact
            />

            {theirReviewVisible(data) && data?.their_review ? (
              <ReviewCard
                review={data.their_review}
                viewerSide={viewerSide}
                variant="theirs"
                title={theirTitle}
                optionLookup={optionLookup}
                onOpenMedia={openMedia}
                compact
              />
            ) : (
              <View style={[styles.locked, { backgroundColor: c.muted, borderColor: c.border }]}>
                <Feather name="lock" size={14} color={c.mutedForeground} />
                <Text style={[styles.lockedText, { color: c.mutedForeground }]}>
                  {t('fb_rev_hidden_hint')}
                </Text>
              </View>
            )}

            <TouchableOpacity onPress={onViewReviews} activeOpacity={0.8} style={styles.linkRow}>
              <Text style={[styles.linkText, { color: c.primary }]}>{t('fb_rev_view_all')}</Text>
              <Feather name="chevron-right" size={14} color={c.primary} />
            </TouchableOpacity>
          </>
        )}
        <MediaViewer
          visible={viewer !== null}
          items={viewer?.items ?? []}
          initialIndex={viewer?.index ?? 0}
          onClose={closeViewer}
        />
      </>
    );
  }

  /* ------------------------------------------------------------- expired */
  if (state === 'EXPIRED') {
    return shell(
      <>
        <View style={styles.headRow}>
          <Feather name="clock" size={15} color={c.mutedForeground} />
          <Text style={[styles.title, { color: c.text }]}>{t('fb_rev_card_title')}</Text>
        </View>
        <Text style={[styles.body, { color: c.mutedForeground }]}>{t('fb_rev_period_ended')}</Text>
        {theirReviewVisible(data) ? (
          <TouchableOpacity onPress={onViewReviews} activeOpacity={0.8} style={styles.linkRow}>
            <Text style={[styles.linkText, { color: c.primary }]}>{t('fb_rev_view_all')}</Text>
            <Feather name="chevron-right" size={14} color={c.primary} />
          </TouchableOpacity>
        ) : null}
      </>
    );
  }

  /* --------------------------------------------------------- can review */
  if (state === 'CAN_REVIEW') {
    return shell(
      <>
        <View style={styles.headRow}>
          <Feather name="star" size={15} color={c.primary} />
          <Text style={[styles.title, { color: c.text }]}>{t('fb_rev_card_title')}</Text>
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: c.primary }]}
          onPress={onRate}
          activeOpacity={0.85}
        >
          <Feather name="star" size={15} color={c.primaryForeground} />
          <Text style={[styles.primaryText, { color: c.primaryForeground }]}>{roleLabel}</Text>
        </TouchableOpacity>

        {deadlineText ? (
          <Animated.View entering={FadeIn.duration(POPUP_FADE_IN_MS)} style={styles.hintWrap}>
            <Text
              style={[
                styles.hint,
                { color: left.underDay ? c.gold : c.mutedForeground },
              ]}
            >
              {t('fb_rev_until', { date: deadlineText })}
              {left.known
                ? ` · ${
                    left.underDay
                      ? t('fb_rev_less_than_day')
                      : t('fb_rev_days_left', { n: Math.max(1, left.days) })
                  }`
                : ''}
            </Text>
          </Animated.View>
        ) : null}
      </>
    );
  }

  /* ---------------------------------------------------------- unavailable */
  return shell(
    <>
      <View style={styles.headRow}>
        <Feather name="info" size={15} color={c.mutedForeground} />
        <Text style={[styles.title, { color: c.text }]}>{t('fb_rev_card_title')}</Text>
      </View>
      <Text style={[styles.body, { color: c.mutedForeground }]}>{t('fb_rev_not_available')}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontFamily: 'Manrope_700Bold', fontSize: 14 },
  body: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loadingText: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    minHeight: 46,
    paddingVertical: 12,
  },
  primaryText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 44,
    paddingVertical: 11,
  },
  secondaryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  hintWrap: { gap: 2 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 18 },
  locked: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  lockedText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 18 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  linkText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
