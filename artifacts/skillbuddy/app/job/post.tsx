import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import BackButton from '@/components/BackButton';
import { useAppAlert } from '@/context/AlertModalContext';
import InlineLoader from '@/components/InlineLoader';
import ServicePickerSheet from '@/components/ServicePickerSheet';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import DotsLoader from '@/components/DotsLoader';
import DateStrip from '@/components/DateStrip';
import TimeRangeSheet from '@/components/TimeRangeSheet';
import TaskEditSheet from '@/components/TaskEditSheet';
import AttachmentSection from '@/components/AttachmentSection';
import AddressFormModal from '@/components/AddressFormModal';
import {
  type ClockRange,
} from '@/components/TimeRangeFields';
import { authApi } from '@/services/api';
import useCategories from '@/hooks/useCategories';
import useServiceDetail from '@/hooks/useServiceDetail';
import { invalidateJobList } from '@/hooks/useJobList';
import { usePublishJob } from '@/hooks/usePublishJob';
import { isDraftJob, publishErrorKey } from '@/lib/jobPublish';
import { isClientProfileMissing, jobStatusLabelKey } from '@/lib/jobList';
import { splitTable } from '@/lib/jobSchedule';
import {
  FIXED_SLOTS,
  MAX_EXPECTED_HOURS,
  MIN_EXPECTED_HOURS,
  type BookingChoice,
  type BookingErrorKey,
  type BookingKind,
  type FormRequestType,
  type OneTimeDay,
  type TimeChoice,
  applyBookingKind,
  applyRequestType,
  buildOneTimeMilestones,
  clampExpectedHours,
  formatWindowLabel,
  hasSlotStarted,
  isBookingKindAllowed,
  isRequestTypeAllowed,
  oneTimeDay,
  validateOneTime,
  validateTimeChoice,
  windowMinutes,
  windowShorterThanHours,
} from '@/lib/jobBooking';
import {
  dayKey,
  firstUntimedTask,
  hasBookableTime as dayHasBookableTime,
  setTaskName,
  setTaskTime,
  syncTasks,
  toggleAgendaDay,
  toggleSlot,
  validateTasks,
  buildTaskMilestones,
  type TaskDraft,
} from '@/lib/postWizard';
import {
  addressFormFrom,
  addressLine,
  defaultAddressId,
  isAddressPostable,
  jobAddressFrom,
  mapAddressValidationErrors,
  normalizeAddressList,
  regionLine,
  type AddressField,
  type PostAddressForm,
} from '@/lib/postAddress';
import { buildProfileAddressPayload } from '@/lib/profileAddressSync';
import type { AttachmentDraft } from '@/lib/jobAttachments';
import {
  DESC_WORD_MAX,
  buildCreateJobRequest,
  buildPreferredTimeLine,
  classifyCreateJobFailure,
  clampToWordLimit,
  countWords,
  createJobErrorCopy,
  firstErrorStep,
  mapValidationErrors,
  titleForService,
  wordCounterTone,
  type JobFormField,
} from '@/lib/jobCreate';
import type { AddressResponse, JobResponse, ServiceListItem } from '@/types';

/**
 * Post a Job — a four-step wizard that creates a REAL job via POST /api/v1/jobs.
 *
 *   1  Job Details   service (with "Change"), description, attachments
 *   2  Booking Type  Urgent (the web's GOLD token) | Regular, Single | Multiple days
 *   3  Date & Time   single day: presets + Anytime (two-row stepper sheet) and
 *                    expected hours (default 1); multiple days: an inline 7-day
 *                    strip + one TASK per selected day, each with its own time
 *   4  Address       the saved addresses as cards (select / edit / delete) plus
 *                    a full-screen Add/Edit form
 *
 * WHAT CHANGED AND WHY (see the delivery report for the Swagger evidence):
 *   • the Job Title FIELD is gone — JobCreate.title is still required, so it is
 *     derived from the selected service (lib/jobCreate.titleForService);
 *   • the counter is one derived value, and every keystroke/paste runs through
 *     clampToWordLimit, so it can neither lag nor exceed 500 words;
 *   • the clock face is gone: Anytime opens components/TimeRangeSheet (two rows
 *     of hours/minutes arrows + AM/PM);
 *   • the calendar sheet is gone: components/DateStrip is the 7-day strip and
 *     components/TaskEditSheet edits each task's own name/time;
 *   • step 4 reads GET /api/v1/addresses and edits through the documented
 *     /addresses/{id} endpoints. The schema has NO name, phone or is_default
 *     field and no list endpoint — reported, never faked.
 *
 * PAYLOAD: unchanged. service_id, category_id, title, description,
 * request_type, booking_type, milestones[{scheduled_at, expected_hours}],
 * address{…}, is_draft. Attachments are uploaded AFTER the 201, one file per
 * POST /api/v1/jobs/{id}/attachments, and a failed file never re-creates the job.
 */

const STEP_KEYS: TranslationKey[] = [
  'post_step_details',
  'post_step_booking',
  'post_step_schedule',
  'post_step_address',
];
const STEP_COUNT = STEP_KEYS.length;

/** Which field each step's validation can flag, so errors render in place. */
type StepErrors = Partial<Record<JobFormField, BookingErrorKey | string>>;

/**
 * Request-type card. BOTH cards share one structure — same width, same
 * minHeight, same icon circle, same badge slot — so the selected and
 * unselected states line up exactly; a selection springs the card.
 */
