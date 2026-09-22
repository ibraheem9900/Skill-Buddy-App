import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
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
import { authApi } from '@/services/api';
import { useProviderProfile } from '@/hooks/useProviderProfile';
import BackButton from '@/components/BackButton';

/**
 * Edit provider profile (PATCH /api/v1/providers/profile) — reached from the
 * provider dashboard's Edit button. Pre-filled from the cached provider
 * profile; sends the FULL body (all six fields, per the PATCH schema).
 * hourly_rate: number on the wire, string back in the 200 response (the
 * response replaces the cache as source of truth — see seedProfile).
 */
const PROVIDER_TYPES = ['INDIVIDUAL', 'COMPANY', 'AGENCY'] as const;
const BIO_MAX = 500;
const RADIUS_MIN = 1;
const RADIUS_MAX = 100;

const FIELD_TO_STATE: Record<string, string> = {
  bio: 'bio',
  hourly_rate: 'rate',
  provider_type: 'providerType',
  is_available: 'isAvailable',
  is_active: 'isActive',
  service_radius: 'radius',
};

export default function EditProviderProfileScreen() {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, seedProfile } = useProviderProfile();

  const [bio, setBio] = useState(profile?.bio ?? '');
  const [rate, setRate] = useState(
    profile?.hourly_rate != null && Number.isFinite(Number(profile.hourly_rate))
      ? String(Number(profile.hourly_rate))
      : '',
  );
  const [providerType, setProviderType] = useState<string>(profile?.provider_type ?? 'INDIVIDUAL');
  const [isAvailable, setIsAvailable] = useState(profile?.is_available ?? true);
  const [isActive, setIsActive] = useState(profile?.is_active ?? true);
  const [radius, setRadius] = useState(profile?.service_radius ?? 25);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    const trimmedBio = bio.trim();
    if (!trimmedBio) errors.bio = t('ep_err_bio_required');
    else if (trimmedBio.length > BIO_MAX) errors.bio = t('ep_err_bio_max');
    const rateNum = Number(rate.replace(',', '.'));
    if (!rate.trim()) errors.rate = t('ep_err_rate_required');
    else if (!Number.isFinite(rateNum) || rateNum < 0) errors.rate = t('ep_err_rate_invalid');
    if (!providerType) errors.providerType = t('ep_err_type_required');
    if (!Number.isInteger(radius) || radius < RADIUS_MIN || radius > RADIUS_MAX) errors.radius = t('ep_err_radius');
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    setGeneralError(null);
    if (!validate()) return;
    setLoading(true);
    try {
      // FULL body per the PATCH schema — including untouched fields.
      const { data } = await authApi.updateProviderProfile({
        bio: bio.trim(),
        hourly_rate: Number(rate.replace(',', '.')),
        provider_type: providerType,
        is_available: isAvailable,
        is_active: isActive,
        service_radius: radius,
      });
      seedProfile(data); // server response IS the new cached state
      Alert.alert(t('ep_success_title'), t('ep_success_msg'));
      router.back();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (Array.isArray(detail) && detail.length) {
        const mapped: Record<string, string> = {};
        const general: string[] = [];
        for (const d of detail) {
          const apiField = Array.isArray(d?.loc) ? String(d.loc[d.loc.length - 1]) : null;
          let msg = typeof d?.msg === 'string' ? d.msg : 'Invalid value.';
          if (msg.startsWith('Value error, ')) msg = msg.slice('Value error, '.length);
          const stateKey = apiField ? FIELD_TO_STATE[apiField] : undefined;
          if (stateKey) mapped[stateKey] = msg.charAt(0).toUpperCase() + msg.slice(1);
          else general.push(msg);
        }
        setFieldErrors(mapped);
        if (general.length) setGeneralError(general.join('\n'));
      } else if (err?.response) {
        setGeneralError(t('ep_err_generic'));
      } else {
        // Network failure → stay on the form with a retryable error; cache untouched.
        setGeneralError(t('ep_err_network'));
      }
    } finally {
      setLoading(false);
    }
  };

  const renderField = (
    label: string,
    value: string,
    set: (v: string) => void,
    errorKey: string,
    opts: { icon?: 'file-text' | 'tag'; multiline?: boolean; keyboardType?: 'default' | 'decimal-pad' } = {},
  ) => (
    <View>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <View style={[styles.inputRow, { backgroundColor: c.muted, borderColor: fieldErrors[errorKey] ? c.destructive : c.border }]}>
        {opts.icon ? <Feather name={opts.icon} size={18} color={c.mutedForeground} style={{ marginRight: 10 }} /> : null}
        <TextInput
          style={[styles.input, { color: c.text }]}
          value={value}
          onChangeText={(v) => {
            set(v);
            if (fieldErrors[errorKey]) setFieldErrors((prev) => { const n = { ...prev }; delete n[errorKey]; return n; });
          }}
          placeholder={label}
          placeholderTextColor={c.mutedForeground}
          multiline={opts.multiline}
          numberOfLines={opts.multiline ? 4 : undefined}
          keyboardType={opts.keyboardType}
          autoCapitalize={opts.multiline ? 'sentences' : 'none'}
        />
      </View>
      {fieldErrors[errorKey] ? <Text style={[styles.errText, { color: c.destructive }]}>{fieldErrors[errorKey]}</Text> : null}
    </View>
  );

  const renderToggle = (label: string, value: boolean, set: (v: boolean) => void, errorKey: string, hint?: string) => (
    <View style={[styles.toggleCard, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: c.text, marginBottom: 2 }]}>{label}</Text>
        {hint ? <Text style={[styles.toggleHint, { color: c.mutedForeground }]}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => { set(v); if (fieldErrors[errorKey]) setFieldErrors((p) => { const n = { ...p }; delete n[errorKey]; return n; }); }}
        trackColor={{ false: c.border, true: c.primary }}
        thumbColor="#FFF"
      />
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('ep_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {renderField(t('cp_bio'), bio, setBio, 'bio', { icon: 'file-text', multiline: true })}
          <Text style={[styles.charCount, { color: c.mutedForeground }]}>{bio.trim().length}/{BIO_MAX}</Text>

          {renderField(t('cp_rate'), rate, setRate, 'rate', { icon: 'tag', keyboardType: 'decimal-pad' })}

          <View>
            <Text style={[styles.label, { color: c.text }]}>{t('cp_provider_type')}</Text>
            <View style={styles.typeRow}>
              {PROVIDER_TYPES.map((pt) => (
                <Pressable
                  key={pt}
                  onPress={() => { setProviderType(pt); if (fieldErrors.providerType) setFieldErrors((p) => { const n = { ...p }; delete n.providerType; return n; }); }}
                  style={[
                    styles.typeChip,
                    { borderColor: providerType === pt ? c.primary : c.border, backgroundColor: providerType === pt ? c.primaryLight : c.card },
                  ]}
                >
                  <Text style={[styles.typeText, { color: providerType === pt ? c.primary : c.mutedForeground }]}>{pt}</Text>
                </Pressable>
              ))}
            </View>
            {fieldErrors.providerType ? <Text style={[styles.errText, { color: c.destructive }]}>{fieldErrors.providerType}</Text> : null}
          </View>

          {renderToggle(t('ep_available'), isAvailable, setIsAvailable, 'isAvailable', t('ep_available_hint'))}
          {renderToggle(t('ep_active'), isActive, setIsActive, 'isActive', t('ep_active_hint'))}

          <View>
            <Text style={[styles.label, { color: c.text }]}>{t('cp_radius', { n: radius })}</Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={[styles.stepperBtn, { borderColor: c.border }]} onPress={() => setRadius((r) => Math.max(RADIUS_MIN, r - 1))}
                accessibilityLabel="-"
              >
                <Feather name="minus" size={16} color={c.text} />
              </TouchableOpacity>
              <Text style={[styles.stepperValue, { color: c.text }]}>{radius} km</Text>
              <TouchableOpacity
                style={[styles.stepperBtn, { borderColor: c.border }]} onPress={() => setRadius((r) => Math.min(RADIUS_MAX, r + 1))}
                accessibilityLabel="+"
              >
                <Feather name="plus" size={16} color={c.text} />
              </TouchableOpacity>
            </View>
            {fieldErrors.radius ? <Text style={[styles.errText, { color: c.destructive }]}>{fieldErrors.radius}</Text> : null}
          </View>

          {generalError ? (
            <View style={[styles.errorBanner, { backgroundColor: c.destructive + '18', borderColor: c.destructive }]}>
              <Feather name="alert-circle" size={16} color={c.destructive} />
              <Text style={[styles.errorBannerText, { color: c.destructive }]}>{generalError}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: c.primary, opacity: loading ? 0.6 : 1 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.submitText}>{t('ep_submit')}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  label: { fontFamily: 'Manrope_500Medium', fontSize: 13, marginBottom: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1 },
  input: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, minHeight: 40, textAlignVertical: 'top' },
  charCount: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: -8, alignSelf: 'flex-end' },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  typeText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  toggleCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 14 },
  toggleHint: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepperBtn: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { fontFamily: 'Manrope_700Bold', fontSize: 16, minWidth: 70, textAlign: 'center' },
  errText: { fontFamily: 'Manrope_500Medium', fontSize: 12, marginTop: 6 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, padding: 12 },
  errorBannerText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 13 },
  submitBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8, marginBottom: 30 },
  submitText: { fontFamily: 'Manrope_700Bold', fontSize: 15, color: '#FFF' },
});
