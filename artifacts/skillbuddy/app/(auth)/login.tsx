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

type Mode = 'login' | 'signup';

interface FieldErrors {
  email?: string;
  password?: string;
  firstName?: string;
  terms?: string;
}

// ── Simple inline validation (currently only used for Log In — see
// handleSignup below for why signup validation is disabled for now) ────────
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

// ── Google "G" mark — official colors, used inside a circular icon button ──
function GoogleMark() {
  return <Text style={styles.googleG}>G</Text>;
}

// ── Apple logo — real Apple glyph, per Sign in with Apple guidelines ───────
function AppleMark({ color }: { color: string }) {
  return <Ionicons name="logo-apple" size={22} color={color} />;
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { login, mockSignIn } = useAuth();

  const [mode, setMode] = useState<Mode>('login');
  const isLogin = mode === 'login';

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
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

  const switchMode = (next: Mode) => {
    setMode(next);
    setErrors({});
    setTouched({});
  };

  // ── Submit handlers ──────────────────────────────────────────────────────
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

  const handleSignup = async () => {
    // TEMPORARY: validation intentionally disabled for now — whatever the
    // user types gets used as-is and they're signed straight into the app.
    // To re-enable real validation + the real backend signup flow later,
    // swap this block back to the commented-out version below and use
    // `signup` (from useAuth) instead of `mockSignIn`.
    //
    // const emailErr = validateEmail(email);
    // const pwErr = validatePassword(password);
    // const nameErr = !firstName.trim() ? 'onb_err_name_required' : undefined;
    // const termsErr = !agreed ? 'onb_err_terms_required' : undefined;
    // setErrors({ email: emailErr, password: pwErr, firstName: nameErr, terms: termsErr });
    // setTouched({ email: true, password: true, firstName: true, terms: true });
    // if (emailErr || pwErr || nameErr || termsErr) return;
    // await signup({ email: email.trim(), password, confirm_password: password, first_name: firstName.trim(), last_name: lastName.trim() });

    setLoading(true);
    try {
      await mockSignIn({
        first_name: firstName.trim() || 'User',
        last_name: lastName.trim(),
        email: email.trim() || 'user@example.com',
      });
      // RouteGate in app/_layout.tsx sees isAuthenticated flip to true and
      // automatically redirects into (tabs) — no manual navigation needed.
    } catch (err: any) {
      Alert.alert(t('signup_failed_title'), t('signup_failed_msg'));
    } finally {
      setLoading(false);
    }
  };

  // ── Social auth stubs (wire to real OAuth when backend ready) ─────────────
  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      // TODO: Wire to expo-auth-session Google OAuth + backend token exchange
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
      // TODO: Wire to expo-apple-authentication + backend token exchange
      Alert.alert('Apple Sign-In', 'Apple Sign-In will be available once configured.');
    } catch {
      Alert.alert(t('onb_apple_error'));
    } finally {
      setLoading(false);
    }
  };

  // ── Error helper ──────────────────────────────────────────────────────────
  const fieldError = (field: keyof FieldErrors) => {
    if (!touched[field] || !errors[field]) return null;
    return (
      <View style={styles.errorRow}>
        <Feather name="alert-circle" size={13} color={c.destructive} />
        <Text style={[styles.errorText, { color: c.destructive }]}>{t(errors[field]! as any)}</Text>
      </View>
    );
  };

  // ── Shared field style helper ────────────────────────────────────────────
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
        {/* Back to onboarding */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/(auth)/language-select' as any)}>
          <Feather name="arrow-left" size={22} color={c.text} />
        </TouchableOpacity>

        {/* Compact logo mark */}
        <Animated.View entering={FadeInDown.delay(0).duration(350)} style={styles.logoWrap}>
          <View style={[styles.logoCircle, { backgroundColor: c.primary }]}>
            <LogoImage variant="white" height={22} animateOnMount={false} />
          </View>
        </Animated.View>

        {/* Title + subtitle — swaps with mode, mirrors the reference layout */}
        <Animated.View key={mode} entering={FadeIn.duration(220)} style={styles.titleWrap}>
          <Text style={[styles.title, { color: c.text }]}>
            {isLogin ? t('onb_login_title') : t('onb_signup_title')}
          </Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
            {isLogin ? t('onb_login_subtitle') : t('onb_signup_subtitle')}
          </Text>
        </Animated.View>

        {/* ── Form fields ─────────────────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.delay(120).duration(350)}>
          {/* Signup-only: first/last name */}
          {!isLogin && (
            <>
              <View style={styles.fieldWrap}>
                <Text style={[styles.label, { color: c.text }]}>{t('onb_signup_first_name')}</Text>
                <View style={[styles.inputRow, { backgroundColor: c.input, borderColor: fieldBorder('firstName', touched.firstName && !!errors.firstName), borderWidth: focusedField === 'firstName' ? 1.5 : 1 }]}>
                  <Feather name="user" size={18} color={focusedField === 'firstName' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: c.text }]}
                    placeholder={t('onb_signup_first_name')}
                    placeholderTextColor={c.mutedForeground}
                    value={firstName}
                    onChangeText={setFirstName}
                    onFocus={() => setFocusedField('firstName')}
                    onBlur={() => { setFocusedField(null); markTouched('firstName'); }}
                    autoCapitalize="words"
                  />
                </View>
                {fieldError('firstName')}
              </View>

              <View style={styles.fieldWrap}>
                <Text style={[styles.label, { color: c.text }]}>{t('onb_signup_last_name')}</Text>
                <View style={[styles.inputRow, { backgroundColor: c.input, borderColor: fieldBorder('lastName'), borderWidth: focusedField === 'lastName' ? 1.5 : 1 }]}>
                  <Feather name="user" size={18} color={focusedField === 'lastName' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: c.text }]}
                    placeholder={t('onb_signup_last_name')}
                    placeholderTextColor={c.mutedForeground}
                    value={lastName}
                    onChangeText={setLastName}
                    onFocus={() => setFocusedField('lastName')}
                    onBlur={() => setFocusedField(null)}
                    autoCapitalize="words"
                  />
                </View>
              </View>
            </>
          )}

          {/* Email */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.text }]}>{t('onb_login_email')}</Text>
            <View style={[styles.inputRow, { backgroundColor: c.input, borderColor: fieldBorder('email', touched.email && !!errors.email), borderWidth: focusedField === 'email' ? 1.5 : 1 }]}>
              <Feather name="mail" size={18} color={focusedField === 'email' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="example@email.com"
                placeholderTextColor={c.mutedForeground}
                value={email}
                onChangeText={setEmail}
                onFocus={() => setFocusedField('email')}
                onBlur={() => { setFocusedField(null); if (isLogin) { markTouched('email'); validateField('email', email); } }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {isLogin && fieldError('email')}
          </View>

          {/* Password */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.text }]}>{t('onb_login_password')}</Text>
            <View style={[styles.inputRow, { backgroundColor: c.input, borderColor: fieldBorder('password', touched.password && !!errors.password), borderWidth: focusedField === 'password' ? 1.5 : 1 }]}>
              <Feather name="lock" size={18} color={focusedField === 'password' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="••••••••••••"
                placeholderTextColor={c.mutedForeground}
                value={password}
                onChangeText={setPassword}
                onFocus={() => setFocusedField('password')}
                onBlur={() => { setFocusedField(null); if (isLogin) { markTouched('password'); validateField('password', password); } }}
                secureTextEntry={!showPassword}
              />
              <Pressable hitSlop={8} onPress={() => setShowPassword(!showPassword)}>
                <Feather name={showPassword ? 'eye' : 'eye-off'} size={18} color={c.mutedForeground} />
              </Pressable>
            </View>
            {isLogin && fieldError('password')}
          </View>

          {/* Forgot password (login only) */}
          {isLogin && (
            <TouchableOpacity style={styles.forgotWrap} onPress={() => router.push('/(auth)/forgot-password')}>
              <Text style={[styles.forgotText, { color: c.primary }]}>{t('onb_login_forgot')}</Text>
            </TouchableOpacity>
          )}

          {/* Terms checkbox (signup only) */}
          {!isLogin && (
            <TouchableOpacity style={styles.termsRow} onPress={() => setAgreed(!agreed)} activeOpacity={0.7}>
              <View style={[styles.checkbox, { borderColor: c.border }, agreed && { backgroundColor: c.primary, borderColor: c.primary }]}>
                {agreed && <Feather name="check" size={12} color="#FFF" />}
              </View>
              <Text style={[styles.termsText, { color: c.text }]}>
                {t('onb_signup_agree')}
                <Text style={{ color: c.primary, fontFamily: 'Manrope_500Medium' }}>{t('onb_signup_terms')}</Text>
              </Text>
            </TouchableOpacity>
          )}

          {/* Primary action button */}
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: loading ? c.primaryDark : c.primary }]}
            onPress={isLogin ? handleLogin : handleSignup}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {isLogin ? t('onb_login_signin') : t('onb_signup_create')}
              </Text>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Divider */}
        <Animated.View entering={FadeInDown.delay(180).duration(300)} style={styles.divider}>
          <View style={[styles.divLine, { backgroundColor: c.border }]} />
          <Text style={[styles.divText, { color: c.mutedForeground }]}>{t('onb_or_divider')}</Text>
          <View style={[styles.divLine, { backgroundColor: c.border }]} />
        </Animated.View>

        {/* Social sign-in — circular icon buttons, per official Google/Apple branding */}
        <Animated.View entering={FadeInDown.delay(220).duration(350)} style={styles.socialRow}>
          <TouchableOpacity
            style={[styles.socialCircle, styles.googleCircle]}
            onPress={handleGoogleSignIn}
            disabled={loading}
            activeOpacity={0.8}
          >
            <GoogleMark />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.socialCircle, styles.appleCircle]}
            onPress={handleAppleSignIn}
            disabled={loading}
            activeOpacity={0.8}
          >
            <AppleMark color="#FFFFFF" />
          </TouchableOpacity>
        </Animated.View>

        {/* Switch mode link */}
        <Animated.View entering={FadeInDown.delay(260).duration(300)} style={styles.switchRow}>
          <Text style={[styles.switchText, { color: c.mutedForeground }]}>
            {isLogin ? t('onb_login_no_account') : t('onb_login_have_account')}
          </Text>
          <TouchableOpacity onPress={() => switchMode(isLogin ? 'signup' : 'login')} hitSlop={6}>
            <Text style={[styles.switchLink, { color: c.primary }]}>
              {isLogin ? t('onb_login_signup_link') : t('onb_login_signin_link')}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 24 },
  backBtn: { marginBottom: 8, alignSelf: 'flex-start' },
  logoWrap: { alignItems: 'center', marginTop: 4, marginBottom: 18 },
  logoCircle: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { alignItems: 'center', marginBottom: 28 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 26, marginBottom: 8, textAlign: 'center' },
  subtitle: { fontFamily: 'Manrope_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 12 },
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
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  forgotWrap: { alignSelf: 'flex-end', marginBottom: 18, marginTop: 2 },
  forgotText: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
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
  socialRow: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginBottom: 28 },
  socialCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleCircle: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#DADCE0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  appleCircle: {
    backgroundColor: '#000000',
  },
  googleG: { fontFamily: 'Manrope_700Bold', fontSize: 20, color: '#4285F4' },
  switchRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' },
  switchText: { fontFamily: 'Manrope_400Regular', fontSize: 14 },
  switchLink: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
});
