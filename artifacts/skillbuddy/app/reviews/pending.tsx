import React, { useCallback, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { useRole } from '@/context/RoleContext';
import { useAuth } from '@/context/AuthContext';
import BackButton from '@/components/BackButton';
import EmptyState from '@/components/EmptyState';
import SkeletonCard from '@/components/SkeletonCard';
import { peekJobDetail } from '@/hooks/useJobDetail';
import { usePendingReviews } from '@/hooks/usePendingReviews';
import { POPUP_FADE_IN_MS, POPUP_FADE_OUT_MS } from '@/lib/motion';
import {
  formatReviewDeadline,
  pendingReviewRole,
  timeLeft,
  urgencyLevel,
  type PendingReview,
} from '@/lib/reviews';
import type { FeedbackFailureKind } from '@/lib/feedback';

/**
 * "Reviews to write" — the closed jobs still waiting for this user's review.
 *
 * Pure reader of GET /api/v1/reviews/pending (via usePendingReviews): the items
 * carry NO role, so each card's button label is resolved from the job the app
 * already holds (hooks/useJobDetail's cache, no extra request). When that job is
 * not cached the card says "Rate this job" rather than guessing.
 *
 * Expired items never reach this screen (the hook drops them); pull-to-refresh,
 * skeleton while loading, Try Again on failure, and the app's empty state when
 * everything is done.
 */
const FAILURE_KEY: Record<FeedbackFailureKind, TranslationKey> = {
  unauthorized: 'fb_err_unauthorized',
  validation: 'fb_err_generic',
  network: 'fb_err_network',
  forbidden: 'fb_err_generic',
  notfound: 'fb_err_generic',
  server: 'fb_err_server',
  unknown: 'fb_err_generic',
};

export default function PendingReviewsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();
  const { activeRole } = useRole();
  const { user } = useAuth();
  const { items, status, failure, refreshing, refetch } = usePendingReviews();
  const [opening, setOpening] = useState<number | null>(null);

  // User.id is a string on the wire; the job's client_id is a number.
  const numericUserId = user?.id ? Number(user.id) : NaN;
  const userId = Number.isInteger(numericUserId) && numericUserId > 0 ? numericUserId : null;

  /**
   * Role per item from a job the app already has. Cached lookups only — the
   * pending payload has no role and no counterpart, and no new request is made
   * here for one.
   */
  const sideOf = useCallback(
    (item: PendingReview) => pendingReviewRole(peekJobDetail(item.job_id), userId),
    [userId]
  );

  const openReview = useCallback(
    (item: PendingReview) => {
      const side = sideOf(item);
      const context =
        side === 'PROVIDER' || (!side && activeRole === 'PROVIDER')
          ? 'PROVIDER_REVIEW'
          : 'CLIENT_REVIEW';
      setOpening(item.job_id);
      router.push(`/feedback/${context}?jobId=${item.job_id}&role=${context === 'PROVIDER_REVIEW' ? 'PROVIDER' : 'CLIENT'}` as any);
    },
    [activeRole, router, sideOf]
  );

  const loading = status === 'loading';
  const failed = status === 'error';

  const header = (
    <View style={[styles.header, { backgroundColor: c.headerBg, paddingTop: insets.top + 10 }]}>
      <StatusBar style="light" />
      <View style={styles.headerRow}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.headerTitle} numberOfLines={2}>
          {t('fb_pending_title')}
        </Text>
        <View style={styles.headerSpacer} />
      </View>
    </View>
  );

  const itemCount = items.length;
  const subtitle = useMemo(
    () =>
      itemCount > 0
        ? t('fb_pending_list_sub', { n: itemCount })
        : t('fb_pending_empty_msg'),
    [itemCount, t]
  );

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
            {[0, 1, 2].map((row) => (
              <SkeletonCard key={row} />
            ))}
          </View>
        ) : failed ? (
          <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="alert-circle" size={24} color={c.destructive} />
            <Text style={[styles.stateTitle, { color: c.text }]}>
              {t('fb_pending_load_error')}
            </Text>
            <Text style={[styles.stateMsg, { color: c.mutedForeground }]}>
              {t(FAILURE_KEY[failure ?? 'unknown'])}
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
        ) : items.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="check-circle"
              title={t('fb_pending_empty_title')}
              subtitle={t('fb_pending_empty_msg')}
            />
          </View>
        ) : (
          <>
            <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{subtitle}</Text>
            {items.map((item) => {
              const side = sideOf(item);
              const level = urgencyLevel(item.review_deadline);
              const left = timeLeft(item.review_deadline);
              const closed = formatReviewDeadline(item.closed_at, language);
              const deadlineChip =
                level === 'SOON'
                  ? t('fb_pending_less_24')
                  : left.known
                    ? left.days >= 1
                      ? t('fb_pending_days_left', { n: left.days })
                      : t('fb_pending_hours_left', { n: Math.max(1, left.hours) })
                    : '';
              const actionLabel =
                side === 'CLIENT'
                  ? t('fb_rev_entry_client')
                  : side === 'PROVIDER'
                    ? t('fb_rev_entry_provider')
                    : t('fb_pending_rate_neutral');

              return (
                <Animated.View
                  key={item.job_id}
                  entering={FadeIn.duration(POPUP_FADE_IN_MS)}
                  exiting={FadeOut.duration(POPUP_FADE_OUT_MS)}
                  style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
                >
                  <TouchableOpacity
                    onPress={() => openReview(item)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={3}>
                      {item.title.trim().length > 0 ? item.title : t('fb_pending_untitled')}
                    </Text>
                    {closed ? (
                      <Text style={[styles.cardMeta, { color: c.mutedForeground }]}>
                        {t('fb_pending_closed_on', { date: closed })}
                      </Text>
                    ) : null}
                  </TouchableOpacity>

                  <View style={styles.cardFooter}>
                    {deadlineChip ? (
                      <View
                        style={[
                          styles.chip,
                          {
                            backgroundColor: level === 'SOON' ? c.goldLight : c.muted,
                            borderColor: level === 'SOON' ? c.gold : c.border,
                          },
                        ]}
                      >
                        <Feather
                          name="clock"
                          size={11}
                          color={level === 'SOON' ? c.gold : c.mutedForeground}
                        />
                        <Text
                          style={[
                            styles.chipText,
                            { color: level === 'SOON' ? c.gold : c.mutedForeground },
                          ]}
                        >
                          {deadlineChip}
                        </Text>
                      </View>
                    ) : (
                      <View />
                    )}
                  </View>

                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={[styles.primaryBtn, { backgroundColor: c.primary }]}
                      onPress={() => openReview(item)}
                      activeOpacity={0.85}
                      disabled={opening === item.job_id}
                    >
                      <Feather name="star" size={14} color={c.primaryForeground} />
                      <Text style={[styles.primaryText, { color: c.primaryForeground }]}>
                        {actionLabel}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.secondaryBtn, { borderColor: c.border }]}
                      onPress={() => router.push(`/job/${item.job_id}` as any)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.secondaryText, { color: c.text }]}>
                        {t('fb_pending_view_job')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </Animated.View>
              );
            })}
          </>
        )}
      </ScrollView>
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
  subtitle: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19 },
  skeletonWrap: { gap: 12 },
  emptyWrap: { minHeight: 360 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  cardTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 15, lineHeight: 20 },
  cardMeta: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 17, marginTop: 3 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  chipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11, flexShrink: 1 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 12,
    minHeight: 44,
    paddingVertical: 11,
    paddingHorizontal: 16,
    flexGrow: 1,
  },
  primaryText: { fontFamily: 'Manrope_700Bold', fontSize: 13, flexShrink: 1 },
  secondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 44,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  secondaryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  stateCard: { borderWidth: 1, borderRadius: 16, padding: 18, alignItems: 'center', gap: 8 },
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
});
