import React, { useMemo, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import BackButton from '@/components/BackButton';
import { CURRENT_USER, MOCK_BIDS, MOCK_JOBS } from '@/data/mockData';
import { calculateProviderScore } from '@/lib/scoring';
import CountdownTimer from '@/components/CountdownTimer';
import InlineLoader from '@/components/InlineLoader';
import EmptyState from '@/components/EmptyState';
import { useAppAlert } from '@/context/AlertModalContext';
import type { Bid, BidProvider } from '@/types';

// The mock-logged-in provider identity (used when submitting a bid as a Pilot).
const ME_AS_PROVIDER: BidProvider = {
  id: 'me-provider',
  name: CURRENT_USER.name,
  rating: 4.7,
  reviewCount: 58,
  jobsDone: 41,
  badge: 2,
  credibility: 90,
  specialty: 'General Services',
  location: 'Riga, Latvia',
  isOnline: true,
  distanceKm: 3.1,
  responseTimeMin: 9,
};

export default function ProviderJobBidScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const showAlert = useAppAlert();

  const job = useMemo(() => MOCK_JOBS.find((j) => j.id === id), [id]);
  const existingBid = useMemo(
    () => MOCK_BIDS.find((b) => b.jobId === id && b.provider.id === ME_AS_PROVIDER.id),
    [id]
  );

  const [price, setPrice] = useState(existingBid ? String(existingBid.price) : String(job?.expectedPrice ?? ''));
  const [eta, setEta] = useState(existingBid?.eta ?? '30 min');
  const [submitted, setSubmitted] = useState(!!existingBid);
  const [submitting, setSubmitting] = useState(false);

  if (!job) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <EmptyState icon="alert-circle" title="Job not found" />
      </View>
    );
  }

  const myScore = calculateProviderScore(ME_AS_PROVIDER);

  const submitBid = async () => {
    const priceNum = parseFloat(price);
    if (!priceNum || priceNum <= 0) {
      showAlert({ title: 'Invalid price', message: 'Please enter a valid bid amount.', icon: 'alert-circle' });
      return;
    }
    setSubmitting(true);
    const bid: Bid = {
      id: existingBid?.id ?? `bid_${job.id}_me_${Date.now()}`,
      jobId: job.id,
      provider: ME_AS_PROVIDER,
      price: priceNum,
      eta,
      createdAt: Date.now(),
      score: myScore.total,
    };
    await new Promise((resolve) => setTimeout(resolve, 450));
    const idx = MOCK_BIDS.findIndex((b) => b.id === bid.id);
    if (idx >= 0) MOCK_BIDS[idx] = bid;
    else MOCK_BIDS.push(bid);
    setSubmitting(false);
    setSubmitted(true);
  };

  const cancelBid = () => {
    showAlert({
      title: 'Cancel Bid',
      message: 'Are you sure you want to withdraw your bid?',
      icon: 'alert-triangle',
      buttons: [
        { text: 'Keep Bid', style: 'cancel' },
        {
          text: 'Cancel Bid',
          style: 'destructive',
          onPress: () => {
            const idx = MOCK_BIDS.findIndex((b) => b.jobId === job.id && b.provider.id === ME_AS_PROVIDER.id);
            if (idx >= 0) MOCK_BIDS.splice(idx, 1);
            setSubmitted(false);
          },
        },
      ],
    });
  };

  const adjustPrice = (delta: number) => {
    const current = parseFloat(price) || 0;
    setPrice(String(Math.max(1, current + delta)));
  };

  const accent = job.urgency === 'urgent' ? c.urgent : c.success;

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>Job Details</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {/* Urgency + countdown */}
        <View style={[styles.urgencyBadge, { borderColor: accent }]}>
          <Feather name={job.urgency === 'urgent' ? 'zap' : 'clock'} size={14} color={accent} />
          <Text style={[styles.urgencyBadgeText, { color: accent }]}>{job.urgency === 'urgent' ? 'Urgent Job' : 'Regular Job'}</Text>
        </View>
        {job.status === 'bidding' && <CountdownTimer endsAt={job.biddingEndsAt} urgency={job.urgency} />}

        {/* Client Snapshot */}
        <View style={[styles.clientCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={[styles.clientAvatar, { backgroundColor: c.primaryLight }]}>
            <Text style={[styles.clientAvatarText, { color: c.primary }]}>{job.clientName.charAt(0)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.clientName, { color: c.text }]}>{job.clientName}</Text>
            <Text style={[styles.clientMeta, { color: c.mutedForeground }]}>{job.location}</Text>
          </View>
          <View style={styles.clientStats}>
            <View style={styles.clientStatItem}>
              <MaterialCommunityIcons name="star" size={13} color={c.rating} />
              <Text style={[styles.clientStatText, { color: c.text }]}>4.8</Text>
            </View>
            <Text style={[styles.clientStatSub, { color: c.mutedForeground }]}>12 jobs posted</Text>
          </View>
        </View>

        {/* Job details */}
        <Text style={[styles.jobTitle, { color: c.text }]}>{job.title}</Text>
        <Text style={[styles.jobDescription, { color: c.mutedForeground }]}>{job.description}</Text>

        <View style={styles.detailGrid}>
          <View style={[styles.detailItem, { backgroundColor: c.muted }]}>
            <Feather name="tag" size={14} color={c.mutedForeground} />
            <Text style={[styles.detailText, { color: c.text }]}>{job.category}</Text>
          </View>
          <View style={[styles.detailItem, { backgroundColor: c.muted }]}>
            <Feather name="calendar" size={14} color={c.mutedForeground} />
            <Text style={[styles.detailText, { color: c.text }]}>{job.date}, {job.time}</Text>
          </View>
          <View style={[styles.detailItem, { backgroundColor: c.muted }]}>
            <Feather name="clock" size={14} color={c.mutedForeground} />
            <Text style={[styles.detailText, { color: c.text }]}>{job.expectedHours} hrs expected</Text>
          </View>
          <View style={[styles.detailItem, { backgroundColor: c.muted }]}>
            <Feather name="dollar-sign" size={14} color={c.mutedForeground} />
            <Text style={[styles.detailText, { color: c.text }]}>€{job.expectedPrice} budget</Text>
          </View>
        </View>

        {job.photos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14 }}>
            {job.photos.map((uri) => (
              <Image key={uri} source={{ uri }} style={styles.jobPhoto} />
            ))}
          </ScrollView>
        )}

        {/* My score preview */}
        <View style={[styles.scoreCard, { backgroundColor: c.primaryLight }]}>
          <Text style={[styles.scoreLabel, { color: c.primary }]}>Your match score for this job</Text>
          <Text style={[styles.scoreValue, { color: c.primary }]}>{myScore.total}/100</Text>
        </View>

        {/* Submit / Modify bid */}
        {job.status === 'bidding' ? (
          <>
            <Text style={[styles.label, { color: c.text }]}>{submitted ? 'Modify Your Bid' : 'Submit Your Bid'}</Text>

            <Text style={[styles.sublabel, { color: c.mutedForeground }]}>Offered Price (€)</Text>
            <View style={styles.priceRow}>
              {[-10, -5, 5, 10].map((delta) => (
                <TouchableOpacity
                  key={delta}
                  style={[styles.adjustBtn, { backgroundColor: c.muted }]}
                  onPress={() => adjustPrice(delta)}
                >
                  <Text style={[styles.adjustText, { color: c.text }]}>{delta > 0 ? `+${delta}` : delta}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.input, { backgroundColor: c.input, color: c.text, borderColor: c.border }]}
              value={price}
              onChangeText={setPrice}
              keyboardType="numeric"
              placeholder="Enter your price"
              placeholderTextColor={c.mutedForeground}
            />

            <Text style={[styles.sublabel, { color: c.mutedForeground, marginTop: 14 }]}>Expected Time of Arrival</Text>
            <View style={styles.chipRow}>
              {['15 min', '30 min', '45 min', '1 hr'].map((e) => (
                <TouchableOpacity
                  key={e}
                  style={[styles.chip, { backgroundColor: eta === e ? c.primary : c.muted }]}
                  onPress={() => setEta(e)}
                >
                  <Text style={[styles.chipText, { color: eta === e ? '#FFF' : c.text }]}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: c.primary, opacity: submitting ? 0.8 : 1 }]}
              onPress={submitBid}
              disabled={submitting}
            >
              {submitting ? <InlineLoader size={20} /> : (
                <Text style={styles.submitText}>{submitted ? 'Update Bid' : 'Submit Bid'}</Text>
              )}
            </TouchableOpacity>

            {submitted && (
              <TouchableOpacity style={[styles.cancelBidBtn, { borderColor: c.border }]} onPress={cancelBid}>
                <Text style={[styles.cancelBidText, { color: c.destructive }]}>Cancel Bid</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <View style={[styles.closedCard, { backgroundColor: c.muted }]}>
            <Text style={[styles.closedText, { color: c.mutedForeground }]}>Bidding has closed for this job.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: 'Inter_700Bold', fontSize: 16, marginHorizontal: 8 },
  urgencyBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 12 },
  urgencyBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  clientCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 16 },
  clientAvatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  clientAvatarText: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  clientName: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  clientMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  clientStats: { alignItems: 'flex-end' },
  clientStatItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clientStatText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  clientStatSub: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  jobTitle: { fontFamily: 'Inter_700Bold', fontSize: 19, marginTop: 18 },
  jobDescription: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: 8 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  detailText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  jobPhoto: { width: 100, height: 100, borderRadius: 12, marginRight: 10 },
  scoreCard: { borderRadius: 14, padding: 14, marginTop: 16, alignItems: 'center' },
  scoreLabel: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  scoreValue: { fontFamily: 'Inter_700Bold', fontSize: 22, marginTop: 2 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 16, marginTop: 24, marginBottom: 4 },
  sublabel: { fontFamily: 'Inter_500Medium', fontSize: 12, marginBottom: 8 },
  priceRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  adjustBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  adjustText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_400Regular', fontSize: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  chipText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  submitBtn: { marginTop: 22, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#FFF' },
  cancelBidBtn: { marginTop: 12, borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  cancelBidText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  closedCard: { borderRadius: 14, padding: 20, alignItems: 'center', marginTop: 20 },
  closedText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
});
