import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { invalidateJobList } from '@/hooks/useJobList';
import { authApi } from '@/services/api';
import {
  HOURS_MAX,
  HOURS_MIN,
  TITLE_MAX,
  TITLE_MIN,
  buildUpdateJobRequest,
  dayChoices,
  fieldErrorText,
  jobToEditValues,
  mapUpdateJobErrors,
  minutesToLabel,
  parseLocalDateKey,
  slotMinutes,
  updateJobErrorMessage,
  validateJobEdit,
  type JobEditErrorKey,
  type JobEditField,
  type JobEditFieldError,
  type JobEditValues,
} from '@/lib/jobUpdate';

/**
 * Edit Job — PATCH /api/v1/jobs/{job_id} (schema JobUpdate).
 *
 * Only the four fields the endpoint actually accepts are editable: title,
 * description, scheduled_at and expected_hours. The address is NOT editable
 * here (that is the Job Address endpoints) and neither are status, request_type
 * or booking_type.
 *
 * Routing: /job/{id}/edit, matching the existing app/job/[id]/* screens.
 *
 * Gating: the whole form is replaced by an explanation whenever the loaded job
 * reports is_editable false, so the user can never fill in a form the server
 * will reject. Nothing is written optimistically — the cached job is replaced
 * by the PATCH response itself, which is the source of truth for the
 * recalculated fields (is_editable, status, remaining_bidding_seconds, ...).
 */
