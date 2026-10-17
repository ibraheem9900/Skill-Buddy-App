import React from 'react';
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
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import useMyBids from '@/hooks/useMyBids';
import MyBidsCard from '@/components/MyBidsCard';
import EmptyState from '@/components/EmptyState';
import { SkeletonBox } from '@/components/SkeletonCard';
import { MY_BIDS_STATUS_VALUES, myBidsEmptyKeys, myBidsFilterLabelKey } from '@/lib/myBids';
import type { BidResponse } from '@/types';

interface Props {
  /** Provider mode with the My Bids chip selected. */
  enabled: boolean;
  /** Space the Android navigation bar + tab bar need at the bottom. */
  bottomInset: number;
}

/**
 * The provider's "My Bids" list: GET /api/v1/bids/mine.
 *
 * STATES (each with its own screen-reader-visible form):
 *   loading      three skeleton rows — never an empty list flashing
 *   bids         the cards, newest first (the server's order)
 *   empty        per FILTER: "No pending bids" is not "no bids at all"
 *   invalid      the query itself was rejected (422) — an app bug, shown with
 *                the backend's own `detail`
 *   unauthorized the session is over
 *   forbidden    a client-only account reached the provider endpoint
 *   error        everything else, with the backend's own text when it sent one
 *
 * The chips are the five values of the live BidStatus enum plus "All" — nothing
 * invented, and nothing the endpoint would 422 on (the enum is case-sensitive).
 */
const FILTERS = [null, ...MY_BIDS_STATUS_VALUES] as const;

export default function MyBidsFeed({ enabled, bottomInset }: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const router = useRouter();

  const {
    status,
    bids,
    filter,
    setFilter,
    loadingMore,
    refreshing,
    inlineError,
    serverMessage,
    refresh,
    retry,
    loadMore,
    titles,
    titlesFailed,
    onViewableItemsChanged,
    viewabilityConfig,
    firstLoad,
  } = useMyBids();

  const openJob = (bid: BidResponse) => router.push(`/job/${bid.job_id}` as any);

  const chips = () => (
    <View style={styles.filterBlock}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map((value) => {
          const active = filter === value;
          return (
            <TouchableOpacity
              key={value ?? 'all'}
              style={[styles.chip, { backgroundColor: active ? c.primary : c.muted }]}
              onPress={() => setFilter(value)}
              accessibilityRole="button"
            >
              <Text
                style={[styles.chipText, { color: active ? c.primaryForeground : c.mutedForeground }]}
              >
                {t(myBidsFilterLabelKey(value))}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  const skeleton = () => (
    <View style={{ padding: 20, gap: 12 }}>
      {[0, 1, 2].map((index) => (
        <View key={index} style={[styles.skeletonCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <SkeletonBox height={16} style={{ width: '55%' }} />
          <SkeletonBox height={14} style={{ width: '30%', marginTop: 12 }} />
          <SkeletonBox height={11} style={{ width: '40%', marginTop: 10 }} />
        </View>
      ))}
    </View>
  );

  const hardError = () => {
    const title =
      status === 'unauthorized'
        ? t('jobs_session_title')
        : status === 'forbidden'
          ? t('mybids_forbidden_title')
          : status === 'invalid'
            ? t('mybids_invalid_title')
            : t('mybids_load_error_title');
    const message =
      status === 'unauthorized'
        ? t('jobs_unauthorized_msg')
        : status === 'forbidden'
          ? t('mybids_forbidden_sub')
          : status === 'invalid'
            ? serverMessage ?? t('mybids_invalid_sub')
            : serverMessage ?? t('mybids_load_error_sub');
    const icon = status === 'unauthorized' ? 'lock' : status === 'forbidden' ? 'lock' : 'alert-circle';
    return (
      <View style={styles.stateWrap}>
        <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name={icon} size={28} color={c.destructive} />
          <Text style={[styles.stateTitle, { color: c.text }]}>{title}</Text>
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>{message}</Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: c.primary }]} onPress={retry}>
            <Text style={[styles.retryText, { color: c.primaryForeground }]}>{t('jobs_retry')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const footer = () => {
    if (loadingMore) {
      return (
        <View style={styles.footer}>
          <ActivityIndicator color={c.primary} />
        </View>
      );
    }
    if (inlineError) {
      return (
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: c.mutedForeground }]}>
            {t('mybids_inline_error')}
          </Text>
        </View>
      );
    }
    return <View style={{ height: bottomInset }} />;
  };

  if (!enabled) return <View style={{ flex: 1 }} />;
  if (firstLoad) {
    return (
      <View style={{ flex: 1 }}>
        {chips()}
        {skeleton()}
      </View>
    );
  }
  if (bids.length === 0 && (status === 'error' || status === 'invalid' || status === 'unauthorized' || status === 'forbidden')) {
    return (
      <View style={{ flex: 1 }}>
        {chips()}
        {hardError()}
      </View>
    );
  }

  const empty = myBidsEmptyKeys(filter);

  return (
    <View style={{ flex: 1 }}>
      {chips()}

      <FlatList
        data={bids}
        keyExtractor={(bid) => String(bid.id)}
        contentContainerStyle={{ padding: 20, paddingBottom: bottomInset + 20, gap: 12, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.4}
        onEndReached={() => loadMore()}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} colors={[c.primary]} />
        }
        ListEmptyComponent={
          <EmptyState icon="briefcase" title={t(empty.title)} subtitle={t(empty.sub)} />
        }
        ListFooterComponent={footer()}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(Math.min(index, 6) * 60).duration(350)}>
            <MyBidsCard
              bid={item}
              title={titles[item.job_id] ?? null}
              titleFailed={titlesFailed[item.job_id] === true}
              onPress={() => openJob(item)}
            />
          </Animated.View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  filterBlock: { paddingVertical: 10 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, alignItems: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  chipText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  skeletonCard: { borderWidth: 1, borderRadius: 14, padding: 14 },
  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  stateCard: {
    alignItems: 'center',
    gap: 10,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    width: '100%',
  },
  stateTitle: { fontFamily: 'Manrope_700Bold', fontSize: 15, textAlign: 'center' },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  retryBtn: { marginTop: 4, paddingHorizontal: 24, paddingVertical: 11, borderRadius: 22 },
  retryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  footer: { paddingVertical: 16, alignItems: 'center' },
  footerText: { fontFamily: 'Manrope_400Regular', fontSize: 12, textAlign: 'center' },
});
