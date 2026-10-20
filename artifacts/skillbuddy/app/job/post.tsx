import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
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
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import { useAppAlert } from '@/context/AlertModalContext';
import InlineLoader from '@/components/InlineLoader';
import BottomSheet from '@/components/BottomSheet';
import DateWindowPickerSheet from '@/components/DateWindowPickerSheet';
import TimePickerSheet from '@/components/TimePickerSheet';
import ServicePickerSheet from '@/components/ServicePickerSheet';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { authApi } from '@/services/api';
import useCountries from '@/hooks/useCountries';
import useCategories from '@/hooks/useCategories';
import useServiceDetail from '@/hooks/useServiceDetail';
import useAddresses from '@/hooks/useAddresses';
import { invalidateJobList } from '@/hooks/useJobList';
import { usePublishJob } from '@/hooks/usePublishJob';
import { isDraftJob, publishErrorKey } from '@/lib/jobPublish';
import { isClientProfileMissing, jobStatusLabelKey } from '@/lib/jobList';
import { splitTable, startOfDay } from '@/lib/jobSchedule';
import {
  FIXED_SLOTS,
  MAX_EXPECTED_HOURS,
  MAX_MILESTONE_DAYS,
  MIN_EXPECTED_HOURS,
  type BookingChoice,
  type BookingErrorKey,
  type BookingKind,
  type OneTimeDay,
  type FormRequestType,
  type TimeChoice,
  applyBookingKind,
  applyRequestType,
  buildMultiDayMilestones,
  buildOneTimeMilestones,
  clampExpectedHours,
  formatDayLabel,
  formatDaysList,
  formatTimeLabel,
  formatWindowLabel,
  hasSlotStarted,
  isBookingKindAllowed,
  isRequestTypeAllowed,
  oneTimeDay,
  selectionForStart,
  sortDays,
  toggleSelectedDay,
  validateMultiDay,
  validateOneTime,
  validateTimeChoice,
  windowMinutes,
  windowShorterThanHours,
} from '@/lib/jobBooking';
import {
  buildProfileAddressPayload,
  profileAddressDiffers,
  type ProfileAddressForm,
} from '@/lib/profileAddressSync';
import {
  DESC_WORD_MAX,
  JOB_TITLE_MAX,
  buildCreateJobRequest,
  buildPreferredTimeLine,
  classifyCreateJobFailure,
  countWords,
  createJobErrorCopy,
  descriptionWordCount,
  firstErrorStep,
  mapValidationErrors,
  stripPreferredTimeLine,
  validateJobTitle,
  type JobFormField,
} from '@/lib/jobCreate';
import type { AddressRegionResponse, JobResponse, ServiceListItem } from '@/types';

/**
 * Post a Job — a four-step wizard that creates a REAL job via POST /api/v1/jobs.
 *
 *   Step 1  Job Details    service (locked from "Book now" or the cascading
 *                          picker), title, description
 *   Step 2  Request Type   Urgent | Regular, then the booking type:
 *                          Single day | Multiple days. The API's BookingType
 *                          stays ONE_TIME | MULTI_DAY (live OpenAPI) — only the
 *                          labels change. The pair is locked two ways: Urgent
 *                          forces Single day, Multiple days forces Regular.
 *   Step 3  Date & Time    Single day: Today/Tomorrow chips. Multiple days: ONE
 *                          start day opening a seven-day window
 *                          (components/DateWindowPickerSheet) where any subset of
 *                          the seven days can be toggled. Then five fixed time
 *                          slots + "Anytime" (which opens the clock for its own
 *                          start and end), and the expected-hours stepper.
 *   Step 4  Service Address country/county/city + street fields, prefilled from
 *                          the profile's saved address (GET /api/v1/addresses)
 *
 * The date picker and the time picker are separate components and are never
 * combined: DateTimeSheet (one sheet holding a calendar AND hour chips) is gone,
 * and so is the start→end RANGE picker (DateRangePickerSheet) it was replaced by.
 *
 * SCHEDULE: every instant is composed from LOCAL calendar parts and serialised
 * with toISOString(), so the API receives UTC and a booking made late at night
 * for "Tomorrow" still lands on tomorrow's local date. ONE_TIME sends one
 * milestone; MULTI_DAY (max 7 days, the week the schema documents) sends one per
 * day, each carrying the same per-day expected hours.
 *
 * AUTH/401: the shared axios client refreshes an expired token once and
 * replays the request; if the session is truly over it clears the session
 * (AuthContext) and this screen shows a sign-in-again message.
 *
 * REMOVED ON PURPOSE (no counterpart in JobCreate): the photo picker and the
 * hourly-rate/budget fields.
 */

// The title bounds (3..150 trimmed) and the description's 500-word ceiling live
// in lib/jobCreate with the schema that declares them (the live backend rejects
// a longer description with 422 "Description cannot exceed 500 words"); this
// screen only renders what those helpers report.

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
  /**
   * Unavailable for this booking (Urgent on a multi-day booking): same card,
   * same alignment, visibly inert — presses do nothing and the disabled state
   * is announced to assistive tech.
   */
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
        {/* One badge slot in both states: an empty ring or a check, never moved. */}
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

/**
 * Booking-type card: identical structure to the request-type card — same
 * width/minHeight, icon circle, title and description slots, and a badge in the
 * SAME corner in every state — so the two pairs line up exactly whether a card
 * is selected, idle or disabled.
 */
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
  /** Greved out and inert (Multiple days while Urgent is selected). */
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

