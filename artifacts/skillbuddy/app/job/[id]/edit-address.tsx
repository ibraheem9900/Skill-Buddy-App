import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
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
import useCountries from '@/hooks/useCountries';
import useCounties from '@/hooks/useCounties';
import useCities from '@/hooks/useCities';
import { authApi } from '@/services/api';
import { firstErrorMessage } from '@/lib/jobList';
import { composeFormattedAddress } from '@/lib/jobCreate';
import {
  buildUpdateJobAddressRequest,
  canUpdateJobAddress,
  hydrateFromCachedAddress,
  mapJobAddressUpdateErrors,
  parseCoordinate,
  selectCity,
  selectCountry,
  selectCounty,
  validateJobAddressUpdate,
  type GeoCascade,
  type JobAddressUpdateField,
  type JobAddressUpdateValues,
} from '@/lib/jobAddressUpdate';
import type { AddressRegionResponse } from '@/types';

/**
 * Edit Job Address — PATCH /api/v1/jobs/{job_id}/address (schema JobAddressUpdate).
 *
 * EDIT-ONLY: reached from Job Details when the loaded job reports it ALREADY has an
 * address and is editable. The form is pre-filled from the cached JobAddressResponse
 * (house_number, street_address, postal_code, landmark, formatted_address, the selected
 * country/county/city, and the map pin latitude/longitude parsed from the response
 * strings), so the user edits existing values rather than blank fields.
 *
 * MAP-PICKER AWARE: the screen exposes latitude/longitude as numeric inputs (and a
 * "map pin" placeholder) so a future map picker can drive them directly. On prefill
 * the cached coordinate STRINGS are parsed via parseCoordinate and passed to the form;
 * on submit they are sent as NUMBERS (the backend returns them as strings on 200, which
 * the caller adopts as the truth — never parses them into the cached object).
 *
 * FULL BODY: the complete JobAddressUpdate object is sent every time (partial bodies are
 * NOT confirmed for this endpoint, so the full-body rule is followed). When the user
 * changes the map pin or address text, formatted_address is kept consistent with the
 * edited location (a fallback is composed only when the user left it blank).
 *
 * CASCADE: the country → county → city pickers reuse the SAME public endpoints (and
 * hooks) as the Post-a-Job and Add-Address screens, and each parent selection clears its
 * children, exactly as in lib/jobAddressUpdate (which re-exports lib/jobAddress's
 * selectCountry/County/City).
 *
 * SOURCE OF TRUTH: on success the cached job address is replaced by the full 200
 * response (never merged from locally-guessed values), the job list is invalidated, and
 * the user is sent back to Job Details where the refreshed address (and pin) is shown.
 *
 * Submit button is disabled while the request is in flight (double-submission guard), and
 * 422 detail[] is mapped to field-specific messages.
 */
