import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useAppAlert } from '@/context/AlertModalContext';
import BackButton from '@/components/BackButton';
import BrandedLoader from '@/components/BrandedLoader';
import { useJobDetail } from '@/hooks/useJobDetail';
import { useDeclineJobByProvider } from '@/hooks/useDeclineJobByProvider';
import {
  DECLINE_DETAILS_MAX_LENGTH,
  declineDetailsFieldError,
  declineJobFailureMessage,
  declineResolvedAfterResync,
  isDeclineNotAllowed,
  isDeclineUnauthorized,
  isJobInDeclinableState,
  shouldResyncAfterDeclineFailure,
  validateDeclineDetails,
} from '@/lib/providerDecline';

/**
 * Decline By Provider — POST /api/v1/jobs/{job_id}/decline-by-provider
 * (schema JobDetailsRequest).
 *
 * REACHED from Job Details → its provider-only "Decline Job" action, which the job's
 * own status (PROVIDER_ASSIGNED) plus the active PROVIDER role gate. The action is NOT
 * offered to the client — the role is part of the gate.
 *
 * FREE-TEXT DETAILS: the contract declares `details` as a plain 3–1000 character string
 * with NO enum, so the screen validates exactly that range before firing, sends the
 * typed text verbatim (trimmed) under the exact field name `details`, and shows the
 * server's own 422 message on the field if it rejects one. No reason list is invented.
 *
 * NO FEE IS QUOTED BEFORE THE RESPONSE: whether a fee applies is whatever the 200
 * returns in `cancellation_fee_charged`; Job Details renders it from that value (and a
 * 200 whose response moved the job out of this window simply updates the screen).
 *
 * SUBMIT IS SAFE TO PRESS TWICE-ISH: it is disabled while in flight, the hook rejects a
 * second call, and after a network failure the job is re-read FIRST — if it has already
 * left the declinable window the provider is told so instead of being offered a repeat
 * decline. The typed details are never cleared by a failure, so a retry sends exactly
 * what was typed.
 */