/** Small pulsing bars shown while the profile address is fetched. */
function AddressSkeleton() {
  const { colors: c } = useTheme();
  const pulse = useSharedValue(0.5);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [pulse]);

  const animStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={styles.skeletonWrap}>
      {[0, 1, 2].map((row) => (
        <Animated.View
          key={row}
          style={[styles.skeletonRow, { backgroundColor: c.skeletonBase }, animStyle]}
        />
      ))}
    </View>
  );
}

export default function PostJobScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const showAlert = useAppAlert();
  const { publish, publishing } = usePublishJob();
  // The profile's saved address (GET /api/v1/addresses) — prefill source for
  // step 4 and the target of the write-back after a successful post.
  const {
    status: profileStatus,
    address: savedAddress,
    load: loadProfileAddress,
    create: createProfileAddress,
    update: updateProfileAddress,
  } = useAddresses();

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

  // ── Shared wizard state ────────────────────────────────────────────────────
  const [step, setStep] = useState(0);
  const [stepErrors, setStepErrors] = useState<StepErrors>({});

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [bookingKind, setBookingKind] = useState<BookingKind>('one_time');
  const [urgency, setUrgency] = useState<FormRequestType>('regular');
  /**
   * One-time notice when the other card pair corrected the choice:
   *   'urgent_single' Urgent forced Single day (Multiple days was selected)
   *   'multi_regular' Multiple days forced Regular (Urgent was selected)
   */
  const [bookingSwitchNotice, setBookingSwitchNotice] = useState<
    'urgent_single' | 'multi_regular' | null
  >(null);
  const [oneTimeDayKind, setOneTimeDayKind] = useState<OneTimeDay>('today');
  /**
   * The time window. ONE choice drives BOTH booking kinds: one of the five fixed
   * slots, or Anytime with its own start/end. Switching the booking kind keeps
   * it (only the dates are reset).
   */
  const [timeChoice, setTimeChoice] = useState<TimeChoice | null>(null);
  /** Multiple days: ONE start date plus any subset of its seven days. */
  const [startDay, setStartDay] = useState<Date | null>(null);
  const [selectedDays, setSelectedDays] = useState<Date[]>([]);
  /** Which clock is open: Anytime's start, Anytime's end, or the slot itself. */
  const [clockTarget, setClockTarget] = useState<'start' | 'end' | null>(null);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);

  const [hours, setHours] = useState(2);

  // ── Address (step 4) ──────────────────────────────────────────────────────
  const { status: countriesStatus, countries, load: loadCountries, refresh: refreshCountries } = useCountries();
  const [counties, setCounties] = useState<AddressRegionResponse[] | null>(null);
  const [cities, setCities] = useState<AddressRegionResponse[] | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<'country' | 'county' | 'city' | null>(null);
  const [geoSearch, setGeoSearch] = useState('');

  const [countryId, setCountryId] = useState<number | null>(null);
  const [countyId, setCountyId] = useState<number | null>(null);
  const [cityId, setCityId] = useState<number | null>(null);
  const [houseNumber, setHouseNumber] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [landmark, setLandmark] = useState('');
  const [formattedAddress, setFormattedAddress] = useState('');
  /** Prefill happens once, and never overwrites something the user typed. */
  const prefilled = useRef(false);

  const [submitting, setSubmitting] = useState<'post' | 'draft' | null>(null);
  /**
   * The REAL in-flight lock. `submitting` is React state, so two taps inside the
   * same frame both read the old value and would fire two POSTs — two jobs. This
   * ref flips synchronously, before the request, and is cleared in `finally`.
   */
  const inFlight = useRef(false);

  useEffect(() => {
    void loadCountries();
  }, [loadCountries]);

  useEffect(() => {
    setGeoSearch('');
  }, [pickerOpen]);

  // Load the profile's saved address for the step-4 prefill.
  useEffect(() => {
    void loadProfileAddress();
  }, [loadProfileAddress]);

  // Month / weekday names for every date label, from the dictionary (never a
  // hardcoded English array, and no Intl dependency on device).
  const months = useMemo(() => splitTable(t('post_sched_months')), [t]);
  const weekdays = useMemo(() => splitTable(t('post_sched_weekdays')), [t]);

  // The counter is the USER's text only — the appended "Preferred time" line is
  // never something they typed (lib/jobCreate owns both rules).
  const wordCount = countWords(description);
  const country = countries?.find((x) => x.id === countryId) ?? null;
  const county = counties?.find((x) => x.id === countyId) ?? null;
  const city = cities?.find((x) => x.id === cityId) ?? null;

  const clearError = useCallback((field: JobFormField) => {
    setStepErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const clearAllErrors = useCallback(() => setStepErrors({}), []);

  // ── The two-way Request Type ↔ Booking Type lock ─────────────────────
  // The live backend refuses URGENT + MULTI_DAY at create time (HTTP 422
  // "Multiple-day bookings only support Regular bidding, not Urgent", captured
  // 2026-10-14), so the two card pairs correct each other:
  //   • Urgent disables Multiple days  (and selects Single day);
  //   • Multiple days disables Urgent  (and selects Regular).
  // The rules live in lib/jobBooking (applyRequestType / applyBookingKind) so
  // they are unit-tested rather than re-implemented here.
  const choice: BookingChoice = { requestType: urgency, kind: bookingKind };

  const clearDates = useCallback(() => {
    setStartDay(null);
    setSelectedDays([]);
  }, []);

  const selectRequestType = useCallback(
    (requestType: FormRequestType) => {
      if (!isRequestTypeAllowed(bookingKind, requestType)) return;
      const next = applyRequestType({ requestType: urgency, kind: bookingKind }, requestType);
      setUrgency(next.requestType);
      setBookingKind(next.kind);
      if (next.datesReset) clearDates();
      // No alarming notice here: choosing Urgent just re-selects Single day,
      // which the cards themselves show.
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

  // The notice hides itself; it is informational, never a dialog.
  useEffect(() => {
    if (!bookingSwitchNotice) return;
    const timer = setTimeout(() => setBookingSwitchNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [bookingSwitchNotice]);

  // ── Geo handlers ───────────────────────────────────────────────────────────
  const loadCounties = useCallback(async (id: number) => {
    setGeoLoading(true);
    setGeoError(false);
    try {
      const { data } = await authApi.getCounties(id);
      setCounties(data);
    } catch {
      setCounties(null);
      setGeoError(true);
    } finally {
      setGeoLoading(false);
    }
  }, []);

  const loadCities = useCallback(async (id: number) => {
    setGeoLoading(true);
    setGeoError(false);
    try {
      const { data } = await authApi.getCities(id);
      setCities(data);
    } catch {
      setCities(null);
      setGeoError(true);
    } finally {
      setGeoLoading(false);
    }
  }, []);

  const handleCountry = (id: number) => {
    setCountryId(id);
    setCountyId(null);
    setCityId(null);
    setCounties(null);
    setCities(null);
    clearError('country_id');
    clearError('county_id');
    clearError('city_id');
    clearError('address');
    setPickerOpen(null);
    void loadCounties(id);
  };

  const handleCounty = (id: number) => {
    setCountyId(id);
    setCityId(null);
    setCities(null);
    clearError('county_id');
    clearError('city_id');
    clearError('address');
    setPickerOpen(null);
    void loadCities(id);
  };

  const handleCity = (id: number) => {
    setCityId(id);
    clearError('city_id');
    clearError('address');
    setPickerOpen(null);
  };

  // ── Prefill from the saved profile address ────────────────────────────────
  useEffect(() => {
    if (prefilled.current) return;
    if (profileStatus !== 'ready') return;
    const saved = savedAddress;
    prefilled.current = true;
    if (!saved) return;

    const savedCountryId = saved.country?.id ?? null;
    setCountryId(savedCountryId);
    setCountyId(saved.county?.id ?? null);
    setCityId(saved.city?.id ?? null);
    setHouseNumber(saved.house_number ?? '');
    setStreetAddress(saved.street_address ?? '');
    setPostalCode(saved.postal_code ?? '');
    setLandmark(saved.landmark ?? '');
    setFormattedAddress(saved.formatted_address ?? '');
    if (savedCountryId != null) void loadCounties(savedCountryId);
    if (saved.county?.id != null) void loadCities(saved.county.id);
  }, [profileStatus, savedAddress, loadCounties, loadCities]);

  // ── Step navigation ───────────────────────────────────────────────────────
  const goBack = useCallback(() => {
    clearAllErrors();
    if (step === 0) {
      router.back();
      return;
    }
    setStep((prev) => Math.max(0, prev - 1));
  }, [clearAllErrors, router, step]);

  // Android hardware back = previous step; on step 1 the navigator keeps its
  // normal behaviour (leaving the screen), exactly as before.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 0) return false;
      clearAllErrors();
      setStep((prev) => Math.max(0, prev - 1));
      return true;
    });
    return () => sub.remove();
  }, [clearAllErrors, step]);

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
      const titleError = validateJobTitle(title);
      if (titleError) next.title = t(titleError);
      if (!description.trim()) next.description = t('post_err_desc');
      // The counter shows the user's own words, but the backend counts the WHOLE
      // stored description — including the "Preferred time" line the app appends.
      else if (descriptionWordCount(description, preferredLine) > DESC_WORD_MAX)
        next.description = t('post_err_desc_line_limit', { n: DESC_WORD_MAX });
    }
    if (target === 1) {
      // One-time is preselected, so this step is always answerable.
    }
    if (target === 2) {
      const now = new Date();
      if (bookingKind === 'one_time') {
        const error = validateOneTime(oneTimeDayKind, timeChoice, now);
        if (error) next.time = t(error);
      } else {
        const error = validateMultiDay(startDay, selectedDays, timeChoice, now);
        if (error) next.date = t(error);
      }
      if (hours < MIN_EXPECTED_HOURS) next.hours = t('post_err_hours');
    }
    if (target === 3) {
      if (countryId == null || countyId == null || cityId == null) {
        next.address = t('post_err_address');
      }
    }
    return next;
  }

  /** Live schedule problems for the visible step, without pressing Next. */
  const scheduleError = useMemo(() => {
    if (step !== 2) return null;
    const now = new Date();
    const error =
      bookingKind === 'one_time'
        ? validateOneTime(oneTimeDayKind, timeChoice, now)
        : validateMultiDay(startDay, selectedDays, timeChoice, now);
    return error ? t(error) : null;
  }, [step, bookingKind, oneTimeDayKind, timeChoice, startDay, selectedDays, t]);

  // ── Picker wiring ─────────────────────────────────────────────────────────
  const today = startOfDay(new Date());
  const activeDay = bookingKind === 'one_time' ? oneTimeDay(oneTimeDayKind) : startDay;

  const meridiem = useMemo(
    () => ({ am: t('post_sched_am'), pm: t('post_sched_pm') }),
    [t]
  );
  /** `8:00 AM - 11:00 AM` for the chosen window ('' while nothing is chosen). */
  const windowLabel = formatWindowLabel(timeChoice, meridiem);
  /** The line appended to the description so the provider sees the window's end. */
  const preferredLine = useMemo(() => buildPreferredTimeLine(windowLabel), [windowLabel]);
  /** The selected days, chronological (Multiple days only). */
  const days = bookingKind === 'multi_day' ? sortDays(selectedDays) : [];
  const daysSummary = formatDaysList(days, months, weekdays);
  const shortWindow = !!timeChoice && windowShorterThanHours(timeChoice, hours);

  const milestonePreview = useMemo(() => {
    if (bookingKind !== 'multi_day' || !timeChoice || days.length === 0) return [];
    return days.map((day, index) => ({
      key: `${day.toISOString()}-${index}`,
      label: t('post_milestone_n', { n: index + 1 }),
      day: formatDayLabel(day, months, weekdays),
      time: windowLabel,
    }));
  }, [bookingKind, timeChoice, days, t, months, weekdays, windowLabel]);

  // ── Profile address sync (only after a successful non-draft post) ─────────
  const syncProfileAddress = useCallback(async (): Promise<boolean> => {
    const form: ProfileAddressForm = {
      countryId,
      countyId,
      cityId,
      streetAddress,
      houseNumber,
      postalCode,
      landmark,
    };
    if (!profileAddressDiffers(form, savedAddress)) return false;
    const payload = buildProfileAddressPayload(form, formattedAddress);
    try {
      if (savedAddress?.id != null) await updateProfileAddress(savedAddress.id, payload);
      else await createProfileAddress(payload);
      return true;
    } catch {
      // The job is already posted — a failed profile sync must not surface as a
      // job failure, and it must not modify anything client-side either.
      return false;
    }
  }, [
    countryId,
    countyId,
    cityId,
    streetAddress,
    houseNumber,
    postalCode,
    landmark,
    formattedAddress,
    savedAddress,
    updateProfileAddress,
    createProfileAddress,
  ]);

  // ── Error handling ────────────────────────────────────────────────────────
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
    // goToJob is stable (router only)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showAlert, t, publish]
  );

  const showPostedAlert = (created: JobResponse, addressUpdated: boolean) => {
    if (addressUpdated) {
      showAlert({
        title: t('post_success_title'),
        message: t('post_success_msg_addr'),
        icon: 'check-circle',
        buttons: [{ text: t('post_view_job'), onPress: () => goToJob(created.id) }],
      });
      return;
    }
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

  const submit = async (isDraft: boolean) => {
    if (submitting || publishing || inFlight.current) return;
    // Every step is validated at submit time: a later step can go stale while
    // the user re-reads an earlier one, and nothing should slip through. The
    // first offending step is the one shown, with its own inline messages.
    const perStep = [validateStep(0), validateStep(1), validateStep(2), validateStep(3)];
    const merged: StepErrors = Object.assign({}, ...perStep);
    if (Object.keys(merged).length > 0) {
      setStepErrors(merged);
      const firstBad = perStep.findIndex((errors) => Object.keys(errors).length > 0);
      if (firstBad >= 0) setStep(firstBad);
      return;
    }

    const now = new Date();
    const chosenHours = clampExpectedHours(hours);
    // ONE milestone for a single day; one per SELECTED day for multiple days
    // (they need not be consecutive). Every instant is composed from local
    // calendar parts and serialised to UTC by lib/jobBooking.
    const milestones =
      bookingKind === 'one_time'
        ? buildOneTimeMilestones(
            oneTimeDay(oneTimeDayKind, now),
            timeChoice as TimeChoice,
            chosenHours
          )
        : buildMultiDayMilestones(days, timeChoice as TimeChoice, chosenHours);

    const payload = buildCreateJobRequest({
      serviceId: serviceId!,
      serviceCategoryId,
      title,
      description,
      // The window's END has no API field, so it rides as one stored line at the
      // end of the description (never part of the user's text field).
      preferredTimeLine: preferredLine,
      requestType: urgency,
      bookingType: bookingKind,
      scheduledAtIso: milestones[0]?.scheduled_at ?? null,
      milestones: milestones.map((m) => ({
        scheduledAtIso: m.scheduled_at,
        expectedHours: Number(m.expected_hours),
      })),
      expectedHours: clampExpectedHours(hours),
      countryId: countryId!,
      countyId: countyId!,
      cityId: cityId!,
      houseNumber,
      streetAddress,
      postalCode,
      landmark,
      formattedAddress,
      isDraft,
    });

    inFlight.current = true;
    setSubmitting(isDraft ? 'draft' : 'post');

    // ONLY the request itself is guarded here. Everything after a confirmed 201
    // (list invalidation, the profile-address write-back, the success alert) runs
    // OUTSIDE this try/catch, so an exception thrown while handling a job that
    // really was created can never be reported as "the job failed to post".
    let created: JobResponse | null = null;
    try {
      const { data } = await authApi.createJob(payload);
      created = data;
    } catch (err: any) {
      // One classifier decides every outcome. A genuine connectivity failure is
      // the ONLY one that may say "check your connection" — a 5xx, a rejected
      // 4xx, a timeout or an exception thrown client-side each get their own
      // message, never the connection one.
      const failure = classifyCreateJobFailure(err);

      if (failure.kind === 'invalid') {
        const mapped = mapValidationErrors(err?.response?.data?.detail);
        setStepErrors((prev) => ({ ...prev, ...mapped.fieldErrors }));
        // A 422 names FIELDS while the screen shows STEPS: jump to the earliest
        // step that owns an offending field so the messages are visible.
        const step = firstErrorStep(mapped.fieldErrors);
        if (step !== null) setStep(step);
        if (mapped.formErrors.length > 0) showUnmapped(mapped.formErrors);
        else if (step === null) showUnmapped([t('post_err_invalid_msg')]);
      } else if (isClientProfileMissing(failure.message)) {
        // PART H: the backend's "Client profile not found." is a DATA problem on
        // the account (the live API has no POST /clients/profile, so the app
        // cannot create one). Say that in the user's language instead of passing
        // the English sentence through.
        showAlert({
          title: t('post_err_profile_title'),
          message: t('post_err_profile_msg'),
          icon: 'user-x',
        });
      } else {
        const copy = createJobErrorCopy(failure.kind);
        showAlert({
          title: t(copy.titleKey),
          // The undocumented 4xx family passes the backend's own readable text
          // through; 5xx/unknown/timeout/network always use translated copy.
          message:
            copy.preferServerMessage && failure.message ? failure.message : t(copy.messageKey),
          icon: copy.icon,
        });
      }
    } finally {
      inFlight.current = false;
      setSubmitting(null);
    }

    // No 201 → the dialog above is the whole outcome, and every entered value is
    // still on screen for the retry.
    if (!created) return;

    invalidateJobList();
    const publishable = isDraftJob(created);

    if (isDraft) {
      // Drafts NEVER touch the saved profile address.
      showAlert({
        title: t('post_draft_title'),
        message: t('post_draft_msg'),
        icon: 'save',
        buttons: publishable
          ? [
              { text: t('post_publish_now'), onPress: () => void publishDraft(created.id) },
              { text: t('post_view_job'), style: 'cancel', onPress: () => goToJob(created.id) },
            ]
          : [{ text: t('post_view_job'), onPress: () => goToJob(created.id) }],
      });
      return;
    }

    // Only a CONFIRMED 201 with is_draft false writes the address back, and
    // only when it actually differs from what the profile holds.
    const addressUpdated = await syncProfileAddress();
    showPostedAlert(created, addressUpdated);
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

  // ── Address helpers ───────────────────────────────────────────────────────
  const pickerRow = (
    field: 'country_id' | 'county_id' | 'city_id',
    labelKey: TranslationKey,
    value: string | null,
    disabled: boolean,
    onPress: () => void
  ) => (
    <View style={styles.fieldWrap}>
      <Text style={[styles.smallLabel, { color: c.mutedForeground }]}>{t(labelKey)}</Text>
      <TouchableOpacity
        style={[
          styles.input,
          styles.pickerInput,
          { backgroundColor: c.input, borderColor: stepErrors[field] ? c.destructive : c.border },
        ]}
        onPress={onPress}
        disabled={disabled}
      >
        <Text
          style={[styles.pickerText, { color: value ? c.text : c.mutedForeground }]}
          numberOfLines={1}
        >
          {value ?? t('addr_c_pick')}
        </Text>
        <Feather name="chevron-down" size={16} color={c.mutedForeground} />
      </TouchableOpacity>
      {stepErrors[field] ? (
        <Text style={[styles.error, { color: c.destructive }]}>{stepErrors[field]}</Text>
      ) : null}
    </View>
  );

  const textField = (
    field: JobFormField,
    labelKey: TranslationKey,
    value: string,
    setValue: (v: string) => void,
    options?: { multiline?: boolean }
  ) => (
    <View style={styles.fieldWrap}>
      <Text style={[styles.smallLabel, { color: c.mutedForeground }]}>{t(labelKey)}</Text>
      <TextInput
        style={[
          styles.input,
          options?.multiline && styles.textAreaSmall,
          {
            backgroundColor: c.input,
            color: c.text,
            borderColor: stepErrors[field] ? c.destructive : c.border,
          },
        ]}
        value={value}
        onChangeText={(v) => {
          setValue(v);
          clearError(field);
        }}
        multiline={options?.multiline}
        placeholderTextColor={c.mutedForeground}
      />
      {stepErrors[field] ? (
        <Text style={[styles.error, { color: c.destructive }]}>{stepErrors[field]}</Text>
      ) : null}
    </View>
  );

  // ── Geo modal ─────────────────────────────────────────────────────────────
  const geoKind = pickerOpen ?? 'country';
  const geoIsCountry = geoKind === 'country';
  const geoSource: Array<{ id: number; name: string }> | null = geoIsCountry
    ? countries
    : geoKind === 'county'
      ? counties
      : cities;
  const geoLoadingNow = geoIsCountry ? countriesStatus === 'loading' : geoLoading;
  const geoErrorNow = geoIsCountry ? countriesStatus === 'error' : geoError;
  const geoQuery = geoSearch.trim().toLowerCase();
  const geoOptions = geoSource?.filter((o) => !geoQuery || o.name.toLowerCase().includes(geoQuery)) ?? null;
  const geoSelectedId = geoIsCountry ? countryId : geoKind === 'county' ? countyId : cityId;
  const geoTitleKey: TranslationKey =
    geoKind === 'country' ? 'addr_c_country' : geoKind === 'county' ? 'addr_c_county' : 'addr_c_city';

  const geoRetry = geoIsCountry
    ? () => void refreshCountries()
    : geoKind === 'county'
      ? () => countryId != null && void loadCounties(countryId)
      : () => countyId != null && void loadCities(countyId);

  const geoPick = (id: number) => {
    if (geoIsCountry) handleCountry(id);
    else if (geoKind === 'county') handleCounty(id);
    else handleCity(id);
  };

  const busy = submitting !== null;
  const profileLoading = profileStatus === 'loading' || profileStatus === 'idle';

  // ── Step bodies ───────────────────────────────────────────────────────────
  const renderDetailsStep = () => (
    <>
      <Text style={[styles.label, { color: c.text }]}>{t('post_service')}</Text>
      {renderServiceSection()}
      {stepErrors.service ? (
        <Text style={[styles.error, { color: c.destructive }]}>{stepErrors.service}</Text>
      ) : null}

      <Text style={[styles.label, { color: c.text }]}>{t('post_job_title')}</Text>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: c.input, color: c.text, borderColor: stepErrors.title ? c.destructive : c.border },
        ]}
        placeholder={t('post_title_placeholder')}
        placeholderTextColor={c.mutedForeground}
        value={title}
        onChangeText={(v) => {
          setTitle(v);
          clearError('title');
        }}
        onBlur={() => {
          // Inline feedback while the field still has focus's attention: the
          // schema's own 3..150 rule, reported under the input it belongs to.
          const error = validateJobTitle(title);
          if (error) setStepErrors((prev) => ({ ...prev, title: t(error) }));
        }}
        maxLength={JOB_TITLE_MAX}
      />
      {stepErrors.title ? (
        <Text style={[styles.error, { color: c.destructive }]}>{stepErrors.title}</Text>
      ) : null}

      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: c.text }]}>{t('post_description')}</Text>
        <Text
          style={[
            styles.counter,
            { color: wordCount > DESC_WORD_MAX ? c.destructive : c.mutedForeground },
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
            borderColor: stepErrors.description ? c.destructive : c.border,
          },
        ]}
        placeholder={t('post_desc_placeholder')}
        placeholderTextColor={c.mutedForeground}
        value={description}
        onChangeText={(v) => {
          setDescription(v);
          clearError('description');
        }}
        multiline
        numberOfLines={5}
        textAlignVertical="top"
      />
      {stepErrors.description ? (
        <Text style={[styles.error, { color: c.destructive }]}>{stepErrors.description}</Text>
      ) : null}
    </>
  );

  /**
   * Step 2 — REQUEST TYPE first, then BOOKING TYPE.
   *
   * Both pairs use the same card component and the same two-column grid, so they
   * line up exactly in every state (selected, idle, disabled). The two-way lock
   * is visible rather than hidden: the disabled card is greyed and says why.
   */
  const renderBookingStep = () => (
    <>
      <Text style={[styles.label, { color: c.text }]}>{t('post_request_type')}</Text>
      <View style={styles.optionRow}>
        <RequestTypeCard
          active={urgency === 'urgent'}
          icon="zap"
          title={t('post_urgent')}
          description={t('post_urgent_desc')}
          accent={c.urgent}
          accentSoft={c.urgentLight}
          onAccent={c.primaryForeground}
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

  const renderScheduleStep = () => (
    <>
      {bookingKind === 'one_time' ? (
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

        </>
      ) : (
        <>
          <Text style={[styles.label, { color: c.text }]}>{t('post_date')}</Text>
          <TouchableOpacity
            style={[
              styles.input,
              styles.fieldButton,
              {
                backgroundColor: c.input,
                borderColor: stepErrors.date ? c.destructive : c.border,
              },
            ]}
            onPress={() => setDateSheetOpen(true)}
            accessibilityRole="button"
          >
            <Feather
              name="calendar"
              size={15}
              color={startDay ? c.primary : c.mutedForeground}
            />
            <Text
              style={[
                styles.fieldButtonText,
                { color: startDay ? c.text : c.mutedForeground },
              ]}
              numberOfLines={1}
            >
              {startDay && days.length > 0 ? daysSummary : t('post_date_start_pick')}
            </Text>
            <Feather name="chevron-right" size={16} color={c.mutedForeground} />
          </TouchableOpacity>
          <Text style={[styles.hint, { color: c.mutedForeground }]}>
            {startDay
              ? t('post_days_selected_of', { n: days.length, total: MAX_MILESTONE_DAYS })
              : t('post_date_window_hint', { n: MAX_MILESTONE_DAYS })}
          </Text>


          {milestonePreview.length > 0 ? (
            <View style={styles.milestoneWrap}>
              <Text style={[styles.label, { color: c.text }]}>{t('post_milestones')}</Text>
              {milestonePreview.map((item, index) => (
                <Animated.View
                  key={item.key}
                  entering={FadeInUp.delay(index * 45).duration(260)}
                  style={[
                    styles.milestoneRow,
                    { backgroundColor: c.primaryLight, borderColor: c.primary },
                  ]}
                >
                  <View style={[styles.milestoneDot, { backgroundColor: c.primary }]}>
                    <Text style={[styles.milestoneDotText, { color: c.primaryForeground }]}>
                      {index + 1}
                    </Text>
                  </View>
                  <View style={styles.milestoneBody}>
                    <Text style={[styles.milestoneTitle, { color: c.text }]} numberOfLines={1}>
                      {item.label}
                    </Text>
                    <Text style={[styles.milestoneMeta, { color: c.mutedForeground }]} numberOfLines={1}>
                      {item.day}
                    </Text>
                  </View>
                  <Text style={[styles.milestoneTime, { color: c.primary }]}>{item.time}</Text>
                </Animated.View>
              ))}
            </View>
          ) : null}
        </>
      )}

      {/* ── Time: five fixed slots + Anytime ────────────────────────────── */}
      <Text style={[styles.label, { color: c.text }]}>{t('post_time')}</Text>
      <View style={styles.slotGrid}>
        {FIXED_SLOTS.map((slot) => {
          const slotChoice: TimeChoice = { kind: 'slot', key: slot.key };
          const active = timeChoice?.kind === 'slot' && timeChoice.key === slot.key;
          const started = hasSlotStarted(slotChoice, activeDay);
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
                setTimeChoice(slotChoice);
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
                {`${formatTimeLabel(slot.start.hour, slot.start.minute, meridiem)} - ${formatTimeLabel(
                  slot.end.hour,
                  slot.end.minute,
                  meridiem
                )}`}
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
          onPress={() => {
            if (timeChoice?.kind === 'anytime') {
              setClockTarget('start');
              return;
            }
            setTimeChoice({
              kind: 'anytime',
              start: { hour: 9, minute: 0 },
              end: { hour: 12, minute: 0 },
            });
            clearError('time');
            clearError('date');
          }}
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

      {/* Anytime reveals its own start and end, each opened on the same clock. */}
      {timeChoice?.kind === 'anytime' ? (
        <View style={styles.anytimeWrap}>
          <View style={styles.fieldWrap}>
            <Text style={[styles.smallLabel, { color: c.mutedForeground }]}>
              {t('post_time_start')}
            </Text>
            <TouchableOpacity
              style={[styles.input, styles.fieldButton, { backgroundColor: c.input, borderColor: c.border }]}
              onPress={() => setClockTarget('start')}
              accessibilityRole="button"
            >
              <Feather name="clock" size={15} color={c.primary} />
              <Text style={[styles.fieldButtonText, { color: c.text }]}>
                {formatTimeLabel(timeChoice.start.hour, timeChoice.start.minute, meridiem)}
              </Text>
              <Feather name="chevron-right" size={16} color={c.mutedForeground} />
            </TouchableOpacity>
          </View>

          <View style={styles.fieldWrap}>
            <Text style={[styles.smallLabel, { color: c.mutedForeground }]}>
              {t('post_time_end')}
            </Text>
            <TouchableOpacity
              style={[styles.input, styles.fieldButton, { backgroundColor: c.input, borderColor: c.border }]}
              onPress={() => setClockTarget('end')}
              accessibilityRole="button"
            >
              <Feather name="clock" size={15} color={c.primary} />
              <Text style={[styles.fieldButtonText, { color: c.text }]}>
                {formatTimeLabel(timeChoice.end.hour, timeChoice.end.minute, meridiem)}
              </Text>
              <Feather name="chevron-right" size={16} color={c.mutedForeground} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.anytimeSummary, { color: c.primary }]}>{windowLabel}</Text>
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

      <Text style={[styles.label, { color: c.text }]}>
        {bookingKind === 'one_time' ? t('post_hours') : t('post_hours_per_day')}
      </Text>
      <View style={[styles.stepper, { backgroundColor: c.input, borderColor: c.border }]}>
        <TouchableOpacity
          style={[styles.stepperBtn, { backgroundColor: c.muted }]}
          onPress={() => setHours((h) => Math.max(MIN_EXPECTED_HOURS, h - 1))}
          accessibilityRole="button"
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
        >
          <Feather name="plus" size={16} color={c.text} />
        </TouchableOpacity>
      </View>
    </>
  );

  const renderAddressStep = () => (
    <>
      {profileLoading ? <AddressSkeleton /> : null}
      {stepErrors.address ? (
        <Text style={[styles.error, { color: c.destructive }]}>{stepErrors.address}</Text>
      ) : null}
      {pickerRow(
        'country_id',
        'addr_c_country',
        country?.name ?? null,
        countriesStatus === 'loading',
        () => setPickerOpen('country')
      )}
      {pickerRow(
        'county_id',
        'addr_c_county',
        county?.name ?? null,
        countryId == null,
        () => setPickerOpen('county')
      )}
      {pickerRow('city_id', 'addr_c_city', city?.name ?? null, countyId == null, () =>
        setPickerOpen('city')
      )}
      {textField('street_address', 'addr_c_street', streetAddress, setStreetAddress)}
      {textField('house_number', 'addr_c_house', houseNumber, setHouseNumber)}
      {textField('postal_code', 'addr_c_postal', postalCode, setPostalCode)}
      {textField('landmark', 'addr_c_landmark', landmark, setLandmark)}
      {textField('formatted_address', 'addr_c_formatted', formattedAddress, setFormattedAddress, {
        multiline: true,
      })}
    </>
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

      {/* Progress: filled segments + "Step n of 4". */}
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

      {/* Bottom action bar — safe-area padded so the Android nav bar never
          covers it, with the final step's two post actions. */}
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
              style={[styles.submitBtn, { backgroundColor: c.primary, opacity: busy ? 0.6 : 1 }]}
              onPress={() => void submit(false)}
              disabled={busy}
              accessibilityRole="button"
            >
              {submitting === 'post' ? (
                <InlineLoader size={20} />
              ) : (
                <Text style={[styles.submitText, { color: c.primaryForeground }]}>
                  {t('post_submit')}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.draftBtn, { borderColor: c.primary, opacity: busy ? 0.6 : 1 }]}
              onPress={() => void submit(true)}
              disabled={busy}
              accessibilityRole="button"
            >
              {submitting === 'draft' ? (
                <InlineLoader size={20} />
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
              style={[styles.barNext, { backgroundColor: c.primary }]}
              onPress={goNext}
              accessibilityRole="button"
            >
              <Text style={[styles.barNextText, { color: c.primaryForeground }]}>
                {t('post_next')}
              </Text>
              <Feather name="arrow-right" size={16} color={c.primaryForeground} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Country / county / city — one identical sheet pattern */}
      <BottomSheet
        visible={pickerOpen !== null}
        onClose={() => setPickerOpen(null)}
        title={t(geoTitleKey)}
        header={
          <View style={[styles.searchRow, { borderBottomColor: c.border }]}>
            <Feather name="search" size={15} color={c.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: c.text }]}
              placeholder={t('geo_search')}
              placeholderTextColor={c.mutedForeground}
              value={geoSearch}
              onChangeText={setGeoSearch}
              autoCorrect={false}
            />
          </View>
        }
      >
        {geoLoadingNow ? (
          <View style={styles.modalState}>
            <InlineLoader size={22} />
          </View>
        ) : geoErrorNow ? (
          <View style={styles.modalState}>
            <Text style={[styles.serviceStateText, { color: c.mutedForeground }]}>
              {t('addr_c_err_network')}
            </Text>
            <TouchableOpacity onPress={geoRetry} hitSlop={6}>
              <Text style={[styles.serviceStateAction, { color: c.primary }]}>{t('addr_retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : geoOptions && geoOptions.length === 0 ? (
          <View style={styles.modalState}>
            <Text style={[styles.serviceStateText, { color: c.mutedForeground }]}>
              {t('geo_no_match')}
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.modalListPad} keyboardShouldPersistTaps="handled">
            {(geoOptions ?? []).map((option) => {
              const active = option.id === geoSelectedId;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.optionLarge,
                    {
                      backgroundColor: active ? c.primaryLight : c.input,
                      borderColor: active ? c.primary : c.border,
                    },
                  ]}
                  onPress={() => geoPick(option.id)}
                >
                  <Text style={[styles.optionText, { color: c.text }]} numberOfLines={1}>
                    {option.name}
                  </Text>
                  {active ? <Feather name="check" size={16} color={c.primary} /> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </BottomSheet>

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

      {/* Clock — the app's ONE clock, opened for Anytime's start or end. */}
      <TimePickerSheet
        visible={clockTarget !== null}
        onClose={() => setClockTarget(null)}
        title={
          clockTarget === 'end'
            ? t('post_time_end')
            : clockTarget === 'start'
              ? t('post_time_start')
              : t('post_time_picker_title')
        }
        value={
          clockTarget !== null && timeChoice?.kind === 'anytime'
            ? clockTarget === 'end'
              ? timeChoice.end
              : timeChoice.start
            : null
        }
        day={activeDay}
        onConfirm={(value) => {
          setTimeChoice((current) => {
            const base =
              current && current.kind === 'anytime'
                ? current
                : { kind: 'anytime' as const, start: { hour: 9, minute: 0 }, end: { hour: 12, minute: 0 } };
            return clockTarget === 'end' ? { ...base, end: value } : { ...base, start: value };
          });
          clearError('time');
          clearError('date');
          setClockTarget(null);
        }}
      />

      {/* Dates — one start day plus any subset of its seven days. */}
      <DateWindowPickerSheet
        visible={dateSheetOpen}
        onClose={() => setDateSheetOpen(false)}
        title={t('post_date_picker_title')}
        value={startDay ? { start: startDay, days: selectedDays } : null}
        minDay={today}
        onConfirm={(choice) => {
          // A NEW start day resets the chosen days; the same start keeps them.
          setStartDay(choice.start);
          setSelectedDays(
            startDay && startDay.getTime() === choice.start.getTime()
              ? choice.days
              : selectionForStart(choice.start)
          );
          clearError('date');
          clearError('time');
          setDateSheetOpen(false);
        }}
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
  progressWrap: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 6,
  },
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
  textAreaSmall: { minHeight: 64 },
  fieldButton: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldButtonText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 14 },
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
  fieldWrap: { marginBottom: 12 },
  chipWrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  chipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  // Two equal slots per row, in every language (no horizontal scrolling).
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
  anytimeWrap: { marginTop: 10 },
  anytimeSummary: { fontFamily: 'Manrope_700Bold', fontSize: 12, marginTop: 4 },
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
  optionLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  milestoneWrap: { marginTop: 4 },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  milestoneDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  milestoneDotText: { fontFamily: 'Manrope_700Bold', fontSize: 11 },
  milestoneBody: { flex: 1 },
  milestoneTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  milestoneMeta: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2 },
  milestoneTime: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
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
  serviceStateText: { fontFamily: 'Manrope_400Regular', fontSize: 12, textAlign: 'center' },
  serviceStateAction: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
  pickerInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerText: { fontFamily: 'Manrope_400Regular', fontSize: 14, flex: 1 },
  bar: {
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
  },
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
  draftBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', borderWidth: 1.5 },
  draftText: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  skeletonWrap: { gap: 10, marginBottom: 14 },
  skeletonRow: { height: 42, borderRadius: 12 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  searchInput: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, paddingVertical: 2 },
  modalListPad: { padding: 16, gap: 8 },
  modalState: { padding: 32, alignItems: 'center', gap: 10 },
  optionText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 14 },
});
