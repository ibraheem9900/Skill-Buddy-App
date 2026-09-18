import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import LogoImage from '@/components/LogoImage';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

// Same email-format rule as the Signup screen — catches bad input before the
// API call so a 422 from the backend is a rare edge case, not the norm.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [focusedField, setFocusedField] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSend = async () => {
    if (loading) return;
    setFormError(null);

    // ---- Client-side validation (before any network call) ----
    if (!email.trim()) {
      setEmailError(t('fp_err_email'));
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setEmailError(t('fp_err_email_invalid'));
      return;
    }

    setLoading(true);
    setEmailError(null);
    try {
      // POST /api/v1/auth/forgot-password — the backend answers 200 with a
      // generic message whether or not the account exists, so the
      // confirmation below never reveals account existence either.
      await authApi.forgotPassword(email.trim());
      setSent(true);
    } catch (err: any) {
      const status = err?.response?.status;
      if (!err?.response) {
        // Timeout (ECONNABORTED) or offline (Network Error)
        setFormError(t('fp_err_network'));
      } else if (status === 422) {
        // Map a field-level 422 back to the email input; keep the raw
        // detail array in the console once for debugging.
        const detail = err.response.data?.detail;
        console.warn('[forgot-password] validation error:', detail);
        const emailDetail = Array.isArray(detail)
          ? detail.find((d: any) => Array.isArray(d?.loc) && d.loc[d.loc.length - 1] === 'email')
          : null;
        if (emailDetail) setEmailError(t('fp_err_email_invalid'));
        else setFormError(t('fp_err_send'));
      } else {
        setFormError(t('fp_err_send'));
      }
    } finally {
      setLoading(false);
    }
  };

  const inputBorder = emailError ? c.destructive : focusedField ? c.primary : c.border;

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
        {/* Back to Sign In */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={c.text} />
        </TouchableOpacity>

        {sent ? (
          <Animated.View entering={FadeInDown.duration(350)} style={styles.center}>
            <View style={[styles.iconCircle, { backgroundColor: c.primaryLight }]}>
              <Feather name="check-circle" size={48} color={c.primary} />
            </View>
            <Text style={[styles.title, { color: c.text }]}>{t('fp_check_email')}</Text>
            <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
              {t('fp_sent', { email: email.trim() })}
            </Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: c.primary }]}
              onPress={() => router.replace('/(auth)/login' as any)}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>{t('fp_back_login')}</Text>
            </TouchableOpacity>
            {/* Manual path to the reset screen — for when the email link doesn't
                open the app; the token is normally pre-filled via deep link. */}
            <TouchableOpacity onPress={() => router.push('/(auth)/reset-password' as any)} hitSlop={6}>
              <Text style={[styles.fpResendLink, { color: c.primary }]}>{t('fp_open_reset')}</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <>
            {/* Standalone logo — no background box, matching the auth template */}
            <Animated.View entering={FadeInDown.delay(0).duration(350)} style={styles.logoWrap}>
              <LogoImage variant={c.background === '#0A0D0D' ? 'light' : 'green'} height={40} animateOnMount={false} />
            </Animated.View>

            {/* Title + subtitle */}
            <Animated.View entering={FadeInDown.delay(100).duration(350)} style={styles.titleWrap}>
              <Text style={[styles.title, { color: c.text }]}>{t('fp_title')}</Text>
              <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('fp_subtitle')}</Text>
            </Animated.View>

            {/* General error banner (network / server errors) */}
            {!!formError && (
              <Animated.View entering={FadeIn.duration(200)} style={[styles.errorBanner, { backgroundColor: c.card, borderColor: c.destructive }]}>
                <Feather name="alert-circle" size={16} color={c.destructive} />
                <Text style={[styles.errorBannerText, { color: c.destructive }]}>{formError}</Text>
              </Animated.View>
            )}

            {/* Email field */}
            <Animated.View entering={FadeInDown.delay(180).duration(350)}>
              <Text style={[styles.label, { color: c.text }]}>{t('fp_email_label')}</Text>
              <View
                style={[
                  styles.inputRow,
                  { backgroundColor: c.input, borderColor: inputBorder, borderWidth: focusedField || emailError ? 1.5 : 1 },
                ]}
              >
                <Feather
                  name="mail"
                  size={18}
                  color={focusedField ? c.primary : c.mutedForeground}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={[styles.input, { color: c.text }]}
                  placeholder="you@email.com"
                  placeholderTextColor={c.mutedForeground}
                  value={email}
                  onChangeText={(v) => {
                    setEmail(v);
                    if (emailError) setEmailError(null);
                  }}
                  onFocus={() => setFocusedField(true)}
                  onBlur={() => setFocusedField(false)}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                />
              </View>
              {!!emailError && (
                <Text style={[styles.fieldError, { color: c.destructive }]}>{emailError}</Text>
              )}
            </Animated.View>

            {/* Primary action button — disabled + spinner while submitting */}
            <Animated.View entering={FadeInDown.delay(240).duration(350)}>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: loading ? c.primaryDark : c.primary, marginTop: 8 }]}
                onPress={handleSend}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>{t('fp_send')}</Text>
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
  primaryBtn: {
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  primaryBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: '#FFF' },
  fpResendLink: { fontFamily: 'Manrope_500Medium', fontSize: 14, paddingVertical: 8 },
});
