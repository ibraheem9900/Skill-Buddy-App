import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useAppAlert } from '@/context/AlertModalContext';
import { CURRENT_USER, MOCK_JOBS } from '@/data/mockData';
import { calculateOrderBreakdown, canUsePayLater, canUseInstalments, pointsToEuro } from '@/lib/payment';
import BackButton from '@/components/BackButton';
import InlineLoader from '@/components/InlineLoader';
import type { PaymentMethod } from '@/types';

const METHODS: { id: PaymentMethod; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { id: 'card', label: 'Card', icon: 'credit-card' },
  { id: 'apple_pay', label: 'Apple Pay', icon: 'smartphone' },
  { id: 'google_pay', label: 'Google Pay', icon: 'smartphone' },
  { id: 'bank_transfer', label: 'Bank Transfer', icon: 'briefcase' },
  { id: 'credit_points', label: 'Credit Points', icon: 'star' },
];

function formatRemaining(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function PaymentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const showAlert = useAppAlert();

  const job = useMemo(() => MOCK_JOBS.find((j) => j.id === id), [id]);
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [usePoints, setUsePoints] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [remaining, setRemaining] = useState(job?.paymentDeadline ? job.paymentDeadline - Date.now() : 0);

  useEffect(() => {
    if (!job?.paymentDeadline) return;
    const interval = setInterval(() => {
      const left = job.paymentDeadline! - Date.now();
      setRemaining(left);
      if (left <= 0) {
        clearInterval(interval);
        // Payment window expired — job reopens for bidding.
        job.status = 'bidding';
        job.assignedProviderId = undefined;
        job.assignedPrice = undefined;
        job.paymentDeadline = undefined;
        showAlert({
          title: 'Payment window expired',
          message: 'You didn\'t complete payment in time, so this job has reopened for bidding.',
          icon: 'clock',
          buttons: [{ text: 'OK', onPress: () => router.replace(`/job/${job.id}` as any) }],
        });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [job]);

  if (!job || !job.assignedPrice) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <Text style={{ color: c.text, padding: 20 }}>Payment session not found.</Text>
      </View>
    );
  }

  const breakdown = calculateOrderBreakdown(job.assignedPrice);
  const payLaterOk = canUsePayLater(CURRENT_USER.jobsDone);
  const instalmentsOk = canUseInstalments(CURRENT_USER.jobsDone, breakdown.total);
  const pointsValue = pointsToEuro(CURRENT_USER.creditPoints);
  const pointsDiscount = usePoints ? Math.min(pointsValue, breakdown.total) : 0;
  const amountDue = Math.max(0, breakdown.total - pointsDiscount);
  const expired = remaining <= 0;

  const handlePay = async () => {
    setProcessing(true);
    await new Promise((r) => setTimeout(r, 700));
    job.status = 'task_assigned';
    job.paymentMethod = method;
    job.paymentDeadline = undefined;
    setProcessing(false);
    router.replace(`/job/${job.id}/booking-summary` as any);
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>Payment</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.timerBar, { backgroundColor: expired ? c.urgentLight : c.primaryLight }]}>
        <Feather name="clock" size={14} color={expired ? c.urgent : c.primary} />
        <Text style={[styles.timerText, { color: expired ? c.urgent : c.primary }]}>
          {expired ? 'Payment window expired' : `Complete payment within ${formatRemaining(remaining)}`}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>Order Summary</Text>
        <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}>
          {[
            ['Bidding Price', `€${breakdown.bidPrice.toFixed(2)}`],
            ['Before VAT', `€${breakdown.beforeVat.toFixed(2)}`],
            ['VAT (24%)', `€${breakdown.vat.toFixed(2)}`],
            ['Platform Fee', `-€${breakdown.platformFee.toFixed(2)}`],
          ].map(([label, value]) => (
            <View key={label} style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: c.mutedForeground }]}>{label}</Text>
              <Text style={[styles.summaryValue, { color: c.text }]}>{value}</Text>
            </View>
          ))}
          {usePoints && (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: c.success }]}>Credit Points Applied</Text>
              <Text style={[styles.summaryValue, { color: c.success }]}>-€{pointsDiscount.toFixed(2)}</Text>
            </View>
          )}
          <View style={[styles.summaryRow, styles.totalRow, { borderTopColor: c.border }]}>
            <Text style={[styles.totalLabel, { color: c.text }]}>Total Order Value</Text>
            <Text style={[styles.totalValue, { color: c.primary }]}>€{amountDue.toFixed(2)}</Text>
          </View>
        </View>

        <View style={[styles.pointsRow, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.pointsLabel, { color: c.text }]}>Use Credit Points</Text>
            <Text style={[styles.pointsSub, { color: c.mutedForeground }]}>
              {CURRENT_USER.creditPoints} pts available (€{pointsValue.toFixed(2)})
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.toggle, { backgroundColor: usePoints ? c.primary : c.muted }]}
            onPress={() => setUsePoints((v) => !v)}
          >
            <View style={[styles.toggleDot, usePoints && { alignSelf: 'flex-end' }]} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionTitle, { color: c.text, marginTop: 22 }]}>Payment Method</Text>
        {METHODS.map((m) => (
          <TouchableOpacity
            key={m.id}
            style={[
              styles.methodRow,
              { backgroundColor: c.card, borderColor: method === m.id ? c.primary : c.border },
            ]}
            onPress={() => setMethod(m.id)}
          >
            <Feather name={m.icon} size={18} color={method === m.id ? c.primary : c.mutedForeground} />
            <Text style={[styles.methodLabel, { color: c.text }]}>{m.label}</Text>
            {method === m.id && <Feather name="check-circle" size={18} color={c.primary} />}
          </TouchableOpacity>
        ))}

        <Text style={[styles.sectionTitle, { color: c.text, marginTop: 22 }]}>Payment Plans</Text>
        <View style={[styles.planRow, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="zap" size={16} color={c.primary} />
          <Text style={[styles.planLabel, { color: c.text }]}>Pay Now</Text>
          <Text style={[styles.planBadge, { color: c.success }]}>Available</Text>
        </View>
        <View style={[styles.planRow, { backgroundColor: c.card, borderColor: c.border, opacity: payLaterOk ? 1 : 0.55 }]}>
          <Feather name="calendar" size={16} color={payLaterOk ? c.primary : c.mutedForeground} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.planLabel, { color: c.text }]}>Pay Later (up to 30 days)</Text>
            {!payLaterOk && (
              <Text style={[styles.planDisabled, { color: c.mutedForeground }]}>
                Not Applicable — requires 20 completed tasks
              </Text>
            )}
          </View>
        </View>
        <View style={[styles.planRow, { backgroundColor: c.card, borderColor: c.border, opacity: instalmentsOk ? 1 : 0.55 }]}>
          <MaterialCommunityIcons name="calendar-multiple" size={16} color={instalmentsOk ? c.primary : c.mutedForeground} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.planLabel, { color: c.text }]}>Pay in Instalments (3 monthly)</Text>
            {!instalmentsOk && (
              <Text style={[styles.planDisabled, { color: c.mutedForeground }]}>
                Not Applicable — requires 20 completed tasks and a bill over €100
              </Text>
            )}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: c.surface, borderTopColor: c.border, paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.payBtn, { backgroundColor: c.primary, opacity: expired || processing ? 0.7 : 1 }]}
          onPress={handlePay}
          disabled={expired || processing}
        >
          {processing ? <InlineLoader size={20} /> : (
            <Text style={styles.payText}>Pay €{amountDue.toFixed(2)}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  timerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10 },
  timerText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  sectionTitle: { fontFamily: 'Manrope_700Bold', fontSize: 15, marginBottom: 10 },
  summaryCard: { borderWidth: 1, borderRadius: 14, padding: 16 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  summaryLabel: { fontFamily: 'Manrope_400Regular', fontSize: 13 },
  summaryValue: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  totalRow: { borderTopWidth: 1, marginTop: 6, paddingTop: 12 },
  totalLabel: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  totalValue: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  pointsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 14 },
  pointsLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  pointsSub: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2 },
  toggle: { width: 44, height: 26, borderRadius: 13, padding: 3 },
  toggleDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFF' },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: 12, padding: 14, marginBottom: 8 },
  methodLabel: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 14 },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 8 },
  planLabel: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
  planBadge: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
  planDisabled: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2 },
  footer: { padding: 16, borderTopWidth: 1 },
  payBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  payText: { fontFamily: 'Manrope_700Bold', fontSize: 15, color: '#FFF' },
});
