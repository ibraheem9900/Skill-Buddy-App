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
import DateStrip from '@/components/DateStrip';
import TimeChoices from '@/components/TimeChoices';
import { useJobDetail } from '@/hooks/useJobDetail';
import { invalidateJobList } from '@/hooks/useJobList';
import { authApi } from '@/services/api';
import { splitTable } from '@/lib/jobSchedule';
import { selectionWindow } from '@/lib/jobBooking';
import {
  DAY_END_MINUTES,
  clampHours,
  clockOf,
  exceedsHoursCap,
  formatLocalDateTime,
  formatTimeLabel,
  formatWindowLabel,
  maxHoursForStart,
  minutesOf,
  parseScheduleSegments,
  segmentsForTasks,
} from '@/lib/timeSlots';
import {
  HOURS_MIN,
  buildUpdateJobRequest,
  editDayChoices,
  editDayLabel,
  editHoursCap,
  fieldErrorText,
  isOutsideEditWindow,
  jobToEditValues,
  localDateKey,
  mapUpdateJobErrors,
  parseLocalDateKey,
  updateJobErrorMessage,
  userWordCount,
  validateJobEdit,
  type JobEditErrorKey,
  type JobEditField,
  type JobEditFieldError,
  type JobEditValues,
} from '@/lib/jobUpdate';

/**
 * Edit Job — PATCH /api/v1/jobs/{job_id} (schema JobUpdate).
 *
 * Only the four fields the endpoint accepts are ever sent: description,
 * scheduled_at and expected_hours here; the title is NOT editable and is never
 * included. The address has its own endpoints and status/type are out of scope.
 *
 * What this screen deliberately does NOT do
 *   • no Job Title field (the title stays the service name);
 *   • no 60-day chip row: the same 7-day window as Post a Job, with the job's
 *     own date left untouched when it falls outside it;
 *   • no arbitrary clock chips: the five client windows + Anytime, preselected
 *     from the job's stored window courtesy of lib/timeSlots.deriveSlotOf;
 *   • no per-task editing: JobUpdate has no milestones field and the live spec
 *     has no milestone endpoint, so a MULTI_DAY job's tasks are shown READ-ONLY
 *     with the reason, and only its description can change.
 *
 * Gating: is_editable false replaces the form entirely, so nobody fills in a
 * form the server will reject. The PATCH response is adopted whole.
 */
