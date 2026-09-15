import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import LogoImage from '@/components/LogoImage';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Map API field names (from 422 detail[].loc) to our state keys. */
const FIELD_TO_STATE: Record<string, string> = {
  email: 'email',
  personal_code: 'personalCode',
  first_name: 'firstName',
  last_name: 'lastName',
  password: 'password',
  confirm_password: 'confirmPassword',
};

/** Pull field-level + general messages out of a 422/4xx response body. */
function extractApiErrors(err: any): { fields: Record<string, string>; general: string | null } {
  const detail = err?.response?.data?.detail;
  if (Array.isArray(detail)) {
    const fields: Record<string, string> = {};
    const general: string[] = [];
    for (const d of detail) {
      const apiField = Array.isArray(d?.loc) ? String(d.loc[d.loc.length - 1]) : null;
      const msg = typeof d?.msg === 'string' ? d.msg : 'Invalid value.';
      // Pydantic wraps business-rule errors as "Value error, <message>" —
      // strip the prefix so users see a clean message.
      const clean = msg.startsWith('Value error, ') ? msg.slice('Value error, '.length) : msg;
      const stateKey = apiField ? FIELD_TO_STATE[apiField] : undefined;
      if (stateKey) fields[stateKey] = clean.charAt(0).toUpperCase() + clean.slice(1);
      else general.push(clean);
    }
    return { fields, general: general.length ? general.join('\n') : null };
  }
  if (typeof detail === 'string') {
    // e.g. 400 {"detail":"Email already registered."} — anchor it to the
    // email field when the message clearly refers to it.
    if (/email/i.test(detail)) return { fields: { email: detail }, general: null };
    return { fields: {}, general: detail };
  }
  const message = err?.response?.data?.message;
  if (typeof message === 'string') return { fields: {}, general: message };
  return { fields: {}, general: null };
}

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { signup } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [personalCode, setPersonalCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const clearError = (field: string) =>
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  const handleSignup = async () => {
    if (loading) return;
    setFormError(null);

    // ---- Client-side validation (before any network call) ----
    const errors: Record<string, string> = {};
    if (!firstName.trim()) errors.firstName = t('signup_err_required');
    if (!lastName.trim()) errors.lastName = t('signup_err_required');
    if (!email.trim()) errors.email = t('signup_err_required');
    else if (!EMAIL_RE.test(email.trim())) errors.email = 'Please enter a valid email address.';
    if (!personalCode.trim()) errors.personalCode = t('signup_err_required');
    if (!password) errors.password = t('signup_err_required');
    else if (password.length < 8) errors.password = t('signup_err_password');
    if (!confirmPassword) errors.confirmPassword = t('signup_err_required');
    else if (password && confirmPassword && password !== confirmPassword)
      errors.confirmPassword = t('signup_err_confirm');

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    if (!agreed) {
      setFormError(t('signup_err_terms'));
      return;
    }

    setLoading(true);
    setFieldErrors({});
    try {
      // POST /api/v1/auth/signup — creates the account and starts email
      // verification. No tokens are returned or stored here.
      await signup({
        email: email.trim(),
        personal_code: personalCode.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        password,
        confirm_password: confirmPassword,
      });
      // Account created → show the "check your email" confirmation screen.
      router.push('/(auth)/verify-email' as any);
    } catch (err: any) {
      const status = err?.response?.status;
      if (!err?.response) {
        // Timeout (ECONNABORTED) or offline (Network Error)
        setFormError(t('signup_err_network'));
      } else if (status === 422 || (status && status >= 400 && status < 500)) {
        const { fields, general } = extractApiErrors(err);
        setFieldErrors(fields);
        setFormError(general);
      } else {
        setFormError(t('signup_failed_msg'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      Alert.alert('Google Sign-In', 'Google Sign-In will be available once the OAuth client is configured.');
    } catch {
      Alert.alert(t('onb_google_error'));
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setLoading(true);
    try {
      Alert.alert('Apple Sign-In', 'Apple Sign-In will be available once configured.');
    } catch {
      Alert.alert(t('onb_apple_error'));
    } finally {
      setLoading(false);
    }
  };

  const fieldBorder = (field: string) => {
    if (fieldErrors[field]) return c.destructive;
    return focusedField === field ? c.primary : c.border;
  };

  const renderFieldError = (field: string) =>
    fieldErrors[field] ? (
      <Text style={[styles.fieldError, { color: c.destructive }]}>{fieldErrors[field]}</Text>
    ) : null;

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={60}
        style={{ flex: 1 }}
      >
        {/* Back to choice screen */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/(auth)/choice' as any)}>
          <Feather name="arrow-left" size={22} color={c.text} />
        </TouchableOpacity>

        {/* Standalone logo — no background box */}
        <Animated.View entering={FadeInDown.delay(0).duration(350)} style={styles.logoWrap}>
          <LogoImage variant={c.background === '#0A0D0D' ? 'light' : 'green'} height={40} animateOnMount={false} />
        </Animated.View>

        {/* Title + subtitle */}
        <Animated.View entering={FadeInDown.delay(100).duration(350)} style={styles.titleWrap}>
          <Text style={[styles.title, { color: c.text }]}>{t('onb_signup_title')}</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('onb_signup_subtitle')}</Text>
        </Animated.View>

        {/* General error banner (network errors, terms gate, unmapped API errors) */}
        {!!formError && (
          <Animated.View entering={FadeIn.duration(200)} style={[styles.errorBanner, { backgroundColor: c.card, borderColor: c.destructive }]}>
            <Feather name="alert-circle" size={16} color={c.destructive} />
            <Text style={[styles.errorBannerText, { color: c.destructive }]}>{formError}</Text>
          </Animated.View>
        )}

        {/* Form fields */}
        <Animated.View entering={FadeInDown.delay(180).duration(350)}>
          {/* First Name */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.text }]}>{t('onb_signup_first_name')}</Text>
            <View style={[styles.inputRow, { backgroundColor: c.input, borderColor: fieldBorder('firstName'), borderWidth: focusedField === 'firstName' || fieldErrors.firstName ? 1.5 : 1 }]}>
              <Feather name="user" size={18} color={focusedField === 'firstName' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder={t('onb_signup_first_name')}
                placeholderTextColor={c.mutedForeground}
                value={firstName}
                onChangeText={(v) => { setFirstName(v); clearError('firstName'); }}
                onFocus={() => setFocusedField('firstName')}
                onBlur={() => setFocusedField(null)}
                autoCapitalize="words"
              />
            </View>
            {renderFieldError('firstName')}
          </View>

          {/* Last Name */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.text }]}>{t('onb_signup_last_name')}</Text>
            <View style={[styles.inputRow, { backgroundColor: c.input, borderColor: fieldBorder('lastName'), borderWidth: focusedField === 'lastName' || fieldErrors.lastName ? 1.5 : 1 }]}>
              <Feather name="user" size={18} color={focusedField === 'lastName' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder={t('onb_signup_last_name')}
                placeholderTextColor={c.mutedForeground}
                value={lastName}
                onChangeText={(v) => { setLastName(v); clearError('lastName'); }}
                onFocus={() => setFocusedField('lastName')}
                onBlur={() => setFocusedField(null)}
                autoCapitalize="words"
              />
            </View>
            {renderFieldError('lastName')}
          </View>

          {/* Email */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.text }]}>{t('onb_signup_email')}</Text>
            <View style={[styles.inputRow, { backgroundColor: c.input, borderColor: fieldBorder('email'), borderWidth: focusedField === 'email' || fieldErrors.email ? 1.5 : 1 }]}>
              <Feather name="mail" size={18} color={focusedField === 'email' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="example@email.com"
                placeholderTextColor={c.mutedForeground}
                value={email}
                onChangeText={(v) => { setEmail(v); clearError('email'); }}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {renderFieldError('email')}
          </View>

          {/* Personal ID Code (required by POST /api/v1/auth/signup) */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.text }]}>{t('onb_signup_personal_code')}</Text>
            <View style={[styles.inputRow, { backgroundColor: c.input, borderColor: fieldBorder('personalCode'), borderWidth: focusedField === 'personalCode' || fieldErrors.personalCode ? 1.5 : 1 }]}>
              <Feather name="credit-card" size={18} color={focusedField === 'personalCode' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder={t('onb_signup_personal_code')}
                placeholderTextColor={c.mutedForeground}
                value={personalCode}
                onChangeText={(v) => { setPersonalCode(v); clearError('personalCode'); }}
                onFocus={() => setFocusedField('personalCode')}
                onBlur={() => setFocusedField(null)}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {renderFieldError('personalCode')}
          </View>

          {/* Password */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.text }]}>{t('onb_signup_password')}</Text>
            <View style={[styles.inputRow, { backgroundColor: c.input, borderColor: fieldBorder('password'), borderWidth: focusedField === 'password' || fieldErrors.password ? 1.5 : 1 }]}>
              <Feather name="lock" size={18} color={focusedField === 'password' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="••••••••••••"
                placeholderTextColor={c.mutedForeground}
                value={password}
                onChangeText={(v) => { setPassword(v); clearError('password'); }}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
                secureTextEntry={!showPassword}
              />
              <Pressable hitSlop={8} onPress={() => setShowPassword(!showPassword)}>
                <Feather name={showPassword ? 'eye' : 'eye-off'} size={18} color={c.mutedForeground} />
              </Pressable>
            </View>
            {renderFieldError('password')}
          </View>

          {/* Confirm Password */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.text }]}>{t('onb_signup_confirm_password')}</Text>
            <View style={[styles.inputRow, { backgroundColor: c.input, borderColor: fieldBorder('confirmPassword'), borderWidth: focusedField === 'confirmPassword' || fieldErrors.confirmPassword ? 1.5 : 1 }]}>
              <Feather name="lock" size={18} color={focusedField === 'confirmPassword' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="••••••••••••"
                placeholderTextColor={c.mutedForeground}
                value={confirmPassword}
                onChangeText={(v) => { setConfirmPassword(v); clearError('confirmPassword'); }}
                onFocus={() => setFocusedField('confirmPassword')}
                onBlur={() => setFocusedField(null)}
                secureTextEntry={!showConfirmPassword}
              />
              <Pressable hitSlop={8} onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                <Feather name={showConfirmPassword ? 'eye' : 'eye-off'} size={18} color={c.mutedForeground} />
              </Pressable>
            </View>
            {renderFieldError('confirmPassword')}
          </View>

          {/* Terms checkbox — client-side gate, NOT sent to the API */}
          <TouchableOpacity style={styles.termsRow} onPress={() => { setAgreed(!agreed); if (!agreed) setFormError(null); }} activeOpacity={0.7}>
            <View style={[styles.checkbox, { borderColor: c.border }, agreed && { backgroundColor: c.primary, borderColor: c.primary }]}>
              {agreed && <Feather name="check" size={12} color="#FFF" />}
            </View>
            <Text style={[styles.termsText, { color: c.text }]}>
              {t('onb_signup_agree')}
              <Text style={{ color: c.primary, fontFamily: 'Manrope_500Medium' }}>{t('onb_signup_terms')}</Text>
            </Text>
          </TouchableOpacity>

          {/* Primary action button — disabled + spinner while submitting */}
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: loading ? c.primaryDark : c.primary }]}
            onPress={handleSignup}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>{t('onb_signup_create')}</Text>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Divider */}
        <Animated.View entering={FadeInDown.delay(280).duration(300)} style={styles.divider}>
          <View style={[styles.divLine, { backgroundColor: c.border }]} />
          <Text style={[styles.divText, { color: c.mutedForeground }]}>{t('onb_choice_or')}</Text>
          <View style={[styles.divLine, { backgroundColor: c.border }]} />
        </Animated.View>

        {/* Full-width social buttons */}
        <Animated.View entering={FadeInDown.delay(320).duration(350)} style={styles.socialCol}>
          <TouchableOpacity
            style={[styles.socialBtn, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={handleGoogleSignIn}
            disabled={loading}
            activeOpacity={0.8}
          >
            <View style={styles.socialIconWrap}>
              <Ionicons name="logo-google" size={20} color="#4285F4" />
            </View>
            <Text style={[styles.socialBtnText, { color: c.text }]}>{t('onb_continue_google')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.socialBtn, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={handleAppleSignIn}
            disabled={loading}
            activeOpacity={0.8}
          >
            <View style={styles.socialIconWrap}>
              <Ionicons name="logo-apple" size={22} color={c.text} />
            </View>
            <Text style={[styles.socialBtnText, { color: c.text }]}>{t('onb_continue_apple')}</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Switch to login */}
        <Animated.View entering={FadeInDown.delay(360).duration(300)} style={styles.switchRow}>
          <Text style={[styles.switchText, { color: c.mutedForeground }]}>{t('onb_login_have_account')}</Text>
          <TouchableOpacity onPress={() => router.replace('/(auth)/login' as any)} hitSlop={6}>
            <Text style={[styles.switchLink, { color: c.primary }]}>{t('onb_login_signin_link')}</Text>
          </TouchableOpacity>
        </Animated.View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 28 },
  backBtn: { marginBottom: 8, alignSelf: 'flex-start' },
  logoWrap: { alignItems: 'center', marginTop: 8, marginBottom: 24 },
  titleWrap: { alignItems: 'center', marginBottom: 24 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 26, marginBottom: 8, textAlign: 'center' },
  subtitle: { fontFamily: 'Manrope_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 8 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  errorBannerText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 18 },
  fieldWrap: { marginBottom: 14 },
  label: { fontFamily: 'Manrope_500Medium', fontSize: 13, marginBottom: 7 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, padding: 0 },
  fieldError: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 5 },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 20, marginTop: 4 },
  checkbox: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  termsText: { fontFamily: 'Manrope_400Regular', fontSize: 13, flex: 1, lineHeight: 18 },
  primaryBtn: { borderRadius: 28, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  primaryBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: '#FFF' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 24, marginBottom: 20 },
  divLine: { flex: 1, height: 1 },
  divText: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  socialCol: { gap: 12, marginBottom: 28 },
  socialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 28,
    paddingVertical: 14,
    borderWidth: 1,
  },
  socialIconWrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  socialBtnText: { fontFamily: 'Manrope_500Medium', fontSize: 15 },
  switchRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' },
  switchText: { fontFamily: 'Manrope_400Regular', fontSize: 14 },
  switchLink: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
});
