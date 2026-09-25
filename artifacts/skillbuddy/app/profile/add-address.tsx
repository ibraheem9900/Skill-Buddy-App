import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import useAddresses from '@/hooks/useAddresses';
import useCountries from '@/hooks/useCountries';
import { authApi } from '@/services/api';
import type { AddressCountryResponse, AddressRegionResponse } from '@/types';

/**
 * Add Address (POST /api/v1/addresses) — form screen.
 *
 * REQUEST BODY (live OpenAPI AddressCreate): EVERY field is optional
 * server-side (no required[] — latitude/longitude accept number | numeric
 * string | null; is_default defaults false). Client-side minimum: the
 * country/county/city cascade + street_address (an address without them is
 * unusable for booking); house_number/postal_code/landmark/formatted_address
 * stay optional. latitude/longitude are OMITTED (not zero-filled): the app
 * has no GPS/map UI yet and fake 0,0 coordinates would be worse than none.
 *
 * PICKER IDS: country_id/county_id/city_id are numeric ids fetched live from
 * the PUBLIC geo endpoints (GET /api/v1/countries/ → /countries/{id}/counties
 * → /counties/{id}/cities; verified Estonia=1 → Harju=1 → Tallinn=1). No
 * hardcoded lists — they would drift from real backend ids.
 *
 * SUBMISSION: goes through the shared authApi axios instance (Bearer
 * auto-attached + silent refresh on 401) — never a raw fetch. 422
 * detail[].loc (last element) maps 1:1 onto the form's field keys for inline
 * errors; offline/network errors keep every entered value (nothing is reset
 * except on success). On the 201 the SERVER-returned AddressResponse is
 * seeded into the useAddresses cache (source of truth) and we navigate back
 * — the list screen shows the new address immediately without a refetch.
 * If is_default moved server-side, the next full refetch reflects it (no
 * client-side patching of other addresses).
 */
