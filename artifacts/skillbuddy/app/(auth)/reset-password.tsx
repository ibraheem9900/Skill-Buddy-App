import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import LogoImage from '@/components/LogoImage';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

// Same rule as the Signup screen: min 8 chars, uppercase + lowercase + number
// (matches onb_err_password_weak), max 128 per the API schema.
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$/;

/**
 * Set New Password screen — completes the forgot-password flow.
 *
 * Token sources (in order):
 *  1. Deep link: the email's reset link opens skillbuddy://reset-password?token=...
 *     (expo-router maps query params into useLocalSearchParams automatically)
 *  2. Manual entry: the user pastes the token from the email.
 */
export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  // Deep-link token: expo-router exposes ?token= from the link URL here.
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const deepLinkToken = Array.isArray(params.token) ? params.token[0] : params.token;

  const [manualToken, setManualToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const token = (deepLinkToken || manualToken).trim();

  const clearError = (field: string) =>
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  const handleReset = async () => {
    if (loading || succeeded) return;
    setFormError(null);

    // ---- Client-side validation (before any network call) ----
    const errors: Record<string, string> = {};
    if (!token) errors.token = t('rp_err_token_required');
    if (!password) errors.password = t('rp_err_required');
    else if (!PASSWORD_RE.test(password)) errors.password = t('onb_err_password_weak');
    if (!confirmPassword) errors.confirmPassword = t('rp_err_required');
    else if (password && confirmPassword && password !== confirmPassword)
      errors.confirmPassword = t('onb_err_confirm_password');

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setLoading(true);
    setFieldErrors({});
    try {
      // POST /api/v1/auth/reset-password — public endpoint, token in the body
      // is the authorization. No Authorization header is attached.
      const res = await authApi.resetPassword({ token, password, confirm_password: confirmPassword });
      // Don't auto-login: token + password locals die with this screen, and
      // the success state only navigates onward to Login.
      setPassword('');
      setConfirmPassword('');
      setManualToken('');
      setSucceeded(true);
      void res; // message not displayed verbatim — app copy below is used
    } catch (err: any) {
      const status = err?.response?.status;
      if (!err?.response) {
        setFormError(t('rp_err_network'));
      } else if (status === 401) {
        // Confirmed live: {"detail":"Invalid token."} — expired/used/garbage
        setFormError(t('rp_err_token_invalid'));
      } else if (status === 422) {
        // Pydantic detail[].input echoes submitted values — never log it raw.
        const detail = err.response.data?.detail;
        const fields: Record<string, string> = {};
        let general: string | null = null;
        if (Array.isArray(detail)) {
          for (const d of detail) {
            const field = Array.isArray(d?.loc) ? String(d.loc[d.loc.length - 1]) : null;
            const msg = typeof d?.msg === 'string' ? d.msg : '';
            const clean = msg.startsWith('Value error, ') ? msg.slice('Value error, '.length) : msg;
            if (field === 'password') fields.password = clean || t('onb_err_password_weak');
            else if (field === 'confirm_password') fields.confirmPassword = clean || t('onb_err_confirm_password');
            else if (field === 'token') { setFormError(t('rp_err_token_invalid')); return; }
            else if (field === 'body' && /passwords do not match/i.test(clean))
              fields.confirmPassword = clean; // body-level rule → anchor to confirm field
            else general = clean || general || t('rp_err_generic');
          }
        } else {
          general = t('rp_err_generic');
        }
        if (Object.keys(fields).length) setFieldErrors(fields);
        if (general && !Object.keys(fields).length) setFormError(general);
      } else {
        setFormError(t('rp_err_generic'));
      }
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
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={60}
        style={{ flex: 1 }}
      >
        {/* Back arrow — hidden once succeeded so the confirmation is the only way forward */}
        {!succeeded && (
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={c.text} />
          </TouchableOpacity>
        )}

        {succeeded ? (
          <Animated.View entering={FadeInDown.duration(350)} style={styles.center}>
            <View style={[styles.iconCircle, { backgroundColor: c.primaryLight }]}>
              <Feather name="check-circle" size={48} color={c.primary} />
            </View>
            <Text style={[styles.title, { color: c.text }]}>{t('rp_success_title')}</Text>
            <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('rp_success_msg')}</Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: c.primary }]}
              onPress={() => router.replace('/(auth)/login' as any)}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>{t('rp_back_login')}</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <>
            {/* Standalone logo — auth template */}
            <Animated.View entering={FadeInDown.delay(0).duration(350)} style={styles.logoWrap}>
              <LogoImage variant={c.background === '#0A0D0D' ? 'light' : 'green'} height={40} animateOnMount={false} />
            </Animated.View>

            {/* Title + subtitle */}
            <Animated.View entering={FadeInDown.delay(100).duration(350)} style={styles.titleWrap}>
              <Text style={[styles.title, { color: c.text }]}>{t('rp_title')}</Text>
              <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('rp_subtitle')}</Text>
            </Animated.View>

            {/* General error banner (invalid/expired token, network, unmapped 422) */}
            {!!formError && (
              <Animated.View entering={FadeIn.duration(200)} style={[styles.errorBanner, { backgroundColor: c.card, borderColor: c.destructive }]}>
                <Feather name="alert-circle" size={16} color={c.destructive} />
                <Text style={[styles.errorBannerText, { color: c.destructive }]}>{formError}</Text>
              </Animated.View>
            )}

            {/* Reset token — pre-filled from deep link when present */}
            <Animated.View entering={FadeInDown.delay(180).duration(350)}>
              <View style={styles.fieldWrap}>
                <Text style={[styles.label, { color: c.text }]}>{t('rp_token_label')}</Text>
                <View
                  style={[
                    styles.inputRow,
                    { backgroundColor: c.input, borderColor: fieldBorder('token'), borderWidth: focusedField === 'token' || fieldErrors.token ? 1.5 : 1 },
                  ]}
                >
                  <Feather name="key" size={18} color={focusedField === 'token' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: c.text }]}
                    placeholder={t('rp_token_placeholder')}
                    placeholderTextColor={c.mutedForeground}
                    value={token}
                    onChangeText={(v) => { setManualToken(v); clearError('token'); }}
                    onFocus={() => setFocusedField('token')}
                    onBlur={() => setFocusedField(null)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!loading}
                  />
                </View>
                {renderFieldError('token')}
                {!!deepLinkToken && !fieldErrors.token && (
                  <Text style={[styles.helper, { color: c.mutedForeground }]}>{t('rp_token_from_link')}</Text>
                )}
              </View>

              {/* New Password */}
              <View style={styles.fieldWrap}>
                <Text style={[styles.label, { color: c.text }]}>{t('rp_password_label')}</Text>
                <View
                  style={[
                    styles.inputRow,
                    { backgroundColor: c.input, borderColor: fieldBorder('password'), borderWidth: focusedField === 'password' || fieldErrors.password ? 1.5 : 1 },
                  ]}
                >
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
                    autoCapitalize="none"
                    editable={!loading}
                  />
                  <Pressable hitSlop={8} onPress={() => setShowPassword(!showPassword)}>
                    <Feather name={showPassword ? 'eye' : 'eye-off'} size={18} color={c.mutedForeground} />
                  </Pressable>
                </View>
                {renderFieldError('password')}
              </View>

              {/* Confirm Password */}
              <View style={styles.fieldWrap}>
                <Text style={[styles.label, { color: c.text }]}>{t('rp_confirm_label')}</Text>
                <View
                  style={[
                    styles.inputRow,
                    { backgroundColor: c.input, borderColor: fieldBorder('confirmPassword'), borderWidth: focusedField === 'confirmPassword' || fieldErrors.confirmPassword ? 1.5 : 1 },
                  ]}
                >
                  <Feather name="lock" size={18} color={focusedField === 'confirmPassword' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: c.text }]}
                    placeholder="••••••••••••"
                    placeholderTextColor={c.mutedForeground}
                    value={confirmPassword}
                    onChangeText={(v) => { setConfirmPassword(v); clearError('confirmPassword'); }}
                    onFocus={() => setFocusedField('confirmPassword')}
                    onBlur={() => setFocusedField(null)}
                    secureTextEntry={!showConfirm}
                    autoCapitalize="none"
                    editable={!loading}
                  />
                  <Pressable hitSlop={8} onPress={() => setShowConfirm(!showConfirm)}>
                    <Feather name={showConfirm ? 'eye' : 'eye-off'} size={18} color={c.mutedForeground} />
                  </Pressable>
                </View>
                {renderFieldError('confirmPassword')}
              </View>

              {/* Primary action button — disabled + spinner while submitting */}
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: loading ? c.primaryDark : c.primary, marginTop: 8 }]}
                onPress={handleReset}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>{t('rp_submit')}</Text>
                )}
              </TouchableOpacity>
            </Animated.View>
          </>
        )}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 26, marginBottom: 8, textAlign: 'center' },
  subtitle: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
    marginBottom: 16,
  },
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
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, padding: 0 },
  fieldError: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 5 },
  helper: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 5 },
  primaryBtn: {
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  primaryBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: '#FFF' },
});
