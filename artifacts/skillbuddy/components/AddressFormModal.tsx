import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { authApi } from '@/services/api';
import useCountries from '@/hooks/useCountries';
import type { AddressRegionResponse } from '@/types';
import type { AddressField, PostAddressForm } from '@/lib/postAddress';

/**
 * "Add new address" / "Edit address" — a separate full-screen surface that
 * sits ON TOP of the wizard, so the wizard's state (service, description,
 * attachments, dates, tasks) is never unmounted while it is open.
 *
 * Fields are in the order the design asks for:
 *   Country → County → City → Apartment / Street → House number → Postal code
 *   → Full address (optional) → Landmark (optional)
 *
 * ── BACKEND REALITY (live OpenAPI, re-read 2026-10-21) ─────────────────────
 * AddressCreate/AddressUpdate have NO `name` and NO `phone` field, so the
 * account's own name and phone are shown READ-ONLY at the top (they come from
 * the signed-in user) and are never sent. "Apartment number" likewise has no
 * field of its own: it is mapped onto the documented `street_address`, labelled
 * "Apartment / Street". Both gaps are listed in the delivery report.
 *
 * Country/county/city are the existing public geo endpoints; the county and city
 * lists are memoised per id for the whole session, so re-opening the form never
 * refetches a list the user already loaded.
 */

const countiesCache = new Map<number, AddressRegionResponse[]>();
const citiesCache = new Map<number, AddressRegionResponse[]>();

const EMPTY_FORM: PostAddressForm = {
  countryId: null,
  countyId: null,
  cityId: null,
  streetAddress: '',
  houseNumber: '',
  postalCode: '',
  landmark: '',
  formattedAddress: '',
};

type PickerKind = 'country' | 'county' | 'city';

