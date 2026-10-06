import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
  FadeInUp,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import { useAppAlert } from '@/context/AlertModalContext';
import InlineLoader from '@/components/InlineLoader';
import BottomSheet from '@/components/BottomSheet';
import DateTimeSheet from '@/components/DateTimeSheet';
import ServicePickerSheet from '@/components/ServicePickerSheet';
import { authApi } from '@/services/api';
import useCountries from '@/hooks/useCountries';
import useCategories from '@/hooks/useCategories';
import useServiceDetail from '@/hooks/useServiceDetail';
import { invalidateJobList } from '@/hooks/useJobList';
import { usePublishJob } from '@/hooks/usePublishJob';
import { isDraftJob, publishErrorKey } from '@/lib/jobPublish';
import { jobStatusLabelKey } from '@/lib/jobList';
import {
  BOOKING_MAX_LEAD_DAYS,
  BOOKING_MIN_LEAD_MINUTES,
  bookingWindow,
  formatScheduleLabel,
  isWithinBookingWindow,
  splitTable,
} from '@/lib/jobSchedule';
import {
  buildCreateJobRequest,
  mapValidationErrors,
  type JobFormField,
} from '@/lib/jobCreate';
import type { AddressRegionResponse, JobResponse, ServiceListItem } from '@/types';

/**
 * Post a Job — creates a REAL job via POST /api/v1/jobs.
 *
 * SERVICE (Issue 1): the screen never renders a flat list of every service.
 * When the user arrives from "Book now" (/job/post?serviceId=123) that exact
 * service is locked in and shown as a read-only card; the general entry point
 * (/job/post from the Jobs tab) opens a CASCADING picker — category first,
 * then only that category's services, both from the live API.
 *
 * SCHEDULE (Issues 2 & 5): the Today / Tomorrow / This Weekend chips plus the
 * fixed time chips remain the fast path, unchanged. A "Custom date & time"
 * action opens a real month calendar (days outside the booking window are
 * greyed out and not tappable) with a specific hour/minute clock, and the
 * chosen slot is what `scheduled_at` carries.
 *
 * Every value is mapped to the live JobCreate contract:
 *   service picker  → service_id (+ category_id from that service)
 *   title/description → title (3..150) / description
 *   urgency cards   → request_type URGENT | REGULAR
 *   date+time       → milestones[0].scheduled_at (ISO 8601 UTC)
 *   hours stepper   → milestones[0].expected_hours (number)
 *   geo pickers + address fields → address{ country_id, county_id, city_id, ... }
 *   Post Job / Save as draft → is_draft false / true
 *
 * booking_type is always ONE_TIME: the form schedules a single visit, and
 * JobCreate exposes no top-level scheduled_at, so milestones[] carries it.
 *
 * REMOVED ON PURPOSE (no counterpart in JobCreate, and the spec has no job
 * attachment endpoint at all): the photo picker and the hourly-rate/budget
 * fields. Nothing inert is left on screen.
 *
 * AUTH/401: the shared axios client refreshes an expired token once and
 * replays the request; if the session is truly over it clears the session
 * (AuthContext) and this screen shows a sign-in-again message. No bespoke
 * token handling lives here.
 */

const TIME_SLOTS = ['9:00 AM', '11:00 AM', '1:00 PM', '3:00 PM', '5:00 PM', '7:00 PM'];

const DATE_KEYS = ['today', 'tomorrow', 'weekend'] as const;
type DateKey = (typeof DATE_KEYS)[number];

const TITLE_MIN = 3;
/** Server cap on JobCreate.title. */
const TITLE_MAX = 150;
const DESC_WORD_MAX = 500;

