import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
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
import { useLanguage } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import BackButton from '@/components/BackButton';

/**
 * "Become a Provider" — one-time creation (POST /api/v1/providers/profile).
 * Reached from the Professional Info screen's no-profile state. NOT for
 * editing an existing profile (that's PATCH — separate task).
 * Validation mirrors the live schema: bio ≤500, hourly_rate ≥0 (number on
 * the wire), provider_type ≤20 chars from the INDIVIDUAL/COMPANY/AGENCY set
 * (server has no enum — matches web app convention), service_radius 1–100.
 */
const PROVIDER_TYPES = ['INDIVIDUAL', 'COMPANY', 'AGENCY'] as const;
const BIO_MAX = 500;
const RADIUS_MIN = 1;
const RADIUS_MAX = 100;

const FIELD_TO_STATE: Record<string, string> = {
  bio: 'bio',
  hourly_rate: 'rate',
  provider_type: 'providerType',
  service_radius: 'radius',
};

export default function CreateProviderProfileScreen() {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [bio, setBio] = useState('');
  const [rate, setRate] = useState('');
  const [providerType, setProviderType] = useState<string>('INDIVIDUAL');
  const [radius, setRadius] = useState(25);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    const trimmedBio = bio.trim();
    if (!trimmedBio) errors.bio = t('cp_err_bio_required');
    else if (trimmedBio.length > BIO_MAX) errors.bio = t('cp_err_bio_max');
    const rateNum = Number(rate.replace(',', '.'));
    if (!rate.trim()) errors.rate = t('cp_err_rate_required');
    else if (!Number.isFinite(rateNum) || rateNum < 0) errors.rate = t('cp_err_rate_invalid');
    if (!providerType) errors.providerType = t('cp_err_type_required');
    if (!Number.isInteger(radius) || radius < RADIUS_MIN || radius > RADIUS_MAX) errors.radius = t('cp_err_radius');
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    setGeneralError(null);
    if (!validate()) return;
    setLoading(true);
    try {
      // hourly_rate goes over the wire as a NUMBER (schema); the 201 response
      // returns it as a string — display-side parsing lives in
      // formatHourlyRate (useProviderProfile).
      await authApi.createProviderProfile({
        bio: bio.trim(),
        hourly_rate: Number(rate.replace(',', '.')),
        provider_type: providerType,
        service_radius: radius,
      });
      Alert.alert(t('cprov_success_title'), t('cprov_success_msg'));
      router.replace('/profile/professional');
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
        setGeneralError(t('cp_err_generic'));
      } else {
        // Network failure → retryable; the user stays on the form.
        setGeneralError(t('cp_err_network'));
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
    opts: { icon: 'file-text' | 'tag'; multiline?: boolean; keyboardType?: 'default' | 'decimal-pad' } = { icon: 'file-text' },
  ) => (
    <View>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <View style={[styles.inputRow, { backgroundColor: c.muted, borderColor: fieldErrors[errorKey] ? c.destructive : c.border }]}>
        <Feather name={opts.icon} size={18} color={c.mutedForeground} style={{ marginRight: 10 }} />
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

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('cp_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={[styles.intro, { color: c.mutedForeground }]}>{t('cp_intro')}</Text>

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
              <Text style={styles.submitText}>{t('cp_submit')}</Text>
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
  intro: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19 },
  label: { fontFamily: 'Manrope_500Medium', fontSize: 13, marginBottom: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1 },
  input: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, minHeight: 40, textAlignVertical: 'top' },
  charCount: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: -8, alignSelf: 'flex-end' },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  typeText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  errText: { fontFamily: 'Manrope_500Medium', fontSize: 12, marginTop: 6 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, padding: 12 },
  errorBannerText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 13 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepperBtn: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { fontFamily: 'Manrope_700Bold', fontSize: 16, minWidth: 70, textAlign: 'center' },
  submitBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8, marginBottom: 30 },
  submitText: { fontFamily: 'Manrope_700Bold', fontSize: 15, color: '#FFF' },
});
