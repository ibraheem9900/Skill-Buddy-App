import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useRole } from '@/context/RoleContext';
import { useAppAlert } from '@/context/AlertModalContext';
import { BID_PROVIDERS, CURRENT_USER, MOCK_JOBS } from '@/data/mockData';
import { calculatePayoutBreakdown, CANCELLATION_FEE } from '@/lib/payment';
import BackButton from '@/components/BackButton';
import type { JobStatus } from '@/types';

const CANCEL_REASONS = ['Schedule conflict', 'Found another provider', 'No longer needed', 'Price disagreement', 'Other'];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const STEPS: { status: JobStatus; label: string }[] = [
  { status: 'task_assigned', label: 'Assigned' },
  { status: 'arrived', label: 'Arrived' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'completed', label: 'Completed' },
  { status: 'approved', label: 'Approved' },
];

export default function JobTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { activeRole } = useRole();
  const showAlert = useAppAlert();
  const isProvider = activeRole === 'PROVIDER';

  const job = useMemo(() => MOCK_JOBS.find((j) => j.id === id), [id]);
  const [, forceRender] = useState(0);
  const [showCancelReasons, setShowCancelReasons] = useState(false);
  const [showRevision, setShowRevision] = useState(false);
  const [extraHours, setExtraHours] = useState('1');
  const [newPrice, setNewPrice] = useState('');

  if (!job) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <Text style={{ color: c.text, padding: 20 }}>Job not found.</Text>
      </View>
    );
  }

  const provider = BID_PROVIDERS.find((p) => p.id === job.assignedProviderId);
  const currentStepIndex = STEPS.findIndex((s) => s.status === job.status);
  const payout = job.assignedPrice ? calculatePayoutBreakdown(job.assignedPrice) : null;

  const refresh = () => forceRender((n) => n + 1);

  const markArrived = () => {
    job.arrivedAt = Date.now();
    job.status = 'arrived';
    showAlert({ title: 'Client notified', message: 'The client has been notified that you\'ve arrived.', icon: 'map-pin' });
    refresh();
  };

  const startJob = () => {
    job.status = 'in_progress';
    refresh();
  };

  const markDone = () => {
    showAlert({
      title: 'Mark as Done?',
      message: 'This cannot be undone. The client will be notified and asked to review the completed job.',
      icon: 'check-circle',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark as Done',
          onPress: () => {
            job.status = 'completed';
            refresh();
            showAlert({ title: 'Job marked complete', message: 'The client has been notified and can now leave a review.', icon: 'check-circle' });
          },
        },
      ],
    });
  };

  const goToReview = () => router.push(`/job/${job.id}/review` as any);

  const proposeRevision = () => {
    const hours = parseFloat(extraHours);
    const price = parseFloat(newPrice);
    if (!hours || !price) {
      showAlert({ title: 'Invalid values', message: 'Enter valid extra hours and a new price.', icon: 'alert-circle' });
      return;
    }
    job.revisionRequest = {
      proposedBy: isProvider ? 'provider' : 'client',
      extraHours: hours,
      newPrice: price,
      status: 'pending',
    };
    setShowRevision(false);
    refresh();
    showAlert({ title: 'Revision proposed', message: 'Waiting for the other party to respond.', icon: 'clock' });
  };

  const respondToRevision = (approve: boolean) => {
    if (!job.revisionRequest) return;
    job.revisionRequest.status = approve ? 'approved' : 'denied';
    if (approve) {
      job.expectedHours += job.revisionRequest.extraHours;
      job.assignedPrice = job.revisionRequest.newPrice;
    }
    refresh();
  };

  const cancelJob = (reason: string) => {
    setShowCancelReasons(false);
    if (isProvider) {
      // Provider cancels before job starts: penalty applies to the current
      // user's own Pilot stats (CURRENT_USER), not the abstract BID_PROVIDERS
      // pool — those represent other simulated Pilots, not "me".
      CURRENT_USER.providerRating = Math.max(0, round1(CURRENT_USER.providerRating - 0.5));
      job.cancellation = { by: 'provider', reason };
      job.status = 'bidding';
      job.assignedProviderId = undefined;
      if (CURRENT_USER.providerRating < 4.0) {
        CURRENT_USER.providerSuspendedUntil = Date.now() + 28 * 24 * 60 * 60 * 1000;
        router.replace('/(tabs)/jobs' as any);
        return;
      }
      showAlert({ title: 'Job cancelled', message: 'The client has been notified and the job has reopened for bidding.', icon: 'info' });
      router.back();
    } else {
      job.cancellation = { by: 'client', reason, feeCharged: CANCELLATION_FEE };
      job.status = 'cancelled';
      if (provider) {
        // Credit the fee to the provider's mock wallet — represented here as a note since
        // there's no live wallet ledger yet; tracked on the job for the payout screens.
      }
      showAlert({
        title: 'Job Cancelled',
        message: `A €${CANCELLATION_FEE.toFixed(2)} cancellation fee has been charged and credited to your Pilot.`,
        icon: 'info',
      });
      router.back();
    }
  };

  const confirmCancel = () => {
    showAlert({
      title: 'Cancel this job?',
      message: isProvider
        ? 'Cancelling will affect your credibility and rating.'
        : `A €${CANCELLATION_FEE.toFixed(2)} cancellation fee applies.`,
      icon: 'alert-triangle',
      buttons: [
        { text: 'Keep Job', style: 'cancel' },
        { text: 'Choose Reason', onPress: () => setShowCancelReasons(true) },
      ],
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>{job.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {/* Progress stepper */}
        <View style={styles.stepper}>
          {STEPS.map((step, i) => (
            <View key={step.status} style={styles.stepItem}>
              <View
                style={[
                  styles.stepDot,
                  { backgroundColor: i <= currentStepIndex ? c.primary : c.muted },
                ]}
              >
                {i < currentStepIndex && <Feather name="check" size={12} color="#FFF" />}
              </View>
              <Text style={[styles.stepLabel, { color: i <= currentStepIndex ? c.primary : c.mutedForeground }]}>
                {step.label}
              </Text>
              {i < STEPS.length - 1 && (
                <View style={[styles.stepLine, { backgroundColor: i < currentStepIndex ? c.primary : c.border }]} />
              )}
            </View>
          ))}
        </View>

        {provider && (
          <View style={[styles.providerCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={[styles.avatar, { backgroundColor: c.primaryLight }]}>
              <Text style={[styles.avatarText, { color: c.primary }]}>{provider.name.charAt(0)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.providerName, { color: c.text }]}>{provider.name}</Text>
              <Text style={[styles.providerSub, { color: c.mutedForeground }]}>SkillBuddy Pilot</Text>
            </View>
            <TouchableOpacity style={[styles.iconAction, { backgroundColor: c.muted }]} onPress={() => router.push(`/chat/${provider.id}` as any)}>
              <Feather name="message-circle" size={16} color={c.text} />
            </TouchableOpacity>
          </View>
        )}

        {/* Revision request status */}
        {job.revisionRequest && job.revisionRequest.status === 'pending' && (
          <View style={[styles.revisionCard, { backgroundColor: c.primaryLight }]}>
            <Text style={[styles.revisionTitle, { color: c.primary }]}>Revision Proposed</Text>
            <Text style={[styles.revisionText, { color: c.primary }]}>
              +{job.revisionRequest.extraHours} hrs, new price €{job.revisionRequest.newPrice}
            </Text>
            {job.revisionRequest.proposedBy !== (isProvider ? 'provider' : 'client') && (
              <View style={styles.revisionActions}>
                <TouchableOpacity style={[styles.smallBtn, { backgroundColor: c.primary }]} onPress={() => respondToRevision(true)}>
                  <Text style={styles.smallBtnText}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.smallBtn, { backgroundColor: c.muted }]} onPress={() => respondToRevision(false)}>
                  <Text style={[styles.smallBtnText, { color: c.text }]}>Deny</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Provider-side payout breakdown */}
        {isProvider && payout && (
          <View style={[styles.payoutCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Payout Breakdown</Text>
            {[
              ['Bidding Price', `€${payout.bidPrice.toFixed(2)}`],
              ['Before VAT', `€${payout.beforeVat.toFixed(2)}`],
              ['VAT (24%)', `€${payout.vat.toFixed(2)}`],
              ['Platform Fee', `-€${payout.platformFee.toFixed(2)}`],
              ['SkillBuddy Commission (5%)', `-€${payout.commission.toFixed(2)}`],
            ].map(([label, value]) => (
              <View key={label} style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: c.mutedForeground }]}>{label}</Text>
                <Text style={[styles.summaryValue, { color: c.text }]}>{value}</Text>
              </View>
            ))}
            <View style={[styles.summaryRow, styles.totalRow, { borderTopColor: c.border }]}>
              <Text style={[styles.totalLabel, { color: c.text }]}>Payout</Text>
              <Text style={[styles.totalValue, { color: c.primary }]}>€{payout.payout.toFixed(2)}</Text>
            </View>
          </View>
        )}

        {/* Action buttons per status/role */}
        <View style={{ marginTop: 20, gap: 10 }}>
          {isProvider && job.status === 'task_assigned' && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: c.primary }]} onPress={markArrived}>
              <Feather name="map-pin" size={16} color="#FFF" />
              <Text style={styles.actionText}>I've Arrived</Text>
            </TouchableOpacity>
          )}
          {isProvider && job.status === 'arrived' && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: c.primary }]} onPress={startJob}>
              <Feather name="play" size={16} color="#FFF" />
              <Text style={styles.actionText}>Start Job</Text>
            </TouchableOpacity>
          )}
          {isProvider && job.status === 'in_progress' && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: c.primary }]} onPress={markDone}>
              <Feather name="check-circle" size={16} color="#FFF" />
              <Text style={styles.actionText}>Mark as Done</Text>
            </TouchableOpacity>
          )}
          {!isProvider && job.status === 'completed' && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: c.primary }]} onPress={goToReview}>
              <Feather name="star" size={16} color="#FFF" />
              <Text style={styles.actionText}>Leave a Review</Text>
            </TouchableOpacity>
          )}
          {['completed', 'approved', 'closed'].includes(job.status) && (
            <TouchableOpacity
              style={[styles.actionBtnOutline, { borderColor: c.border }]}
              onPress={() => router.push({ pathname: '/profile/raise-ticket', params: { jobId: job.id } } as any)}
            >
              <Feather name="help-circle" size={16} color={c.text} />
              <Text style={[styles.actionOutlineText, { color: c.text }]}>Get Help</Text>
            </TouchableOpacity>
          )}
          {['task_assigned', 'arrived', 'in_progress'].includes(job.status) && (
            <TouchableOpacity style={[styles.actionBtnOutline, { borderColor: c.border }]} onPress={() => setShowRevision(true)}>
              <Feather name="edit-3" size={16} color={c.text} />
              <Text style={[styles.actionOutlineText, { color: c.text }]}>Propose Revision</Text>
            </TouchableOpacity>
          )}
          {['task_assigned', 'arrived', 'in_progress'].includes(job.status) && (
            <TouchableOpacity style={[styles.actionBtnOutline, { borderColor: c.destructive }]} onPress={confirmCancel}>
              <Feather name="x-circle" size={16} color={c.destructive} />
              <Text style={[styles.actionOutlineText, { color: c.destructive }]}>Cancel Job</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Cancel reason picker */}
        {showCancelReasons && (
          <View style={[styles.reasonCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Select a reason</Text>
            {CANCEL_REASONS.map((r) => (
              <TouchableOpacity key={r} style={[styles.reasonRow, { borderBottomColor: c.border }]} onPress={() => cancelJob(r)}>
                <Text style={[styles.reasonText, { color: c.text }]}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Revision proposal form */}
        {showRevision && (
          <View style={[styles.reasonCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Propose Revision</Text>
            <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Extra Hours</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.muted, color: c.text }]}
              value={extraHours}
              onChangeText={setExtraHours}
              keyboardType="numeric"
            />
            <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>New Total Price (€)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.muted, color: c.text }]}
              value={newPrice}
              onChangeText={setNewPrice}
              keyboardType="numeric"
              placeholder={String(job.assignedPrice ?? '')}
              placeholderTextColor={c.mutedForeground}
            />
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: c.primary, marginTop: 12 }]} onPress={proposeRevision}>
              <Text style={styles.actionText}>Send Proposal</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: 'Manrope_700Bold', fontSize: 16, marginHorizontal: 8 },
  stepper: { flexDirection: 'row', marginBottom: 20 },
  stepItem: { flex: 1, alignItems: 'center' },
  stepDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { fontFamily: 'Manrope_500Medium', fontSize: 9, marginTop: 4, textAlign: 'center' },
  stepLine: { position: 'absolute', top: 12, left: '55%', right: '-45%', height: 2 },
  providerCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 14 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  providerName: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  providerSub: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2 },
  iconAction: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  revisionCard: { borderRadius: 14, padding: 14, marginBottom: 14 },
  revisionTitle: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
  revisionText: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 4 },
  revisionActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  smallBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
  smallBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#FFF' },
  payoutCard: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 14 },
  sectionTitle: { fontFamily: 'Manrope_700Bold', fontSize: 14, marginBottom: 8 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  summaryLabel: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  summaryValue: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  totalRow: { borderTopWidth: 1, marginTop: 4, paddingTop: 10 },
  totalLabel: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
  totalValue: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 14 },
  actionText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, color: '#FFF' },
  actionBtnOutline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 13 },
  actionOutlineText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  reasonCard: { borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 14 },
  reasonRow: { paddingVertical: 12, borderBottomWidth: 1 },
  reasonText: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
  fieldLabel: { fontFamily: 'Manrope_500Medium', fontSize: 11, marginTop: 10, marginBottom: 6 },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: 'Manrope_400Regular', fontSize: 13 },
});
