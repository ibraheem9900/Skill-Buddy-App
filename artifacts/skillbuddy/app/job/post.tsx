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
import TimeChoices from '@/components/TimeChoices';
import TaskEditSheet from '@/components/TaskEditSheet';
import AttachmentSection from '@/components/AttachmentSection';
import AddressFormModal from '@/components/AddressFormModal';
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
  selectionWindow,
  validateOneTime,
  validateTimeChoice,
  windowMinutes,
  windowShorterThanHours,
} from '@/lib/jobBooking';
import {
  activeAfterDelete,
  activeDayOf,
  applyDayTap,
  applyTaskTime,
  buildTaskMilestones,
  dayKey,
  firstUntimedTask,
  hasBookableTime as dayHasBookableTime,
  syncTasks,
  taskHoursCap,
  toggleSlot,
  validateTasks,
  type DaySelection,
  type TaskDraft,
} from '@/lib/postWizard';
import {
  MIN_EXPECTED_HOURS as MIN_HOURS_BEFORE_DAY_END,
  DAY_END_MINUTES,
  buildScheduleLine,
  clampHours,
  clockOf,
  exceedsHoursCap,
  formatDayLabel,
  formatLocalDateTime,
  formatTimeLabel,
  maxHoursForStart,
  minutesOf,
} from '@/lib/timeSlots';
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

/* ── The wizard's steps ───────────────────────────────────────────────────────
 * Single day keeps four steps. Multiple days inserts the Tasks step (one card
 * per selected day), so the progress bar and "Step x of N" are derived from the
 * CURRENT booking type and always agree with each other.
 */
const STEP_DETAILS: TranslationKey = 'post_step_details';
const STEP_BOOKING: TranslationKey = 'post_step_booking';
const STEP_SCHEDULE: TranslationKey = 'post_step_schedule';
const STEP_TASKS: TranslationKey = 'post_step_tasks';
const STEP_ADDRESS: TranslationKey = 'post_step_address';

