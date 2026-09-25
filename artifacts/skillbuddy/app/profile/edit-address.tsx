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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import useAddresses from '@/hooks/useAddresses';
import useCountries from '@/hooks/useCountries';
import { authApi } from '@/services/api';
import type { AddressResponse, AddressCountryResponse, AddressRegionResponse } from '@/types';

/**
 * Edit Address (PUT /api/v1/addresses/{address_id}) — form screen.
 *
 * PREFILL: the address is loaded CACHE-FIRST (cached GET /api/v1/addresses
 * entry when the id matches, else the Bearer-protected GET-by-id fallback)
 * and the form is hydrated with nested objects mapped back to their ids
 * (country.id → country_id, county.id → county_id, city.id → city_id —
 * exactly what the PUT body needs). Counties/cities lists are prefetched
 * for the pre-selected ids so the cascade pickers open ready.
 *
 * PUT SEMANTICS (full replace): the request sends the COMPLETE
 * AddressUpdate object — every field explicit, null where no usable value
 * exists (latitude/longitude are null: the app has no GPS/map source) —
 * never a partial diff, so unspecified fields cannot be reset server-side.
 * If the user changes the country/county/city cascade they must re-pick
 * county/city (ids reset on country change, cities on county change).
 *
 * IS_DEFAULT: the SERVER's 200 AddressResponse is the only truth — the
 * cached entry is replaced with it and no other address is patched
 * client-side (whether the server auto-unsets the previous default shows up
 * on the next full refetch; nothing to sync manually here).
 *
 * ERRORS: 422 detail[].loc (last element) maps 1:1 onto the form's field
 * keys for inline errors; offline/network errors keep every entered value;
 * 401 flows through the shared silent-refresh interceptor first. NOTHING is
 * updated optimistically — the cache changes only after the confirmed 200.
 */