export default function AddressFormModal({
  visible,
  mode,
  initial,
  accountName,
  accountPhone,
  submitting,
  fieldErrors,
  formError,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  mode: 'add' | 'edit';
  initial: PostAddressForm | null;
  accountName: string;
  accountPhone: string;
  submitting: boolean;
  fieldErrors: Partial<Record<AddressField, string>>;
  formError: string | null;
  onClose: () => void;
  onSubmit: (form: PostAddressForm) => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { status: countriesStatus, countries, load: loadCountries, refresh: refreshCountries } =
    useCountries();

  const [form, setForm] = useState<PostAddressForm>(initial ?? EMPTY_FORM);
  const [localError, setLocalError] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [search, setSearch] = useState('');
  const [counties, setCounties] = useState<AddressRegionResponse[] | null>(null);
  const [cities, setCities] = useState<AddressRegionResponse[] | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState(false);

  // Fresh form on every open (the caller passes the row being edited).
  useEffect(() => {
    if (!visible) return;
    setForm(initial ?? EMPTY_FORM);
    setLocalError(null);
    setPicker(null);
    setSearch('');
  }, [visible, initial]);

  useEffect(() => {
    void loadCountries();
  }, [loadCountries]);

  const loadCounties = useCallback(async (countryId: number) => {
    const cached = countiesCache.get(countryId);
    if (cached) {
      setCounties(cached);
      return;
    }
    setGeoLoading(true);
    setGeoError(false);
    try {
      const { data } = await authApi.getCounties(countryId);
      countiesCache.set(countryId, data);
      setCounties(data);
    } catch {
      setCounties(null);
      setGeoError(true);
    } finally {
      setGeoLoading(false);
    }
  }, []);

  const loadCities = useCallback(async (countyId: number) => {
    const cached = citiesCache.get(countyId);
    if (cached) {
      setCities(cached);
      return;
    }
    setGeoLoading(true);
    setGeoError(false);
    try {
      const { data } = await authApi.getCities(countyId);
      citiesCache.set(countyId, data);
      setCities(data);
    } catch {
      setCities(null);
      setGeoError(true);
    } finally {
      setGeoLoading(false);
    }
  }, []);

  // Seed the dependent lists for the edited address (from cache first).
  useEffect(() => {
    if (!visible) return;
    if (initial?.countryId != null) void loadCounties(initial.countryId);
    if (initial?.countyId != null) void loadCities(initial.countyId);
  }, [visible, initial, loadCounties, loadCities]);

  const country = countries?.find((row) => row.id === form.countryId) ?? null;
  const county = counties?.find((row) => row.id === form.countyId) ?? null;
  const city = cities?.find((row) => row.id === form.cityId) ?? null;

  const set = <K extends keyof PostAddressForm>(key: K, value: PostAddressForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setLocalError(null);
  };

  const chooseCountry = (id: number) => {
    setForm((current) => ({
      ...current,
      countryId: id,
      countyId: null,
      cityId: null,
    }));
    setCounties(null);
    setCities(null);
    setPicker(null);
    void loadCounties(id);
  };

  const chooseCounty = (id: number) => {
    setForm((current) => ({ ...current, countyId: id, cityId: null }));
    setCities(null);
    setPicker(null);
    void loadCities(id);
  };

  const chooseCity = (id: number) => {
    setForm((current) => ({ ...current, cityId: id }));
    setPicker(null);
  };

  const options = useMemo(() => {
    if (picker === 'country') return countries ?? [];
    if (picker === 'county') return counties ?? [];
    if (picker === 'city') return cities ?? [];
    return [];
  }, [picker, countries, counties, cities]);

  const query = search.trim().toLowerCase();
  const filtered = options.filter(
    (option) => query.length === 0 || option.name.toLowerCase().includes(query)
  );

  const pickerTitle =
    picker === 'country'
      ? t('addr_c_country')
      : picker === 'county'
        ? t('addr_c_county')
        : t('addr_c_city');
  const pickerLoading =
    picker === 'country'
      ? countriesStatus === 'loading'
      : geoLoading;
  const pickerError =
    picker === 'country' ? countriesStatus === 'error' : geoError;
  const selectedId =
    picker === 'country' ? form.countryId : picker === 'county' ? form.countyId : form.cityId;

  const save = () => {
    if (submitting) return;
    if (form.countryId == null || form.countyId == null || form.cityId == null) {
      setLocalError(t('post_addr_err_required'));
      return;
    }
    if (
      form.streetAddress.trim().length === 0 &&
      form.houseNumber.trim().length === 0 &&
      form.formattedAddress.trim().length === 0
    ) {
      setLocalError(t('post_addr_err_street'));
      return;
    }
    onSubmit(form);
  };

  const inputFor = (
    field: AddressField,
    value: string,
    onChangeText: (text: string) => void,
    placeholderKey: 'post_addr_apartment_ph' | 'post_addr_house_ph' | 'post_addr_postal_ph' | 'post_addr_full_ph' | 'post_addr_landmark_ph',
    options?: { multiline?: boolean; maxLength?: number }
  ) => (
    <View style={styles.fieldWrap}>
      <Text style={[styles.smallLabel, { color: c.mutedForeground }]}>
        {t(fieldLabelKey(field))}
      </Text>
      <TextInput
        style={[
          styles.input,
          options?.multiline && styles.textArea,
          {
            backgroundColor: c.input,
            color: c.text,
            borderColor: fieldErrors[field] ? c.destructive : c.border,
          },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={t(placeholderKey)}
        placeholderTextColor={c.mutedForeground}
        multiline={options?.multiline}
        textAlignVertical={options?.multiline ? 'top' : 'center'}
        maxLength={options?.maxLength}
        autoCapitalize="words"
      />
      {fieldErrors[field] ? (
        <Text style={[styles.error, { color: c.destructive }]}>{fieldErrors[field]}</Text>
      ) : null}
    </View>
  );

  // Fade, not slide: the app's popups never translate in (lib/motion rule).
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={t('action_cancel')}
          >
            <Feather name="chevron-left" size={22} color={c.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>
            {mode === 'add' ? t('post_addr_new_title') : t('post_addr_edit_title')}
          </Text>
          <View style={{ width: 36 }} />
        </View>

        <KeyboardAwareScrollViewCompat
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          bottomOffset={110}
        >
          {/* Account identity — read-only, because the schema has no such fields. */}
          <View style={[styles.identity, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={[styles.identityRow, { borderBottomColor: c.border }]}>
              <Text style={[styles.smallLabel, { color: c.mutedForeground }]}>
                {t('post_addr_name')}
              </Text>
              <Text style={[styles.identityValue, { color: c.text }]} numberOfLines={1}>
                {accountName || '—'}
              </Text>
            </View>
            <View style={styles.identityRow}>
              <Text style={[styles.smallLabel, { color: c.mutedForeground }]}>
                {t('post_addr_phone')}
              </Text>
              <Text style={[styles.identityValue, { color: c.text }]} numberOfLines={1}>
                {accountPhone || '—'}
              </Text>
            </View>
            <Text style={[styles.identityNote, { color: c.mutedForeground }]}>
              {t('post_addr_identity_note')}
            </Text>
          </View>

          {pickerRow('addr_c_country', country?.name ?? null, () => setPicker('country'), false, c, t)}
          {pickerRow(
            'addr_c_county',
            county?.name ?? null,
            () => setPicker('county'),
            form.countryId == null,
            c,
            t
          )}
          {pickerRow(
            'addr_c_city',
            city?.name ?? null,
            () => setPicker('city'),
            form.countyId == null,
            c,
            t
          )}

          {inputFor(
            'street_address',
            form.streetAddress,
            (text) => set('streetAddress', text),
            'post_addr_apartment_ph',
            { maxLength: 255 }
          )}
          {inputFor('house_number', form.houseNumber, (text) => set('houseNumber', text), 'post_addr_house_ph', {
            maxLength: 20,
          })}
          {inputFor('postal_code', form.postalCode, (text) => set('postalCode', text), 'post_addr_postal_ph', {
            maxLength: 20,
          })}
          {inputFor(
            'formatted_address',
            form.formattedAddress,
            (text) => set('formattedAddress', text),
            'post_addr_full_ph',
            { multiline: true, maxLength: 500 }
          )}
          {inputFor('landmark', form.landmark, (text) => set('landmark', text), 'post_addr_landmark_ph', {
            maxLength: 255,
          })}

          {localError ? (
            <Text style={[styles.error, { color: c.destructive }]}>{localError}</Text>
          ) : formError ? (
            <Text style={[styles.error, { color: c.destructive }]}>{formError}</Text>
          ) : null}
        </KeyboardAwareScrollViewCompat>

        <View
          style={[
            styles.footer,
            {
              backgroundColor: c.surface,
              borderTopColor: c.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: c.primary, opacity: submitting ? 0.6 : 1 }]}
            onPress={save}
            disabled={submitting}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator size="small" color={c.primaryForeground} />
            ) : (
              <Text style={[styles.saveText, { color: c.primaryForeground }]}>
                {mode === 'add' ? t('post_addr_save') : t('post_addr_save_edit')}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Country / county / city — an overlay INSIDE this modal (a nested
            native Modal is unreliable on Android). */}
        {picker ? (
          <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: c.background }]}>
            <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
              <TouchableOpacity onPress={() => setPicker(null)} style={styles.backBtn}>
                <Feather name="chevron-left" size={22} color={c.text} />
              </TouchableOpacity>
              <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>
                {pickerTitle}
              </Text>
              <View style={{ width: 36 }} />
            </View>

            <View style={[styles.searchRow, { borderBottomColor: c.border }]}>
              <Feather name="search" size={15} color={c.mutedForeground} />
              <TextInput
                style={[styles.searchInput, { color: c.text }]}
                placeholder={t('geo_search')}
                placeholderTextColor={c.mutedForeground}
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
                autoFocus
              />
            </View>

            {pickerLoading ? (
              <View style={styles.stateWrap}>
                <ActivityIndicator size="small" color={c.primary} />
              </View>
            ) : pickerError ? (
              <View style={styles.stateWrap}>
                <Text style={[styles.stateText, { color: c.mutedForeground }]}>
                  {t('addr_c_err_network')}
                </Text>
                <TouchableOpacity
                  onPress={() =>
                    picker === 'country'
                      ? void refreshCountries()
                      : picker === 'county'
                        ? form.countryId != null && void loadCounties(form.countryId)
                        : form.countyId != null && void loadCities(form.countyId)
                  }
                >
                  <Text style={[styles.stateAction, { color: c.primary }]}>{t('addr_retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : filtered.length === 0 ? (
              <View style={styles.stateWrap}>
                <Text style={[styles.stateText, { color: c.mutedForeground }]}>
                  {t('geo_no_match')}
                </Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.listPad} keyboardShouldPersistTaps="handled">
                {filtered.map((option) => {
                  const active = option.id === selectedId;
                  return (
                    <TouchableOpacity
                      key={option.id}
                      style={[
                        styles.option,
                        {
                          backgroundColor: active ? c.primaryLight : c.input,
                          borderColor: active ? c.primary : c.border,
                        },
                      ]}
                      onPress={() =>
                        picker === 'country'
                          ? chooseCountry(option.id)
                          : picker === 'county'
                            ? chooseCounty(option.id)
                            : chooseCity(option.id)
                      }
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
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/** The translated label for each documented address field. */
function fieldLabelKey(field: AddressField) {
  switch (field) {
    case 'street_address':
      return 'post_addr_apartment' as const;
    case 'house_number':
      return 'addr_c_house' as const;
    case 'postal_code':
      return 'addr_c_postal' as const;
    case 'formatted_address':
      return 'addr_c_formatted' as const;
    case 'landmark':
      return 'addr_c_landmark' as const;
    default:
      return 'addr_c_city' as const;
  }
}

/** A tappable field that opens the geo overlay. */
function pickerRow(
  labelKey: 'addr_c_country' | 'addr_c_county' | 'addr_c_city',
  value: string | null,
  onPress: () => void,
  disabled: boolean,
  c: ReturnType<typeof useTheme>['colors'],
  t: (key: any) => string
) {
  return (
    <View style={styles.fieldWrap} key={labelKey}>
      <Text style={[styles.smallLabel, { color: c.mutedForeground }]}>{t(labelKey)}</Text>
      <TouchableOpacity
        style={[
          styles.input,
          styles.pickerInput,
          {
            backgroundColor: c.input,
            borderColor: c.border,
            opacity: disabled ? 0.55 : 1,
          },
        ]}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
      >
        <Text
          style={[styles.pickerText, { color: value ? c.text : c.mutedForeground }]}
          numberOfLines={1}
        >
          {value ?? t('addr_c_pick')}
        </Text>
        <Feather name="chevron-down" size={16} color={c.mutedForeground} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: 'Manrope_700Bold', fontSize: 17 },
  scroll: { padding: 20, paddingBottom: 32, gap: 4 },
  identity: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 14, gap: 8 },
  identityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  identityValue: { flex: 1, textAlign: 'right', fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  identityNote: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16 },
  fieldWrap: { marginBottom: 12 },
  smallLabel: { fontFamily: 'Manrope_500Medium', fontSize: 12, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
  },
  textArea: { minHeight: 72 },
  pickerInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14 },
  error: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 4, lineHeight: 15 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  saveBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveText: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  overlay: { zIndex: 10 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  searchInput: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, paddingVertical: 2 },
  listPad: { padding: 16, gap: 8 },
  option: {
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
  stateWrap: { padding: 32, alignItems: 'center', gap: 10 },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 12, textAlign: 'center' },
  stateAction: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
});