function stepKeysFor(bookingKind: BookingKind): TranslationKey[] {
  return bookingKind === 'multi_day'
    ? [STEP_DETAILS, STEP_BOOKING, STEP_SCHEDULE, STEP_TASKS, STEP_ADDRESS]
    : [STEP_DETAILS, STEP_BOOKING, STEP_SCHEDULE, STEP_ADDRESS];
}

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

  /**
   * Multiple days: the strip's selected days + which one is ACTIVE, and one
   * task per selected day (that task's own time and hours live on the task).
   */
  const [daySelection, setDaySelection] = useState<DaySelection>({ days: [], activeKey: null });
  const [tasks, setTasks] = useState<TaskDraft[]>([]);
  const [taskEditorKey, setTaskEditorKey] = useState<string | null>(null);

  /**
   * The Single-day expected hours (default 1). The ceiling is NOT a constant:
   * it is computed from the chosen start until 11 PM (lib/timeSlots), so 8 AM
   * allows 15 h and 8 PM only 3 h.
   */
  const [hours, setHours] = useState(MIN_EXPECTED_HOURS);
  /** Transient "hours lowered" notice after a time change or an edit. */
  const [hoursNotice, setHoursNotice] = useState<number | null>(null);
  const [taskHoursNotice, setTaskHoursNotice] = useState<{
    n: number;
    hours: number;
  } | null>(null);

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
    setDaySelection({ days: [], activeKey: null });
    setTasks([]);
    setTaskEditorKey(null);
    setTaskHoursNotice(null);
  }, []);

  /** The current step list — 4 steps, or 5 with the Tasks step for several days. */
  const steps = useMemo(() => stepKeysFor(bookingKind), [bookingKind]);
  const stepCount = steps.length;
  const safeStep = Math.min(step, stepCount - 1);
  const stepKey = steps[safeStep];

  const selectRequestType = useCallback(
    (requestType: FormRequestType) => {
      if (!isRequestTypeAllowed(bookingKind, requestType)) return;
      const next = applyRequestType({ requestType: urgency, kind: bookingKind }, requestType);
      setUrgency(next.requestType);
      setBookingKind(next.kind);
      if (next.datesReset) clearDates();
      setStep((prev) => Math.min(prev, stepKeysFor(next.kind).length - 1));
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
      setStep((prev) => Math.min(prev, stepKeysFor(next.kind).length - 1));
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
    const errors = validateStepKey(stepKey);
    setStepErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setStep((prev) => Math.min(stepCount - 1, prev + 1));
  };

  // ── Per-step validation (by STEP, not by index: the list is 4 or 5 long) ──
  function validateStepKey(key: TranslationKey): StepErrors {
    const next: StepErrors = {};
    if (key === STEP_DETAILS) {
      if (serviceId == null) next.service = t('post_err_service');
      if (!description.trim()) next.description = t('post_err_desc');
    }
    if (key === STEP_SCHEDULE) {
      const now = new Date();
      if (bookingKind === 'one_time') {
        const error = validateOneTime(oneTimeDayKind, timeChoice, now);
        if (error) next.time = t(error);
        if (hours < MIN_EXPECTED_HOURS) next.hours = t('post_err_hours');
      } else {
        // Every SELECTED day needs its own valid time; the offending days are
        // marked on the strip and the message names the rule, not a number.
        if (tasks.length === 0) next.date = t('post_err_dates_pick');
        else {
          const badIndex = firstUntimedTask(tasks, now);
          if (badIndex >= 0) next.time = t('post_err_day_time');
          else {
            const error = validateTasks(tasks, now);
            if (error) next.time = t(error);
          }
        }
      }
    }
    if (key === STEP_TASKS) {
      // Re-checked here too: a day added on the previous step must never reach
      // the address step without a time.
      if (tasks.length === 0) next.date = t('post_err_tasks_empty');
      else if (firstUntimedTask(tasks, new Date()) >= 0) next.time = t('post_err_day_time');
    }
    if (key === STEP_ADDRESS) {
      const chosen = addresses.find((row) => row.id === selectedAddressId) ?? null;
      if (!chosen) next.address = t('post_err_address');
      else if (!isAddressPostable(chosen)) next.address = t('post_addr_incomplete');
    }
    return next;
  }

  const validateStep = (index: number) => validateStepKey(steps[index] ?? STEP_DETAILS);

  /** Live schedule problems for the visible step, without pressing Next. */
  const scheduleError = useMemo(() => {
    if (stepKey !== STEP_SCHEDULE) return null;
    const now = new Date();
    if (bookingKind === 'one_time') {
      const error = validateOneTime(oneTimeDayKind, timeChoice, now);
      return error ? t(error) : null;
    }
    if (tasks.length === 0) return t('post_err_dates_pick');
    if (firstUntimedTask(tasks, now) >= 0) return t('post_err_day_time');
    const error = validateTasks(tasks, now);
    return error ? t(error) : null;
  }, [stepKey, bookingKind, oneTimeDayKind, timeChoice, tasks, t]);

  /** Live problems on the Tasks step (empty list is the only blocker there). */
  const tasksError = useMemo(() => {
    if (stepKey !== STEP_TASKS) return null;
    if (tasks.length === 0) return t('post_err_tasks_empty');
    if (firstUntimedTask(tasks, new Date()) >= 0) return t('post_err_day_time');
    return null;
  }, [stepKey, tasks, t]);

  /** Next is blocked exactly when the visible step still has a problem. */
  const nextBlocked =
    (stepKey === STEP_SCHEDULE && scheduleError !== null) ||
    (stepKey === STEP_TASKS && tasksError !== null);

  // ── Picker wiring ─────────────────────────────────────────────────────────
  const singleDay = bookingKind === 'one_time' ? oneTimeDay(oneTimeDayKind) : null;
  const activeTask = activeDayOf(daySelection, tasks);
  const activeDay = activeTask?.day ?? null;
  const windowLabel = formatWindowLabel(timeChoice, meridiem);
  const shortWindow = !!timeChoice && windowShorterThanHours(timeChoice, hours);
  /** The Single-day hours ceiling for the chosen start (null = no time yet). */
  const singleHoursCap = useMemo(() => {
    const win = selectionWindow(timeChoice);
    if (!win) return null;
    return maxHoursForStart(minutesOf(win.start));
  }, [timeChoice]);

  // A new start can lower the ceiling. Lower the value with it and say so — the
  // payload can never carry more hours than the 11 PM rule allows.
  useEffect(() => {
    if (singleHoursCap === null) return;
    setHours((current) => {
      if (!exceedsHoursCap(current, singleHoursCap)) return current;
      setHoursNotice(singleHoursCap);
      return clampHours(current, singleHoursCap);
    });
  }, [singleHoursCap]);

  useEffect(() => {
    if (hoursNotice === null) return;
    const timer = setTimeout(() => setHoursNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [hoursNotice]);

  useEffect(() => {
    if (!taskHoursNotice) return;
    const timer = setTimeout(() => setTaskHoursNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [taskHoursNotice]);

  /**
   * The "Preferred time" line the API has no field for (JobMilestoneCreate is
   * only scheduled_at + expected_hours). Rebuilt from the FINAL task list every
   * render, in the fixed English format earlier versions wrote: one window for a
   * single day, `Task N …` segments when several days carry their own windows.
   */
  const preferredLine = useMemo(() => {
    if (bookingKind === 'one_time') {
      const win = selectionWindow(timeChoice);
      if (!win) return null;
      return buildScheduleLine([
        {
          startMinutes: minutesOf(win.start) ?? 0,
          endMinutes: minutesOf(win.end) ?? 0,
          meridiem,
        },
      ]);
    }
    if (tasks.length === 0) return null;
    return buildScheduleLine(
      tasks
        .map((task, index) => {
          const win = selectionWindow(task.time);
          if (!win) return null;
          return {
            taskNumber: index + 1,
            startMinutes: minutesOf(win.start) ?? 0,
            endMinutes: minutesOf(win.end) ?? 0,
            meridiem,
          };
        })
        .filter((part): part is NonNullable<typeof part> => part !== null)
    );
  }, [bookingKind, timeChoice, tasks, meridiem]);

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
  /** One strip tap: select + activate, activate only, or deselect. */
  const selectDay = (day: Date) => {
    const outcome = applyDayTap(daySelection, day, tasks);
    setDaySelection(outcome.selection);
    setTasks((prev) =>
      outcome.removedKey
        ? prev.filter((task) => task.key !== outcome.removedKey)
        : syncTasks(prev, outcome.selection.days)
    );
    clearError('date');
    clearError('time');
  };

  /** Replace the ACTIVE day's time, re-clamping that task's hours with it. */
  const applyActiveTime = (time: TimeChoice | null) => {
    if (!activeTask) return;
    const index = tasks.findIndex((task) => task.key === activeTask.key);
    const { tasks: next, loweredFrom } = applyTaskTime(tasks, activeTask.key, time);
    setTasks(next);
    if (loweredFrom !== null) {
      const updated = next.find((task) => task.key === activeTask.key);
      if (updated) setTaskHoursNotice({ n: index + 1, hours: updated.hours });
    }
    clearError('time');
    clearError('date');
  };

  /** Delete one task: its day leaves the strip too, and numbering closes up. */
  const removeTask = (task: TaskDraft) => {
    const remainingDays = daySelection.days.filter((day) => dayKey(day) !== task.key);
    setDaySelection(activeAfterDelete(remainingDays, task.key));
    setTasks(syncTasks(tasks, remainingDays));
    setTaskEditorKey((current) => (current === task.key ? null : current));
    clearError('time');
    clearError('date');
  };

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
    // Single day: the chosen value, never above the 11 PM ceiling of its start.
    // Multiple days: each task carries its OWN hours (Part C), so there is no
    // global value to send.
    const chosenHours =
      bookingKind === 'one_time'
        ? clampHours(hours, singleHoursCap ?? MIN_HOURS_BEFORE_DAY_END)
        : MIN_HOURS_BEFORE_DAY_END;
    const milestones =
      bookingKind === 'one_time'
        ? buildOneTimeMilestones(oneTimeDay(oneTimeDayKind, now), timeChoice as TimeChoice, chosenHours)
        : buildTaskMilestones(tasks);

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
          accent={c.urgentText}
          accentSoft={c.urgentBg}
          onAccent={c.urgentText}
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

  /**
   * Expected hours for a SINGLE day: 1 … the 11 PM ceiling of the chosen start.
   * "+" is disabled AT the ceiling, the value is clamped when the start changes
   * and a short translated notice says why. Until a time exists the stepper is
   * disabled and asks for one.
   */
  const renderHours = () => {
    const cap = singleHoursCap;
    const atCap = cap !== null && hours >= cap;
    const endLabel = formatTimeLabel(clockOf(DAY_END_MINUTES), meridiem);
    return (
      <>
        <Text style={[styles.label, { color: c.text }]}>{t('post_hours')}</Text>
        <View
          style={[
            styles.stepper,
            { backgroundColor: c.input, borderColor: c.border, opacity: cap === null ? 0.55 : 1 },
          ]}
        >
          <TouchableOpacity
            style={[styles.stepperBtn, { backgroundColor: c.muted }]}
            onPress={() => setHours((h) => Math.max(MIN_EXPECTED_HOURS, h - 1))}
            disabled={cap === null || hours <= MIN_EXPECTED_HOURS}
            accessibilityRole="button"
            accessibilityLabel={`${t('post_hours')} -1`}
          >
            <Feather name="minus" size={16} color={c.text} />
          </TouchableOpacity>
          <Text style={[styles.stepperValue, { color: c.text }]}>
            {hours === 1
              ? t('post_hours_value', { n: hours })
              : t('post_hours_value_plural', { n: hours })}
          </Text>
          <TouchableOpacity
            style={[styles.stepperBtn, { backgroundColor: c.muted, opacity: atCap ? 0.4 : 1 }]}
            onPress={() => setHours((h) => clampHours(h + 1, cap ?? MIN_EXPECTED_HOURS))}
            disabled={cap === null || atCap}
            accessibilityRole="button"
            accessibilityLabel={`${t('post_hours')} +1`}
            accessibilityState={{ disabled: cap === null || atCap }}
          >
            <Feather name="plus" size={16} color={c.text} />
          </TouchableOpacity>
        </View>
        <Text style={[styles.hint, { color: c.mutedForeground }]}>
          {cap === null
            ? t('post_hours_pick_time')
            : t('post_hours_cap', { n: cap, time: endLabel })}
        </Text>
        {hoursNotice !== null ? (
          <Animated.View
            entering={FadeIn.duration(180)}
            style={[styles.switchNotice, { backgroundColor: c.muted, borderColor: c.border }]}
          >
            <Feather name="info" size={13} color={c.mutedForeground} />
            <Text style={[styles.switchNoticeText, { color: c.mutedForeground }]}>
              {t('post_hours_lowered', { n: hoursNotice, time: endLabel })}
            </Text>
          </Animated.View>
        ) : null}
      </>
    );
  };

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
      <TimeChoices
        choice={timeChoice}
        day={singleDay}
        onChange={(next) => {
          setTimeChoice(next);
          clearError('time');
          clearError('date');
        }}
      />
      {shortWindow ? (
        <Text style={[styles.hint, { color: c.mutedForeground }]}>
          {t('post_time_short_hint', { h: hours })}
        </Text>
      ) : null}

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

  /**
   * MULTIPLE DAYS — the strip, then the ACTIVE day's time grid directly below
   * it (the reference layout: "Select Day" then "Select Time"). Only the active
   * day is edited here; its own hours and the per-task list live on the Tasks
   * step, so this screen has no global hours control and no task list.
   */
  const renderMultiDay = () => (
    <>
      <Text style={[styles.label, { color: c.text }]}>{t('post_dates_title')}</Text>
      <DateStrip
        selected={daySelection.days}
        activeKey={daySelection.activeKey}
        onToggle={selectDay}
        weekdays={weekdays}
        months={months}
        disabled={(day) => !dayHasBookableTime(day)}
        status={(day) => {
          const key = dayKey(day);
          const task = tasks.find((entry) => entry.key === key);
          if (!task) return null;
          return validateTimeChoice(task.time, task.day, new Date()) === null ? 'timed' : 'untimed';
        }}
      />
      <Text style={[styles.hint, { color: c.mutedForeground, marginTop: 10 }]}>
        {daySelection.days.length === 0
          ? t('post_dates_hint')
          : t('post_days_selected_of', { n: daySelection.days.length, total: 7 })}
      </Text>

      {activeTask ? (
        <>
          <Text style={[styles.label, { color: c.text }]}>
            {t('post_time_for_day', { day: formatDayLabel(activeTask.day, months, weekdays) })}
          </Text>
          <TimeChoices
            choice={activeTask.time}
            day={activeTask.day}
            onChange={(next) => applyActiveTime(next)}
          />
        </>
      ) : (
        <Text style={[styles.hint, { color: c.mutedForeground }]}>{t('post_time_pick_day')}</Text>
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
    </>
  );

  /**
   * STEP 4 (several days only) — "Your tasks": one card per selected day, in
   * date order, always renumbered Task 1..N after a deletion. Each card owns its
   * expected hours (1 … the 11 PM ceiling for ITS start), Edit (time-only) and
   * Delete (which also removes the day from the strip, in sync).
   */
  const renderTasksStep = () => (
    <>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: c.text }]}>{t('post_tasks')}</Text>
        {tasks.length > 0 ? (
          <Text style={[styles.counter, { color: c.mutedForeground }]}>
            {t('post_tasks_count', { n: tasks.length })}
          </Text>
        ) : null}
      </View>

      {taskHoursNotice ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          style={[styles.switchNotice, { backgroundColor: c.muted, borderColor: c.border }]}
        >
          <Feather name="info" size={13} color={c.mutedForeground} />
          <Text style={[styles.switchNoticeText, { color: c.mutedForeground }]}>
            {t('post_task_hours_lowered', {
              n: taskHoursNotice.n,
              h: taskHoursNotice.hours,
              time: formatTimeLabel(clockOf(DAY_END_MINUTES), meridiem),
            })}
          </Text>
        </Animated.View>
      ) : null}

      {tasks.length === 0 ? (
        <View style={[styles.taskEmpty, { backgroundColor: c.muted, borderColor: c.border }]}>
          <Feather name="list" size={18} color={c.mutedForeground} />
          <Text style={[styles.taskEmptyText, { color: c.mutedForeground }]}>
            {t('post_tasks_none')}
          </Text>
          <TouchableOpacity
            onPress={() => setStep((prev) => Math.max(0, prev - 1))}
            style={[styles.taskEmptyBtn, { borderColor: c.primary }]}
            accessibilityRole="button"
          >
            <Feather name="calendar" size={14} color={c.primary} />
            <Text style={[styles.taskEmptyBtnText, { color: c.primary }]}>
              {t('post_tasks_back_to_dates')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        tasks.map((task, index) => {
          const taskWindow = formatWindowLabel(task.time, meridiem);
          const untimed = validateTimeChoice(task.time, task.day, new Date()) !== null;
          const cap = taskHoursCap(task);
          const atCap = cap !== null && task.hours >= cap;
          return (
            <Animated.View
              key={task.key}
              entering={FadeInUp.delay(index * 40).duration(240)}
              style={[
                styles.taskCardFull,
                {
                  backgroundColor: c.card,
                  borderColor: untimed ? c.destructive : c.border,
                },
              ]}
            >
              <View style={styles.taskCardHead}>
                <View style={[styles.taskBadge, { backgroundColor: c.primary }]}>
                  <Text style={[styles.taskBadgeText, { color: c.primaryForeground }]}>
                    {index + 1}
                  </Text>
                </View>
                <View style={styles.taskBody}>
                  <Text style={[styles.taskName, { color: c.text }]} numberOfLines={1}>
                    {t('post_task_n', { n: index + 1 })}
                  </Text>
                  <Text style={[styles.taskMeta, { color: c.mutedForeground }]} numberOfLines={1}>
                    {`${formatDayLabel(task.day, months, weekdays)} · ${
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
              </View>

              <View style={styles.taskCardFoot}>
                <Text style={[styles.smallLabel, { color: c.mutedForeground, marginBottom: 0 }]}>
                  {t('post_task_hours')}
                </Text>
                <View style={[styles.taskStepper, { backgroundColor: c.input, borderColor: c.border }]}>
                  <TouchableOpacity
                    style={[styles.taskStepperBtn, { backgroundColor: c.muted }]}
                    onPress={() =>
                      setTasks((prev) =>
                        prev.map((entry) =>
                          entry.key === task.key
                            ? { ...entry, hours: Math.max(MIN_EXPECTED_HOURS, entry.hours - 1) }
                            : entry
                        )
                      )
                    }
                    disabled={task.hours <= MIN_EXPECTED_HOURS}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('post_task_hours')} -1`}
                  >
                    <Feather name="minus" size={14} color={c.text} />
                  </TouchableOpacity>
                  <Text style={[styles.taskStepperValue, { color: c.text }]}>
                    {task.hours === 1
                      ? t('post_hours_value', { n: task.hours })
                      : t('post_hours_value_plural', { n: task.hours })}
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.taskStepperBtn,
                      { backgroundColor: c.muted, opacity: atCap ? 0.4 : 1 },
                    ]}
                    onPress={() =>
                      setTasks((prev) =>
                        prev.map((entry) =>
                          entry.key === task.key
                            ? { ...entry, hours: clampHours(entry.hours + 1, cap ?? MIN_EXPECTED_HOURS) }
                            : entry
                        )
                      )
                    }
                    disabled={cap === null || atCap}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('post_task_hours')} +1`}
                    accessibilityState={{ disabled: cap === null || atCap }}
                  >
                    <Feather name="plus" size={14} color={c.text} />
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={[styles.taskHoursHint, { color: c.mutedForeground }]}>
                {cap === null
                  ? t('post_hours_pick_time')
                  : t('post_hours_cap', {
                      n: cap,
                      time: formatTimeLabel(clockOf(DAY_END_MINUTES), meridiem),
                    })}
              </Text>
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
      ) : tasksError ? (
        <Text style={[styles.hint, { color: c.mutedForeground }]}>{tasksError}</Text>
      ) : null}
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
          {t(stepKey)}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.progressWrap, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <View style={styles.progressTrack}>
          {steps.map((key, index) => (
            <View
              key={key}
              style={[
                styles.progressSegment,
                { backgroundColor: index <= safeStep ? c.primary : c.muted },
              ]}
            />
          ))}
        </View>
        <Text style={[styles.progressLabel, { color: c.mutedForeground }]}>
          {t('post_step_of', { n: safeStep + 1, total: stepCount })}
        </Text>
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        bottomOffset={110}
      >
        <Animated.View key={stepKey} entering={FadeInUp.duration(260)} style={styles.stepBody}>
          {stepKey === STEP_DETAILS ? renderDetailsStep() : null}
          {stepKey === STEP_BOOKING ? renderBookingStep() : null}
          {stepKey === STEP_SCHEDULE ? renderScheduleStep() : null}
          {stepKey === STEP_TASKS ? renderTasksStep() : null}
          {stepKey === STEP_ADDRESS ? renderAddressStep() : null}
        </Animated.View>
      </KeyboardAwareScrollViewCompat>

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
        {safeStep === stepCount - 1 ? (
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
                { backgroundColor: c.primary, opacity: nextBlocked ? 0.55 : 1 },
              ]}
              onPress={goNext}
              // Date & Time may only advance with a valid schedule for EVERY
              // selected day; the Tasks step needs at least one task left.
              disabled={nextBlocked}
              accessibilityRole="button"
              accessibilityState={{ disabled: nextBlocked }}
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

      {/* One task's TIME only — the date belongs to the strip, the hours to the
          card, and the name was removed from the product. */}
      <TaskEditSheet
        visible={editingTask !== null}
        onClose={() => setTaskEditorKey(null)}
        task={editingTask}
        index={editingTaskIndex < 0 ? 0 : editingTaskIndex}
        onSave={(time) => {
          if (!editingTask) return;
          const index = tasks.findIndex((entry) => entry.key === editingTask.key);
          const { tasks: next, loweredFrom } = applyTaskTime(tasks, editingTask.key, time);
          setTasks(next);
          if (loweredFrom !== null) {
            const updated = next.find((entry) => entry.key === editingTask.key);
            if (updated) setTaskHoursNotice({ n: index + 1, hours: updated.hours });
          }
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
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 12,
    minHeight: 52,
  },
  slotBody: { alignItems: 'center', gap: 2, maxWidth: '100%' },
  slotInnerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  slotText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, flexShrink: 1 },
  /** Second line inside the chip: never truncates the window above it. */
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
  taskEmptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  taskEmptyBtnText: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
  /** Step 4's task card: a header row plus its own hours control. */
  taskCardFull: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 10,
  },
  taskCardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  taskCardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  taskStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    padding: 4,
  },
  taskStepperBtn: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  taskStepperValue: { minWidth: 48, textAlign: 'center', fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  taskHoursHint: { fontFamily: 'Manrope_400Regular', fontSize: 10, lineHeight: 14 },
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
