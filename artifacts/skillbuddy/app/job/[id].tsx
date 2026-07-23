import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import BackButton from '@/components/BackButton';
import { BID_PROVIDERS, MOCK_BIDS, MOCK_JOBS } from '@/data/mockData';
import { calculateProviderScore } from '@/lib/scoring';
import CountdownTimer from '@/components/CountdownTimer';
import BidCard from '@/components/BidCard';
import EmptyState from '@/components/EmptyState';
import BrandedLoader from '@/components/BrandedLoader';
import { useAppAlert } from '@/context/AlertModalContext';
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const showAlert = useAppAlert();

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
        <EmptyState icon="alert-circle" title="Job not found" />
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
      title: 'Cancel Job',
      message: 'Are you sure? No cancellation fee applies at this stage.',
      icon: 'alert-triangle',
      buttons: [
        { text: 'Keep Job', style: 'cancel' },
        {
          text: 'Cancel Job',
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
      title: 'Accept this bid?',
      message: `${bid.provider.name} — €${bid.price}, ETA ${bid.eta}`,
      icon: 'check-circle',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          onPress: () => {
            job.status = 'assigned';
            job.assignedProviderId = bid.provider.id;
            router.back();
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
                <Text style={[styles.restartText, { color: c.text }]}>Restart Timer</Text>
              </TouchableOpacity>
            )}

            {expired && bids.length === 0 ? (
              <View style={[styles.noBidsCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <Feather name="inbox" size={32} color={c.mutedForeground} />
                <Text style={[styles.noBidsTitle, { color: c.text }]}>No Bids Found</Text>
                <Text style={[styles.noBidsSub, { color: c.mutedForeground }]}>
                  No SkillBuddy Pilots bid within the window. Try restarting the timer{job.urgency === 'urgent' ? ', or convert this to a Regular request for a longer window.' : '.'}
                </Text>
                <View style={styles.noBidsActions}>
                  <TouchableOpacity style={[styles.restartBtnFull, { backgroundColor: c.primary }]} onPress={restartTimer}>
                    <Text style={styles.restartFullText}>Restart Timer</Text>
                  </TouchableOpacity>
                  {job.urgency === 'urgent' && (
                    <TouchableOpacity style={[styles.restartBtnFull, { backgroundColor: c.muted }]} onPress={convertToRegular}>
                      <Text style={[styles.restartFullText, { color: c.text }]}>Convert to Regular</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ) : (
              <>
                {top3.length > 0 && (
                  <>
                    <View style={styles.sectionHeaderRow}>
                      <Text style={[styles.sectionTitle, { color: c.text }]}>Recommended SkillBuddies</Text>
                      <TouchableOpacity onPress={() => setShowAll(true)}>
                        <Text style={[styles.viewAll, { color: c.primary }]}>View All Offers ({bids.length})</Text>
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
                      <Text style={[styles.sectionTitle, { color: c.text }]}>All Offers</Text>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                      {([
                        ['recommended', 'Best Match'],
                        ['lowPrice', 'Lowest Price'],
                        ['highRating', 'Highest Rated'],
                        ['distance', 'Nearest'],
                        ['badge', 'Badge Tier'],
                      ] as [SortMode, string][]).map(([mode, label]) => (
                        <TouchableOpacity
                          key={mode}
                          style={[styles.sortChip, { backgroundColor: sortMode === mode ? c.primary : c.muted, marginRight: 8 }]}
                          onPress={() => setSortMode(mode)}
                        >
                          <Text style={[styles.sortChipText, { color: sortMode === mode ? '#FFF' : c.text }]}>{label}</Text>
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
              {job.status === 'assigned' ? 'Job assigned' : job.status === 'cancelled' ? 'Job cancelled' : 'Job in progress'}
            </Text>
          </View>
        )}

        <TouchableOpacity style={[styles.cancelBtn, { borderColor: c.border }]} onPress={cancelJob}>
          <Text style={[styles.cancelText, { color: c.destructive }]}>Cancel Job</Text>
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
});
