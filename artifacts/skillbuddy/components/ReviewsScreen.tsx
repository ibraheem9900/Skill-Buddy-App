import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import DotsLoader from '@/components/DotsLoader';
import MediaViewer, { type MediaViewerItem } from '@/components/MediaViewer';
import ReviewCard from '@/components/ReviewCard';
import RatingSummary from '@/components/RatingSummary';
import { useFeedbackOptions } from '@/hooks/useFeedbackOptions';
import { useReviewsPage, type ReviewSubject } from '@/hooks/useReviewsPage';
import type { FeedbackFailureKind } from '@/lib/feedback';
import { reviewContext, type Review } from '@/lib/reviews';

/**
 * ONE "Reviews" screen for BOTH published-review lists — a pilot's reviews
 * (written by clients) and a client's reviews (written by pilots). Which list it
 * is comes from `subject`; the id is the PROFILE id the endpoint expects (both
 * were measured live: the user id answers 404).
 *
 * Behaviour is identical for both subjects: infinite scroll (guarded against
 * double fires), pull-to-refresh back to offset 0, first-load skeleton, error
 * with Try Again, empty state, inline "couldn't load more" row that keeps what
 * is already loaded.
 *
 * Read-only: no reply/report feature exists in the API.
 */
const FAILURE_KEY: Record<FeedbackFailureKind, TranslationKey> = {
  unauthorized: 'fb_err_unauthorized',
  validation: 'fb_err_generic',
  network: 'fb_err_network',
  forbidden: 'fb_prov_unavailable',
  notfound: 'fb_prov_unavailable',
  server: 'fb_err_server',
  unknown: 'fb_err_generic',
};

interface Props {
  subject: ReviewSubject;
  /** Provider profile id (subject="provider") or client profile id. */
  id: number | null;
}

export default function ReviewsScreen({ subject, id }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  const {
    summary,
    reviews,
    loading,
    loadingMore,
    refreshing,
    failure,
    moreFailure,
    hasMore,
    loadMore,
    retryLoadMore,
    refetch,
  } = useReviewsPage(subject, id);

  // Reviews about a provider were written by a client (CLIENT_REVIEW); reviews
  // about a client were written by a pilot (PROVIDER_REVIEW). The mapping lives
  // in reviewContextForRole — one source of truth, no second table here.
  const options = useFeedbackOptions(
    reviewContext(subject === 'provider' ? 'CLIENT' : 'PROVIDER')
  );
  const optionLookup = useMemo(
    () => new Map(options.options.map((option) => [option.id, option.label])),
    [options.options]
  );

  const [viewer, setViewer] = useState<{ items: MediaViewerItem[]; index: number } | null>(null);
  const openMedia = useCallback((items: MediaViewerItem[], index: number) => {
    setViewer({ items, index });
  }, []);

  const reviewerLabel =
    subject === 'provider' ? t('fb_prov_reviewer_client') : t('fb_rev_reviewer_pilot');

  const header = (
    <View style={[styles.header, { backgroundColor: c.headerBg, paddingTop: insets.top + 10 }]}>
      <StatusBar style="light" />
      <View style={styles.headerRow}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('fb_prov_title')}
        </Text>
        <View style={styles.headerSpacer} />
      </View>
    </View>
  );

  const renderItem = ({ item }: { item: Review }) => (
    <View style={styles.cardWrap}>
      <ReviewCard
        review={item}
        viewerSide="CLIENT"
        variant="public"
        title={reviewerLabel}
        optionLookup={optionLookup}
        onOpenMedia={openMedia}
      />
    </View>
  );

  const footer = () => {
    if (loadingMore) {
      return (
        <View style={styles.footer}>
          <DotsLoader color={c.mutedForeground} />
        </View>
      );
    }
    if (moreFailure) {
      return (
        <TouchableOpacity
          style={[styles.moreRetry, { borderColor: c.border, backgroundColor: c.card }]}
          onPress={retryLoadMore}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <Feather name="refresh-cw" size={14} color={c.primary} />
          <Text style={[styles.moreRetryText, { color: c.text }]} numberOfLines={2}>
            {t('fb_prov_retry_more')}
          </Text>
        </TouchableOpacity>
      );
    }
    return null;
  };

  const failedFirstLoad = !loading && failure !== null && reviews.length === 0;

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {header}

      {loading ? (
        <View style={styles.skeletonWrap}>
          {[0, 1, 2, 3].map((row) => (
            <View
              key={row}
              style={[styles.skeleton, { backgroundColor: c.muted, borderColor: c.border }]}
            />
          ))}
        </View>
      ) : failedFirstLoad ? (
        <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="alert-circle" size={24} color={c.destructive} />
          <Text style={[styles.stateTitle, { color: c.text }]}>{t('fb_prov_load_error')}</Text>
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
      ) : (
        <FlatList
          data={reviews}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
          ListHeaderComponent={
            <View style={styles.summaryWrap}>
              <RatingSummary summary={summary} subject={subject} />
            </View>
          }
          ListEmptyComponent={
            <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Feather name="star" size={24} color={c.mutedForeground} />
              <Text style={[styles.stateTitle, { color: c.text }]}>{t('fb_prov_no_reviews')}</Text>
              <Text style={[styles.stateMsg, { color: c.mutedForeground }]}>
                {t(subject === 'provider' ? 'fb_prov_empty_msg' : 'fb_rev_client_empty_msg')}
              </Text>
            </View>
          }
          ListFooterComponent={footer}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasMore) void loadMore();
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refetch('refresh')}
              tintColor={c.primary}
              colors={[c.primary]}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

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
  summaryWrap: { marginBottom: 6 },
  cardWrap: { marginBottom: 12 },
  footer: { paddingVertical: 16 },
  moreRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  moreRetryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, flexShrink: 1 },
  skeletonWrap: { padding: 20, gap: 12 },
  skeleton: { height: 100, borderRadius: 16, borderWidth: 1, opacity: 0.5 },
  stateCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    gap: 8,
    margin: 20,
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
    minHeight: 44,
  },
  retryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