/** Request-type card: the same two options, with a real press animation. */
function UrgencyCard({
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
}: {
  active: boolean;
  icon: 'zap' | 'clock';
  title: string;
  description: string;
  accent: string;
  accentSoft: string;
  /** Foreground for content sitting ON the accent fill (theme token, not a literal). */
  onAccent: string;
  idle: string;
  border: string;
  titleColor: string;
  bodyColor: string;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[styles.urgencySlot, animStyle]}>
      <Pressable
        style={[
          styles.urgencyOption,
          {
            backgroundColor: active ? accentSoft : idle,
            borderColor: active ? accent : border,
          },
        ]}
        onPressIn={() => {
          scale.value = withSpring(0.96, { damping: 18, stiffness: 320 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 16, stiffness: 280 });
        }}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
      >
        <View style={[styles.urgencyIcon, { backgroundColor: active ? accent : idle }]}>
          <Feather name={icon} size={17} color={active ? onAccent : bodyColor} />
        </View>
        <Text style={[styles.urgencyTitle, { color: active ? accent : titleColor }]}>
          {title}
        </Text>
        <Text style={[styles.urgencyDesc, { color: bodyColor }]}>{description}</Text>
        {active ? (
          <Animated.View entering={FadeInUp.duration(160)} style={[styles.urgencyBadge, { backgroundColor: accent }]}>
            <Feather name="check" size={11} color={onAccent} />
          </Animated.View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export default function PostJobScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const showAlert = useAppAlert();
  const { publish, publishing } = usePublishJob();

  // ── Service (Issue 1) ──────────────────────────────────────────────────────
  // "Book now" deep links here as /job/post?serviceId=123. Anything
  // non-numeric is ignored, so a malformed link degrades to the picker.
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

  // The service the user picked in the sheet already carries its category, so
  // only the Book-now path needs the detail round trip.
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

  // ── Geo picker sources (live PUBLIC endpoints) ─────────────────────────────
  const { status: countriesStatus, countries, load: loadCountries, refresh: refreshCountries } = useCountries();
  const [counties, setCounties] = useState<AddressRegionResponse[] | null>(null);
  const [cities, setCities] = useState<AddressRegionResponse[] | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<'country' | 'county' | 'city' | null>(null);
  const [geoSearch, setGeoSearch] = useState('');

  // ── Form values ────────────────────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dateKey, setDateKey] = useState<DateKey>('today');
  const [timeSlot, setTimeSlot] = useState('11:00 AM');
  /** A confirmed custom slot; null while the quick chips are in charge. */
  const [customAt, setCustomAt] = useState<Date | null>(null);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [hours, setHours] = useState(2);
  const [urgency, setUrgency] = useState<'urgent' | 'regular'>('regular');
  const [countryId, setCountryId] = useState<number | null>(null);
  const [countyId, setCountyId] = useState<number | null>(null);
  const [cityId, setCityId] = useState<number | null>(null);
  const [houseNumber, setHouseNumber] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [landmark, setLandmark] = useState('');
  const [formattedAddress, setFormattedAddress] = useState('');

  const [errors, setErrors] = useState<Partial<Record<JobFormField, string>>>({});
  /** null = idle; otherwise WHICH button is submitting (blocks both). */
  const [submitting, setSubmitting] = useState<'post' | 'draft' | null>(null);

  useEffect(() => {
    void loadCountries();
  }, [loadCountries]);

  useEffect(() => {
    setGeoSearch('');
  }, [pickerOpen]);

  // Month / weekday names for the custom-slot summary, from the dictionary
  // (never a hardcoded English array, and no Intl dependency on device).
  const months = useMemo(() => splitTable(t('post_sched_months')), [t]);
  const weekdays = useMemo(() => splitTable(t('post_sched_weekdays')), [t]);

  const wordCount = description.trim().length ? description.trim().split(/\s+/).length : 0;
  const country = countries?.find((x) => x.id === countryId) ?? null;
  const county = counties?.find((x) => x.id === countyId) ?? null;
  const city = cities?.find((x) => x.id === cityId) ?? null;

  const clearError = useCallback((field: JobFormField) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

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
    setPickerOpen(null);
    void loadCounties(id);
  };

  const handleCounty = (id: number) => {
    setCountyId(id);
    setCityId(null);
    setCities(null);
    clearError('county_id');
    clearError('city_id');
    setPickerOpen(null);
    void loadCities(id);
  };

  const handleCity = (id: number) => {
    setCityId(id);
    clearError('city_id');
    setPickerOpen(null);
  };

  // ── Scheduling ─────────────────────────────────────────────────────────────
  /** The window message for a slot that the server-side limits reject. */
  const windowErrorFor = useCallback(
    (at: Date): string | null => {
      const { min, max } = bookingWindow(new Date());
      if (at.getTime() < min.getTime()) {
        return t('post_sched_err_early', { n: BOOKING_MIN_LEAD_MINUTES });
      }
      if (at.getTime() > max.getTime()) {
        return t('post_sched_err_late', { n: BOOKING_MAX_LEAD_DAYS });
      }
      return null;
    },
    [t]
  );

  /** A quick chip always wins back the fast path from a custom slot. */
  const chooseQuickDate = (key: DateKey) => {
    setCustomAt(null);
    setDateKey(key);
    clearError('date');
  };

  const chooseQuickTime = (slot: string) => {
    setCustomAt(null);
    setTimeSlot(slot);
    clearError('date');
  };

  const confirmCustom = (value: Date) => {
    setCustomAt(value);
    setDateSheetOpen(false);
    clearError('date');
  };

  // ── Validation (mirrors the server's required fields / title bounds) ───────
  const validate = () => {
    const next: Partial<Record<JobFormField, string>> = {};
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < TITLE_MIN) next.title = t('post_err_title_min');
    if (!description.trim()) next.description = t('post_err_desc');
    else if (wordCount > DESC_WORD_MAX) next.description = t('post_err_desc_long');
    if (serviceId == null) next.service = t('post_err_service');
    if (countryId == null || countyId == null || cityId == null) {
      next.address = t('post_err_address');
    }
    if (customAt) {
      // The picker already blocks out-of-window slots; this is the belt-and-
      // braces guard for a slot that went stale while the form sat open.
      const rangeError = windowErrorFor(customAt);
      if (rangeError) next.date = rangeError;
    } else if (!timeSlot) {
      next.date = t('post_err_schedule');
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  // ── Error handling ─────────────────────────────────────────────────────────
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

  // Publishing a fresh draft goes through the SAME hook the job details screen
  // uses, so 422 / 401 / network handling and the list invalidation are
  // identical in both places instead of being re-implemented here.
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
        // The session is over; the job itself is safely saved as a draft.
        showAlert({
          title: t('post_err_session_title'),
          message: t('post_err_session_msg'),
          icon: 'lock',
        });
        return;
      }

      showAlert({
        title: t('post_publish_failed_title'),
        // The backend's own readable text wins when it sent one.
        message: outcome.message ?? t(publishErrorKey(outcome.kind)),
        icon: 'alert-triangle',
      });
    },
    // goToJob is stable (router only)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showAlert, t, publish]
  );

  const submit = async (isDraft: boolean) => {
    // `publishing` covers the draft→publish round trip, `submitting` the form
    // POST itself, so neither can be fired twice by a double tap.
    if (submitting || publishing) return;
    if (!validate()) return;

    // Ids are guaranteed non-null by validate() above. A custom slot, if one is
    // set, must be in-window — validate() rejected it otherwise.
    if (customAt && !isWithinBookingWindow(customAt)) return;

    const payload = buildCreateJobRequest({
      serviceId: serviceId!,
      serviceCategoryId: serviceCategoryId,
      title,
      description,
      requestType: urgency,
      dateKey,
      timeSlot,
      scheduledAtIso: customAt ? customAt.toISOString() : null,
      expectedHours: hours,
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

    setSubmitting(isDraft ? 'draft' : 'post');
    try {
      const { data } = await authApi.createJob(payload);
      // The created job's server identity — id, status and bidding window are
      // the fields the flow needs (bidding_ends_at drives the bidding timer).
      const created: JobResponse = data;
      // The job list caches nothing, but a mounted list would still be showing
      // pre-create data; this tells it to refetch so the new job appears.
      invalidateJobList();
      // Publish is offered ONLY for a job the SERVER itself reports as DRAFT.
      // If the response says anything else, the action is not offered at all —
      // publishing a job that is not a draft would be wrong.
      const publishable = isDraftJob(created);
      if (isDraft) {
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
      } else {
        // The status is rendered as a TRANSLATED label, never as the raw enum.
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
      }
    } catch (err: any) {
      const status: number | undefined = err?.response?.status;
      if (status === 422) {
        const mapped = mapValidationErrors(err?.response?.data?.detail);
        setErrors(mapped.fieldErrors);
        // Anything we could not attach to an input is surfaced instead of
        // being swallowed, and nothing is dropped from the form.
        showUnmapped(mapped.formErrors);
      } else if (status === 401) {
        // The client already refreshed + retried once; getting here means the
        // session is over and it has been cleared for us.
        showAlert({
          title: t('post_err_session_title'),
          message: t('post_err_session_msg'),
          icon: 'lock',
        });
      } else {
        // Network / timeout / 5xx — keep everything the user typed.
        showAlert({
          title: t('post_err_network_title'),
          message: t('post_err_network_msg'),
          icon: 'wifi-off',
        });
      }
    } finally {
      setSubmitting(null);
    }
  };

  // ── Service section (Issue 1: no flat list, ever) ──────────────────────────
  const renderServiceSection = () => {
    if (serviceId == null) {
      return (
        <TouchableOpacity
          style={[
            styles.serviceEmpty,
            { backgroundColor: c.input, borderColor: errors.service ? c.destructive : c.border },
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

  // ── Address picker rows ────────────────────────────────────────────────────
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
          { backgroundColor: c.input, borderColor: errors[field] ? c.destructive : c.border },
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
      {errors[field] ? (
        <Text style={[styles.error, { color: c.destructive }]}>{errors[field]}</Text>
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
          { backgroundColor: c.input, color: c.text, borderColor: errors[field] ? c.destructive : c.border },
        ]}
        value={value}
        onChangeText={(v) => {
          setValue(v);
          clearError(field);
        }}
        multiline={options?.multiline}
        placeholderTextColor={c.mutedForeground}
      />
      {errors[field] ? (
        <Text style={[styles.error, { color: c.destructive }]}>{errors[field]}</Text>
      ) : null}
    </View>
  );

  // ── Geo modal (Issue 4: one sheet pattern for country / county / city) ─────
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
  const quickDimmed = customAt != null;

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('post_a_job')}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Service */}
        <Text style={[styles.label, { color: c.text }]}>{t('post_service')}</Text>
        {renderServiceSection()}
        {errors.service ? (
          <Text style={[styles.error, { color: c.destructive }]}>{errors.service}</Text>
        ) : null}

        {/* Title */}
        <Text style={[styles.label, { color: c.text }]}>{t('post_job_title')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: c.input, color: c.text, borderColor: errors.title ? c.destructive : c.border }]}
          placeholder={t('post_title_placeholder')}
          placeholderTextColor={c.mutedForeground}
          value={title}
          onChangeText={(v) => {
            setTitle(v);
            clearError('title');
          }}
          maxLength={TITLE_MAX}
        />
        {errors.title ? (
          <Text style={[styles.error, { color: c.destructive }]}>{errors.title}</Text>
        ) : null}

        {/* Description */}
        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: c.text }]}>{t('post_description')}</Text>
          <Text style={[styles.counter, { color: wordCount > DESC_WORD_MAX ? c.destructive : c.mutedForeground }]}>
            {t('post_words', { n: wordCount })}
          </Text>
        </View>
        <TextInput
          style={[styles.textArea, { backgroundColor: c.input, color: c.text, borderColor: errors.description ? c.destructive : c.border }]}
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
        {errors.description ? (
          <Text style={[styles.error, { color: c.destructive }]}>{errors.description}</Text>
        ) : null}

        {/* Date — the quick path, dimmed (not removed) while a custom slot is set */}
        <Text style={[styles.label, { color: c.text }]}>{t('post_date')}</Text>
        <Animated.View
          layout={LinearTransition.duration(220)}
          style={[styles.chipWrapRow, quickDimmed && styles.dimmed]}
        >
          {DATE_KEYS.map((key) => {
            const label =
              key === 'today'
                ? t('post_date_today')
                : key === 'tomorrow'
                  ? t('post_date_tomorrow')
                  : t('post_date_weekend');
            const active = !quickDimmed && dateKey === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.chip, { backgroundColor: active ? c.primary : c.muted }]}
                onPress={() => chooseQuickDate(key)}
              >
                <Text style={[styles.chipText, { color: active ? c.primaryForeground : c.text }]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </Animated.View>

        {/* Time — quick chips + the custom entry point (Issues 2 & 5) */}
        <Text style={[styles.label, { color: c.text }]}>{t('post_time')}</Text>
        <Animated.View
          layout={LinearTransition.duration(220)}
          style={[styles.chipWrapRow, quickDimmed && styles.dimmed]}
        >
          {TIME_SLOTS.map((slot) => {
            const active = !quickDimmed && timeSlot === slot;
            return (
              <TouchableOpacity
                key={slot}
                style={[styles.chip, { backgroundColor: active ? c.primary : c.muted }]}
                onPress={() => chooseQuickTime(slot)}
              >
                <Text style={[styles.chipText, { color: active ? c.primaryForeground : c.text }]}>
                  {slot}
                </Text>
              </TouchableOpacity>
            );
          })}
        </Animated.View>

        <Animated.View layout={LinearTransition.duration(220)} style={styles.customWrap}>
          {customAt == null ? (
            <Animated.View key="custom-cta" entering={FadeInUp.duration(200)} exiting={FadeOut.duration(140)}>
              <TouchableOpacity
                style={[styles.customCta, { borderColor: c.primary, backgroundColor: c.primaryLight }]}
                onPress={() => setDateSheetOpen(true)}
                accessibilityRole="button"
              >
                <Feather name="calendar" size={15} color={c.primary} />
                <Text style={[styles.customCtaText, { color: c.primary }]}>
                  {t('post_sched_custom')}
                </Text>
                <Feather name="chevron-right" size={15} color={c.primary} />
              </TouchableOpacity>
            </Animated.View>
          ) : (
            <Animated.View
              key="custom-card"
              entering={FadeInUp.duration(200)}
              exiting={FadeOut.duration(140)}
              style={[styles.customCard, { borderColor: c.primary, backgroundColor: c.primaryLight }]}
            >
              <View style={styles.customCardBody}>
                <Text style={[styles.customCardLabel, { color: c.mutedForeground }]}>
                  {t('post_sched_custom')}
                </Text>
                <Text style={[styles.customCardValue, { color: c.text }]} numberOfLines={1}>
                  {formatScheduleLabel(customAt, months, weekdays)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setDateSheetOpen(true)} hitSlop={8} accessibilityRole="button">
                <Feather name="edit-2" size={15} color={c.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setCustomAt(null)} hitSlop={8} accessibilityRole="button">
                <Feather name="x" size={16} color={c.mutedForeground} />
              </TouchableOpacity>
            </Animated.View>
          )}
        </Animated.View>

        {errors.date ? <Text style={[styles.error, { color: c.destructive }]}>{errors.date}</Text> : null}

        {/* Expected hours */}
        <Text style={[styles.label, { color: c.text }]}>{t('post_hours')}</Text>
        <View style={[styles.stepper, { backgroundColor: c.input, borderColor: errors.hours ? c.destructive : c.border }]}>
          <TouchableOpacity
            style={[styles.stepperBtn, { backgroundColor: c.muted }]}
            onPress={() => setHours((h) => Math.max(1, h - 1))}
          >
            <Feather name="minus" size={16} color={c.text} />
          </TouchableOpacity>
          <Text style={[styles.stepperValue, { color: c.text }]}>
            {hours === 1 ? t('post_hours_value', { n: hours }) : t('post_hours_value_plural', { n: hours })}
          </Text>
          <TouchableOpacity
            style={[styles.stepperBtn, { backgroundColor: c.muted }]}
            onPress={() => setHours((h) => Math.min(24, h + 1))}
          >
            <Feather name="plus" size={16} color={c.text} />
          </TouchableOpacity>
        </View>
        {errors.hours ? <Text style={[styles.error, { color: c.destructive }]}>{errors.hours}</Text> : null}

        {/* Request type — same meaning, real selected/unselected states */}
        <Text style={[styles.label, { color: c.text }]}>{t('post_request_type')}</Text>
        <View style={styles.urgencyRow}>
          <UrgencyCard
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
            onPress={() => setUrgency('urgent')}
          />
          <UrgencyCard
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
            onPress={() => setUrgency('regular')}
          />
        </View>

        {/* Address */}
        <Text style={[styles.label, { color: c.text }]}>{t('post_address')}</Text>
        {errors.address ? (
          <Text style={[styles.error, { color: c.destructive }]}>{errors.address}</Text>
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
        {pickerRow('city_id', 'addr_c_city', city?.name ?? null, countyId == null, () => setPickerOpen('city'))}
        {textField('street_address', 'addr_c_street', streetAddress, setStreetAddress)}
        {textField('house_number', 'addr_c_house', houseNumber, setHouseNumber)}
        {textField('postal_code', 'addr_c_postal', postalCode, setPostalCode)}
        {textField('landmark', 'addr_c_landmark', landmark, setLandmark)}
        {textField('formatted_address', 'addr_c_formatted', formattedAddress, setFormattedAddress, {
          multiline: true,
        })}

        {/* Actions */}
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: c.primary, opacity: busy ? 0.6 : 1 }]}
          onPress={() => void submit(false)}
          disabled={busy}
        >
          {submitting === 'post' ? <InlineLoader size={20} /> : <Text style={[styles.submitText, { color: c.primaryForeground }]}>{t('post_submit')}</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.draftBtn, { borderColor: c.primary, opacity: busy ? 0.6 : 1 }]}
          onPress={() => void submit(true)}
          disabled={busy}
        >
          {submitting === 'draft' ? (
            <InlineLoader size={20} />
          ) : (
            <Text style={[styles.draftText, { color: c.primary }]}>{t('post_save_draft')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* Location sheets — country / county / city, one identical pattern */}
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
            <Text style={[styles.serviceStateText, { color: c.mutedForeground }]}>{t('geo_no_match')}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.modalListPad} keyboardShouldPersistTaps="handled">
            {(geoOptions ?? []).map((option) => {
              const active = option.id === geoSelectedId;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.optionRow,
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

      {/* Custom date & time */}
      <DateTimeSheet
        visible={dateSheetOpen}
        onClose={() => setDateSheetOpen(false)}
        value={customAt}
        onConfirm={confirmCustom}
      />
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
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  scroll: { padding: 20, paddingBottom: 60, gap: 6 },
  label: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginTop: 16, marginBottom: 8 },
  smallLabel: { fontFamily: 'Manrope_500Medium', fontSize: 12, marginBottom: 6 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  counter: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Manrope_400Regular', fontSize: 14 },
  textArea: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Manrope_400Regular', fontSize: 14, minHeight: 110 },
  textAreaSmall: { minHeight: 64 },
  error: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 4 },
  inlineError: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  fieldWrap: { marginBottom: 12 },
  chipWrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dimmed: { opacity: 0.45 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  chipText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  customWrap: { marginTop: 10 },
  customCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  customCtaText: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  customCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  customCardBody: { flex: 1 },
  customCardLabel: { fontFamily: 'Manrope_500Medium', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  customCardValue: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, marginTop: 3 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 12, padding: 8 },
  stepperBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  urgencyRow: { flexDirection: 'row', gap: 10 },
  urgencySlot: { flex: 1 },
  urgencyOption: { borderWidth: 1.5, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 12, alignItems: 'center', gap: 7 },
  urgencyIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  urgencyTitle: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  urgencyDesc: { fontFamily: 'Manrope_400Regular', fontSize: 11, textAlign: 'center', lineHeight: 15 },
  urgencyBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  submitBtn: { marginTop: 28, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitText: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  draftBtn: { marginTop: 12, borderRadius: 14, paddingVertical: 15, alignItems: 'center', borderWidth: 1.5 },
  draftText: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
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
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  optionText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 14 },
});
