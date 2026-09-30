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
import { useCancelJob } from '@/hooks/useCancelJob';
import {
  CANCEL_REASON_MAX_LENGTH,
  canCancelJob,
  cancelJobFailureMessage,
  cancelReasonFieldError,
  cancelResolvedAfterResync,
  isCancelNotAllowed,
  isCancelUnauthorized,
  shouldResyncAfterCancelFailure,
  validateCancelReason,
} from '@/lib/jobCancel';

/**
 * Cancel Job — POST /api/v1/jobs/{job_id}/cancel (schema JobCancelRequest).
 *
 * REACHED from Job Details → its existing "Cancel Job" action, which the backend's own
 * `is_cancellable` flag already gates. The action list is NOT role-restricted here: the
 * app's own in-progress screen (track.tsx) offers cancelling from a shared status list
 * with no role guard (only its confirmation copy differs), and the API keeps the
 * provider's separate path in POST /jobs/{job_id}/provider-cancel — so `/cancel` with a
 * reason is the route both roles use, and the backend authorises the real party.
 *
 * FREE-TEXT REASON: the contract declares `reason` as a plain 3–255 character string
 * with NO enum, so the screen validates exactly that range before firing, sends the
 * typed text verbatim, and shows the server's own 422 message on the field if it
 * rejects one. `notes` is optional (blank becomes null). No reason list is invented.
 *
 * NO FEE IS QUOTED BEFORE THE RESPONSE: whether a fee applies is whatever the 200
 * returns in `cancellation_fee_charged`, which Job Details renders afterwards.
 *
 * SUBMIT IS SAFE TO PRESS TWICE-ISH: it is disabled while in flight, the hook rejects a
 * second call, and after a network failure the job is re-read FIRST — if it is already
 * cancelled the user is told so instead of being offered a repeat cancel. The typed
 * reason/notes are never cleared by a failure, so a retry sends exactly what was typed.
 */
