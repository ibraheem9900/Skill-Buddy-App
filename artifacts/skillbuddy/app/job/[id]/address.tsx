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
import {
  buildCreateJobAddressRequest,
  canAddJobAddress,
  jobHasAddress,
  mapJobAddressErrors,
  selectCity,
  selectCountry,
  selectCounty,
  validateJobAddress,
  type GeoCascade,
  type JobAddressField,
} from '@/lib/jobAddress';
import type { AddressRegionResponse } from '@/types';

/**
 * Add Job Address — POST /api/v1/jobs/{job_id}/address (schema JobAddressCreate).
 *
 * Reached from Job Details when the loaded job reports NO address and is
 * editable. The country → county → city cascade reuses the SAME public
 * endpoints (and hooks) as the Post-a-Job and Add-Address screens, and each
 * parent selection clears its children so a stale id can never be submitted.
 *
 * CREATE-ONLY: this screen never edits an existing address (that is
 * PATCH /jobs/{job_id}/address, a separate task), so it refuses to POST when
 * the job already has one — it says so and sends the user back.
 *
 * latitude/longitude are omitted: this app has no map picker and never
 * captures coordinates, and the schema allows their absence.
 */
export default function AddJobAddressScreen() {
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

  const [cascade, setCascade] = useState<GeoCascade>({
    countryId: null,
    countyId: null,
    cityId: null,
  });
  const [houseNumber, setHouseNumber] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [landmark, setLandmark] = useState('');
  const [formattedAddress, setFormattedAddress] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<JobAddressField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<'country' | 'county' | 'city' | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    void loadCountries();
  }, [loadCountries]);

  const clearError = (field: JobAddressField) => {
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

  // Each parent selection resets its children (pure rule in lib/jobAddress) and
  // loads the next list.
  const handleCountry = useCallback(
    (countryId: number) => {
      setCascade((prev) => selectCountry(prev, countryId));
      clearError('country_id');
      clearError('county_id');
      clearError('city_id');
      void loadForCountry(countryId);
    },
    // clearError is stable (setState only)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadForCountry]
  );

  const handleCounty = useCallback(
    (countyId: number) => {
      setCascade((prev) => selectCounty(prev, countyId));
      clearError('county_id');
      clearError('city_id');
      void loadForCounty(countyId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadForCounty]
  );

  const handleCity = useCallback((cityId: number) => {
    setCascade((prev) => selectCity(prev, cityId));
    clearError('city_id');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useCallback(async () => {
    if (!job || submitting || inFlight.current) return;

    const values = {
      ...cascade,
      houseNumber,
      streetAddress,
      postalCode,
      landmark,
      formattedAddress,
    };

    const validation = validateJobAddress(values);
    if (!validation.ok) {
      setFieldErrors(
        Object.fromEntries(
          Object.entries(validation.fieldErrors).map(([k, v]) => [k, t(v!)])
        ) as Partial<Record<JobAddressField, string>>
      );
      return;
    }

    // The ids are non-null once validated.
    const payload = buildCreateJobAddressRequest({
      ...values,
      countryId: cascade.countryId!,
      countyId: cascade.countyId!,
      cityId: cascade.cityId!,
    });

    inFlight.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const { data: createdAddress } = await authApi.createJobAddress(job.id, payload);
      // The 201 body IS the address object, so it is adopted directly — the
      // address in app state comes from the server's response, never from the
      // values typed on this screen.
      invalidateJobList();
      applyJob({ ...job, address: createdAddress });
      setSubmitting(false);
      showAlert({
        title: t('addr_c_success_title'),
        message: t('addr_c_success_msg'),
        icon: 'check-circle',
        buttons: [{ text: t('post_view_job'), onPress: () => router.back() }],
      });
      // Reconcile anything else the server recalculated as a side effect
      // (status, history, flags) without blocking the confirmation.
      void refetch();
    } catch (err: any) {
      setSubmitting(false);
      const status: number | undefined = err?.response?.status;
      const backendMessage = firstErrorMessage(err?.response?.data);

      if (status === 401) {
        showAlert({
          title: t('post_err_session_title'),
          message: t('post_err_session_msg'),
          icon: 'lock',
        });
        router.replace('/(auth)/login' as any);
      } else if (status === 422) {
        const mapped = mapJobAddressErrors(err?.response?.data?.detail);
        setFieldErrors(mapped.fieldErrors);
        setFormError(mapped.formErrors[0] ?? null);
      } else if (status === 404) {
        setFormError(backendMessage ?? t('pub_err_notfound'));
      } else if (status === 409 || status === 400) {
        // Most likely "this job already has an address" — it cannot be created
        // twice, and editing belongs to a different endpoint.
        setFormError(backendMessage ?? t('jobaddr_exists'));
      } else {
        setFormError(backendMessage ?? t('addr_c_err_network'));
      }
      // The job may have changed underneath us (assigned / cancelled / already
      // given an address); re-read it so the screen reflects the truth.
      void refetch();
    } finally {
      inFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, submitting, cascade, houseNumber, streetAddress, postalCode, landmark, formattedAddress, showAlert, t, router, refetch]);

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
        {header(t('jobaddr_title'))}
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
        {header(t('jobaddr_title'))}
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
        </View>
      </View>
    );
  }

  // Already has an address, or is not editable: this endpoint is create-only,
  // so there is nothing to do here. Send the user back to the job.
  if (!canAddJobAddress(job)) {
    const existing = jobHasAddress(job);
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        {header(t('jobaddr_title'))}
        <View style={styles.stateWrap}>
          <Feather name={existing ? 'map-pin' : 'lock'} size={28} color={c.destructive} />
          <Text style={[styles.stateTitle, { color: c.text }]}>
            {existing ? t('jobaddr_exists') : t('editjob_not_editable_title')}
          </Text>
          <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
            {existing ? t('jobaddr_exists_msg') : t('editjob_not_editable_msg')}
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

  const pickerRow = (
    field: JobAddressField,
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
          { backgroundColor: c.input, borderColor: fieldErrors[field] ? c.destructive : c.border },
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
    field: JobAddressField,
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
          { backgroundColor: c.input, color: c.text, borderColor: fieldErrors[field] ? c.destructive : c.border },
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

  // The picker's data source follows which level is open.
  const pickerSource: AddressRegionResponse[] | null =
    pickerOpen === 'country'
      ? (countries ?? null)
      : pickerOpen === 'county'
        ? (counties ?? null)
        : pickerOpen === 'city'
          ? (cities ?? null)
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
      {header(t('jobaddr_title'))}

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

        {textField('house_number', 'addr_c_house', houseNumber, setHouseNumber)}
        {textField('street_address', 'addr_c_street', streetAddress, setStreetAddress)}
        {textField('postal_code', 'addr_c_postal', postalCode, setPostalCode, true)}
        {textField('landmark', 'addr_c_landmark', landmark, setLandmark)}
        {textField(
          'formatted_address',
          'addr_c_formatted',
          formattedAddress,
          setFormattedAddress
        )}
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
          {submitting ? <ActivityIndicator size="small" color={c.primaryForeground} /> : null}
          <Text style={[styles.submitText, { color: c.primaryForeground }]}>
            {submitting ? t('editjob_saving') : t('addr_c_save')}
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
          <View style={[styles.modalSheet, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={[styles.modalHead, { borderBottomColor: c.border }]}>
              <Text style={[styles.modalTitle, { color: c.text }]}>
                {t(
                  (pickerOpen === 'country'
                    ? 'addr_c_country'
                    : pickerOpen === 'county'
                      ? 'addr_c_county'
                      : 'addr_c_city') as any
                )}
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
  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
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
  modalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, maxHeight: '78%' },
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