export default function EditJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const showAlert = useAppAlert();

  const numericId = /^\d+$/.test(id ?? '') ? Number(id) : null;

  const { status: detailStatus, job, serverMessage, retry, refetch, applyJob } =
    useJobDetail(numericId);

  const [form, setForm] = useState<JobEditValues | null>(null);
  const [clientErrors, setClientErrors] = useState<
    Partial<Record<JobEditField, JobEditErrorKey>>
  >({});
  const [serverErrors, setServerErrors] = useState<
    Partial<Record<JobEditField, JobEditFieldError>>
  >({});
  const [hoursNotice, setHoursNotice] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const prefilled = useRef(false);

  const months = useMemo(() => splitTable(t('post_sched_months')), [t]);
  const weekdays = useMemo(() => splitTable(t('post_sched_weekdays')), [t]);
  const meridiem = useMemo(
    () => ({ am: t('post_sched_am'), pm: t('post_sched_pm') }),
    [t]
  );

  // Pre-fill ONCE from the loaded job so a background refetch can never wipe
  // what the user is typing.
  useEffect(() => {
    if (!job || prefilled.current) return;
    setForm(jobToEditValues(job));
    prefilled.current = true;
  }, [job]);

  useEffect(() => {
    if (hoursNotice === null) return;
    const timer = setTimeout(() => setHoursNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [hoursNotice]);

  const setTime = (next: JobEditValues['time']) => {
    setForm((prev) => {
      if (!prev) return prev;
      const cap = next
        ? maxHoursForStart(minutesOf(selectionWindow(next)?.start ?? null))
        : null;
      if (cap === null) return { ...prev, time: next };
      if (exceedsHoursCap(prev.expectedHours, cap)) {
        setHoursNotice(cap);
        return { ...prev, time: next, expectedHours: clampHours(prev.expectedHours, cap) };
      }
      return { ...prev, time: next };
    });
    clearError('scheduled_at');
    clearError('expected_hours');
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

  const submit = useCallback(async () => {
    if (!form || submitting) return;
    // The flag is the gate — never a client guess about the status.
    if (job?.is_editable !== true) return;

    const validation = validateJobEdit(form);
    setClientErrors(validation.fieldErrors);
    if (!validation.ok) return;

    const body = buildUpdateJobRequest(form, meridiem);
    if (Object.keys(body).length === 0) {
      showAlert({
        title: t('editjob_no_changes_title'),
        message: t('editjob_no_changes_msg'),
        icon: 'info',
      });
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await authApi.updateJob(job.id, body);
      // The response is the source of truth: adopt it whole.
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
          message: updateJobErrorMessage(err?.response?.data) ?? t('editjob_err_msg'),
          icon: 'alert-triangle',
        });
      }

      await refetch();
    }
  }, [form, submitting, job, meridiem, applyJob, showAlert, t, router, refetch]);

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

  if (detailStatus === 'idle' || detailStatus === 'loading' || !form) {
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
          <TouchableOpacity style={[styles.stateBtn, { backgroundColor: c.primary }]} onPress={retry}>
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

  const multiDay = form.original.isMultiDay;
  const words = userWordCount(form.description);
  const cap = editHoursCap(form);
  const chosenDay = parseLocalDateKey(form.dateKey);
  const outsideWindow = isOutsideEditWindow(form.dateKey);
  const dayChoices = editDayChoices();

  // Multi-day tasks: read-only rows built from the milestones + stored line.
  const storedMilestones = [...(job.milestones ?? [])].sort(
    (a, b) => a.sequence - b.sequence || a.id - b.id
  );
  const segments = segmentsForTasks(
    parseScheduleSegments(job.description),
    storedMilestones.length
  );

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      {header(t('job_edit'))}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Description — the schedule line is stripped and never counted. */}
        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: c.text }]}>{t('post_description')}</Text>
          <Text
            style={[styles.counter, { color: words > 500 ? c.destructive : c.mutedForeground }]}
          >
            {t('post_words', { n: words })}
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
            setForm((prev) => (prev ? { ...prev, description: v } : prev));
            clearError('description');
          }}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />
        {errorText('description') ? (
          <Text style={[styles.error, { color: c.destructive }]}>{errorText('description')}</Text>
        ) : null}

        {multiDay ? (
          <>
            {/* MULTI_DAY: JobUpdate has no milestones field, so the tasks are
                shown with their real local times and cannot be edited here. */}
            <Text style={[styles.label, { color: c.text }]}>{t('post_tasks')}</Text>
            {storedMilestones.map((m, index) => {
              const segment = segments[index] ?? null;
              const when = formatLocalDateTime(m.scheduled_at, months, weekdays, meridiem);
              const window =
                segment && segment.endMinutes !== null
                  ? formatWindowLabel(
                      clockOf(segment.startMinutes),
                      clockOf(segment.endMinutes),
                      meridiem
                    )
                  : null;
              return (
                <View
                  key={m.id}
                  style={[styles.taskRow, { backgroundColor: c.card, borderColor: c.border }]}
                >
                  <View style={[styles.taskBadge, { backgroundColor: c.primary }]}>
                    <Text style={[styles.taskBadgeText, { color: c.primaryForeground }]}>
                      {index + 1}
                    </Text>
                  </View>
                  <View style={styles.taskBody}>
                    <Text style={[styles.taskTitle, { color: c.text }]}>
                      {t('post_task_n', { n: index + 1 })}
                    </Text>
                    <Text style={[styles.taskMeta, { color: c.mutedForeground }]}>
                      {window ? `${when} · ${window}` : when}
                    </Text>
                  </View>
                </View>
              );
            })}
            <View style={[styles.notice, { backgroundColor: c.muted, borderColor: c.border }]}>
              <Feather name="info" size={13} color={c.mutedForeground} />
              <Text style={[styles.noticeText, { color: c.mutedForeground }]}>
                {t('editjob_tasks_locked')}
              </Text>
            </View>
          </>
        ) : (
          <>
            {/* Date — the SAME seven days as Post a Job. */}
            <Text style={[styles.label, { color: c.text }]}>{t('post_date')}</Text>
            {outsideWindow ? (
              <TouchableOpacity
                style={[
                  styles.keepChip,
                  {
                    backgroundColor: form.dateKey === null ? c.muted : c.primaryLight,
                    borderColor: form.dateKey === null ? c.border : c.primary,
                  },
                ]}
                onPress={() => {
                  setForm((prev) =>
                    prev ? { ...prev, dateKey: prev.original.dateKey } : prev
                  );
                  clearError('scheduled_at');
                }}
              >
                <Feather name="calendar" size={13} color={c.primary} />
                <Text style={[styles.keepChipText, { color: c.text }]}>
                  {t('editjob_keep_date', {
                    date: editDayLabel(form.original.dateKey, months, weekdays),
                  })}
                </Text>
              </TouchableOpacity>
            ) : null}
            <DateStrip
              selected={chosenDay ? [chosenDay] : []}
              activeKey={form.dateKey}
              onToggle={(day) => {
                const key = localDateKey(day);
                setForm((prev) =>
                  prev ? { ...prev, dateKey: prev.dateKey === key ? prev.original.dateKey : key } : prev
                );
                clearError('scheduled_at');
              }}
              weekdays={weekdays}
              months={months}
              disabled={() => false}
              status={() => null}
            />

            {/* Time — the five client windows + Anytime, preselected from the job. */}
            <Text style={[styles.label, { color: c.text }]}>{t('post_time')}</Text>
            <TimeChoices
              choice={form.time}
              day={chosenDay ?? dayChoices[0]}
              onChange={setTime}
            />
            {errorText('scheduled_at') ? (
              <Text style={[styles.error, { color: c.destructive }]}>
                {errorText('scheduled_at')}
              </Text>
            ) : null}

            {/* Expected hours, capped by the 11 PM rule for this start. */}
            <Text style={[styles.label, { color: c.text }]}>{t('post_hours')}</Text>
            <View
              style={[
                styles.stepper,
                {
                  backgroundColor: c.input,
                  borderColor: errorText('expected_hours') ? c.destructive : c.border,
                  opacity: cap === null ? 0.55 : 1,
                },
              ]}
            >
              <TouchableOpacity
                style={[styles.stepperBtn, { backgroundColor: c.muted }]}
                onPress={() => {
                  setForm((prev) =>
                    prev
                      ? { ...prev, expectedHours: Math.max(HOURS_MIN, prev.expectedHours - 1) }
                      : prev
                  );
                  clearError('expected_hours');
                }}
                disabled={cap === null || form.expectedHours <= HOURS_MIN}
              >
                <Feather name="minus" size={16} color={c.text} />
              </TouchableOpacity>
              <Text style={[styles.stepperValue, { color: c.text }]}>
                {form.expectedHours === 1
                  ? t('post_hours_value', { n: form.expectedHours })
                  : t('post_hours_value_plural', { n: form.expectedHours })}
              </Text>
              <TouchableOpacity
                style={[
                  styles.stepperBtn,
                  { backgroundColor: c.muted, opacity: cap !== null && form.expectedHours >= cap ? 0.4 : 1 },
                ]}
                onPress={() => {
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          expectedHours: clampHours(prev.expectedHours + 1, cap ?? HOURS_MIN),
                        }
                      : prev
                  );
                  clearError('expected_hours');
                }}
                disabled={cap === null || form.expectedHours >= cap}
              >
                <Feather name="plus" size={16} color={c.text} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.hint, { color: c.mutedForeground }]}>
              {cap === null
                ? t('post_hours_pick_time')
                : t('post_hours_cap', {
                    n: cap,
                    time: formatTimeLabel(clockOf(DAY_END_MINUTES), meridiem),
                  })}
            </Text>
            {hoursNotice !== null ? (
              <View style={[styles.notice, { backgroundColor: c.muted, borderColor: c.border }]}>
                <Feather name="info" size={13} color={c.mutedForeground} />
                <Text style={[styles.noticeText, { color: c.mutedForeground }]}>
                  {t('post_hours_lowered', {
                    n: form.expectedHours,
                    time: formatTimeLabel(clockOf(DAY_END_MINUTES), meridiem),
                  })}
                </Text>
              </View>
            ) : null}
            {errorText('expected_hours') ? (
              <Text style={[styles.error, { color: c.destructive }]}>
                {errorText('expected_hours')}
              </Text>
            ) : null}
          </>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: c.primary }, submitting && styles.submitBtnBusy]}
          onPress={() => void submit()}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? <ActivityIndicator size="small" color={c.primaryForeground} /> : null}
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
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 8, lineHeight: 16 },
  keepChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  keepChipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  taskBadge: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  taskBadgeText: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
  taskBody: { flex: 1, minWidth: 0 },
  taskTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  taskMeta: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  noticeText: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16, flex: 1 },
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
