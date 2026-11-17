import React, { useCallback, useMemo, useState } from 'react';
import {
  RefreshControl,
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
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import MediaViewer, { type MediaViewerItem } from '@/components/MediaViewer';
import MyReviewCard from '@/components/MyReviewCard';
import ReviewCard from '@/components/ReviewCard';
import { useFeedbackOptionLabels } from '@/hooks/useFeedbackOptionLabels';
import { useJobReviews } from '@/hooks/useJobReviews';
import {
  formatReviewDeadline,
  reviewState,
  theirReviewVisible,
  timeLeft,
} from '@/lib/reviews';
import type { FeedbackFailureKind } from '@/lib/feedback';
import type { FeedbackSide } from '@/lib/taskFeedback';

/**
 * "Job reviews" — one job's reviews for the logged-in user.
 *
 * A thin, honest reader of GET /api/v1/jobs/{job_id}/reviews: your review on
 * top, the other side's review (or the locked 14-day explanation) below. Pull to
 * refresh, the app's loader while reading, Try Again on failure. Lists of
 * provider/client reviews are NOT built — those endpoints are undocumented.
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

export default function JobReviewsScreen() {
  const { id, role } = useLocalSearchParams<{ id?: string; role?: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();
  const jobId = id && /^\d+$/.test(id) ? Number(id) : null;
  const viewerSide: FeedbackSide = role === 'PROVIDER' ? 'PROVIDER' : 'CLIENT';

  const { data, status, failure, refreshing, refetch } = useJobReviews(jobId);
  const { labels } = useFeedbackOptionLabels();
  const [viewer, setViewer] = useState<{ items: MediaViewerItem[]; index: number } | null>(null);

  const state = reviewState(data);
  const left = timeLeft(data?.review_deadline);
  const deadlineText = formatReviewDeadline(data?.review_deadline, language);

  const theirTitle = useMemo(
    () => (viewerSide === 'CLIENT' ? t('fb_rev_from_pilot') : t('fb_rev_from_client')),
    [t, viewerSide]
  );
  const roleLabel = viewerSide === 'CLIENT' ? t('fb_rev_entry_client') : t('fb_rev_entry_provider');

  const openMedia = useCallback((items: MediaViewerItem[], index: number) => {
    setViewer({ items, index });
  }, []);

  const header = (
    <View style={[styles.header, { backgroundColor: c.headerBg, paddingTop: insets.top + 10 }]}>
      <StatusBar style="light" />
      <View style={styles.headerRow}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.headerTitle} numberOfLines={2}>
          {t('fb_rev_screen_title')}
        </Text>
        <View style={styles.headerSpacer} />
      </View>
    </View>
  );

  const loading = status === 'idle' || status === 'loading';
  const failed = status === 'error' || status === 'notavailable';

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {header}

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refetch('refresh')}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      >
        {loading ? (
          <View style={styles.skeletonWrap}>
            {[0, 1, 2, 3].map((row) => (
              <View
                key={row}
                style={[
                  styles.skeleton,
                  { backgroundColor: c.muted, borderColor: c.border },
                  row === 1 ? styles.skeletonShort : null,
                ]}
              />
            ))}
          </View>
        ) : failed ? (
          <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="alert-circle" size={24} color={c.destructive} />
            <Text style={[styles.stateTitle, { color: c.text }]}>{t('fb_rev_load_error')}</Text>
            <Text style={[styles.stateMsg, { color: c.mutedForeground }]}>
              {status === 'notavailable'
                ? t('fb_rev_not_available')
                : t(FAILURE_KEY[failure ?? 'unknown'])}
            </Text>
            <TouchableOpacity
              style={[styles.retryBtn, { borderColor: c.border }]}
              onPress={() => void refetch('retry')}
              activeOpacity={0.85}
            >
              <Feather name="refresh-cw" size={15} color={c.text} />
              <Text style={[styles.retryText, { color: c.text }]}>{t('fb_try_again')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Deadline, only while reviewing is still possible. */}
            {state === 'CAN_REVIEW' && deadlineText ? (
              <Text
                style={[styles.hint, { color: left.underDay ? c.gold : c.mutedForeground }]}
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
            ) : null}

            {/* Your review */}
            <Text style={[styles.section, { color: c.text }]}>{t('fb_rev_your')}</Text>
            {data?.my_review ? (
              <MyReviewCard
                review={data.my_review}
                viewerSide={viewerSide}
                title={t('fb_rev_your')}
                optionLookup={labels}
                onOpenMedia={openMedia}
              />
            ) : state === 'CAN_REVIEW' ? (
              <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <Text style={[styles.stateMsg, { color: c.mutedForeground }]}>
                  {t('fb_rev_none_yet')}
                </Text>
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: c.primary }]}
                  onPress={() =>
                    router.push(
                      `/feedback/${
                        viewerSide === 'CLIENT' ? 'CLIENT_REVIEW' : 'PROVIDER_REVIEW'
                      }?jobId=${jobId ?? ''}&role=${viewerSide}` as any
                    )
                  }
                  activeOpacity={0.85}
                >
                  <Feather name="star" size={15} color={c.primaryForeground} />
                  <Text style={[styles.primaryText, { color: c.primaryForeground }]}>
                    {roleLabel}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <Text style={[styles.stateMsg, { color: c.mutedForeground }]}>
                  {state === 'EXPIRED' ? t('fb_rev_period_ended') : t('fb_rev_none_yet')}
                </Text>
              </View>
            )}

            {/* Their review */}
            <Text style={[styles.section, { color: c.text }]}>{t('fb_rev_theirs')}</Text>
            {theirReviewVisible(data) && data?.their_review ? (
              <ReviewCard
                review={data.their_review}
                viewerSide={viewerSide}
                variant="theirs"
                title={theirTitle}
                optionLookup={labels}
                onOpenMedia={openMedia}
              />
            ) : (
              <View style={[styles.locked, { backgroundColor: c.muted, borderColor: c.border }]}>
                <Feather name="lock" size={16} color={c.mutedForeground} />
                <Text style={[styles.lockedText, { color: c.mutedForeground }]}>
                  {t('fb_rev_hidden_hint')}
                </Text>
              </View>
            )}

            {state === 'UNAVAILABLE' ? (
              <Text style={[styles.footnote, { color: c.mutedForeground }]}>
                {t('fb_rev_not_available')}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>

      <MediaViewer
        visible={viewer !== null}
        items={viewer?.items ?? []}
        initialIndex={viewer?.index ?? 0}
        onClose={() => setViewer(null)}
      />
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
  content: { padding: 20, gap: 12 },
  section: { fontFamily: 'Manrope_700Bold', fontSize: 15, marginTop: 4 },
  hint: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 2,
  },
  skeletonWrap: { gap: 10 },
  skeleton: { height: 84, borderRadius: 16, borderWidth: 1, opacity: 0.5 },
  skeletonShort: { height: 58, width: '70%' },
  stateCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    gap: 8,
  },
  stateTitle: { fontFamily: 'Manrope_700Bold', fontSize: 15, textAlign: 'center' },
  stateMsg: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 18,
  },
  retryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    minHeight: 46,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignSelf: 'stretch',
  },
  primaryText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  locked: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  lockedText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19 },
  footnote: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 18 },
});
