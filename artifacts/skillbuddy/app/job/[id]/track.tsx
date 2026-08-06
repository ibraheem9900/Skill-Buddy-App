import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useRole } from '@/context/RoleContext';
import { useAppAlert } from '@/context/AlertModalContext';
import { BID_PROVIDERS, CURRENT_USER, MOCK_JOBS } from '@/data/mockData';
import { calculatePayoutBreakdown, CANCELLATION_FEE } from '@/lib/payment';
import BackButton from '@/components/BackButton';
import type { JobStatus } from '@/types';

const CANCEL_REASON_KEYS = ['track_reason_1', 'track_reason_2', 'track_reason_3', 'track_reason_4', 'track_reason_5'];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const STEPS: { status: JobStatus; labelKey: string }[] = [
  { status: 'task_assigned', labelKey: 'track_assigned' },
  { status: 'arrived', labelKey: 'track_arrived' },
  { status: 'in_progress', labelKey: 'track_in_progress' },
  { status: 'completed', labelKey: 'track_completed' },
  { status: 'approved', labelKey: 'track_approved' },
];

export default function JobTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
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
        <Text style={{ color: c.text, padding: 20 }}>{t('track_not_found')}</Text>
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
    showAlert({ title: t('track_client_notified'), message: t('track_client_notified_msg'), icon: 'map-pin' });
    refresh();
  };

  const startJob = () => {
    job.status = 'in_progress';
    refresh();
  };

  const markDone = () => {
    showAlert({
      title: t('track_done_title'),
      message: t('track_done_msg'),
      icon: 'check-circle',
      buttons: [
        { text: t('action_cancel'), style: 'cancel' },
        {
          text: t('track_done_btn'),
          onPress: () => {
            job.status = 'completed';
            refresh();
            showAlert({ title: t('track_marked'), message: t('track_marked_msg'), icon: 'check-circle' });
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
      showAlert({ title: t('track_invalid_title'), message: t('track_invalid_msg'), icon: 'alert-circle' });
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
    showAlert({ title: t('track_rev_proposed_title'), message: t('track_rev_proposed_msg'), icon: 'clock' });
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
      showAlert({ title: t('track_cancelled_title'), message: t('track_cancelled_msg'), icon: 'info' });
      router.back();
    } else {
      job.cancellation = { by: 'client', reason, feeCharged: CANCELLATION_FEE };
      job.status = 'cancelled';
      if (provider) {
        // Credit the fee to the provider's mock wallet — represented here as a note since
        // there's no live wallet ledger yet; tracked on the job for the payout screens.
      }
      showAlert({
        title: t('track_cancelled_client'),
        message: t('track_cancelled_client_msg', { fee: CANCELLATION_FEE.toFixed(2) }),
        icon: 'info',
      });
      router.back();
    }
  };

  const confirmCancel = () => {
    showAlert({
      title: t('track_confirm_title'),
      message: isProvider
        ? t('track_confirm_provider')
        : t('track_confirm_client', { fee: CANCELLATION_FEE.toFixed(2) }),
      icon: 'alert-triangle',
      buttons: [
        { text: t('job_keep'), style: 'cancel' },
        { text: t('track_choose_reason'), onPress: () => setShowCancelReasons(true) },
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
                {t(step.labelKey as any)}
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
              <Text style={[styles.providerSub, { color: c.mutedForeground }]}>{t('track_pilot')}</Text>
            </View>
            <TouchableOpacity style={[styles.iconAction, { backgroundColor: c.muted }]} onPress={() => router.push(`/chat/${provider.id}` as any)}>
              <Feather name="message-circle" size={16} color={c.text} />
            </TouchableOpacity>
          </View>
        )}

        {/* Revision request status */}
        {job.revisionRequest && job.revisionRequest.status === 'pending' && (
          <View style={[styles.revisionCard, { backgroundColor: c.primaryLight }]}>
            <Text style={[styles.revisionTitle, { color: c.primary }]}>{t('track_revision_proposed')}</Text>
            <Text style={[styles.revisionText, { color: c.primary }]}>
              {t('track_revision_text', { n: job.revisionRequest.extraHours, p: job.revisionRequest.newPrice })}
            </Text>
            {job.revisionRequest.proposedBy !== (isProvider ? 'provider' : 'client') && (
              <View style={styles.revisionActions}>
                <TouchableOpacity style={[styles.smallBtn, { backgroundColor: c.primary }]} onPress={() => respondToRevision(true)}>
                  <Text style={styles.smallBtnText}>{t('track_approve')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.smallBtn, { backgroundColor: c.muted }]} onPress={() => respondToRevision(false)}>
                  <Text style={[styles.smallBtnText, { color: c.text }]}>{t('track_deny')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Provider-side payout breakdown */}
        {isProvider && payout && (
          <View style={[styles.payoutCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>{t('track_payout')}</Text>
            {[
              [t('pay_bidding_price'), `€${payout.bidPrice.toFixed(2)}`],
              [t('pay_before_vat'), `€${payout.beforeVat.toFixed(2)}`],
              [t('pay_vat'), `€${payout.vat.toFixed(2)}`],
              [t('pay_platform_fee'), `-€${payout.platformFee.toFixed(2)}`],
              [t('track_commission'), `-€${payout.commission.toFixed(2)}`],
            ].map(([label, value]) => (
              <View key={label} style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: c.mutedForeground }]}>{label}</Text>
                <Text style={[styles.summaryValue, { color: c.text }]}>{value}</Text>
              </View>
            ))}
            <View style={[styles.summaryRow, styles.totalRow, { borderTopColor: c.border }]}>
              <Text style={[styles.totalLabel, { color: c.text }]}>{t('track_payout_total')}</Text>
              <Text style={[styles.totalValue, { color: c.primary }]}>€{payout.payout.toFixed(2)}</Text>
            </View>
          </View>
        )}

        {/* Action buttons per status/role */}
        <View style={{ marginTop: 20, gap: 10 }}>
          {isProvider && job.status === 'task_assigned' && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: c.primary }]} onPress={markArrived}>
              <Feather name="map-pin" size={16} color="#FFF" />
              <Text style={styles.actionText}>{t('track_arrived_btn')}</Text>
            </TouchableOpacity>
          )}
          {isProvider && job.status === 'arrived' && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: c.primary }]} onPress={startJob}>
              <Feather name="play" size={16} color="#FFF" />
              <Text style={styles.actionText}>{t('track_start')}</Text>
            </TouchableOpacity>
          )}
          {isProvider && job.status === 'in_progress' && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: c.primary }]} onPress={markDone}>
              <Feather name="check-circle" size={16} color="#FFF" />
              <Text style={styles.actionText}>{t('track_done')}</Text>
            </TouchableOpacity>
          )}
          {!isProvider && job.status === 'completed' && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: c.primary }]} onPress={goToReview}>
              <Feather name="star" size={16} color="#FFF" />
              <Text style={styles.actionText}>{t('track_review')}</Text>
            </TouchableOpacity>
          )}
          {['completed', 'approved', 'closed'].includes(job.status) && (
            <TouchableOpacity
              style={[styles.actionBtnOutline, { borderColor: c.border }]}
              onPress={() => router.push({ pathname: '/profile/raise-ticket', params: { jobId: job.id } } as any)}
            >
              <Feather name="help-circle" size={16} color={c.text} />
              <Text style={[styles.actionOutlineText, { color: c.text }]}>{t('track_help')}</Text>
            </TouchableOpacity>
          )}
          {['task_assigned', 'arrived', 'in_progress'].includes(job.status) && (
            <TouchableOpacity style={[styles.actionBtnOutline, { borderColor: c.border }]} onPress={() => setShowRevision(true)}>
              <Feather name="edit-3" size={16} color={c.text} />
              <Text style={[styles.actionOutlineText, { color: c.text }]}>{t('track_revision_btn')}</Text>
            </TouchableOpacity>
          )}
          {['task_assigned', 'arrived', 'in_progress'].includes(job.status) && (
            <TouchableOpacity style={[styles.actionBtnOutline, { borderColor: c.destructive }]} onPress={confirmCancel}>
              <Feather name="x-circle" size={16} color={c.destructive} />
              <Text style={[styles.actionOutlineText, { color: c.destructive }]}>{t('track_cancel')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Cancel reason picker */}
        {showCancelReasons && (
          <View style={[styles.reasonCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>{t('track_select_reason')}</Text>
            {CANCEL_REASON_KEYS.map((key) => (
              <TouchableOpacity key={key} style={[styles.reasonRow, { borderBottomColor: c.border }]} onPress={() => cancelJob(t(key as any))}>
                <Text style={[styles.reasonText, { color: c.text }]}>{t(key as any)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Revision proposal form */}
        {showRevision && (
          <View style={[styles.reasonCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>{t('track_revision_title')}</Text>
            <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>{t('track_extra_hours')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.muted, color: c.text }]}
              value={extraHours}
              onChangeText={setExtraHours}
              keyboardType="numeric"
            />
            <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>{t('track_new_price')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.muted, color: c.text }]}
              value={newPrice}
              onChangeText={setNewPrice}
              keyboardType="numeric"
              placeholder={String(job.assignedPrice ?? '')}
              placeholderTextColor={c.mutedForeground}
            />
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: c.primary, marginTop: 12 }]} onPress={proposeRevision}>
              <Text style={styles.actionText}>{t('track_send')}</Text>
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