export default function EditJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const showAlert = useAppAlert();

  // Server jobs only: a numeric id is a real job. The mock 'j1'/'j2' catalogue
  // has no server counterpart, so it gets no edit screen.
  const numericId = /^\d+$/.test(id ?? '') ? Number(id) : null;

  const {
    status: detailStatus,
    job,
    serverMessage,
    retry,
    refetch,
    applyJob,
  } = useJobDetail(numericId);

  const [form, setForm] = useState<JobEditValues>({
    title: '',
    description: '',
    dateKey: '',
    minutes: 9 * 60,
    expectedHours: 2,
  });
  const [clientErrors, setClientErrors] = useState<
    Partial<Record<JobEditField, JobEditErrorKey>>
  >({});
  const [serverErrors, setServerErrors] = useState<
    Partial<Record<JobEditField, JobEditFieldError>>
  >({});
  const [submitting, setSubmitting] = useState(false);
  const prefilled = useRef(false);

  // Pre-fill ONCE from the loaded job so a background refetch can never wipe
  // what the user is typing.
  useEffect(() => {
    if (!job || prefilled.current) return;
    setForm(jobToEditValues(job));
    prefilled.current = true;
  }, [job]);

  const setField = <K extends keyof JobEditValues>(key: K, value: JobEditValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const clearError = (field: JobEditField) => {
    setClientErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setServerErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const errorText = (field: JobEditField): string | null =>
    fieldErrorText(serverErrors[field], (key) => t(key)) ??
    (clientErrors[field] ? t(clientErrors[field]!) : null);

  const wordCount = useMemo(
    () => form.description.trim().split(/\s+/).filter(Boolean).length,
    [form.description]
  );

  const dateOptions = useMemo(
    () => dayChoices(form.dateKey || ''),
    // Recomputed only when the selected day changes: the list already spans the
    // next 60 days, so it must not be rebuilt on every keystroke.
    [form.dateKey]
  );

  /**
   * 30-minute slots, plus the job's own time when it sits off the grid (e.g.
   * 2:15 PM) so an untouched form re-sends exactly what the server had.
   */
  const timeOptions = useMemo(() => {
    const base = slotMinutes();
    return base.includes(form.minutes) ? base : [...base, form.minutes].sort((a, b) => a - b);
  }, [form.minutes]);

  const submit = useCallback(async () => {
    if (!job || submitting) return;

    // The flag is the gate — never a client guess about the status.
    if (job.is_editable !== true) return;

    const validation = validateJobEdit(form);
    setClientErrors(validation.fieldErrors);
    if (!validation.ok) return;

    setSubmitting(true);
    try {
      const { data } = await authApi.updateJob(job.id, buildUpdateJobRequest(form));
      // The response is the source of truth: adopt it whole instead of patching
      // in the values we sent.
      applyJob(data);
      invalidateJobList();
      setSubmitting(false);
      showAlert({
        title: t('editjob_saved_title'),
        message: t('editjob_saved_msg'),
        icon: 'check-circle',
        buttons: [{ text: t('post_view_job'), onPress: () => router.back() }],
      });
    } catch (err: any) {
      setSubmitting(false);
      const status: number | undefined = err?.response?.status;

      // The shared client already refreshed + replayed once; getting here means
      // the session is over, so hand the user to login rather than a dead form.
      if (status === 401) {
        showAlert({
          title: t('post_err_session_title'),
          message: t('post_err_session_msg'),
          icon: 'lock',
        });
        router.replace('/(auth)/login' as any);
        return;
      }

      if (status === 422) {
        const mapped = mapUpdateJobErrors(err?.response?.data?.detail);
        setServerErrors(mapped.fieldErrors);
        if (mapped.formErrors.length > 0) {
          showAlert({
            title: t('post_err_invalid_title'),
            message: mapped.formErrors.join('\n'),
            icon: 'alert-circle',
          });
        }
      } else {
        showAlert({
          title: t('editjob_err_title'),
          // The backend's own text wins when it sent one.
          message: updateJobErrorMessage(err?.response?.data) ?? t('editjob_err_msg'),
          icon: 'alert-triangle',
        });
      }

      // The job may have been assigned, cancelled or completed since this screen
      // opened, in which case the server will keep refusing. Re-read it: if
      // is_editable has flipped to false the screen re-renders as non-editable
      // instead of letting the user retry a form that cannot ever succeed.
      await refetch();
    }
  }, [job, submitting, form, applyJob, showAlert, t, router, refetch]);

  const header = (title: string) => (
    <View style={[styles.header, { backgroundColor: c.background, borderBottomColor: c.border }]}>
      <BackButton />
      <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  if (numericId === null) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        {header(t('job_edit'))}
        <View style={styles.stateWrap}>
          <Feather name="slash" size={28} color={c.destructive} />
          <Text style={[styles.stateTitle, { color: c.text }]}>{t('jobd_unavailable_title')}</Text>
          <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
            {t('jobd_unavailable_msg')}
          </Text>
        </View>
      </View>
    );
  }

  if (detailStatus === 'idle' || detailStatus === 'loading') {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <BrandedLoader size={44} />
      </View>
    );
  }

  if (detailStatus !== 'ready' || !job) {
    const unavailable = detailStatus === 'notfound' || detailStatus === 'forbidden';
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        {header(t('job_edit'))}
        <View style={styles.stateWrap}>
          <Feather name={unavailable ? 'slash' : 'alert-circle'} size={28} color={c.destructive} />
          <Text style={[styles.stateTitle, { color: c.text }]}>
            {unavailable ? t('jobd_unavailable_title') : t('jobd_load_error')}
          </Text>
          <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
            {unavailable ? serverMessage ?? t('jobd_unavailable_msg') : t('jobd_load_error_sub')}
          </Text>
          <TouchableOpacity
            style={[styles.stateBtn, { backgroundColor: c.primary }]}
            onPress={retry}
          >
            <Text style={[styles.stateBtnText, { color: c.primaryForeground }]}>
              {t('jobs_retry')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.stateBtnOutline, { borderColor: c.border }]}
            onPress={() => router.back()}
          >
            <Text style={[styles.stateBtnText, { color: c.text }]}>{t('jobd_back_to_jobs')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // is_editable false -> no form at all. The user cannot fill in something the
  // server will reject.
  if (job.is_editable !== true) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        {header(t('job_edit'))}
        <View style={styles.stateWrap}>
          <Feather name="lock" size={28} color={c.destructive} />
          <Text style={[styles.stateTitle, { color: c.text }]}>
            {t('editjob_not_editable_title')}
          </Text>
          <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
            {t('editjob_not_editable_msg')}
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

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      {header(t('job_edit'))}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <Text style={[styles.label, { color: c.text }]}>{t('post_job_title')}</Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: c.input,
              color: c.text,
              borderColor: errorText('title') ? c.destructive : c.border,
            },
          ]}
          placeholder={t('post_title_placeholder')}
          placeholderTextColor={c.mutedForeground}
          value={form.title}
          onChangeText={(v) => {
            setField('title', v);
            clearError('title');
          }}
          maxLength={TITLE_MAX}
        />
        {errorText('title') ? (
          <Text style={[styles.error, { color: c.destructive }]}>{errorText('title')}</Text>
        ) : null}

        {/* Description */}
        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: c.text }]}>{t('post_description')}</Text>
          <Text
            style={[
              styles.counter,
              { color: wordCount > 500 ? c.destructive : c.mutedForeground },
            ]}
          >
            {t('post_words', { n: wordCount })}
          </Text>
        </View>
        <TextInput
          style={[
            styles.textArea,
            {
              backgroundColor: c.input,
              color: c.text,
              borderColor: errorText('description') ? c.destructive : c.border,
            },
          ]}
          placeholder={t('post_desc_placeholder')}
          placeholderTextColor={c.mutedForeground}
          value={form.description}
          onChangeText={(v) => {
            setField('description', v);
            clearError('description');
          }}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />
        {errorText('description') ? (
          <Text style={[styles.error, { color: c.destructive }]}>{errorText('description')}</Text>
        ) : null}

        {/* Scheduled day (local). The selected day is always offered first, so a
            job scheduled outside the window stays visible and selectable. */}
        <Text style={[styles.label, { color: c.text }]}>{t('post_date')}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {dateOptions.map((key) => {
            const date = parseLocalDateKey(key);
            const active = form.dateKey === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.chip, { backgroundColor: active ? c.primary : c.muted }]}
                onPress={() => {
                  setField('dateKey', key);
                  clearError('scheduled_at');
                }}
              >
                <Text
                  style={[styles.chipText, { color: active ? c.primaryForeground : c.text }]}
                >
                  {date
                    ? date.toLocaleDateString(undefined, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })
                    : key}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Time slot (local) */}
        <Text style={[styles.label, { color: c.text }]}>{t('post_time')}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {timeOptions.map((minutes) => {
            const active = form.minutes === minutes;
            return (
              <TouchableOpacity
                key={minutes}
                style={[styles.chip, { backgroundColor: active ? c.primary : c.muted }]}
                onPress={() => {
                  setField('minutes', minutes);
                  clearError('scheduled_at');
                }}
              >
                <Text
                  style={[styles.chipText, { color: active ? c.primaryForeground : c.text }]}
                >
                  {minutesToLabel(minutes)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {errorText('scheduled_at') ? (
          <Text style={[styles.error, { color: c.destructive }]}>{errorText('scheduled_at')}</Text>
        ) : null}

        {/* Expected hours — sent as a NUMBER */}
        <Text style={[styles.label, { color: c.text }]}>{t('post_hours')}</Text>
        <View
          style={[
            styles.stepper,
            {
              backgroundColor: c.input,
              borderColor: errorText('expected_hours') ? c.destructive : c.border,
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.stepperBtn, { backgroundColor: c.muted }]}
            onPress={() => {
              setField('expectedHours', Math.max(HOURS_MIN, form.expectedHours - 1));
              clearError('expected_hours');
            }}
          >
            <Feather name="minus" size={16} color={c.text} />
          </TouchableOpacity>
          <Text style={[styles.stepperValue, { color: c.text }]}>
            {form.expectedHours === 1
              ? t('post_hours_value', { n: form.expectedHours })
              : t('post_hours_value_plural', { n: form.expectedHours })}
          </Text>
          <TouchableOpacity
            style={[styles.stepperBtn, { backgroundColor: c.muted }]}
            onPress={() => {
              setField('expectedHours', Math.min(HOURS_MAX, form.expectedHours + 1));
              clearError('expected_hours');
            }}
          >
            <Feather name="plus" size={16} color={c.text} />
          </TouchableOpacity>
        </View>
        {errorText('expected_hours') ? (
          <Text style={[styles.error, { color: c.destructive }]}>
            {errorText('expected_hours')}
          </Text>
        ) : null}

        {/* Save */}
        <TouchableOpacity
          style={[
            styles.submitBtn,
            { backgroundColor: c.primary },
            submitting && styles.submitBtnBusy,
          ]}
          onPress={() => void submit()}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={c.primaryForeground} />
          ) : null}
          <Text style={[styles.submitText, { color: c.primaryForeground }]}>
            {submitting ? t('editjob_saving') : t('editjob_submit')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 36 },
  scroll: { padding: 20, paddingBottom: 60 },
  label: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginTop: 16, marginBottom: 8 },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  counter: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    minHeight: 110,
  },
  error: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 4 },
  chipRow: { gap: 8, paddingRight: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  chipText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
  },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  submitBtn: {
    marginTop: 28,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  submitBtnBusy: { opacity: 0.6 },
  submitText: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  stateTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16, textAlign: 'center' },
  stateSub: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  stateBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  stateBtnOutline: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  stateBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
