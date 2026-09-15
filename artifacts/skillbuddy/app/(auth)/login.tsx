import React, { useState, useCallback } from 'react';
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

interface FieldErrors {
  email?: string;
  password?: string;
}

function validateEmail(email: string): string | undefined {
  if (!email.trim()) return 'onb_err_email_required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'onb_err_email_invalid';
  return undefined;
}

function validatePassword(pw: string): string | undefined {
  if (!pw) return 'onb_err_password_required';
  if (pw.length < 8) return 'onb_err_password_short';
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw)) return 'onb_err_password_weak';
  return undefined;
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const validateField = useCallback((field: keyof FieldErrors, value: string) => {
    setErrors((prev) => {
      const next = { ...prev };
      if (field === 'email') next.email = validateEmail(value);
      else if (field === 'password') next.password = validatePassword(value);
      return next;
    });
  }, []);

  const markTouched = (field: string) => setTouched((p) => ({ ...p, [field]: true }));

  const handleLogin = async () => {
    const emailErr = validateEmail(email);
    const pwErr = validatePassword(password);
    setErrors({ email: emailErr, password: pwErr });
    setTouched({ email: true, password: true });
    if (emailErr || pwErr) return;

    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? t('login_failed_invalid');
      Alert.alert(t('login_failed'), typeof msg === 'string' ? msg : t('login_failed_invalid'));
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

  const fieldError = (field: keyof FieldErrors) => {
    if (!touched[field] || !errors[field]) return null;
    return (
      <View style={styles.errorRow}>
        <Feather name="alert-circle" size={13} color={c.destructive} />
        <Text style={[styles.errorText, { color: c.destructive }]}>{t(errors[field]! as any)}</Text>
      </View>
    );
  };

  const fieldBorder = (field: string, hasError?: boolean) =>
    hasError ? c.destructive : focusedField === field ? c.primary : c.border;

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

        {/* Title + subtitle — matching web copy */}
        <Animated.View entering={FadeInDown.delay(100).duration(350)} style={styles.titleWrap}>
          <Text style={[styles.title, { color: c.text }]}>{t('onb_login_title_web')}</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('onb_login_subtitle_web')}</Text>
        </Animated.View>

        {/* Form fields */}
        <Animated.View entering={FadeInDown.delay(180).duration(350)}>
          {/* Email */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.text }]}>{t('onb_login_email')}</Text>
            <View style={[styles.inputRow, { backgroundColor: c.input, borderColor: fieldBorder('email', touched.email && !!errors.email), borderWidth: focusedField === 'email' ? 1.5 : 1 }]}>
              <Feather name="mail" size={18} color={focusedField === 'email' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="you@email.com"
                placeholderTextColor={c.mutedForeground}
                value={email}
                onChangeText={setEmail}
                onFocus={() => setFocusedField('email')}
                onBlur={() => { setFocusedField(null); markTouched('email'); validateField('email', email); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {fieldError('email')}
          </View>

          {/* Password */}
          <View style={styles.fieldWrap}>
            <View style={styles.passwordHeader}>
              <Text style={[styles.label, { color: c.text }]}>{t('onb_login_password')}</Text>
              <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password')}>
                <Text style={[styles.forgotText, { color: c.primary }]}>{t('onb_login_forgot')}</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.inputRow, { backgroundColor: c.input, borderColor: fieldBorder('password', touched.password && !!errors.password), borderWidth: focusedField === 'password' ? 1.5 : 1 }]}>
              <Feather name="lock" size={18} color={focusedField === 'password' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="••••••••••••"
                placeholderTextColor={c.mutedForeground}
                value={password}
                onChangeText={setPassword}
                onFocus={() => setFocusedField('password')}
                onBlur={() => { setFocusedField(null); markTouched('password'); validateField('password', password); }}
                secureTextEntry={!showPassword}
              />
              <Pressable hitSlop={8} onPress={() => setShowPassword(!showPassword)}>
                <Feather name={showPassword ? 'eye' : 'eye-off'} size={18} color={c.mutedForeground} />
              </Pressable>
            </View>
            {fieldError('password')}
          </View>

          {/* Primary action button */}
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: loading ? c.primaryDark : c.primary }]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>{t('onb_login_signin')}</Text>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Divider */}
        <Animated.View entering={FadeInDown.delay(240).duration(300)} style={styles.divider}>
          <View style={[styles.divLine, { backgroundColor: c.border }]} />
          <Text style={[styles.divText, { color: c.mutedForeground }]}>{t('onb_choice_or')}</Text>
          <View style={[styles.divLine, { backgroundColor: c.border }]} />
        </Animated.View>

        {/* Full-width social buttons */}
        <Animated.View entering={FadeInDown.delay(280).duration(350)} style={styles.socialCol}>
          <TouchableOpacity
            style={[styles.socialBtn, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={handleGoogleSignIn}
            disabled={loading}
            activeOpacity={0.8}
          >
            {/* Google G mark */}
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

        {/* Switch to signup */}
        <Animated.View entering={FadeInDown.delay(320).duration(300)} style={styles.switchRow}>
          <Text style={[styles.switchText, { color: c.mutedForeground }]}>{t('onb_login_no_account')}</Text>
          <TouchableOpacity onPress={() => router.replace('/(auth)/signup' as any)} hitSlop={6}>
            <Text style={[styles.switchLink, { color: c.primary }]}>{t('onb_login_signup_link')}</Text>
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
  titleWrap: { alignItems: 'center', marginBottom: 28 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 26, marginBottom: 8, textAlign: 'center' },
  subtitle: { fontFamily: 'Manrope_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 8 },
  fieldWrap: { marginBottom: 16 },
  passwordHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 },
  label: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
  forgotText: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
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
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
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