export default function AddAddressScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { create } = useAddresses();

  // ── Form state (never reset on failure — only on success) ──────────────
  const [countryId, setCountryId] = useState<number | null>(null);
  const [countyId, setCountyId] = useState<number | null>(null);
  const [cityId, setCityId] = useState<number | null>(null);
  const [houseNumber, setHouseNumber] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [landmark, setLandmark] = useState('');
  const [formattedAddress, setFormattedAddress] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // ── Geo picker data (live PUBLIC endpoints — no hardcoded ids) ─────────
  // Countries come from the SHARED session cache (useCountries — fetched
  // once per session across all screens); counties/cities stay per-screen.
  const { status: countriesStatus, countries, load: loadCountries, refresh: refreshCountries } = useCountries();
  const [geoSearch, setGeoSearch] = useState('');
  const [counties, setCounties] = useState<AddressRegionResponse[] | null>(null);
  const [countiesLoading, setCountiesLoading] = useState(false);
  const [countiesError, setCountiesError] = useState(false);
  const [cities, setCities] = useState<AddressRegionResponse[] | null>(null);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [citiesError, setCitiesError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<'country' | 'county' | 'city' | null>(null);

  // Clear the modal's search whenever a picker opens/closes.
  useEffect(() => {
    setGeoSearch('');
  }, [pickerOpen]);

  const country = countries?.find((x) => x.id === countryId) ?? null;
  const county = counties?.find((x) => x.id === countyId) ?? null;
  const city = cities?.find((x) => x.id === cityId) ?? null;

  // Fetch once per session; the hook's module cache makes repeat screens
  // and modal opens free. No auto-refetch while ready.
  useEffect(() => {
    void loadCountries();
  }, [loadCountries]);

  /** Counties load eagerly when a country is picked (picker ready on open). */
  const handleCountry = (id: number) => {
    setCountryId(id);
    setCountyId(null);
    setCityId(null);
    setCounties(null);
    setCities(null);
    setCountiesError(false);
    setCitiesError(false);
    clearError('country_id');
    clearError('county_id');
    clearError('city_id');
    setPickerOpen(null);
    (async () => {
      setCountiesLoading(true);
      try {
        const { data } = await authApi.getCounties(id);
        setCounties(data);
      } catch {
        setCountiesError(true);
      } finally {
        setCountiesLoading(false);
      }
    })();
  };

  const handleCounty = (id: number) => {
    setCountyId(id);
    setCityId(null);
    setCities(null);
    setCitiesError(false);
    clearError('county_id');
    clearError('city_id');
    setPickerOpen(null);
    (async () => {
      setCitiesLoading(true);
      try {
        const { data } = await authApi.getCities(id);
        setCities(data);
      } catch {
        setCitiesError(true);
      } finally {
        setCitiesLoading(false);
      }
    })();
  };

  const handleCity = (id: number) => {
    setCityId(id);
    clearError('city_id');
    setPickerOpen(null);
  };

  const clearError = (field: string) =>
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  const fieldBorder = (field: string) => {
    if (fieldErrors[field]) return c.destructive;
    return focusedField === field ? c.primary : c.border;
  };

  const renderFieldError = (field: string) =>
    fieldErrors[field] ? (
      <Text style={[styles.fieldError, { color: c.destructive }]}>{fieldErrors[field]}</Text>
    ) : null;

  const textField = (
    keyName: 'house_number' | 'street_address' | 'postal_code' | 'landmark' | 'formatted_address',
    labelKey: Parameters<typeof t>[0],
    value: string,
    setter: (v: string) => void,
    opts?: { multiline?: boolean; numeric?: boolean },
  ) => (
    <View style={styles.fieldWrap}>
      <Text style={[styles.label, { color: c.text }]}>{t(labelKey)}</Text>
      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: c.input,
            borderColor: fieldBorder(keyName),
            borderWidth: focusedField === keyName || fieldErrors[keyName] ? 1.5 : 1,
            minHeight: opts?.multiline ? 72 : undefined,
            alignItems: opts?.multiline ? 'flex-start' : 'center',
          },
        ]}
      >
        <TextInput
          style={[styles.input, { color: c.text, textAlignVertical: opts?.multiline ? 'top' : 'center' }]}
          placeholder={t('addr_c_placeholder')}
          placeholderTextColor={c.mutedForeground}
          value={value}
          onChangeText={(v) => {
            setter(v);
            clearError(keyName);
          }}
          onFocus={() => setFocusedField(keyName)}
          onBlur={() => setFocusedField(null)}
          multiline={opts?.multiline}
          keyboardType={opts?.numeric ? 'numeric' : 'default'}
          autoCapitalize="none"
          editable={!loading}
        />
      </View>
      {renderFieldError(keyName)}
    </View>
  );

  /** Picker row (label + selected value or placeholder + chevron). */
  const pickerRow = (
    keyName: 'country_id' | 'county_id' | 'city_id',
    labelKey: Parameters<typeof t>[0],
    selectedName: string | null,
    disabled: boolean,
    onPress: () => void,
  ) => (
    <View style={styles.fieldWrap}>
      <Text style={[styles.label, { color: c.text }]}>{t(labelKey)}</Text>
      <TouchableOpacity
        style={[
          styles.pickerRow,
          { backgroundColor: c.input, borderColor: fieldBorder(keyName), borderWidth: fieldErrors[keyName] ? 1.5 : 1, opacity: disabled ? 0.55 : 1 },
        ]}
        onPress={onPress}
        disabled={disabled || loading}
        accessibilityLabel={t(labelKey)}
      >
        <Text
          style={[styles.pickerText, { color: selectedName ? c.text : c.mutedForeground }]}
          numberOfLines={1}
        >
          {selectedName ?? t('addr_c_pick')}
        </Text>
        <Feather name="chevron-down" size={18} color={c.mutedForeground} />
      </TouchableOpacity>
      {renderFieldError(keyName)}
    </View>
  );

  /** Body builder — trims strings, empty → null; ids null when unselected;
   * lat/lng OMITTED (no GPS/map source in the app — see doc comment). */
  const buildPayload = () => {
    const trim = (s: string) => {
      const v = s.trim();
      return v.length ? v : null;
    };
    const composedStreet = [trim(houseNumber), trim(streetAddress)].filter(Boolean).join(' ');
    const composed = [
      composedStreet || null,
      city?.name ?? null,
      county?.name ?? null,
      country?.name ?? null,
    ]
      .filter(Boolean)
      .join(', ');
    return {
      country_id: countryId,
      county_id: countyId,
      city_id: cityId,
      house_number: trim(houseNumber),
      street_address: trim(streetAddress),
      postal_code: trim(postalCode),
      landmark: trim(landmark),
      formatted_address: trim(formattedAddress) ?? (composed || null),
      is_default: isDefault,
    };
  };

  const handleSubmit = async () => {
    if (loading) return; // double-tap guard
    setFormError(null);

    // ── Client-side validation ────────────────────────────────────────────
    // Server accepts everything optional (schema has no required[]) — this
    // minimum is a product decision: cascade + street make the address
    // usable for bookings; everything else stays optional.
    const errors: Record<string, string> = {};
    if (countryId == null) errors.country_id = t('addr_c_err_required');
    if (countyId == null) errors.county_id = t('addr_c_err_required');
    if (cityId == null) errors.city_id = t('addr_c_err_required');
    if (!streetAddress.trim()) errors.street_address = t('addr_c_err_required');
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }

    setLoading(true);
    setFieldErrors({});
    try {
      await create(buildPayload());
      // 201 — the server-returned address is already in the shared cache;
      // back to the list, which renders it immediately.
      Alert.alert(t('addr_c_success_title'), t('addr_c_success_msg'));
      router.back();
    } catch (err: any) {
      const status = err?.response?.status;
      if (!err?.response) {
        // Offline / timeout / no connection — input is preserved.
        setFormError(t('addr_c_err_network'));
      } else if (status === 401) {
        // Silent refresh already ran and failed — session is over.
        setFormError(t('addr_c_err_session'));
      } else if (status === 422) {
        // detail[].loc last element === this form's field keys 1:1.
        const detail = err.response.data?.detail;
        const fields: Record<string, string> = {};
        let general: string | null = null;
        if (Array.isArray(detail)) {
          for (const d of detail) {
            const field = Array.isArray(d?.loc) ? String(d.loc[d.loc.length - 1]) : null;
            const msg = typeof d?.msg === 'string' ? d.msg : '';
            const clean = msg.startsWith('Value error, ') ? msg.slice('Value error, '.length) : msg;
            if (
              field === 'country_id' ||
              field === 'county_id' ||
              field === 'city_id' ||
              field === 'house_number' ||
              field === 'street_address' ||
              field === 'postal_code' ||
              field === 'landmark' ||
              field === 'formatted_address' ||
              field === 'latitude' ||
              field === 'longitude' ||
              field === 'is_default'
            ) {
              fields[field] = clean || t('addr_c_err_generic');
            } else {
              general = clean || general || t('addr_c_err_generic');
            }
          }
        } else if (typeof detail === 'string') {
          general = detail;
        }
        if (Object.keys(fields).length) setFieldErrors(fields);
        if (general && !Object.keys(fields).length) setFormError(general);
      } else {
        setFormError(t('addr_c_err_generic'));
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Geo option list inside the modal ────────────────────────────────────
  const pickerModal = () => {
    if (!pickerOpen) return null;
    const isCountry = pickerOpen === 'country';
    const source: (AddressCountryResponse | AddressRegionResponse)[] | null = isCountry
      ? countries
      : pickerOpen === 'county'
        ? counties
        : cities;
    const loadingNow = isCountry ? countriesStatus === 'loading' : pickerOpen === 'county' ? countiesLoading : citiesLoading;
    const errorNow = isCountry ? countriesStatus === 'error' : pickerOpen === 'county' ? countiesError : citiesError;
    // Search/filter inside the modal — countries lists can be long.
    const q = geoSearch.trim().toLowerCase();
    const opts = source?.filter((o) => !q || o.name.toLowerCase().includes(q)) ?? null;
    // Id-based retries: the derived country/county objects can be null
    // when their source list failed to load — the picked id is always
    // enough to refetch the failing level.
    const retry = isCountry
      ? refreshCountries
      : pickerOpen === 'county'
        ? () => countryId != null && handleCountry(countryId)
        : () => countyId != null && handleCounty(countyId);
    const selectedId = pickerOpen === 'country' ? countryId : pickerOpen === 'county' ? countyId : cityId;
    const titleKey = pickerOpen === 'country' ? 'addr_c_country' : pickerOpen === 'county' ? 'addr_c_county' : 'addr_c_city';

    return (
      <Modal visible transparent animationType="slide" onRequestClose={() => setPickerOpen(null)}>
        <Pressable style={[styles.modalBackdrop, { backgroundColor: 'rgba(0,0,0,0.45)' }]} onPress={() => setPickerOpen(null)}>
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
                {geoSearch ? (
                  <TouchableOpacity onPress={() => setGeoSearch('')} hitSlop={8}>
                    <Feather name="x-circle" size={15} color={c.mutedForeground} />
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
            {loadingNow ? (
              <View style={styles.modalState}>
                <ActivityIndicator size="small" color={c.primary} />
              </View>
            ) : errorNow ? (
              <View style={styles.modalState}>
                <Feather name="wifi-off" size={20} color={c.destructive} />
                <TouchableOpacity onPress={() => void retry()}>
                  <Text style={[styles.modalRetry, { color: c.primary }]}>{t('addr_retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={opts ?? []}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.modalRow, { borderBottomColor: c.border }]}
                    onPress={() =>
                      pickerOpen === 'country'
                        ? handleCountry(item.id)
                        : pickerOpen === 'county'
                          ? handleCounty(item.id)
                          : handleCity(item.id)
                    }
                  >
                    <Text style={[styles.modalRowText, { color: c.text }]}>{item.name}</Text>
                    {selectedId === item.id && <Feather name="check" size={18} color={c.primary} />}
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={[styles.modalEmpty, { color: c.mutedForeground }]}>
                    {source && source.length === 0 ? t('addr_c_geo_empty') : t('geo_no_match')}
                  </Text>
                }
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('addr_c_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={60}
        style={{ flex: 1 }}
      >
        {pickerRow('country_id', 'addr_c_country', country?.name ?? null, !countries || countriesStatus === 'loading', () => setPickerOpen('country'))}
        {countiesLoading ? (
          <ActivityIndicator size="small" color={c.primary} style={styles.cascadeLoader} />
        ) : countiesError ? (
          <TouchableOpacity onPress={() => countryId != null && handleCountry(countryId)}>
            <Text style={[styles.geoError, { color: c.destructive }]}>{t('addr_c_err_geo')}</Text>
          </TouchableOpacity>
        ) : null}
        {pickerRow('county_id', 'addr_c_county', county?.name ?? null, !countryId || countiesLoading, () => setPickerOpen('county'))}
        {citiesLoading ? (
          <ActivityIndicator size="small" color={c.primary} style={styles.cascadeLoader} />          ) : citiesError ? (
            <TouchableOpacity onPress={() => countyId != null && handleCounty(countyId)}>
              <Text style={[styles.geoError, { color: c.destructive }]}>{t('addr_c_err_geo')}</Text>
            </TouchableOpacity>
        ) : null}
        {pickerRow('city_id', 'addr_c_city', city?.name ?? null, !countyId || citiesLoading, () => setPickerOpen('city'))}

        {textField('house_number', 'addr_c_house', houseNumber, setHouseNumber)}
        {textField('street_address', 'addr_c_street', streetAddress, setStreetAddress)}
        {textField('postal_code', 'addr_c_postal', postalCode, setPostalCode, { numeric: true })}
        {textField('landmark', 'addr_c_landmark', landmark, setLandmark)}
        {textField('formatted_address', 'addr_c_formatted', formattedAddress, setFormattedAddress, { multiline: true })}

        <View style={[styles.defaultRow, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.defaultTextWrap}>
            <Text style={[styles.defaultLabel, { color: c.text }]}>{t('addr_c_default')}</Text>
            <Text style={[styles.defaultHint, { color: c.mutedForeground }]}>{t('addr_c_default_hint')}</Text>
          </View>
          <Switch value={isDefault} onValueChange={setIsDefault} trackColor={{ true: c.primary }} disabled={loading} />
        </View>

        {formError ? (
          <View style={[styles.formError, { backgroundColor: c.card, borderColor: c.destructive }]}>
            <Feather name="alert-circle" size={16} color={c.destructive} />
            <Text style={[styles.formErrorText, { color: c.destructive }]}>{formError}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: c.primary, opacity: loading ? 0.6 : 1 }]}
          onPress={() => void handleSubmit()}
          disabled={loading}
          accessibilityLabel={t('addr_c_save')}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text style={styles.submitText}>{t('addr_c_save')}</Text>
          )}
        </TouchableOpacity>
      </KeyboardAwareScrollViewCompat>
      {pickerModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  fieldWrap: { marginBottom: 14 },
  label: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, marginBottom: 6 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  input: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, paddingVertical: 10 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  pickerText: { fontFamily: 'Manrope_400Regular', fontSize: 14, flex: 1, marginRight: 8 },
  fieldError: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 4 },
  cascadeLoader: { marginTop: -8, marginBottom: 8 },
  geoError: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: -6, marginBottom: 10 },
  defaultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
    marginBottom: 14,
  },
  defaultTextWrap: { flex: 1, marginRight: 12 },
  defaultLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  defaultHint: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2 },
  formError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  formErrorText: { fontFamily: 'Manrope_400Regular', fontSize: 12, flex: 1 },
  submitBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontFamily: 'Manrope_700Bold', fontSize: 15, color: '#FFF' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    maxHeight: '70%',
    paddingBottom: 20,
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  modalTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  searchInput: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, paddingVertical: 4 },
  modalState: { alignItems: 'center', gap: 8, paddingVertical: 36 },
  modalRetry: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  modalRowText: { fontFamily: 'Manrope_400Regular', fontSize: 15, flex: 1 },
  modalEmpty: { textAlign: 'center', fontFamily: 'Manrope_400Regular', fontSize: 13, paddingVertical: 24 },
});