export default function EditJobAddressScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const showAlert = useAppAlert();

  const numericId = /^\d+$/.test(id ?? '') ? Number(id) : null;

  const {
    status: jobStatus,
    job,
    serverMessage,
    retry,
    refetch,
    applyJob,
  } = useJobDetail(numericId);

  const {
    status: countriesStatus,
    countries,
    load: loadCountries,
    refresh: refreshCountries,
  } = useCountries();
  const {
    status: countiesStatus,
    counties,
    loadForCountry,
  } = useCounties();
  const { cities, loadForCounty } = useCities();

  // Form state — initialised from the cached address once the job is ready.
  const [cascade, setCascade] = useState<GeoCascade>({
    countryId: null,
    countyId: null,
    cityId: null,
  });
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [houseNumber, setHouseNumber] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [landmark, setLandmark] = useState('');
  const [formattedAddress, setFormattedAddress] = useState('');
  const [formattedTouched, setFormattedTouched] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<JobAddressUpdateField, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<'country' | 'county' | 'city' | null>(null);
  const inFlight = useRef(false);

  // Prefill ONCE from the cached address so a background refetch can never wipe the
  // user's edits after they have touched the form. A prefill is skipped once the user
  // has changed anything — we keep what they have.
  const prefillDone = useRef(false);

  useEffect(() => {
    void loadCountries();
  }, [loadCountries]);

  // Apply the cached address values when the job first becomes ready.
  useEffect(() => {
    if (!job || job.address == null || prefillDone.current) return;
    const values = hydrateFromCachedAddress(job.address);
    setCascade(values);
    setLatitude(values.latitude);
    setLongitude(values.longitude);
    setHouseNumber(values.houseNumber);
    setStreetAddress(values.streetAddress);
    setPostalCode(values.postalCode);
    setLandmark(values.landmark);
    setFormattedAddress(values.formattedAddress);
    setFormattedTouched(values.formattedAddress.length > 0);
    prefillDone.current = true;
  }, [job?.address]);

  const clearError = (field: JobAddressUpdateField) => {
    setFieldErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const country = useMemo(
    () => countries?.find((x) => x.id === cascade.countryId) ?? null,
    [countries, cascade.countryId]
  );
  const county = useMemo(
    () => counties?.find((x) => x.id === cascade.countyId) ?? null,
    [counties, cascade.countyId]
  );
  const city = useMemo(
    () => cities?.find((x) => x.id === cascade.cityId) ?? null,
    [cities, cascade.cityId]
  );

  // Keep formatted_address consistent with edited location text when the user hasn't
  // written their own. If the user has touched it, we never overwrite it.
  const recomputeFormatted = useCallback(
    (street: string, house: string, postal: string) => {
      if (formattedTouched) return;
      const composed = composeFormattedAddress([street || null, house || null, postal || null]);
      setFormattedAddress(composed ?? '');
    },
    [formattedTouched]
  );

  // Each parent selection resets its children (pure rule in lib/jobAddressUpdate) and
  // loads the next list.
  const handleCountry = useCallback(
    (countryId: number) => {
      setCascade((prev) => selectCountry(prev, countryId));
      clearError('country_id');
      clearError('county_id');
      clearError('city_id');
      void loadForCountry(countryId);
    },
    [loadForCountry]
  );

  const handleCounty = useCallback(
    (countyId: number) => {
      setCascade((prev) => selectCounty(prev, countyId));
      clearError('county_id');
      clearError('city_id');
      void loadForCounty(countyId);
    },
    [loadForCounty]
  );

  const handleCity = useCallback((cityId: number) => {
    setCascade((prev) => selectCity(prev, cityId));
    clearError('city_id');
  }, []);

  const submit = useCallback(async () => {
    if (!job || submitting || inFlight.current) return;

    const values: JobAddressUpdateValues = {
      ...cascade,
      latitude,
      longitude,
      houseNumber,
      streetAddress,
      postalCode,
      landmark,
      formattedAddress,
    };

    const validation = validateJobAddressUpdate(values);
    if (!validation.ok) {
      setFieldErrors(
        Object.fromEntries(
          Object.entries(validation.fieldErrors).map(([k, v]) => [k, t(v!)])
        ) as Partial<Record<JobAddressUpdateField, string>>
      );
      return;
    }

    // The ids and coordinates are non-null once validated.
    const payload = buildUpdateJobAddressRequest({
      ...values,
      countryId: cascade.countryId!,
      countyId: cascade.countyId!,
      cityId: cascade.cityId!,
      latitude: latitude!,
      longitude: longitude!,
    });

    inFlight.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const { data: updatedAddress } = await authApi.updateJobAddress(job.id, payload);
      // The 200 body IS the address object — adopt it directly. The job's address in
      // app state now comes from the server's response, never from the values typed
      // on this screen (which may have reformatted numbers, etc.).
      invalidateJobList();
      applyJob({ ...job, address: updatedAddress });
      setSubmitting(false);
      showAlert({
        title: t('addr_u_success_title'),
        message: t('addr_u_success_msg'),
        icon: 'check-circle',
        buttons: [{ text: t('post_view_job'), onPress: () => router.back() }],
      });
      // Reconcile anything else the server recalculated as a side effect (status,
      // history, flags) without blocking the confirmation.
      void refetch();
    } catch (err: any) {
      setSubmitting(false);
      const status: number | undefined = err?.response?.status;
      const backendMessage = firstErrorMessage(err?.response?.data);

      if (status === 401) {
        showAlert({
          title: t('addr_u_err_session'),
          message: t('addr_u_err_session'),
          icon: 'lock',
        });
        router.replace('/(auth)/login' as any);
      } else if (status === 422) {
        const mapped = mapJobAddressUpdateErrors(err?.response?.data?.detail);
        setFieldErrors(mapped.fieldErrors);
        setFormError(mapped.formErrors[0] ?? null);
      } else if (status === 404) {
        // Address (or job) not found — if the address is gone, the job no longer has
        // one to edit; route back and let Job Details decide how to surface it.
        setFormError(backendMessage ?? t('jobaddr_update_exists'));
      } else {
        setFormError(backendMessage ?? t('addr_u_err_network'));
      }
      // The job may have changed underneath us; re-read it so the screen reflects the
      // truth (is_editable may have flipped, or the address may have been removed).
      void refetch();
    } finally {
      inFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    job,
    submitting,
    cascade,
    latitude,
    longitude,
    houseNumber,
    streetAddress,
    postalCode,
    landmark,
    formattedAddress,
    showAlert,
    t,
    router,
    refetch,
  ]);

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
        {header(t('jobaddr_update_title'))}
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

  if (jobStatus === 'idle' || jobStatus === 'loading') {
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
        {header(t('jobaddr_update_title'))}
        <View style={styles.stateWrap}>
          <Feather
            name={unavailable ? 'slash' : 'alert-circle'}
            size={28}
            color={c.destructive}
          />
          <Text style={[styles.stateTitle, { color: c.text }]}>
            {unavailable ? t('jobd_unavailable_title') : t('jobd_load_error')}
          </Text>
          <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
            {unavailable
              ? serverMessage ?? t('jobd_unavailable_msg')
              : t('jobd_load_error_sub')}
          </Text>
          <TouchableOpacity style={[styles.stateBtn, { backgroundColor: c.primary }]} onPress={retry}>
            <Text style={[styles.stateBtnText, { color: c.primaryForeground }]}>{t('jobs_retry')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Edit-only: if the job is not editable, or has no address to edit, there is nothing
  // to do here — send the user back to the job.
  if (!canUpdateJobAddress(job)) {
    const missing = !job.address;
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        {header(t('jobaddr_update_title'))}
        <View style={styles.stateWrap}>
          <Feather name={missing ? 'map-pin' : 'lock'} size={28} color={c.destructive} />
          <Text style={[styles.stateTitle, { color: c.text }]}>
            {missing ? t('jobaddr_update_exists') : t('editjob_not_editable_title')}
          </Text>
          <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
            {missing
              ? t('jobaddr_update_exists_msg')
              : t('editjob_not_editable_msg')}
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

  // This screen reuses the existing addr_c_* picker/text labels — only the title and
  // the coordinate-specific keys are new.
  const pickerRow = (
    field: JobAddressUpdateField,
    labelKey: string,
    value: string | null,
    disabled: boolean,
    onPress: () => void
  ) => (
    <View style={styles.fieldWrap}>
      <Text style={[styles.label, { color: c.text }]}>{t(labelKey as any)}</Text>
      <TouchableOpacity
        style={[
          styles.input,
          styles.pickerInput,
          {
            backgroundColor: c.input,
            borderColor: fieldErrors[field] ? c.destructive : c.border,
          },
        ]}
        onPress={onPress}
        disabled={disabled}
      >
        <Text
          style={[
            styles.pickerText,
            { color: value ? c.text : c.mutedForeground },
            disabled && styles.pickerTextDisabled,
          ]}
          numberOfLines={1}
        >
          {value ?? t('addr_c_pick')}
        </Text>
        <Feather name="chevron-down" size={16} color={c.mutedForeground} />
      </TouchableOpacity>
      {fieldErrors[field] ? (
        <Text style={[styles.error, { color: c.destructive }]}>{fieldErrors[field]}</Text>
      ) : null}
    </View>
  );

  const textField = (
    field: JobAddressUpdateField,
    labelKey: string,
    value: string,
    onChange: (v: string) => void,
    numeric = false
  ) => (
    <View style={styles.fieldWrap}>
      <Text style={[styles.label, { color: c.text }]}>{t(labelKey as any)}</Text>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: c.input,
            color: c.text,
            borderColor: fieldErrors[field] ? c.destructive : c.border,
          },
        ]}
        placeholder={t('addr_c_placeholder')}
        placeholderTextColor={c.mutedForeground}
        value={value}
        onChangeText={(v) => {
          onChange(v);
          clearError(field);
        }}
        keyboardType={numeric ? 'number-pad' : 'default'}
      />
      {fieldErrors[field] ? (
        <Text style={[styles.error, { color: c.destructive }]}>{fieldErrors[field]}</Text>
      ) : null}
    </View>
  );

  // Coordinate inputs (map-picker aware). On prefill these are parsed from the cached
  // strings; a real map picker would set these directly. Editing them also recomputes
  // formatted_address when the user hasn't supplied their own.
  const coordinateText = (
    field: JobAddressUpdateField,
    labelKey: string,
    value: number | null,
    onChange: (v: number | null) => void,
    kind: 'lat' | 'lng'
  ) => (
    <View style={styles.fieldWrap}>
      <Text style={[styles.label, { color: c.text }]}>{t(labelKey as any)}</Text>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: c.input,
            color: c.text,
            borderColor: fieldErrors[field] ? c.destructive : c.border,
          },
        ]}
        placeholder={t('addr_c_placeholder')}
        placeholderTextColor={c.mutedForeground}
        value={value == null ? '' : String(value)}
        onChangeText={(raw) => {
          const trimmed = raw.trim();
          if (trimmed === '') {
            onChange(null);
            clearError(field);
            return;
          }
          const n = Number(trimmed);
          if (!Number.isFinite(n)) {
            onChange(null);
            setFieldErrors((prev) => ({ ...prev, [field]: t('addr_u_invalid_coords') }));
            return;
          }
          // Enforce the same bounds as parseCoordinate so the form is consistent with
          // the cached value rules.
          const limit = kind === 'lat' ? 90 : 180;
          if (Math.abs(n) > limit) {
            onChange(null);
            setFieldErrors((prev) => ({ ...prev, [field]: t('addr_u_invalid_coords') }));
            return;
          }
          onChange(n);
          clearError(field);
          // Keep formatted_address consistent with the text the user is typing, unless
          // they wrote their own.
          recomputeFormatted(streetAddress, houseNumber, postalCode);
        }}
        keyboardType="decimal-pad"
      />
      {fieldErrors[field] ? (
        <Text style={[styles.error, { color: c.destructive }]}>{fieldErrors[field]}</Text>
      ) : null}
      <Text style={[styles.hint, { color: c.mutedForeground }]}>
        {kind === 'lat'
          ? 'Between -90 and 90'
          : 'Between -180 and 180'}
      </Text>
    </View>
  );

  // The picker's data source follows which level is open.
  const pickerSource: AddressRegionResponse[] | null =
    pickerOpen === 'country'
      ? countries
      : pickerOpen === 'county'
        ? counties
        : pickerOpen === 'city'
          ? cities
          : null;
  const pickerLoading =
    pickerOpen === 'country'
      ? countriesStatus === 'loading'
      : pickerOpen === 'county'
        ? countiesStatus === 'loading'
        : false;
  const selectedId =
    pickerOpen === 'country'
      ? cascade.countryId
      : pickerOpen === 'county'
        ? cascade.countyId
        : cascade.cityId;

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      {header(t('jobaddr_update_title'))}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {formError ? (
          <View style={[styles.banner, { backgroundColor: c.card, borderColor: c.destructive }]}>
            <Feather name="alert-triangle" size={14} color={c.destructive} />
            <Text style={[styles.bannerText, { color: c.text }]}>{formError}</Text>
          </View>
        ) : null}

        {/* country → county → city, each child cleared when its parent changes */}
        {pickerRow('country_id', 'addr_c_country', country?.name ?? null, false, () =>
          setPickerOpen('country')
        )}
        {countriesStatus === 'error' ? (
          <TouchableOpacity onPress={() => void refreshCountries()}>
            <Text style={[styles.error, { color: c.destructive }]}>{t('addr_c_err_geo')}</Text>
          </TouchableOpacity>
        ) : null}

        {pickerRow(
          'county_id',
          'addr_c_county',
          county?.name ?? null,
          !cascade.countryId,
          () => setPickerOpen('county')
        )}
        {pickerRow(
          'city_id',
          'addr_c_city',
          city?.name ?? null,
          !cascade.countyId,
          () => setPickerOpen('city')
        )}

        {/* Map-picker-aware coordinates — numbers on the wire; parsed from cached strings
            on prefill. */}
        {coordinateText('latitude', 'addr_u_lat', latitude, setLatitude, 'lat')}
        {coordinateText('longitude', 'addr_u_lng', longitude, setLongitude, 'lng')}
        <Text style={[styles.hint, { color: c.mutedForeground }]}>{t('addr_u_map_pin')}</Text>

        {textField('house_number', 'addr_c_house', houseNumber, setHouseNumber, true)}
        {textField('street_address', 'addr_c_street', streetAddress, setStreetAddress)}
        {textField('postal_code', 'addr_c_postal', postalCode, setPostalCode, true)}
        {textField('landmark', 'addr_c_landmark', landmark, setLandmark)}

        <View style={styles.fieldWrap}>
          <Text style={[styles.label, { color: c.text }]}>{t('addr_c_formatted')}</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: c.input,
                color: c.text,
                borderColor: fieldErrors.formatted_address ? c.destructive : c.border,
              },
            ]}
            placeholder={t('addr_c_placeholder')}
            placeholderTextColor={c.mutedForeground}
            value={formattedAddress}
            onChangeText={(v) => {
              setFormattedAddress(v);
              setFormattedTouched(true);
              clearError('formatted_address');
            }}
          />
          {fieldErrors.formatted_address ? (
            <Text style={[styles.error, { color: c.destructive }]}>{fieldErrors.formatted_address}</Text>
          ) : null}
        </View>
        <Text style={[styles.hint, { color: c.mutedForeground }]}>
          {t('addr_c_formatted_hint')}
        </Text>

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
            {submitting ? t('editjob_saving') : t('addr_u_save')}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* One modal, three levels — the same pattern the Post-a-Job screen uses */}
      <Modal
        visible={pickerOpen !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerOpen(null)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[styles.modalSheet, { backgroundColor: c.card, borderColor: c.border }]}
          >
            <View style={[styles.modalHead, { borderBottomColor: c.border }]}>
              <Text style={[styles.modalTitle, { color: c.text }]}>
                {t(
                  pickerOpen === 'country'
                    ? 'addr_c_country'
                    : pickerOpen === 'county'
                      ? 'addr_c_county'
                      : 'addr_c_city'
                ) as any}
              </Text>
              <TouchableOpacity onPress={() => setPickerOpen(null)} hitSlop={8}>
                <Feather name="x" size={20} color={c.text} />
              </TouchableOpacity>
            </View>

            {pickerLoading ? (
              <View style={styles.modalState}>
                <ActivityIndicator color={c.primary} />
              </View>
            ) : !pickerSource || pickerSource.length === 0 ? (
              <View style={styles.modalState}>
                <Text style={[styles.bannerText, { color: c.mutedForeground }]}>
                  {t('addr_c_geo_empty')}
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.modalList}>
                {pickerSource.map((option) => {
                  const active = selectedId === option.id;
                  return (
                    <TouchableOpacity
                      key={option.id}
                      style={[styles.optionRow, { borderBottomColor: c.border }]}
                      onPress={() => {
                        if (pickerOpen === 'country') handleCountry(option.id);
                        else if (pickerOpen === 'county') handleCounty(option.id);
                        else handleCity(option.id);
                        setPickerOpen(null);
                      }}
                    >
                      <Text style={[styles.optionText, { color: c.text }]}>{option.name}</Text>
                      {active ? <Feather name="check" size={16} color={c.primary} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
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
  fieldWrap: { marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
  },
  pickerInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerText: { fontFamily: 'Manrope_400Regular', fontSize: 14, flex: 1 },
  pickerTextDisabled: { opacity: 0.5 },
  error: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 4 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 6, lineHeight: 16 },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  bannerText: { fontFamily: 'Manrope_400Regular', fontSize: 12, flex: 1, lineHeight: 18 },
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
  stateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  stateTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16, textAlign: 'center' },
  stateSub: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  stateBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  stateBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    maxHeight: '78%',
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  modalTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  modalList: { maxHeight: 380 },
  modalState: { padding: 32, alignItems: 'center', gap: 10 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  optionText: { fontFamily: 'Manrope_500Medium', fontSize: 14 },
});