export default function EditAddressScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ address_id?: string }>();
  const raw = Array.isArray(params.address_id) ? params.address_id[0] : params.address_id;
  const addressId = Number(raw);
  const canLoad = !!user && Number.isFinite(addressId) && addressId > 0;

  const { address: cached, getById, update } = useAddresses();

  // ── Prefill states ──────────────────────────────────────────────────────
  const [prefillState, setPrefillState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [source, setSource] = useState<AddressResponse | null>(null);

  // ── Form state (pre-filled; never reset on failure — only on success) ──
  const [countryId, setCountryId] = useState<number | null>(null);
  const [countyId, setCountyId] = useState<number | null>(null);
  const [cityId, setCityId] = useState<number | null>(null);
  const [houseNumber, setHouseNumber] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [landmark, setLandmark] = useState('');
  const [formattedAddress, setFormattedAddress] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  const [saving, setSaving] = useState(false);
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

  const clearError = (field: string) =>
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  /** Hydrates the form from the loaded address — nested objects → ids. */
  const hydrate = useCallback((a: AddressResponse) => {
    setSource(a);
    setCountryId(a.country?.id ?? null);
    setCountyId(a.county?.id ?? null);
    setCityId(a.city?.id ?? null);
    setHouseNumber(a.house_number ?? '');
    setStreetAddress(a.street_address ?? '');
    setPostalCode(a.postal_code ?? '');
    setLandmark(a.landmark ?? '');
    setFormattedAddress(a.formatted_address ?? '');
    setIsDefault(!!a.is_default);
    // Prefetch the cascade lists for the pre-selected ids so the pickers
    // open ready (failures just flip the retry flags — ids stay intact).
    (async () => {
      if (a.country?.id != null) {
        setCountiesLoading(true);
        try {
          const { data } = await authApi.getCounties(a.country.id);
          setCounties(data);
        } catch {
          setCountiesError(true);
        } finally {
          setCountiesLoading(false);
        }
      }
      if (a.county?.id != null) {
        setCitiesLoading(true);
        try {
          const { data } = await authApi.getCities(a.county.id);
          setCities(data);
        } catch {
          setCitiesError(true);
        } finally {
          setCitiesLoading(false);
        }
      }
    })();
  }, []);

  /** Cache-first prefill; network GET-by-id only on a cache miss. */
  useEffect(() => {
    if (!canLoad) return;
    let cancelled = false;
    (async () => {
      setPrefillState('loading');
      try {
        let a: AddressResponse | null = cached && cached.id === addressId ? cached : null;
        if (!a) a = await getById(addressId);
        if (cancelled) return;
        if (!a) {
          setPrefillState('notfound');
          return;
        }
        hydrate(a);
        void loadCountries(); // shared cache — free when already loaded
        setPrefillState('ready');
      } catch {
        if (!cancelled) setPrefillState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad, addressId]);

  /** Pick handlers — changing country resets county+city, county resets city. */
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
          editable={!saving && prefillState === 'ready'}
        />
      </View>
      {renderFieldError(keyName)}
    </View>
  );

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
        disabled={disabled || saving}
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

  /** FULL AddressUpdate body (PUT full-replace): every field explicit —
   * null where no usable value exists, so nothing is silently kept or
   * guessed server-side. Cascade ids from the pre-filled/updated picks;
   * lat/lng null (no GPS/map source in the app). */
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
      latitude: null,
      longitude: null,
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
    if (saving || !source) return; // double-tap guard; source guards prefill
    setFormError(null);

    // ── Client-side validation ────────────────────────────────────────────
    const errors: Record<string, string> = {};
    if (countryId == null) errors.country_id = t('addr_c_err_required');
    if (countyId == null) errors.county_id = t('addr_c_err_required');
    if (cityId == null) errors.city_id = t('addr_c_err_required');
    if (!streetAddress.trim()) errors.street_address = t('addr_c_err_required');
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    setFieldErrors({});
    try {
      await update(addressId, buildPayload());
      // 200 — the SERVER response already replaced the shared cache; back
      // to the detail screen which re-reads it on focus.
      Alert.alert(t('addr_e_success_title'), t('addr_e_success_msg'));
      router.back();
    } catch (err: any) {
      const status = err?.response?.status;
      if (!err?.response) {
        setFormError(t('addr_c_err_network'));
      } else if (status === 401) {
        setFormError(t('addr_c_err_session'));
      } else if (status === 422) {
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
      setSaving(false);
    }
  };

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
                <TouchableOpacity onPress={retry}>
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

  if (!canLoad) {
    return (
      <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
          <BackButton />
          <Text style={[styles.headerTitle, { color: c.text }]}>{t('addr_e_title')}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={[styles.prefillState, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="map-pin" size={22} color={c.mutedForeground} />
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('addr_sign_in')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('addr_e_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      {prefillState === 'loading' ? (
        <View style={[styles.prefillState, { backgroundColor: c.card, borderColor: c.border }]}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      ) : prefillState === 'notfound' ? (
        <View style={[styles.prefillState, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="search" size={22} color={c.mutedForeground} />
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('addr_d_not_found')}</Text>
          <TouchableOpacity onPress={() => router.back()} style={[styles.submitBtn, { backgroundColor: c.primary }]}>
            <Text style={styles.submitText}>{t('addr_d_back')}</Text>
          </TouchableOpacity>
        </View>
      ) : prefillState === 'error' ? (
        <View style={[styles.prefillState, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="alert-circle" size={22} color={c.destructive} />
          <Text style={[styles.stateText, { color: c.destructive }]}>{t('addr_e_err_load')}</Text>
          <TouchableOpacity
            onPress={() => {
              // Re-run the cache-first prefill by remounting state.
              setPrefillState('loading');
              (async () => {
                try {
                  let a: AddressResponse | null = cached && cached.id === addressId ? cached : null;
                  if (!a) a = await getById(addressId);
                  if (!a) {
                    setPrefillState('notfound');
                    return;
                  }
                  hydrate(a);
                  setPrefillState('ready');
                } catch {
                  setPrefillState('error');
                }
              })();
            }}
            style={[styles.submitBtn, { backgroundColor: c.primary }]}
          >
            <Text style={styles.submitText}>{t('addr_retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
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
            <ActivityIndicator size="small" color={c.primary} style={styles.cascadeLoader} />
          ) : citiesError ? (
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
            <Switch value={isDefault} onValueChange={setIsDefault} trackColor={{ true: c.primary }} disabled={saving} />
          </View>

          {formError ? (
            <View style={[styles.formError, { backgroundColor: c.card, borderColor: c.destructive }]}>
              <Feather name="alert-circle" size={16} color={c.destructive} />
              <Text style={[styles.formErrorText, { color: c.destructive }]}>{formError}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: c.primary, opacity: saving ? 0.6 : 1 }]}
            onPress={() => void handleSubmit()}
            disabled={saving}
            accessibilityLabel={t('addr_e_save')}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.submitText}>{t('addr_e_save')}</Text>
            )}
          </TouchableOpacity>
        </KeyboardAwareScrollViewCompat>
      )}
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
  prefillState: {
    margin: 20,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center' },
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
