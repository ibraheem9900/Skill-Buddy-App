import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import useJobBids from '@/hooks/useJobBids';
import BidOfferCard from '@/components/BidOfferCard';
import type { BidLocale } from '@/lib/bid';
import type { BidTaskWindow } from '@/lib/bidTimes';

interface Props {
  jobId: number;
  /** The job's tasks, so every offer shows the real date for each arrival. */
  tasks?: BidTaskWindow[];
  /** Only the owning client may read this job's offers. */
  canView: boolean;
  onViewAll: () => void;
  /** Bumped by the parent's pull-to-refresh so offers refresh with the job. */
  refreshSignal?: number;
}

/**
 * The client's live offers on Job Details. It deliberately reuses the same
 * endpoint, hook and card as /job/[id]/bids, so a newly arrived bid cannot be
 * visible on one screen and missing on the other.
 */
export default function JobOffersSection({
  jobId,
  tasks = [],
  canView,
  onViewAll,
  refreshSignal,
}: Props) {
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();
  const {
    status,
    all,
    total,
    serverMessage,
    refreshing,
    refreshFailed,
    newBidIds,
    refresh,
    reload,
  } = useJobBids(canView ? jobId : null, { live: canView });
  const lastSignal = useRef(refreshSignal ?? 0);

  useEffect(() => {
    if (!canView || refreshSignal === undefined) return;
    if (refreshSignal === lastSignal.current) return;
    lastSignal.current = refreshSignal;
    void refresh();
  }, [canView, refresh, refreshSignal]);

  if (!canView) return null;

  // At most TWO offers in the preview; the rest live behind "View Bids".
  const visible = all.slice(0, 2);
  const hasMore = total > visible.length;

  return (
    <View>
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.text }]}>{t('jobd_offers_title')}</Text>
        <View style={styles.headerActions}>
          {refreshing ? <ActivityIndicator size="small" color={c.primary} /> : null}
          <TouchableOpacity
            onPress={() => void refresh()}
            style={styles.refreshBtn}
            accessibilityRole="button"
            accessibilityLabel={t('jobd_offers_refresh')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="refresh-cw" size={14} color={c.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onViewAll} accessibilityRole="button">
            <Text style={[styles.viewAll, { color: c.primary }]}>{t('jobd_offers_view_all')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {refreshFailed ? (
        <Text style={[styles.notice, { color: c.mutedForeground }]}>
          {t('jobd_offers_refresh_failed')}
        </Text>
      ) : null}

      {status === 'loading' ? (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <ActivityIndicator color={c.primary} />
          <Text style={[styles.muted, { color: c.mutedForeground }]}>{t('jobd_offers_loading')}</Text>
        </View>
      ) : status === 'error' || status === 'invalid' || status === 'unauthorized' || status === 'forbidden' ? (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.destructive }]}>
          <Feather name="alert-circle" size={18} color={c.destructive} />
          <Text style={[styles.muted, { color: c.text }]}>
            {serverMessage ?? t('jobd_offers_error')}
          </Text>
          <TouchableOpacity
            style={[styles.retry, { backgroundColor: c.primary }]}
            onPress={() => void reload()}
            accessibilityRole="button"
          >
            <Text style={[styles.retryText, { color: c.primaryForeground }]}>
              {t('jobd_offers_try_again')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : visible.length === 0 ? (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="inbox" size={20} color={c.mutedForeground} />
          <Text style={[styles.muted, { color: c.mutedForeground }]}>{t('jobd_offers_empty')}</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Text style={[styles.count, { color: c.mutedForeground }]}>
            {t('jobd_offers_count', { n: total })}
          </Text>
          {visible.map((bid) => (
            <BidOfferCard
              key={bid.id}
              bid={bid}
              tasks={tasks}
              locale={(language ?? 'en') as BidLocale}
              isNew={newBidIds.includes(bid.id)}
              onPress={onViewAll}
            />
          ))}
          {hasMore ? (
            <TouchableOpacity
              onPress={onViewAll}
              style={[styles.more, { borderColor: c.border, backgroundColor: c.card }]}
              accessibilityRole="button"
            >
              <Text style={[styles.moreText, { color: c.primary }]}>
                {t('jobd_offers_view_all')}
              </Text>
              <Feather name="chevron-right" size={15} color={c.primary} />
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 10,
    gap: 10,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  refreshBtn: { padding: 2 },
  viewAll: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  notice: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginBottom: 8 },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  muted: { fontFamily: 'Manrope_400Regular', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  retry: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9, marginTop: 2 },
  retryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  count: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
  },
  moreText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
});