export default function CancelJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const showAlert = useAppAlert();

  const numericId = /^\d+$/.test(id ?? '') ? Number(id) : null;

  const { status: jobStatus, job, serverMessage, retry, refetch, applyJob } =
    useJobDetail(numericId);
  const { cancelJob, cancelling } = useCancelJob();

  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);

  const doCancel = useCallback(async () => {
    if (numericId === null) return;
    setFormError(null);
    setRetryable(false);

    const outcome = await cancelJob(numericId, reason, notes);

    if (outcome.ok) {
      // The whole job comes from the response — reason, notes, cancelled_at, the fee
      // flag and every derived flag. Nothing is patched locally.
      applyJob(outcome.job);
      showAlert({
        title: t('jobd_cancel_success_title'),
        message: t('jobd_cancel_success_msg'),
        icon: 'check-circle',
      });
      router.back();
      return;
    }

    if (outcome.kind === 'busy') return;
    if (isCancelUnauthorized(outcome.kind)) {
      router.replace('/(auth)/login' as any);
      return;
    }

    // A lost response is NOT a blind retry: re-read first, and if the job is already
    // cancelled then the request went through — say so instead of asking again.
    if (outcome.kind === 'network') {
      const refetched = await refetch();
      if (cancelResolvedAfterResync(refetched)) {
        if (refetched) applyJob(refetched);
        showAlert({
          title: t('jobd_cancel_moved_title'),
          message: t('jobd_cancel_moved_msg'),
          icon: 'info',
        });
        router.back();
        return;
      }
      setFormError(cancelJobFailureMessage(outcome, t));
      setRetryable(true);
      return;
    }

    // A refusal means the is_cancellable flag this screen gated on is stale — re-read.
    if (shouldResyncAfterCancelFailure(outcome.kind)) {
      void refetch();
    }

    // 422 for the reason field → put the server's own message on the input.
    if (outcome.kind === 'invalid') {
      const fieldMessage = cancelReasonFieldError(outcome.detail);
      if (fieldMessage) {
        setReasonError(fieldMessage);
        setRetryable(true);
        return;
      }
    }

    if (isCancelNotAllowed(outcome.kind)) {
      setFormError(cancelJobFailureMessage(outcome, t));
      setRetryable(false);
      return;
    }

    // 403 / 404 / 422 / 5xx — the backend's own message wins when it sent one.
    setFormError(cancelJobFailureMessage(outcome, t));
    setRetryable(true);
  }, [numericId, reason, notes, cancelJob, applyJob, refetch, showAlert, t, router]);

  const submit = useCallback(() => {
    if (cancelling) return;
    const invalid = validateCancelReason(reason);
    if (invalid) {
      setReasonError(t(invalid));
      return;
    }
    setReasonError(null);
    setFormError(null);
    setRetryable(false);
    showAlert({
      title: t('jobd_cancel_confirm_title'),
      message: t('jobd_cancel_confirm_msg'),
      icon: 'alert-triangle',
      buttons: [
        { text: t('jobd_cancel_confirm_cta'), onPress: () => void doCancel() },
        { text: t('job_keep'), style: 'cancel' },
      ],
    });
  }, [cancelling, reason, showAlert, t, doCancel]);

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
        {header(t('job_cancel'))}
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

  // Not cancellable any more: no form to fill in, so say so rather than offering an
  // action the backend would refuse with a 409.
  if (!canCancelJob(job)) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        {header(t('job_cancel'))}
        <View style={styles.stateWrap}>
          <Feather name="lock" size={28} color={c.destructive} />
          <Text style={[styles.stateTitle, { color: c.text }]}>{t('jobd_cancel_blocked_title')}</Text>
          <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
            {t('jobd_cancel_blocked_msg')}
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
      {header(t('job_cancel'))}
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
              {t('jobd_cancel_warning')}
            </Text>
          </View>

          <Text style={[styles.label, { color: c.text }]}>{t('jobd_cancel_reason_label')}</Text>
          <TextInput
            style={[
              styles.input,
              styles.textarea,
              {
                backgroundColor: c.card,
                color: c.text,
                borderColor: reasonError ? c.destructive : c.border,
              },
            ]}
            value={reason}
            onChangeText={(v) => {
              setReason(v);
              if (reasonError) setReasonError(null);
            }}
            placeholder={t('jobd_cancel_reason_ph')}
            placeholderTextColor={c.mutedForeground}
            multiline
            textAlignVertical="top"
            maxLength={CANCEL_REASON_MAX_LENGTH}
            editable={!cancelling}
          />
          <View style={styles.metaRow}>
            <Text style={[styles.hint, { color: reasonError ? c.destructive : c.mutedForeground }]}>
              {reasonError ?? t('jobd_cancel_reason_hint')}
            </Text>
            <Text style={[styles.counter, { color: c.mutedForeground }]}>
              {reason.trim().length}/{CANCEL_REASON_MAX_LENGTH}
            </Text>
          </View>

          <Text style={[styles.label, { color: c.text }]}>{t('jobd_cancel_notes_label')}</Text>
          <TextInput
            style={[
              styles.input,
              styles.textarea,
              { backgroundColor: c.card, color: c.text, borderColor: c.border },
            ]}
            value={notes}
            onChangeText={setNotes}
            placeholder={t('jobd_cancel_notes_ph')}
            placeholderTextColor={c.mutedForeground}
            multiline
            textAlignVertical="top"
            editable={!cancelling}
          />

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
              cancelling && styles.submitBusy,
            ]}
            onPress={submit}
            disabled={cancelling}
            activeOpacity={0.85}
          >
            {cancelling ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Feather name="x-circle" size={16} color="#FFFFFF" />
            )}
            <Text style={styles.submitText}>
              {cancelling ? t('jobd_cancel_busy') : t('jobd_cancel_submit')}
            </Text>
          </TouchableOpacity>

          {retryable && !cancelling ? (
            <TouchableOpacity
              style={[styles.retry, { borderColor: c.border }]}
              onPress={() => void doCancel()}
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
