import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import { useAppAlert } from '@/context/AlertModalContext';
import InlineLoader from '@/components/InlineLoader';
import { authApi } from '@/services/api';
import useServices from '@/hooks/useServices';
import useCountries from '@/hooks/useCountries';
import { invalidateJobList } from '@/hooks/useJobList';
import { usePublishJob } from '@/hooks/usePublishJob';
import { isDraftJob, publishErrorKey } from '@/lib/jobPublish';
import { jobStatusLabelKey } from '@/lib/jobList';
import {
  buildCreateJobRequest,
  mapValidationErrors,
  type JobFormField,
} from '@/lib/jobCreate';
import type { AddressRegionResponse, JobResponse } from '@/types';

/**
 * Post a Job — creates a REAL job via POST /api/v1/jobs.
 *
 * Every value is mapped to the live JobCreate contract:
 *   service picker  → service_id (+ category_id from the chosen service)
 *   title/description → title (3..150) / description
 *   urgency chips   → request_type URGENT | REGULAR
 *   date+time chips → milestones[0].scheduled_at (ISO 8601 UTC)
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

export default function PostJobScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const showAlert = useAppAlert();
  const { publish, publishing } = usePublishJob();

  // ── Services (real ids — never invented) ───────────────────────────────────
  const { status: servicesStatus, services, load: loadServices } = useServices();

  // ── Geo picker sources (live PUBLIC endpoints) ─────────────────────────────
  const { status: countriesStatus, countries, load: loadCountries, refresh: refreshCountries } = useCountries();
  const [counties, setCounties] = useState<AddressRegionResponse[] | null>(null);
  const [cities, setCities] = useState<AddressRegionResponse[] | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<'country' | 'county' | 'city' | null>(null);
  const [geoSearch, setGeoSearch] = useState('');

  // ── Form values ────────────────────────────────────────────────────────────
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dateKey, setDateKey] = useState<DateKey>('today');
  const [timeSlot, setTimeSlot] = useState('11:00 AM');
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
    void loadServices();
  }, [loadServices]);

  useEffect(() => {
    setGeoSearch('');
  }, [pickerOpen]);

  const wordCount = description.trim().length ? description.trim().split(/\s+/).length : 0;
  const selectedService = useMemo(
    () => services?.find((service) => service.id === serviceId) ?? null,
    [services, serviceId]
  );
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
    if (!timeSlot) next.date = t('post_err_schedule');
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

  const goToJob = (jobId: number) => {
    router.replace(`/job/${jobId}` as any);
  };

  const submit = async (isDraft: boolean) => {
    // `publishing` covers the draft→publish round trip, `submitting` the form
    // POST itself, so neither can be fired twice by a double tap.
    if (submitting || publishing) return;
    if (!validate()) return;

    // Ids are guaranteed non-null by validate() above.
    const payload = buildCreateJobRequest({
      serviceId: serviceId!,
      serviceCategoryId: selectedService?.category_id ?? null,
      title,
      description,
      requestType: urgency,
      dateKey,
      timeSlot,
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

  // ── Service picker ─────────────────────────────────────────────────────────
  const renderServicePicker = () => {
    if (servicesStatus === 'loading' || servicesStatus === 'idle') {
      return (
        <View style={styles.serviceState}>
          <InlineLoader size={18} />
        </View>
      );
    }
    if (servicesStatus === 'error') {
      return (
        <View style={[styles.serviceState, { borderColor: c.border }]}>
          <Text style={[styles.serviceStateText, { color: c.mutedForeground }]}>
            {t('post_service_load_error')}
          </Text>
          <TouchableOpacity onPress={() => void loadServices(true)} hitSlop={6}>
            <Text style={[styles.serviceStateAction, { color: c.primary }]}>{t('addr_retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (!services || services.length === 0) {
      return (
        <View style={[styles.serviceState, { borderColor: c.border }]}>
          <Text style={[styles.serviceStateText, { color: c.mutedForeground }]}>
            {t('post_service_empty')}
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.serviceList}>
        {services.map((service) => {
          const active = service.id === serviceId;
          return (
            <TouchableOpacity
              key={service.id}
              style={[
                styles.serviceRow,
                {
                  backgroundColor: active ? c.primaryLight : c.input,
                  borderColor: active ? c.primary : c.border,
                },
              ]}
              onPress={() => {
                setServiceId(service.id);
                clearError('service');
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.serviceName, { color: c.text }]} numberOfLines={1}>
                  {service.title}
                </Text>
                {service.category_name ? (
                  <Text style={[styles.serviceMeta, { color: c.mutedForeground }]} numberOfLines={1}>
                    {service.category_name}
                  </Text>
                ) : null}
              </View>
              {active ? <Feather name="check-circle" size={18} color={c.primary} /> : null}
            </TouchableOpacity>
          );
        })}
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

  // ── Geo modal ──────────────────────────────────────────────────────────────
  const pickerModal = () => {
    if (!pickerOpen) return null;
    const isCountry = pickerOpen === 'country';
    const source: Array<{ id: number; name: string }> | null = isCountry
      ? countries
      : pickerOpen === 'county'
        ? counties
        : cities;
    const loadingNow = isCountry ? countriesStatus === 'loading' : geoLoading;
    const errorNow = isCountry ? countriesStatus === 'error' : geoError;
    const query = geoSearch.trim().toLowerCase();
    const options = source?.filter((o) => !query || o.name.toLowerCase().includes(query)) ?? null;
    const selectedId = isCountry ? countryId : pickerOpen === 'county' ? countyId : cityId;
    const titleKey =
      pickerOpen === 'country' ? 'addr_c_country' : pickerOpen === 'county' ? 'addr_c_county' : 'addr_c_city';

    const retry = isCountry
      ? () => void refreshCountries()
      : pickerOpen === 'county'
        ? () => countryId != null && void loadCounties(countryId)
        : () => countyId != null && void loadCities(countyId);

    const pick = (id: number) => {
      if (isCountry) handleCountry(id);
      else if (pickerOpen === 'county') handleCounty(id);
      else handleCity(id);
    };

    return (
      <Modal visible transparent animationType="slide" onRequestClose={() => setPickerOpen(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(null)}>
          <Pressable style={[styles.modalSheet, { backgroundColor: c.background, borderColor: c.border }]}>
            <View style={[styles.modalHead, { borderBottomColor: c.border }]}>
              <Text style={[styles.modalTitle, { color: c.text }]}>{t(titleKey)}</Text>
              <TouchableOpacity onPress={() => setPickerOpen(null)} hitSlop={8}>
                <Feather name="x" size={20} color={c.mutedForeground} />
              </TouchableOpacity>
            </View>

            {isCountry ? (
              <View style={[styles.searchRow, { borderBottomColor: c.border }]}>
                <Feather name="search" size={16} color={c.mutedForeground} />
                <TextInput
                  style={[styles.searchInput, { color: c.text }]}
                  placeholder={t('geo_search')}
                  placeholderTextColor={c.mutedForeground}
                  value={geoSearch}
                  onChangeText={setGeoSearch}
                  autoCorrect={false}
                />
              </View>
            ) : null}

            {loadingNow ? (
              <View style={styles.modalState}>
                <InlineLoader size={22} />
              </View>
            ) : errorNow ? (
              <View style={styles.modalState}>
                <Text style={[styles.serviceStateText, { color: c.mutedForeground }]}>
                  {t('addr_c_err_network')}
                </Text>
                <TouchableOpacity onPress={retry} hitSlop={6}>
                  <Text style={[styles.serviceStateAction, { color: c.primary }]}>{t('addr_retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : options && options.length === 0 ? (
              <View style={styles.modalState}>
                <Text style={[styles.serviceStateText, { color: c.mutedForeground }]}>
                  {t('geo_no_match')}
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled">
                {(options ?? []).map((option) => {
                  const active = option.id === selectedId;
                  return (
                    <TouchableOpacity
                      key={option.id}
                      style={[styles.optionRow, { borderBottomColor: c.border }]}
                      onPress={() => pick(option.id)}
                    >
                      <Text style={[styles.optionText, { color: c.text }]}>{option.name}</Text>
                      {active ? <Feather name="check" size={16} color={c.primary} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    );
  };

  const busy = submitting !== null;

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
        {renderServicePicker()}
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

        {/* Date */}
        <Text style={[styles.label, { color: c.text }]}>{t('post_date')}</Text>
        <View style={styles.chipWrapRow}>
          {DATE_KEYS.map((key) => {
            const label =
              key === 'today'
                ? t('post_date_today')
                : key === 'tomorrow'
                  ? t('post_date_tomorrow')
                  : t('post_date_weekend');
            return (
              <TouchableOpacity
                key={key}
                style={[styles.chip, { backgroundColor: dateKey === key ? c.primary : c.muted }]}
                onPress={() => {
                  setDateKey(key);
                  clearError('date');
                }}
              >
                <Text style={[styles.chipText, { color: dateKey === key ? '#FFF' : c.text }]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Time */}
        <Text style={[styles.label, { color: c.text }]}>{t('post_time')}</Text>
        <View style={styles.chipWrapRow}>
          {TIME_SLOTS.map((slot) => (
            <TouchableOpacity
              key={slot}
              style={[styles.chip, { backgroundColor: timeSlot === slot ? c.primary : c.muted }]}
              onPress={() => {
                setTimeSlot(slot);
                clearError('date');
              }}
            >
              <Text style={[styles.chipText, { color: timeSlot === slot ? '#FFF' : c.text }]}>{slot}</Text>
            </TouchableOpacity>
          ))}
        </View>
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

        {/* Request type */}
        <Text style={[styles.label, { color: c.text }]}>{t('post_request_type')}</Text>
        <View style={styles.urgencyRow}>
          <TouchableOpacity
            style={[
              styles.urgencyOption,
              {
                backgroundColor: urgency === 'urgent' ? c.urgentLight : c.muted,
                borderColor: urgency === 'urgent' ? c.urgent : c.border,
              },
            ]}
            onPress={() => setUrgency('urgent')}
          >
            <Feather name="zap" size={20} color={urgency === 'urgent' ? c.urgent : c.mutedForeground} />
            <Text style={[styles.urgencyTitle, { color: urgency === 'urgent' ? c.urgent : c.text }]}>
              {t('post_urgent')}
            </Text>
            <Text style={[styles.urgencyDesc, { color: c.mutedForeground }]}>{t('post_urgent_desc')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.urgencyOption,
              {
                backgroundColor: urgency === 'regular' ? c.successLight : c.muted,
                borderColor: urgency === 'regular' ? c.success : c.border,
              },
            ]}
            onPress={() => setUrgency('regular')}
          >
            <Feather name="clock" size={20} color={urgency === 'regular' ? c.success : c.mutedForeground} />
            <Text style={[styles.urgencyTitle, { color: urgency === 'regular' ? c.success : c.text }]}>
              {t('post_regular')}
            </Text>
            <Text style={[styles.urgencyDesc, { color: c.mutedForeground }]}>{t('post_regular_desc')}</Text>
          </TouchableOpacity>
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
          {submitting === 'post' ? <InlineLoader size={20} /> : <Text style={styles.submitText}>{t('post_submit')}</Text>}
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

      {pickerModal()}
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
  fieldWrap: { marginBottom: 12 },
  chipWrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  chipText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 12, padding: 8 },
  stepperBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  urgencyRow: { flexDirection: 'row', gap: 10 },
  urgencyOption: { flex: 1, borderWidth: 1.5, borderRadius: 14, padding: 14, alignItems: 'center', gap: 6 },
  urgencyTitle: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  urgencyDesc: { fontFamily: 'Manrope_400Regular', fontSize: 11, textAlign: 'center', lineHeight: 15 },
  serviceList: { gap: 8 },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  serviceName: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  serviceMeta: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2 },
  serviceState: { borderWidth: 1, borderRadius: 12, padding: 16, alignItems: 'center', gap: 8 },
  serviceStateText: { fontFamily: 'Manrope_400Regular', fontSize: 12, textAlign: 'center' },
  serviceStateAction: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
  pickerInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerText: { fontFamily: 'Manrope_400Regular', fontSize: 14, flex: 1 },
  submitBtn: { marginTop: 28, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitText: { fontFamily: 'Manrope_700Bold', fontSize: 15, color: '#FFF' },
  draftBtn: { marginTop: 12, borderRadius: 14, paddingVertical: 15, alignItems: 'center', borderWidth: 1.5 },
  draftText: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, maxHeight: '78%' },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  modalTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1 },
  searchInput: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, paddingVertical: 4 },
  modalList: { maxHeight: 380 },
  modalState: { padding: 32, alignItems: 'center', gap: 10 },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  optionText: { fontFamily: 'Manrope_500Medium', fontSize: 14 },
});