function RequestTypeCard({
  active,
  icon,
  title,
  description,
  accent,
  accentSoft,
  onAccent,
  idle,
  border,
  titleColor,
  bodyColor,
  onPress,
  disabled = false,
}: {
  active: boolean;
  icon: 'zap' | 'clock';
  title: string;
  description: string;
  accent: string;
  accentSoft: string;
  /** Foreground for content sitting ON the accent fill (theme token). */
  onAccent: string;
  idle: string;
  border: string;
  titleColor: string;
  bodyColor: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[styles.optionSlot, animStyle]}>
      <Pressable
        style={[
          styles.optionCard,
          {
            backgroundColor: active ? accentSoft : idle,
            borderColor: active ? accent : border,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
        onPressIn={() => {
          if (disabled) return;
          scale.value = withSpring(0.97, { damping: 18, stiffness: 320 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 16, stiffness: 280 });
        }}
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ selected: active, disabled }}
      >
        <View style={[styles.optionIcon, { backgroundColor: active ? accent : idle }]}>
          <Feather name={icon} size={17} color={active ? onAccent : bodyColor} />
        </View>
        <Text style={[styles.optionTitle, { color: active ? accent : titleColor }]}>{title}</Text>
        <Text style={[styles.optionDesc, { color: bodyColor }]} numberOfLines={3}>
          {description}
        </Text>
        <View
          style={[
            styles.optionBadge,
            active
              ? { backgroundColor: accent, borderColor: accent }
              : { borderColor: border, backgroundColor: 'transparent' },
          ]}
        >
          {active ? <Feather name="check" size={11} color={onAccent} /> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Booking-type card: the same structure as the request-type card. */
function BookingTypeCard({
  active,
  icon,
  title,
  description,
  onPress,
  disabled = false,
}: {
  active: boolean;
  icon: 'calendar' | 'repeat';
  title: string;
  description: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors: c } = useTheme();
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[styles.optionSlot, animStyle]}>
      <Pressable
        style={[
          styles.optionCard,
          {
            backgroundColor: active ? c.primaryLight : c.muted,
            borderColor: active ? c.primary : c.border,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
        onPressIn={() => {
          if (disabled) return;
          scale.value = withSpring(0.97, { damping: 18, stiffness: 320 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 16, stiffness: 280 });
        }}
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ selected: active, disabled }}
      >
        <View style={[styles.optionIcon, { backgroundColor: active ? c.primary : c.muted }]}>
          <Feather name={icon} size={17} color={active ? c.primaryForeground : c.mutedForeground} />
        </View>
        <Text style={[styles.optionTitle, { color: active ? c.primary : c.text }]}>{title}</Text>
        <Text style={[styles.optionDesc, { color: c.mutedForeground }]} numberOfLines={3}>
          {description}
        </Text>
        <View
          style={[
            styles.optionBadge,
            active
              ? { backgroundColor: c.primary, borderColor: c.primary }
              : { borderColor: c.border, backgroundColor: 'transparent' },
          ]}
        >
          {active ? <Feather name="check" size={11} color={c.primaryForeground} /> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** One saved-address card in step 4. */
function AddressCard({
  address,
  selected,
  isDefault,
  busy,
  onSelect,
  onEdit,
  onDelete,
}: {
  address: AddressResponse;
  selected: boolean;
  isDefault: boolean;
  busy: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const line = addressLine(address);
  const region = regionLine(address);
  const postable = isAddressPostable(address);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onSelect}
      style={[
        styles.addrCard,
        {
          backgroundColor: c.card,
          borderColor: selected ? c.primary : c.border,
          borderWidth: selected ? 2 : 1,
        },
      ]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <View style={styles.addrHead}>
        <View
          style={[
            styles.radio,
            { borderColor: selected ? c.primary : c.border },
          ]}
        >
          {selected ? <View style={[styles.radioDot, { backgroundColor: c.primary }]} /> : null}
        </View>
        <View style={styles.addrBody}>
          <View style={styles.addrTitleRow}>
            <Text style={[styles.addrTitle, { color: c.text }]} numberOfLines={2}>
              {line || t('addr_fallback_title')}
            </Text>
            {isDefault ? (
              <View style={[styles.chip, { backgroundColor: c.accent }]}>
                <Text style={[styles.chipText, { color: c.primary }]}>{t('post_addr_default')}</Text>
              </View>
            ) : null}
          </View>
          {region ? (
            <Text style={[styles.addrRegion, { color: c.mutedForeground }]} numberOfLines={1}>
              {region}
            </Text>
          ) : null}
          {!postable ? (
            <Text style={[styles.addrWarn, { color: c.destructive }]} numberOfLines={2}>
              {t('post_addr_incomplete')}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={[styles.addrActions, { borderTopColor: c.border }]}>
        <TouchableOpacity
          onPress={onEdit}
          disabled={busy}
          style={styles.addrAction}
          accessibilityRole="button"
        >
          <Feather name="edit-2" size={13} color={c.primary} />
          <Text style={[styles.addrActionText, { color: c.primary }]}>{t('post_addr_edit')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDelete}
          disabled={busy}
          style={styles.addrAction}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator size="small" color={c.destructive} />
          ) : (
            <Feather name="trash-2" size={13} color={c.destructive} />
          )}
          <Text style={[styles.addrActionText, { color: c.destructive }]}>
            {t('post_addr_delete')}
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

export default function PostJobScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuth();
  const showAlert = useAppAlert();
  const { publish, publishing } = usePublishJob();

  // ── Service ────────────────────────────────────────────────────────────────
  const { serviceId: serviceIdParam } = useLocalSearchParams<{ serviceId?: string }>();
  const paramServiceId = useMemo(() => {
    const raw = Array.isArray(serviceIdParam) ? serviceIdParam[0] : serviceIdParam;
    return raw != null && /^\d+$/.test(String(raw)) ? Number(raw) : null;
  }, [serviceIdParam]);

  const [serviceId, setServiceId] = useState<number | null>(paramServiceId);
  const [pickedService, setPickedService] = useState<ServiceListItem | null>(null);
  const [serviceSheetOpen, setServiceSheetOpen] = useState(false);

  useEffect(() => {
    setServiceId(paramServiceId);
    setPickedService(null);
  }, [paramServiceId]);

  const {
    status: detailStatus,
    service: detailService,
    load: loadDetail,
    refresh: refreshDetail,
  } = useServiceDetail(serviceId);

  useEffect(() => {
    if (serviceId == null) return;
    if (pickedService?.id === serviceId) return;
    void loadDetail();
  }, [serviceId, pickedService, loadDetail]);

  const { categories, load: loadCategories } = useCategories();
  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const serviceCategoryId = pickedService?.category_id ?? detailService?.category_id ?? null;
  const serviceTitle = pickedService?.title ?? detailService?.title ?? null;
  const serviceCategoryName = useMemo(() => {
    const direct = pickedService?.category_name ?? detailService?.category_name;
    if (direct) return direct;
    if (serviceCategoryId == null) return null;
    return categories?.find((cat) => cat.id === serviceCategoryId)?.name ?? null;
  }, [pickedService, detailService, serviceCategoryId, categories]);

  /** The title sent to the API — the service defines the job (no title field). */
  const jobTitle = useMemo(
    () => titleForService(serviceTitle ?? serviceCategoryName),
    [serviceTitle, serviceCategoryName]
  );

  // ── Shared wizard state ────────────────────────────────────────────────────
  const [step, setStep] = useState(0);
  const [stepErrors, setStepErrors] = useState<StepErrors>({});

  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);

  const [bookingKind, setBookingKind] = useState<BookingKind>('one_time');
  const [urgency, setUrgency] = useState<FormRequestType>('regular');
  const [bookingSwitchNotice, setBookingSwitchNotice] = useState<
    'urgent_single' | 'multi_regular' | null
  >(null);
  const [oneTimeDayKind, setOneTimeDayKind] = useState<OneTimeDay>('today');

  /** Single day: one preset slot OR one custom window (null = nothing chosen). */
  const [timeChoice, setTimeChoice] = useState<TimeChoice | null>(null);
  const [customSheetOpen, setCustomSheetOpen] = useState(false);

  /** Multiple days: the strip's selection and one task per selected day. */
  const [selectedDays, setSelectedDays] = useState<Date[]>([]);
  const [tasks, setTasks] = useState<TaskDraft[]>([]);
  const [taskEditorKey, setTaskEditorKey] = useState<string | null>(null);
  /** The last removed task, so its snackbar can put it back. */
  const [undo, setUndo] = useState<{ days: Date[]; tasks: TaskDraft[] } | null>(null);

  /** Expected hours — ONE global control, default 1 (was 2). */
  const [hours, setHours] = useState(MIN_EXPECTED_HOURS);

  // ── Address (step 4) ──────────────────────────────────────────────────────
  const [addresses, setAddresses] = useState<AddressResponse[]>([]);
  const [addressStatus, setAddressStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressModal, setAddressModal] = useState<
    { mode: 'add' | 'edit'; addressId: number | null } | null
  >(null);
  const [addressSubmitting, setAddressSubmitting] = useState(false);
  const [addressFieldErrors, setAddressFieldErrors] = useState<
    Partial<Record<AddressField, string>>
  >({});
  const [addressFormError, setAddressFormError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState<'post' | 'draft' | null>(null);
  /** The job that already exists — attachments retry against THIS id, never a new job. */
  const [postedJobId, setPostedJobId] = useState<number | null>(null);
  const [failedUploads, setFailedUploads] = useState<AttachmentDraft[]>([]);
  /**
   * The REAL in-flight lock. `submitting` is React state, so two taps inside the
   * same frame both read the old value and would fire two POSTs — two jobs. This
   * ref flips synchronously, before the request, and is cleared in `finally`.
   */
  const inFlight = useRef(false);

  // Month / weekday names for every date label, from the dictionary.
  const months = useMemo(() => splitTable(t('post_sched_months')), [t]);
  const weekdays = useMemo(() => splitTable(t('post_sched_weekdays')), [t]);
  const meridiem = useMemo(() => ({ am: t('post_sched_am'), pm: t('post_sched_pm') }), [t]);

  /**
   * THE COUNTER. One derived value from the live `description` state; the field's
   * onChangeText stores exactly what clampToWordLimit returns, so the count can
   * never disagree with the text and can never pass 500.
   */
  const wordCount = countWords(description);
  const wordTone = wordCounterTone(wordCount, DESC_WORD_MAX);
  const counterColor =
    wordTone === 'error' ? c.destructive : wordTone === 'warn' ? c.warning : c.mutedForeground;

  const clearError = useCallback((field: JobFormField) => {
    setStepErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const clearAllErrors = useCallback(() => setStepErrors({}), []);

  // ── The two-way Request Type ↔ Booking Type lock ─────────────────────────
  const clearDates = useCallback(() => {
    setSelectedDays([]);
    setTasks([]);
  }, []);

  const selectRequestType = useCallback(
    (requestType: FormRequestType) => {
      if (!isRequestTypeAllowed(bookingKind, requestType)) return;
      const next = applyRequestType({ requestType: urgency, kind: bookingKind }, requestType);
      setUrgency(next.requestType);
      setBookingKind(next.kind);
      if (next.datesReset) clearDates();
      setStepErrors((prev) => {
        const { date, time, ...rest } = prev;
        return rest;
      });
    },
    [bookingKind, urgency, clearDates]
  );

  const selectBookingKind = useCallback(
    (kind: BookingKind) => {
      if (!isBookingKindAllowed(kind, urgency)) return;
      const next = applyBookingKind({ requestType: urgency, kind: bookingKind }, kind);
      setUrgency(next.requestType);
      setBookingKind(next.kind);
      if (next.datesReset) clearDates();
      if (next.switched) setBookingSwitchNotice('multi_regular');
      setStepErrors((prev) => {
        const { date, time, ...rest } = prev;
        return rest;
      });
    },
    [bookingKind, urgency, clearDates]
  );

  useEffect(() => {
    if (!bookingSwitchNotice) return;
    const timer = setTimeout(() => setBookingSwitchNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [bookingSwitchNotice]);

  // ── Step navigation ───────────────────────────────────────────────────────
  const busy = submitting !== null;

  const goBack = useCallback(() => {
    if (inFlight.current || submitting !== null) return;
    clearAllErrors();
    if (step === 0) {
      router.back();
      return;
    }
    setStep((prev) => Math.max(0, prev - 1));
  }, [clearAllErrors, router, step, submitting]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (inFlight.current || submitting !== null) return true; // locked while posting
      if (step === 0) return false;
      clearAllErrors();
      setStep((prev) => Math.max(0, prev - 1));
      return true;
    });
    return () => sub.remove();
  }, [clearAllErrors, step, submitting]);

  const goNext = () => {
    const errors = validateStep(step);
    setStepErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setStep((prev) => Math.min(STEP_COUNT - 1, prev + 1));
  };

  // ── Per-step validation ───────────────────────────────────────────────────
  function validateStep(target: number): StepErrors {
    const next: StepErrors = {};
    if (target === 0) {
      if (serviceId == null) next.service = t('post_err_service');
      if (!description.trim()) next.description = t('post_err_desc');
    }
    if (target === 2) {
      const now = new Date();
      if (bookingKind === 'one_time') {
        const error = validateOneTime(oneTimeDayKind, timeChoice, now);
        if (error) next.time = t(error);
      } else {
        if (tasks.length === 0) next.date = t('post_err_dates_pick');
        else {
          const error = validateTasks(tasks, now);
          if (error) next.time = t(error);
          const badIndex = firstUntimedTask(tasks, now);
          if (badIndex >= 0) {
            next.time = t('post_err_task_time', { n: badIndex + 1 });
          }
        }
      }
      if (hours < MIN_EXPECTED_HOURS) next.hours = t('post_err_hours');
    }
    if (target === 3) {
      const chosen = addresses.find((row) => row.id === selectedAddressId) ?? null;
      if (!chosen) next.address = t('post_err_address');
      else if (!isAddressPostable(chosen)) next.address = t('post_addr_incomplete');
    }
    return next;
  }

  /** Live schedule problems for the visible step, without pressing Next. */
  const scheduleError = useMemo(() => {
    if (step !== 2) return null;
    const now = new Date();
    if (bookingKind === 'one_time') {
      const error = validateOneTime(oneTimeDayKind, timeChoice, now);
      return error ? t(error) : null;
    }
    if (tasks.length === 0) return t('post_err_dates_pick');
    const error = validateTasks(tasks, now);
    if (!error) return null;
    const badIndex = firstUntimedTask(tasks, now);
    return badIndex >= 0 ? t('post_err_task_time', { n: badIndex + 1 }) : t(error);
  }, [step, bookingKind, oneTimeDayKind, timeChoice, tasks, t]);

  // ── Picker wiring ─────────────────────────────────────────────────────────
  const activeDay = bookingKind === 'one_time' ? oneTimeDay(oneTimeDayKind) : null;
  const windowLabel = formatWindowLabel(timeChoice, meridiem);
  const shortWindow = !!timeChoice && windowShorterThanHours(timeChoice, hours);
  const range: ClockRange | null =
    timeChoice?.kind === 'anytime'
      ? { start: timeChoice.start, end: timeChoice.end }
      : null;

  /**
   * The "Preferred time" line the API has no field for (JobMilestoneCreate is
   * only scheduled_at + expected_hours). For one day it is that window; for
   * several days with DIFFERENT windows it names each task so no end time is
   * silently lost.
   */
  const preferredLine = useMemo(() => {
    if (bookingKind === 'one_time') return buildPreferredTimeLine(windowLabel);
    if (tasks.length === 0) return null;
    const labels = tasks.map((task, index) => {
      const label = formatWindowLabel(task.time, meridiem);
      const name = task.name ?? t('post_task_n', { n: index + 1 });
      return label ? `${name} ${label}` : '';
    });
    const distinct = new Set(labels.filter((label) => label.length > 0));
    if (distinct.size <= 1) return buildPreferredTimeLine(labels[0] ?? '');
    return buildPreferredTimeLine(labels.filter((label) => label.length > 0).join('; '));
  }, [bookingKind, windowLabel, tasks, meridiem, t]);

  // ── Addresses ─────────────────────────────────────────────────────────────
  const loadAddresses = useCallback(async () => {
    setAddressStatus('loading');
    try {
      const { data } = await authApi.getAddresses();
      const list = normalizeAddressList(data);
      setAddresses(list);
      setSelectedAddressId((current) =>
        current != null && list.some((row) => row.id === current)
          ? current
          : defaultAddressId(list)
      );
      setAddressStatus('ready');
    } catch {
      setAddressStatus('error');
    }
  }, []);

  useEffect(() => {
    void loadAddresses();
  }, [loadAddresses]);

  const beginAddAddress = () => {
    setAddressFieldErrors({});
    setAddressFormError(null);
    setAddressModal({ mode: 'add', addressId: null });
  };

  const beginEditAddress = (address: AddressResponse) => {
    setAddressFieldErrors({});
    setAddressFormError(null);
    setAddressModal({ mode: 'edit', addressId: address.id });
  };

  const editingAddress =
    addressModal?.mode === 'edit'
      ? addresses.find((row) => row.id === addressModal.addressId) ?? null
      : null;

  const submitAddress = async (form: PostAddressForm) => {
    if (addressSubmitting) return;
    setAddressSubmitting(true);
    setAddressFieldErrors({});
    setAddressFormError(null);
    try {
      const payload = buildProfileAddressPayload(form, form.formattedAddress);
      if (addressModal?.mode === 'edit' && editingAddress) {
        const { data } = await authApi.updateAddress(editingAddress.id, payload);
        setAddresses((prev) => prev.map((row) => (row.id === data.id ? data : row)));
        setSelectedAddressId(data.id);
      } else {
        const { data } = await authApi.createAddress(payload);
        setAddresses((prev) => [data, ...prev.filter((row) => row.id !== data.id)]);
        setSelectedAddressId(data.id);
      }
      setAddressModal(null);
    } catch (err: any) {
      const status = err?.response?.status;
      const mapped = mapAddressValidationErrors(err?.response?.data?.detail);
      setAddressFieldErrors(mapped.fieldErrors);
      setAddressFormError(
        mapped.formErrors[0] ??
          (status === 422
            ? t('post_addr_err_validation')
            : t('post_addr_err_save'))
      );
    } finally {
      setAddressSubmitting(false);
    }
  };

  const confirmDeleteAddress = (address: AddressResponse) => {
    showAlert({
      title: t('post_addr_delete_title'),
      message: t('post_addr_delete_msg'),
      icon: 'alert-triangle',
      buttons: [
        { text: t('action_cancel'), style: 'cancel' },
        {
          text: t('post_addr_delete'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setAddressBusy(true);
              try {
                await authApi.deleteAddress(address.id);
                const rest = addresses.filter((row) => row.id !== address.id);
                setAddresses(rest);
                setSelectedAddressId((current) =>
                  current === address.id ? defaultAddressId(rest) : current
                );
              } catch (err: any) {
                showAlert({
                  title: t('post_addr_delete_title'),
                  message:
                    err?.response?.status === 404
                      ? t('post_addr_delete_gone')
                      : t('post_addr_delete_failed'),
                  icon: 'alert-circle',
                });
                void loadAddresses();
              } finally {
                setAddressBusy(false);
              }
            })();
          },
        },
      ],
    });
  };

  // ── Multiple days: strip ↔ tasks ──────────────────────────────────────────
  const toggleDay = (day: Date) => {
    const nextDays = toggleAgendaDay(selectedDays, day);
    setSelectedDays(nextDays);
    setTasks((prev) => syncTasks(prev, nextDays));
    clearError('date');
    clearError('time');
  };

  const removeTask = (task: TaskDraft) => {
    const nextDays = selectedDays.filter((day) => dayKey(day) !== task.key);
    setUndo({ days: selectedDays, tasks });
    setSelectedDays(nextDays);
    setTasks(syncTasks(tasks, nextDays));
    clearError('time');
    clearError('date');
  };

  const undoRemove = () => {
    if (!undo) return;
    setSelectedDays(undo.days);
    setTasks(undo.tasks);
    setUndo(null);
  };

  // The snackbar fades itself out; it is informational, never a dialog.
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(timer);
  }, [undo]);

  const editingTask = taskEditorKey
    ? tasks.find((task) => task.key === taskEditorKey) ?? null
    : null;
  const editingTaskIndex = taskEditorKey
    ? tasks.findIndex((task) => task.key === taskEditorKey)
    : -1;

  // ── Error handling / posting ──────────────────────────────────────────────
  const showUnmapped = (messages: string[]) => {
    if (messages.length === 0) return;
    showAlert({
      title: t('post_err_invalid_title'),
      message: messages.join('\n'),
      icon: 'alert-circle',
    });
  };

  const goToJob = (jobId: number) => {
    router.replace(`/job/${jobId}` as any);
  };

  const publishDraft = useCallback(
    async (jobId: number) => {
      setSubmitting('draft');
      const outcome = await publish(jobId);
      setSubmitting(null);

      if (outcome.ok) {
        showAlert({
          title: t('post_publish_title'),
          message: t('post_publish_msg'),
          icon: 'radio',
          buttons: [{ text: t('post_view_job'), onPress: () => goToJob(jobId) }],
        });
        return;
      }

      if (outcome.kind === 'busy') return;
      if (outcome.kind === 'unauthorized') {
        showAlert({
          title: t('post_err_session_title'),
          message: t('post_err_session_msg'),
          icon: 'lock',
        });
        return;
      }

      showAlert({
        title: t('post_publish_failed_title'),
        message: outcome.message ?? t(publishErrorKey(outcome.kind)),
        icon: 'alert-triangle',
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showAlert, t, publish]
  );

  const showPostedAlert = (created: JobResponse) => {
    const createdStatusKey = jobStatusLabelKey(created.status);
    showAlert({
      title: t('post_success_title'),
      message:
        created.status === 'OPEN' || !createdStatusKey
          ? t('post_success_msg')
          : t('post_success_msg_status', { status: t(createdStatusKey) }),
      icon: 'check-circle',
      buttons: [{ text: t('post_view_job'), onPress: () => goToJob(created.id) }],
    });
  };

  /**
   * Upload the held files to the job that ALREADY exists. Returns exactly the
   * files that failed, so a retry can never touch a file that succeeded.
   */
  const uploadQueue = async (
    jobId: number,
    queue: AttachmentDraft[]
  ): Promise<AttachmentDraft[]> => {
    const failed: AttachmentDraft[] = [];
    for (const file of queue) {
      try {
        await authApi.addJobAttachment(jobId, {
          uri: file.uri,
          name: file.name,
          mimeType: file.mimeType,
        });
      } catch {
        failed.push(file);
      }
    }
    return failed;
  };

  /**
   * Upload, then either continue to `after`, or offer a retry for ONLY the
   * failed files. The job id is threaded through the recursion, so a retry can
   * never fall back to a second POST /api/v1/jobs (no duplicate job).
   */
  const uploadWithRetry = async (
    jobId: number,
    queue: AttachmentDraft[],
    after: () => void,
    phase: 'post' | 'draft' = 'post'
  ): Promise<void> => {
    if (queue.length === 0) {
      after();
      return;
    }
    const failed = await uploadQueue(jobId, queue);
    setPostedJobId(jobId);
    setFailedUploads(failed);
    if (failed.length === 0) {
      after();
      return;
    }

    setSubmitting(null);
    showAlert({
      title: t('post_attach_failed_title'),
      message: t('post_attach_failed_msg', { n: failed.length, total: queue.length }),
      icon: 'alert-triangle',
      buttons: [
        { text: t('post_attach_skip'), style: 'cancel', onPress: after },
        {
          text: t('post_attach_retry'),
          onPress: () => {
            setSubmitting(phase);
            void uploadWithRetry(jobId, failed, after, phase);
          },
        },
      ],
    });
  };

  const submit = async (isDraft: boolean) => {
    if (submitting || publishing || inFlight.current) return;
    const perStep = [validateStep(0), validateStep(1), validateStep(2), validateStep(3)];
    const merged: StepErrors = Object.assign({}, ...perStep);
    if (Object.keys(merged).length > 0) {
      setStepErrors(merged);
      const firstBad = perStep.findIndex((errors) => Object.keys(errors).length > 0);
      if (firstBad >= 0) setStep(firstBad);
      return;
    }

    const chosenAddress = addresses.find((row) => row.id === selectedAddressId) ?? null;
    if (!chosenAddress) return;
    const address = jobAddressFrom(chosenAddress);
    if (
      address.countryId === null ||
      address.countyId === null ||
      address.cityId === null ||
      serviceId == null
    ) {
      setStepErrors({ address: t('post_addr_incomplete') });
      setStep(3);
      return;
    }

    const now = new Date();
    const chosenHours = clampExpectedHours(hours);
    const milestones =
      bookingKind === 'one_time'
        ? buildOneTimeMilestones(oneTimeDay(oneTimeDayKind, now), timeChoice as TimeChoice, chosenHours)
        : buildTaskMilestones(tasks, chosenHours);

    const payload = buildCreateJobRequest({
      serviceId,
      serviceCategoryId,
      // The user no longer types a title: the service's own title is sent.
      title: jobTitle,
      description,
      preferredTimeLine: preferredLine,
      requestType: urgency,
      bookingType: bookingKind,
      scheduledAtIso: milestones[0]?.scheduled_at ?? null,
      milestones: milestones.map((m) => ({
        scheduledAtIso: m.scheduled_at,
        expectedHours: Number(m.expected_hours),
      })),
      expectedHours: chosenHours,
      countryId: address.countryId,
      countyId: address.countyId,
      cityId: address.cityId,
      houseNumber: address.houseNumber,
      streetAddress: address.streetAddress,
      postalCode: address.postalCode,
      landmark: address.landmark,
      formattedAddress: address.formattedAddress,
      isDraft,
    });

    inFlight.current = true;
    setSubmitting(isDraft ? 'draft' : 'post');

    let created: JobResponse | null = null;
    try {
      const { data } = await authApi.createJob(payload);
      created = data;
    } catch (err: any) {
      const failure = classifyCreateJobFailure(err);

      if (failure.kind === 'invalid') {
        const mapped = mapValidationErrors(err?.response?.data?.detail);
        setStepErrors((prev) => ({ ...prev, ...mapped.fieldErrors }));
        const badStep = firstErrorStep(mapped.fieldErrors);
        if (badStep !== null) setStep(badStep);
        if (mapped.formErrors.length > 0) showUnmapped(mapped.formErrors);
        else if (badStep === null) showUnmapped([t('post_err_invalid_msg')]);
      } else if (isClientProfileMissing(failure.message)) {
        showAlert({
          title: t('post_err_profile_title'),
          message: t('post_err_profile_msg'),
          icon: 'user-x',
        });
      } else {
        const copy = createJobErrorCopy(failure.kind);
        showAlert({
          title: t(copy.titleKey),
          message:
            copy.preferServerMessage && failure.message ? failure.message : t(copy.messageKey),
          icon: copy.icon,
        });
      }
    } finally {
      inFlight.current = false;
    }

    // No 201 → the dialog above is the whole outcome, and every entered value is
    // still on screen for the retry.
    if (!created) {
      setSubmitting(null);
      return;
    }

    invalidateJobList();
    const publishable = isDraftJob(created);
    const jobId = created.id;

    if (isDraft) {
      // Drafts carry the address and the tasks (milestones) like a real post.
      await uploadWithRetry(jobId, attachments, () => {
        setSubmitting(null);
        showAlert({
          title: t('post_draft_title'),
          message: t('post_draft_msg'),
          icon: 'save',
          buttons: publishable
            ? [
                { text: t('post_publish_now'), onPress: () => void publishDraft(jobId) },
                { text: t('post_view_job'), style: 'cancel', onPress: () => goToJob(jobId) },
              ]
            : [{ text: t('post_view_job'), onPress: () => goToJob(jobId) }],
        });
      }, 'draft');
      return;
    }

    // The job exists: files go up now, and the loader stays on until they are done
    // (or the user chooses to skip a file that failed).
    await uploadWithRetry(jobId, attachments, () => {
      setSubmitting(null);
      showPostedAlert(created);
    });
  };

  // ── Service section ───────────────────────────────────────────────────────
  const renderServiceSection = () => {
    if (serviceId == null) {
      return (
        <TouchableOpacity
          style={[
            styles.serviceEmpty,
            { backgroundColor: c.input, borderColor: stepErrors.service ? c.destructive : c.border },
          ]}
          onPress={() => setServiceSheetOpen(true)}
          accessibilityRole="button"
        >
          <Feather name="briefcase" size={17} color={c.mutedForeground} />
          <View style={styles.serviceEmptyBody}>
            <Text style={[styles.serviceName, { color: c.text }]}>{t('post_service_pick')}</Text>
            <Text style={[styles.serviceMeta, { color: c.mutedForeground }]}>
              {t('post_service_pick_sub')}
            </Text>
          </View>
          <Feather name="chevron-down" size={17} color={c.mutedForeground} />
        </TouchableOpacity>
      );
    }

    const loadingMeta = detailStatus === 'loading' && pickedService == null;
    const metaFailed =
      pickedService == null &&
      (detailStatus === 'error' || detailStatus === 'notfound' || detailStatus === 'invalid');

    return (
      <View>
        <View style={[styles.lockedCard, { backgroundColor: c.primaryLight, borderColor: c.primary }]}>
          <View style={styles.lockedBody}>
            {loadingMeta ? (
              <InlineLoader size={16} />
            ) : (
              <>
                <Text style={[styles.serviceName, { color: c.text }]} numberOfLines={1}>
                  {serviceTitle ?? t('post_service')}
                </Text>
                {serviceCategoryName ? (
                  <Text style={[styles.serviceMeta, { color: c.mutedForeground }]} numberOfLines={1}>
                    {serviceCategoryName}
                  </Text>
                ) : null}
              </>
            )}
          </View>
          <TouchableOpacity
            onPress={() => setServiceSheetOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={[styles.lockedAction, { color: c.primary }]}>{t('post_svc_change')}</Text>
          </TouchableOpacity>
        </View>
        {metaFailed ? (
          <View style={styles.inlineError}>
            <Feather name="alert-circle" size={12} color={c.mutedForeground} />
            <Text style={[styles.error, { color: c.mutedForeground, marginTop: 0 }]}>
              {t('post_service_meta_error')}
            </Text>
            <TouchableOpacity onPress={() => void refreshDetail()} hitSlop={6}>
              <Text style={[styles.serviceStateAction, { color: c.primary }]}>{t('cats_retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  // ── Step bodies ───────────────────────────────────────────────────────────
  const renderDetailsStep = () => (
    <>
      <Text style={[styles.label, { color: c.text }]}>{t('post_service')}</Text>
      {renderServiceSection()}
      {stepErrors.service ? (
        <Text style={[styles.error, { color: c.destructive }]}>{stepErrors.service}</Text>
      ) : null}
      {stepErrors.title ? (
        <Text style={[styles.error, { color: c.destructive }]}>{stepErrors.title}</Text>
      ) : null}

      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: c.text }]}>{t('post_description')}</Text>
        <Text style={[styles.counter, { color: counterColor }]}>
          {t('post_words', { n: wordCount })}
        </Text>
      </View>
      <TextInput
        style={[
          styles.textArea,
          {
            backgroundColor: c.input,
            color: c.text,
            borderColor: stepErrors.description ? c.destructive : c.border,
          },
        ]}
        placeholder={t('post_desc_placeholder')}
        placeholderTextColor={c.mutedForeground}
        value={description}
        onChangeText={(next) => {
          // Live on every change, including a paste: clamp keeps the field and
          // the counter in lock-step, so "N/500 words" can never desynchronise.
          setDescription(clampToWordLimit(next));
          clearError('description');
        }}
        multiline
        numberOfLines={5}
        textAlignVertical="top"
      />
      {stepErrors.description ? (
        <Text style={[styles.error, { color: c.destructive }]}>{stepErrors.description}</Text>
      ) : null}

      <AttachmentSection files={attachments} onChange={setAttachments} />
    </>
  );

  const renderBookingStep = () => (
    <>
      <Text style={[styles.label, { color: c.text }]}>{t('post_request_type')}</Text>
      <View style={styles.optionRow}>
        <RequestTypeCard
          active={urgency === 'urgent'}
          icon="zap"
          title={t('post_urgent')}
          description={t('post_urgent_desc')}
          // The web app's gold token (--warning = oklch(0.78 0.16 75) = #F2A618).
          accent={c.gold}
          accentSoft={c.goldLight}
          onAccent={c.goldForeground}
          idle={c.muted}
          border={c.border}
          titleColor={c.text}
          bodyColor={c.mutedForeground}
          onPress={() => selectRequestType('urgent')}
          disabled={!isRequestTypeAllowed(bookingKind, 'urgent')}
        />
        <RequestTypeCard
          active={urgency === 'regular'}
          icon="clock"
          title={t('post_regular')}
          description={t('post_regular_desc')}
          accent={c.success}
          accentSoft={c.successLight}
          onAccent={c.primaryForeground}
          idle={c.muted}
          border={c.border}
          titleColor={c.text}
          bodyColor={c.mutedForeground}
          onPress={() => selectRequestType('regular')}
        />
      </View>
      {!isRequestTypeAllowed(bookingKind, 'urgent') ? (
        <Text style={[styles.hint, { color: c.mutedForeground }]}>{t('post_urgent_locked')}</Text>
      ) : null}

      <Text style={[styles.label, { color: c.text }]}>{t('post_booking_pick')}</Text>
      <View style={styles.optionRow}>
        <BookingTypeCard
          active={bookingKind === 'one_time'}
          icon="calendar"
          title={t('post_booking_single_day')}
          description={t('post_booking_single_day_desc')}
          onPress={() => selectBookingKind('one_time')}
        />
        <BookingTypeCard
          active={bookingKind === 'multi_day'}
          icon="repeat"
          title={t('post_booking_multi_day')}
          description={t('post_booking_multi_day_desc')}
          onPress={() => selectBookingKind('multi_day')}
          disabled={!isBookingKindAllowed('multi_day', urgency)}
        />
      </View>
      {!isBookingKindAllowed('multi_day', urgency) ? (
        <Text style={[styles.hint, { color: c.mutedForeground }]}>
          {t('post_lock_urgent_single')}
        </Text>
      ) : null}

      {bookingSwitchNotice ? (
        <View style={[styles.switchNotice, { backgroundColor: c.muted, borderColor: c.border }]}>
          <Feather name="info" size={14} color={c.mutedForeground} />
          <Text style={[styles.switchNoticeText, { color: c.mutedForeground }]}>
            {bookingSwitchNotice === 'multi_regular'
              ? t('post_lock_multi_regular_notice')
              : t('post_lock_urgent_single_notice')}
          </Text>
        </View>
      ) : null}
    </>
  );

  /** The five presets — a second tap on the selected one clears the choice. */
  const renderPresetGrid = (day: Date | null) => (
    <View style={styles.slotGrid}>
      {FIXED_SLOTS.map((slot) => {
        const choice: TimeChoice = { kind: 'slot', key: slot.key };
        const active = timeChoice?.kind === 'slot' && timeChoice.key === slot.key;
        const started = hasSlotStarted(choice, day);
        return (
          <TouchableOpacity
            key={slot.key}
            style={[
              styles.slot,
              {
                backgroundColor: active ? c.primary : c.input,
                borderColor: active ? c.primary : c.border,
                opacity: started ? 0.45 : 1,
              },
            ]}
            onPress={() => {
              if (started) return;
              setTimeChoice(toggleSlot(timeChoice, slot.key));
              clearError('time');
              clearError('date');
            }}
            disabled={started}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: started }}
          >
            <Text
              style={[styles.slotText, { color: active ? c.primaryForeground : c.text }]}
              numberOfLines={1}
            >
              {formatWindowLabel(choice, meridiem)}
            </Text>
            {started ? (
              <Text
                style={[
                  styles.slotNote,
                  { color: active ? c.primaryForeground : c.mutedForeground },
                ]}
              >
                {t('post_time_slot_started')}
              </Text>
            ) : null}
          </TouchableOpacity>
        );
      })}

      <TouchableOpacity
        style={[
          styles.slot,
          {
            backgroundColor: timeChoice?.kind === 'anytime' ? c.primary : c.input,
            borderColor: timeChoice?.kind === 'anytime' ? c.primary : c.border,
          },
        ]}
        onPress={() => setCustomSheetOpen(true)}
        accessibilityRole="button"
        accessibilityState={{ selected: timeChoice?.kind === 'anytime' }}
      >
        <Feather
          name="clock"
          size={13}
          color={timeChoice?.kind === 'anytime' ? c.primaryForeground : c.mutedForeground}
        />
        <Text
          style={[
            styles.slotText,
            { color: timeChoice?.kind === 'anytime' ? c.primaryForeground : c.text },
          ]}
        >
          {t('post_time_anytime')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  /** The custom window, shown on its own chip with a clear (x). */
  const renderCustomChip = () => {
    if (timeChoice?.kind !== 'anytime') return null;
    return (
      <View style={styles.customRow}>
        <View style={[styles.customChip, { backgroundColor: c.primaryLight, borderColor: c.primary }]}>
          <Feather name="clock" size={13} color={c.primary} />
          <Text style={[styles.customChipText, { color: c.primary }]}>{windowLabel}</Text>
          <TouchableOpacity
            onPress={() => {
              setTimeChoice(null);
              clearError('time');
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('post_time_clear')}
          >
            <Feather name="x" size={13} color={c.primary} />
          </TouchableOpacity>
        </View>
        {windowMinutes(timeChoice) <= 0 ? (
          <View style={styles.inlineError}>
            <Feather name="alert-circle" size={13} color={c.destructive} />
            <Text style={[styles.error, { color: c.destructive, marginTop: 0, flex: 1 }]}>
              {t('post_err_time_window')}
            </Text>
          </View>
        ) : shortWindow ? (
          <Text style={[styles.hint, { color: c.mutedForeground }]}>
            {t('post_time_short_hint', { h: hours })}
          </Text>
        ) : null}
      </View>
    );
  };

  const renderHours = () => (
    <>
      <Text style={[styles.label, { color: c.text }]}>
        {bookingKind === 'one_time' ? t('post_hours') : t('post_hours_per_day')}
      </Text>
      <View style={[styles.stepper, { backgroundColor: c.input, borderColor: c.border }]}>
        <TouchableOpacity
          style={[styles.stepperBtn, { backgroundColor: c.muted }]}
          onPress={() => setHours((h) => Math.max(MIN_EXPECTED_HOURS, h - 1))}
          accessibilityRole="button"
          accessibilityLabel={`${t('post_hours')} -1`}
        >
          <Feather name="minus" size={16} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.stepperValue, { color: c.text }]}>
          {hours === 1 ? t('post_hours_value', { n: hours }) : t('post_hours_value_plural', { n: hours })}
        </Text>
        <TouchableOpacity
          style={[styles.stepperBtn, { backgroundColor: c.muted }]}
          onPress={() => setHours((h) => Math.min(MAX_EXPECTED_HOURS, h + 1))}
          accessibilityRole="button"
          accessibilityLabel={`${t('post_hours')} +1`}
        >
          <Feather name="plus" size={16} color={c.text} />
        </TouchableOpacity>
      </View>
    </>
  );

  const renderSingleDay = () => (
    <>
      <Text style={[styles.label, { color: c.text }]}>{t('post_date')}</Text>
      <View style={styles.chipWrapRow}>
        {(['today', 'tomorrow'] as OneTimeDay[]).map((kind) => {
          const active = oneTimeDayKind === kind;
          return (
            <TouchableOpacity
              key={kind}
              style={[styles.chip, { backgroundColor: active ? c.primary : c.muted }]}
              onPress={() => {
                setOneTimeDayKind(kind);
                clearError('date');
                clearError('time');
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, { color: active ? c.primaryForeground : c.text }]}>
                {t(kind === 'today' ? 'post_date_today' : 'post_date_tomorrow')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.label, { color: c.text }]}>{t('post_time')}</Text>
      {renderPresetGrid(activeDay)}
      {renderCustomChip()}

      {stepErrors.date || stepErrors.time ? (
        <Animated.View entering={FadeIn.duration(180)} style={styles.inlineError}>
          <Feather name="alert-circle" size={13} color={c.destructive} />
          <Text style={[styles.error, { color: c.destructive, marginTop: 0, flex: 1 }]}>
            {stepErrors.time ?? stepErrors.date}
          </Text>
        </Animated.View>
      ) : scheduleError ? (
        <Text style={[styles.hint, { color: c.mutedForeground }]}>{scheduleError}</Text>
      ) : null}

      {renderHours()}
    </>
  );

  const renderMultiDay = () => (
    <>
      <Text style={[styles.label, { color: c.text }]}>{t('post_dates_title')}</Text>
      <DateStrip
        selected={selectedDays}
        onToggle={toggleDay}
        weekdays={weekdays}
        months={months}
        disabled={(day) => !dayHasBookableTime(day)}
      />
      <Text style={[styles.hint, { color: c.mutedForeground, marginTop: 10 }]}>
        {selectedDays.length === 0
          ? t('post_dates_hint')
          : t('post_days_selected_of', { n: selectedDays.length, total: 7 })}
      </Text>

      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: c.text }]}>{t('post_tasks')}</Text>
        {tasks.length > 0 ? (
          <Text style={[styles.counter, { color: c.mutedForeground }]}>
            {t('post_tasks_count', { n: tasks.length })}
          </Text>
        ) : null}
      </View>

      {tasks.length === 0 ? (
        <View style={[styles.taskEmpty, { backgroundColor: c.muted, borderColor: c.border }]}>
          <Feather name="list" size={18} color={c.mutedForeground} />
          <Text style={[styles.taskEmptyText, { color: c.mutedForeground }]}>
            {t('post_tasks_empty')}
          </Text>
        </View>
      ) : (
        tasks.map((task, index) => {
          const taskLabel = task.name ?? t('post_task_n', { n: index + 1 });
          const taskWindow = formatWindowLabel(task.time, meridiem);
          const untimed = validateTimeChoice(task.time, task.day, new Date()) !== null;
          return (
            <Animated.View
              key={task.key}
              entering={FadeInUp.delay(index * 40).duration(240)}
              style={[
                styles.taskCard,
                {
                  backgroundColor: c.card,
                  borderColor: untimed ? c.destructive : c.primary,
                },
              ]}
            >
              <View style={[styles.taskBadge, { backgroundColor: c.primary }]}>
                <Text style={[styles.taskBadgeText, { color: c.primaryForeground }]}>
                  {index + 1}
                </Text>
              </View>
              <View style={styles.taskBody}>
                <Text style={[styles.taskName, { color: c.text }]} numberOfLines={1}>
                  {taskLabel}
                </Text>
                <Text style={[styles.taskMeta, { color: c.mutedForeground }]} numberOfLines={1}>
                  {`${t('post_task_short_day', { day: task.day.getDate(), month: months[task.day.getMonth()] ?? '' })} · ${
                    taskWindow || t('post_task_time_missing')
                  }`}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setTaskEditorKey(task.key)}
                hitSlop={8}
                style={styles.taskAction}
                accessibilityRole="button"
                accessibilityLabel={t('post_task_edit')}
              >
                <Feather name="edit-2" size={15} color={c.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => removeTask(task)}
                hitSlop={8}
                style={styles.taskAction}
                accessibilityRole="button"
                accessibilityLabel={t('post_task_remove')}
              >
                <Feather name="trash-2" size={15} color={c.destructive} />
              </TouchableOpacity>
            </Animated.View>
          );
        })
      )}

      {stepErrors.date || stepErrors.time ? (
        <Animated.View entering={FadeIn.duration(180)} style={styles.inlineError}>
          <Feather name="alert-circle" size={13} color={c.destructive} />
          <Text style={[styles.error, { color: c.destructive, marginTop: 0, flex: 1 }]}>
            {stepErrors.time ?? stepErrors.date}
          </Text>
        </Animated.View>
      ) : scheduleError ? (
        <Text style={[styles.hint, { color: c.mutedForeground }]}>{scheduleError}</Text>
      ) : null}

      {renderHours()}
    </>
  );

  const renderScheduleStep = () => (bookingKind === 'one_time' ? renderSingleDay() : renderMultiDay());

  const renderAddressStep = () => (
    <>
      <Text style={[styles.label, { color: c.text }]}>{t('post_addr_pick')}</Text>

      {addressStatus === 'loading' && addresses.length === 0 ? (
        <View style={[styles.addrState, { backgroundColor: c.card, borderColor: c.border }]}>
          <ActivityIndicator size="small" color={c.primary} />
          <Text style={[styles.addrStateText, { color: c.mutedForeground }]}>
            {t('post_addr_loading')}
          </Text>
        </View>
      ) : addressStatus === 'error' ? (
        <View style={[styles.addrState, { backgroundColor: c.card, borderColor: c.destructive }]}>
          <Feather name="wifi-off" size={18} color={c.destructive} />
          <Text style={[styles.addrStateText, { color: c.destructive }]}>
            {t('addr_err_network')}
          </Text>
          <TouchableOpacity onPress={() => void loadAddresses()}>
            <Text style={[styles.serviceStateAction, { color: c.primary }]}>{t('addr_retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : addresses.length === 0 ? (
        <View style={[styles.addrState, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="map-pin" size={20} color={c.mutedForeground} />
          <Text style={[styles.addrStateText, { color: c.mutedForeground }]}>
            {t('post_addr_empty')}
          </Text>
        </View>
      ) : (
        addresses.map((address) => (
          <AddressCard
            key={address.id}
            address={address}
            selected={address.id === selectedAddressId}
            isDefault={address.id === defaultAddressId(addresses)}
            busy={addressBusy}
            onSelect={() =>
              setSelectedAddressId((current) => (current === address.id ? null : address.id))
            }
            onEdit={() => beginEditAddress(address)}
            onDelete={() => confirmDeleteAddress(address)}
          />
        ))
      )}

      <TouchableOpacity
        style={[styles.addAddrBtn, { borderColor: c.primary }]}
        onPress={beginAddAddress}
        accessibilityRole="button"
      >
        <Feather name="plus" size={16} color={c.primary} />
        <Text style={[styles.addAddrText, { color: c.primary }]}>{t('post_addr_add')}</Text>
      </TouchableOpacity>

      {stepErrors.address ? (
        <Text style={[styles.error, { color: c.destructive }]}>{stepErrors.address}</Text>
      ) : null}
    </>
  );

  const selectedAddress = addresses.find((row) => row.id === selectedAddressId) ?? null;
  // Memoised so a parent re-render (e.g. the submit flag) never re-seeds the
  // form and wipes what the user is typing.
  const initialAddressForm = useMemo(
    () => (editingAddress ? addressFormFrom(editingAddress) : null),
    [editingAddress]
  );

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton onPress={goBack} />
        <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>
          {t(STEP_KEYS[step])}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.progressWrap, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <View style={styles.progressTrack}>
          {STEP_KEYS.map((key, index) => (
            <View
              key={key}
              style={[
                styles.progressSegment,
                { backgroundColor: index <= step ? c.primary : c.muted },
              ]}
            />
          ))}
        </View>
        <Text style={[styles.progressLabel, { color: c.mutedForeground }]}>
          {t('post_step_of', { n: step + 1, total: STEP_COUNT })}
        </Text>
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        bottomOffset={110}
      >
        <Animated.View key={`step-${step}`} entering={FadeInUp.duration(260)} style={styles.stepBody}>
          {step === 0 ? renderDetailsStep() : null}
          {step === 1 ? renderBookingStep() : null}
          {step === 2 ? renderScheduleStep() : null}
          {step === 3 ? renderAddressStep() : null}
        </Animated.View>
      </KeyboardAwareScrollViewCompat>

      {/* Undo snackbar — above the action bar, never over the system buttons. */}
      {undo ? (
        <Animated.View
          entering={FadeInUp.duration(180)}
          style={[
            styles.snackbar,
            {
              backgroundColor: c.text,
              bottom: insets.bottom + 150,
            },
          ]}
        >
          <Text style={[styles.snackbarText, { color: c.background }]} numberOfLines={1}>
            {t('post_task_removed')}
          </Text>
          <TouchableOpacity onPress={undoRemove} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.snackbarAction, { color: c.background }]}>{t('post_undo')}</Text>
          </TouchableOpacity>
        </Animated.View>
      ) : null}

      <View
        style={[
          styles.bar,
          {
            backgroundColor: c.surface,
            borderTopColor: c.border,
            paddingBottom: Math.max(insets.bottom, 12),
          },
        ]}
      >
        {step === STEP_COUNT - 1 ? (
          <>
            <TouchableOpacity
              style={[
                styles.submitBtn,
                { backgroundColor: c.primary, opacity: busy || !selectedAddress ? 0.55 : 1 },
              ]}
              onPress={() => void submit(false)}
              disabled={busy || !selectedAddress}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || !selectedAddress, busy: submitting === 'post' }}
            >
              {submitting === 'post' ? (
                <View style={styles.loadingRow}>
                  <DotsLoader color={c.primaryForeground} />
                  <Text style={[styles.submitText, { color: c.primaryForeground }]}>
                    {t('post_posting')}
                  </Text>
                </View>
              ) : (
                <Text style={[styles.submitText, { color: c.primaryForeground }]}>
                  {t('post_submit')}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.draftBtn, { borderColor: c.primary, opacity: busy ? 0.55 : 1 }]}
              onPress={() => void submit(true)}
              disabled={busy}
              accessibilityRole="button"
            >
              {submitting === 'draft' ? (
                <View style={styles.loadingRow}>
                  <DotsLoader color={c.primary} />
                  <Text style={[styles.draftText, { color: c.primary }]}>
                    {t('post_saving_draft')}
                  </Text>
                </View>
              ) : (
                <Text style={[styles.draftText, { color: c.primary }]}>{t('post_save_draft')}</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.barRow}>
            <TouchableOpacity
              style={[styles.barBack, { borderColor: c.border }]}
              onPress={goBack}
              accessibilityRole="button"
            >
              <Text style={[styles.barBackText, { color: c.text }]}>{t('post_back')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.barNext,
                { backgroundColor: c.primary, opacity: step === 2 && scheduleError ? 0.55 : 1 },
              ]}
              onPress={goNext}
              // The time step may only advance once its schedule is valid:
              // a preset is chosen, or EVERY task has a valid time of its own.
              disabled={step === 2 && scheduleError !== null}
              accessibilityRole="button"
              accessibilityState={{ disabled: step === 2 && scheduleError !== null }}
            >
              <Text style={[styles.barNextText, { color: c.primaryForeground }]}>
                {t('post_next')}
              </Text>
              <Feather name="arrow-right" size={16} color={c.primaryForeground} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Cascading category → service picker */}
      <ServicePickerSheet
        visible={serviceSheetOpen}
        onClose={() => setServiceSheetOpen(false)}
        selectedId={serviceId}
        onSelect={(service) => {
          setPickedService(service);
          setServiceId(service.id);
          clearError('service');
          setServiceSheetOpen(false);
        }}
      />

      {/* Anytime — ONE sheet, two rows, hours/minutes arrows. No clock face. */}
      <TimeRangeSheet
        visible={customSheetOpen}
        onClose={() => setCustomSheetOpen(false)}
        title={t('post_time_custom_title')}
        value={range}
        day={activeDay}
        onApply={(next) => {
          setTimeChoice({ kind: 'anytime', start: next.start, end: next.end });
          clearError('time');
          clearError('date');
          setCustomSheetOpen(false);
        }}
      />

      {/* One task's own name + time. */}
      <TaskEditSheet
        visible={editingTask !== null}
        onClose={() => setTaskEditorKey(null)}
        task={editingTask}
        index={editingTaskIndex < 0 ? 0 : editingTaskIndex}
        onSave={(name, time) => {
          if (!taskEditorKey) return;
          setTasks((prev) =>
            setTaskName(setTaskTime(prev, taskEditorKey, time), taskEditorKey, name)
          );
          clearError('time');
          setTaskEditorKey(null);
        }}
      />

      {/* Add / edit a saved address — full screen, on top of the wizard. */}
      <AddressFormModal
        visible={addressModal !== null}
        mode={addressModal?.mode ?? 'add'}
        initial={initialAddressForm}
        accountName={[user?.first_name, user?.last_name].filter(Boolean).join(' ')}
        accountPhone={user?.phone ?? ''}
        submitting={addressSubmitting}
        fieldErrors={addressFieldErrors}
        formError={addressFormError}
        onClose={() => setAddressModal(null)}
        onSubmit={(form) => void submitAddress(form)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18, flex: 1, textAlign: 'center' },
  progressWrap: { paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, gap: 6 },
  progressTrack: { flexDirection: 'row', gap: 6 },
  progressSegment: { flex: 1, height: 4, borderRadius: 2 },
  progressLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 11, letterSpacing: 0.3 },
  scroll: { padding: 20, paddingBottom: 36, gap: 6 },
  stepBody: { gap: 2 },
  label: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginTop: 16, marginBottom: 8 },
  smallLabel: { fontFamily: 'Manrope_500Medium', fontSize: 12, marginBottom: 6 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
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
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 8, lineHeight: 16 },
  switchNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  switchNoticeText: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16, flex: 1 },
  inlineError: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  chipWrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  chipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  slotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
    columnGap: 8,
  },
  slot: {
    width: '47.5%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 12,
    minHeight: 52,
  },
  slotText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, flexShrink: 1 },
  slotNote: { fontFamily: 'Manrope_400Regular', fontSize: 9 },
  customRow: { marginTop: 10, gap: 4 },
  customChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  customChipText: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
  },
  stepperBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  optionRow: { flexDirection: 'row', gap: 10 },
  optionSlot: { flex: 1 },
  optionCard: {
    flex: 1,
    minHeight: 168,
    borderWidth: 1.5,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 7,
  },
  optionIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontFamily: 'Manrope_700Bold', fontSize: 14, minHeight: 20, textAlign: 'center' },
  optionDesc: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 15,
    minHeight: 45,
  },
  optionBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 16,
    marginBottom: 4,
  },
  taskEmptyText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 17 },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  taskBadge: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  taskBadgeText: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
  taskBody: { flex: 1, minWidth: 0 },
  taskName: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  taskMeta: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2 },
  taskAction: { padding: 4 },
  serviceEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  serviceEmptyBody: { flex: 1 },
  lockedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  lockedBody: { flex: 1 },
  lockedAction: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
  serviceName: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  serviceMeta: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2 },
  serviceStateAction: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
  addrCard: { borderRadius: 16, padding: 14, marginBottom: 10, gap: 12 },
  addrHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioDot: { width: 9, height: 9, borderRadius: 5 },
  addrBody: { flex: 1, minWidth: 0 },
  addrTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  addrTitle: { flexShrink: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  addrRegion: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 2 },
  addrWarn: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 4 },
  addrActions: { flexDirection: 'row', gap: 18, borderTopWidth: 1, paddingTop: 10 },
  addrAction: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addrActionText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  addrState: {
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  addrStateText: { fontFamily: 'Manrope_400Regular', fontSize: 12, textAlign: 'center' },
  addAddrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 2,
  },
  addAddrText: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
  snackbar: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    zIndex: 40,
    elevation: 12,
  },
  snackbarText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 12 },
  snackbarAction: { fontFamily: 'Manrope_700Bold', fontSize: 12, textDecorationLine: 'underline' },
  bar: { borderTopWidth: 1, paddingHorizontal: 20, paddingTop: 12, gap: 10 },
  barRow: { flexDirection: 'row', gap: 10 },
  barBack: { flex: 1, borderWidth: 1.5, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  barBackText: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  barNext: {
    flex: 2,
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  barNextText: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  submitBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitText: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  draftBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', borderWidth: 1.5 },
  draftText: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
});