export default function DeclineJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const showAlert = useAppAlert();

  const numericId = /^\d+$/.test(id ?? '') ? Number(id) : null;

  const { status: jobStatus, job, serverMessage, retry, refetch, applyJob } =
    useJobDetail(numericId);
  const { declineJob, declining } = useDeclineJobByProvider();

  const [details, setDetails] = useState('');
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);

  const doDecline = useCallback(async () => {
    if (numericId === null) return;
    setFormError(null);
    setRetryable(false);

    const outcome = await declineJob(numericId, details);

    if (outcome.ok) {
      // The whole job comes from the response — status, assignment, the can_* flags,
      // cancelled_at and the fee flag. Nothing is patched locally.
      applyJob(outcome.job);
      // A fee/penalty is only ever REPORTED from the backend's own flag, never guessed
      // and never given an amount the response does not carry.
      const feeNotice = outcome.job.cancellation_fee_charged
        ? `\n\n${t('jobd_cancel_fee')}`
        : '';
      showAlert({
        title: t('jobd_decline_success_title'),
        message: `${t('jobd_decline_success_msg')}${feeNotice}`,
        icon: 'check-circle',
      });
      router.back();
      return;
    }

    if (outcome.kind === 'busy') return;
    if (isDeclineUnauthorized(outcome.kind)) {
      router.replace('/(auth)/login' as any);
      return;
    }

    // A lost response is NOT a blind retry: re-read first, and if the job has already
    // left the declinable window the request went through — say so instead of asking
    // again.
    if (outcome.kind === 'network') {
      const refetched = await refetch();
      if (declineResolvedAfterResync(refetched)) {
        if (refetched) applyJob(refetched);
        showAlert({
          title: t('jobd_decline_moved_title'),
          message: t('jobd_decline_moved_msg'),
          icon: 'info',
        });
        router.back();
        return;
      }
      setFormError(declineJobFailureMessage(outcome, t));
      setRetryable(true);
      return;
    }

    // A refusal means the state this screen gated on is stale — re-read.
    if (shouldResyncAfterDeclineFailure(outcome.kind)) {
      void refetch();
    }

    // 422 for the details field → put the server's own message on the input.
    if (outcome.kind === 'invalid') {
      const fieldMessage = declineDetailsFieldError(outcome.detail);
      if (fieldMessage) {
        setDetailsError(fieldMessage);
        setRetryable(true);
        return;
      }
    }

    if (isDeclineNotAllowed(outcome.kind)) {
      setFormError(declineJobFailureMessage(outcome, t));
      setRetryable(false);
      return;
    }

    // 403 / 404 / 422 / 5xx — the backend's own message wins when it sent one.
    setFormError(declineJobFailureMessage(outcome, t));
    setRetryable(true);
  }, [numericId, details, declineJob, applyJob, refetch, showAlert, t, router]);

  const submit = useCallback(() => {
    if (declining) return;
    const invalid = validateDeclineDetails(details);
    if (invalid) {
      setDetailsError(t(invalid));
      return;
    }
    setDetailsError(null);
    setFormError(null);
    setRetryable(false);
    showAlert({
      title: t('jobd_decline_confirm_title'),
      message: t('jobd_decline_confirm_msg'),
      icon: 'alert-triangle',
      buttons: [
        { text: t('jobd_decline_confirm_cta'), onPress: () => void doDecline() },
        { text: t('job_keep'), style: 'cancel' },
      ],
    });
  }, [declining, details, showAlert, t, doDecline]);

  /* ------------------------------------------------------------------ states */

  const header = (title: string) => (
    <View style={styles.header}>
      <BackButton />
      <Text style={[styles.headerTitle, { color: c.text }]}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );

  if (numericId === null || jobStatus === 'idle' || jobStatus === 'loading') {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <BrandedLoader size={44} />
      </View>
    );
  }

  if (jobStatus !== 'ready' || !job) {
    const unavailable = jobStatus === 'notfound' || jobStatus === 'forbidden';
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        {header(t('jobd_decline_screen_title'))}
        <View style={styles.stateWrap}>
          <Feather name={unavailable ? 'slash' : 'alert-circle'} size={28} color={c.destructive} />
          <Text style={[styles.stateTitle, { color: c.text }]}>
            {unavailable ? t('jobd_unavailable_title') : t('jobd_load_error')}
          </Text>
          <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
            {unavailable ? serverMessage ?? t('jobd_unavailable_msg') : t('jobd_load_error_sub')}
          </Text>
          <TouchableOpacity style={[styles.stateBtn, { backgroundColor: c.primary }]} onPress={retry}>
            <Text style={[styles.stateBtnText, { color: c.primaryForeground }]}>{t('jobs_retry')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Not declinable any more: no form to fill in, so say so rather than offering an
  // action the backend would refuse with a 409. The screen is reached only from the
  // provider-only action, so no role check is repeated here.
  if (!isJobInDeclinableState(job)) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        {header(t('jobd_decline_screen_title'))}
        <View style={styles.stateWrap}>
          <Feather name="lock" size={28} color={c.destructive} />
          <Text style={[styles.stateTitle, { color: c.text }]}>{t('jobd_decline_blocked_title')}</Text>
          <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
            {t('jobd_decline_blocked_msg')}
          </Text>
          <TouchableOpacity
            style={[styles.stateBtn, { backgroundColor: c.primary }]}
            onPress={() => router.back()}
          >
            <Text style={[styles.stateBtnText, { color: c.primaryForeground }]}>
              {t('jobd_back_to_jobs')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  /* -------------------------------------------------------------------- form */

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      {header(t('jobd_decline_screen_title'))}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={24}
      >
        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <View style={[styles.warnCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="alert-triangle" size={16} color={c.destructive} />
            <Text style={[styles.warnText, { color: c.mutedForeground }]}>
              {t('jobd_decline_warning')}
            </Text>
          </View>

          <Text style={[styles.label, { color: c.text }]}>{t('jobd_decline_details_label')}</Text>
          <TextInput
            style={[
              styles.input,
              styles.textarea,
              {
                backgroundColor: c.card,
                color: c.text,
                borderColor: detailsError ? c.destructive : c.border,
              },
            ]}
            value={details}
            onChangeText={(v) => {
              setDetails(v);
              if (detailsError) setDetailsError(null);
            }}
            placeholder={t('jobd_decline_details_ph')}
            placeholderTextColor={c.mutedForeground}
            multiline
            textAlignVertical="top"
            maxLength={DECLINE_DETAILS_MAX_LENGTH}
            editable={!declining}
          />
          <View style={styles.metaRow}>
            <Text style={[styles.hint, { color: detailsError ? c.destructive : c.mutedForeground }]}>
              {detailsError ?? t('jobd_decline_details_hint')}
            </Text>
            <Text style={[styles.counter, { color: c.mutedForeground }]}>
              {details.trim().length}/{DECLINE_DETAILS_MAX_LENGTH}
            </Text>
          </View>

          {formError ? (
            <View style={[styles.errorBox, { borderColor: c.destructive }]}>
              <Feather name="alert-circle" size={16} color={c.destructive} />
              <Text style={[styles.errorText, { color: c.destructive }]}>{formError}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.submit,
              { backgroundColor: c.destructive },
              declining && styles.submitBusy,
            ]}
            onPress={submit}
            disabled={declining}
            activeOpacity={0.85}
          >
            {declining ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Feather name="x-octagon" size={16} color="#FFFFFF" />
            )}
            <Text style={styles.submitText}>
              {declining ? t('jobd_decline_busy') : t('jobd_decline_submit')}
            </Text>
          </TouchableOpacity>

          {retryable && !declining ? (
            <TouchableOpacity
              style={[styles.retry, { borderColor: c.border }]}
              onPress={() => void doDecline()}
              activeOpacity={0.85}
            >
              <Feather name="refresh-cw" size={15} color={c.text} />
              <Text style={[styles.retryText, { color: c.text }]}>{t('jobs_retry')}</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 17, flex: 1, textAlign: 'center' },
  form: { padding: 16, paddingBottom: 40, gap: 4 },
  warnCard: {
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  warnText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19 },
  label: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginTop: 12, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
  },
  textarea: { minHeight: 96 },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  hint: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 11 },
  counter: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
  errorBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 16,
  },
  errorText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19 },
  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 24,
  },
  submitBusy: { opacity: 0.7 },
  submitText: { fontFamily: 'Manrope_700Bold', fontSize: 15, color: '#FFFFFF' },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: 12,
  },
  retryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  stateTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16, textAlign: 'center' },
  stateSub: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  stateBtn: { marginTop: 8, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22 },
  stateBtnText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
});
