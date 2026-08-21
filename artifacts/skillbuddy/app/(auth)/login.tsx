import React, { useState, useCallback } from 'react';
import {
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
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';

type Mode = 'login' | 'signup';

interface FieldErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
  firstName?: string;
  lastName?: string;
  terms?: string;
}

// ── Simple inline validation ────────────────────────────────────────────────
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

// ── Google "G" logo as inline SVG-like component ────────────────────────────
function GoogleLogo() {
  return (
    <View style={googleStyles.wrap}>
      <Text style={googleStyles.g}>G</Text>
    </View>
  );
}
const googleStyles = StyleSheet.create({
  wrap: { width: 22, height: 22, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  g: { fontFamily: 'Manrope_700Bold', fontSize: 18, color: '#4285F4' },
});

// ── Apple logo ──────────────────────────────────────────────────────────────
function AppleLogo({ color }: { color: string }) {
  return <Feather name="smartphone" size={20} color={color} />;
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { login, signup } = useAuth();

  const [mode, setMode] = useState<Mode>('login');

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Live validation on blur
  const validateField = useCallback((field: string, value: string) => {
    setErrors((prev) => {
      const next = { ...prev };
      if (field === 'email') next.email = validateEmail(value);
      else if (field === 'password') next.password = validatePassword(value);
      else if (field === 'confirmPassword') {
        next.confirmPassword = value !== password ? 'onb_err_confirm_password' : undefined;
      } else if (field === 'firstName') {
        next.firstName = !value.trim() ? 'onb_err_name_required' : undefined;
      }
      return next;
    });
  }, [password]);

  const markTouched = (field: string) => setTouched((p) => ({ ...p, [field]: true }));

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
    const emailErr = validateEmail(email);
    const pwErr = validatePassword(password);
    const confirmErr = confirmPassword !== password ? 'onb_err_confirm_password' : undefined;
    const nameErr = !firstName.trim() ? 'onb_err_name_required' : undefined;
    const termsErr = !agreed ? 'onb_err_terms_required' : undefined;

    setErrors({
      email: emailErr,
      password: pwErr,
      confirmPassword: confirmErr,
      firstName: nameErr,
      terms: termsErr,
    });
    setTouched({ email: true, password: true, confirmPassword: true, firstName: true, terms: true });

    if (emailErr || pwErr || confirmErr || nameErr || termsErr) return;

    setLoading(true);
    try {
      await signup({
        email: email.trim(),
        password,
        confirm_password: confirmPassword,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      });
      Alert.alert(t('signup_title'), t('ve_subtitle'));
      setMode('login');
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? t('signup_failed_msg');
      Alert.alert(t('signup_failed_title'), typeof msg === 'string' ? msg : t('signup_failed_msg'));
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

  const isLogin = mode === 'login';

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

  // ── Shared input style ───────────────────────────────────────────────────
  const inputBg = c.input;
  const inputBorder = c.border;
  const textColor = c.text;
  const mutedColor = c.mutedForeground;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Back to onboarding */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/(auth)/language-select' as any)}>
          <Feather name="arrow-left" size={22} color={c.text} />
        </TouchableOpacity>

        {/* Logo */}
        <Animated.View entering={FadeInDown.delay(0).duration(350)} style={styles.logoWrap}>
          <View style={[styles.logoCircle, { backgroundColor: c.primary }]}>
            <Feather name="zap" size={32} color="#FFF" />
          </View>
          <Text style={[styles.brandName, { color: c.text }]}>SkillBuddy</Text>
        </Animated.View>

        {/* Tab switcher: Login / Signup */}
        <Animated.View entering={FadeInDown.delay(80).duration(350)} style={[styles.tabRow, { backgroundColor: c.muted }]}>
          {(['login', 'signup'] as Mode[]).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.tab, mode === m && { backgroundColor: c.primary }]}
              onPress={() => { setMode(m); setErrors({}); setTouched({}); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, mode === m && { color: '#FFF' }]}>
                {m === 'login' ? t('onb_login_tab') : t('onb_signup_tab')}
              </Text>
            </TouchableOpacity>
          ))}
        </Animated.View>

        {/* Social buttons */}
        <Animated.View entering={FadeInDown.delay(160).duration(350)} style={styles.socialWrap}>
          {/* Google — official branding: white bg, colored G, standard border */}
          <TouchableOpacity style={[styles.socialBtn, styles.googleBtn]} onPress={handleGoogleSignIn} disabled={loading}>
            <GoogleLogo />
            <Text style={[styles.socialBtnText, { color: '#1F1F1F' }]}>{t('onb_google_signin')}</Text>
          </TouchableOpacity>

          {/* Apple — official branding: dark bg, white Apple logo */}
          <TouchableOpacity style={[styles.socialBtn, styles.appleBtn]} onPress={handleAppleSignIn} disabled={loading}>
            <AppleLogo color="#FFFFFF" />
            <Text style={[styles.socialBtnText, { color: '#FFFFFF' }]}>{t('onb_apple_signin')}</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Divider */}
        <Animated.View entering={FadeInDown.delay(220).duration(300)} style={styles.divider}>
          <View style={[styles.divLine, { backgroundColor: c.border }]} />
          <Text style={[styles.divText, { color: c.mutedForeground }]}>{t('onb_or_divider')}</Text>
          <View style={[styles.divLine, { backgroundColor: c.border }]} />
        </Animated.View>

        {/* ── Form fields ─────────────────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.delay(260).duration(350)}>
          {/* Signup-only: first/last name */}
          {!isLogin && (
            <>
              <View style={styles.fieldWrap}>
                <Text style={[styles.label, { color: c.text }]}>{t('onb_signup_first_name')}</Text>
                <View style={[styles.inputRow, { backgroundColor: inputBg, borderColor: touched.firstName && errors.firstName ? c.destructive : inputBorder }]}>
                  <Feather name="user" size={18} color={mutedColor} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: textColor }]}
                    placeholder={t('onb_signup_first_name')}
                    placeholderTextColor={mutedColor}
                    value={firstName}
                    onChangeText={setFirstName}
                    onBlur={() => { markTouched('firstName'); validateField('firstName', firstName); }}
                    autoCapitalize="words"
                  />
                </View>
                {fieldError('firstName')}
              </View>

              <View style={styles.fieldWrap}>
                <Text style={[styles.label, { color: c.text }]}>{t('onb_signup_last_name')}</Text>
                <View style={[styles.inputRow, { backgroundColor: inputBg, borderColor: inputBorder }]}>
                  <Feather name="user" size={18} color={mutedColor} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: textColor }]}
                    placeholder={t('onb_signup_last_name')}
                    placeholderTextColor={mutedColor}
                    value={lastName}
                    onChangeText={setLastName}
                    autoCapitalize="words"
                  />
                </View>
              </View>
            </>
          )}

          {/* Email */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.text }]}>{t('onb_login_email')}</Text>
            <View style={[styles.inputRow, { backgroundColor: inputBg, borderColor: touched.email && errors.email ? c.destructive : inputBorder }]}>
              <Feather name="mail" size={18} color={mutedColor} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: textColor }]}
                placeholder="example@email.com"
                placeholderTextColor={mutedColor}
                value={email}
                onChangeText={setEmail}
                onBlur={() => { markTouched('email'); validateField('email', email); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {fieldError('email')}
          </View>

          {/* Password */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.text }]}>{t('onb_login_password')}</Text>
            <View style={[styles.inputRow, { backgroundColor: inputBg, borderColor: touched.password && errors.password ? c.destructive : inputBorder }]}>
              <Feather name="lock" size={18} color={mutedColor} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: textColor }]}
                placeholder="••••••••••••"
                placeholderTextColor={mutedColor}
                value={password}
                onChangeText={setPassword}
                onBlur={() => { markTouched('password'); validateField('password', password); }}
                secureTextEntry={!showPassword}
              />
              <Pressable onPress={() => setShowPassword(!showPassword)}>
                <Feather name={showPassword ? 'eye' : 'eye-off'} size={18} color={mutedColor} />
              </Pressable>
            </View>
            {fieldError('password')}
          </View>

          {/* Signup-only: confirm password */}
          {!isLogin && (
            <View style={styles.fieldWrap}>
              <Text style={[styles.label, { color: c.text }]}>{t('onb_signup_confirm_password')}</Text>
              <View style={[styles.inputRow, { backgroundColor: inputBg, borderColor: touched.confirmPassword && errors.confirmPassword ? c.destructive : inputBorder }]}>
                <Feather name="lock" size={18} color={mutedColor} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: textColor }]}
                  placeholder="••••••••••••"
                  placeholderTextColor={mutedColor}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  onBlur={() => { markTouched('confirmPassword'); validateField('confirmPassword', confirmPassword); }}
                  secureTextEntry={!showPassword}
                />
              </View>
              {fieldError('confirmPassword')}
            </View>
          )}

          {/* Forgot password (login only) */}
          {isLogin && (
            <TouchableOpacity style={styles.forgotWrap} onPress={() => router.push('/(auth)/forgot-password')}>
              <Text style={[styles.forgotText, { color: c.primary }]}>{t('onb_login_forgot')}</Text>
            </TouchableOpacity>
          )}

          {/* Terms checkbox (signup only) */}
          {!isLogin && (
            <TouchableOpacity style={styles.termsRow} onPress={() => setAgreed(!agreed)}>
              <View style={[styles.checkbox, agreed && { backgroundColor: c.primary, borderColor: c.primary }]}>
                {agreed && <Feather name="check" size={12} color="#FFF" />}
              </View>
              <Text style={[styles.termsText, { color: c.text }]}>
                {t('onb_signup_agree')}
                <Text style={{ color: c.primary, fontFamily: 'Manrope_500Medium' }}>{t('onb_signup_terms')}</Text>
              </Text>
            </TouchableOpacity>
          )}
          {fieldError('terms')}

          {/* Primary action button */}
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: loading ? c.primaryDark : c.primary }]}
            onPress={isLogin ? handleLogin : handleSignup}
            disabled={loading}
            activeOpacity={0.8}
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

        {/* Switch mode link */}
        <Animated.View entering={FadeInDown.delay(340).duration(300)} style={styles.switchRow}>
          <Text style={[styles.switchText, { color: c.mutedForeground }]}>
            {isLogin ? t('onb_login_no_account') : t('onb_login_have_account')}
          </Text>
          <TouchableOpacity onPress={() => { setMode(isLogin ? 'signup' : 'login'); setErrors({}); setTouched({}); }}>
            <Text style={[styles.switchLink, { color: c.primary }]}>
              {isLogin ? t('onb_login_signup_link') : t('onb_login_signin_link')}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24 },
  backBtn: { marginBottom: 16 },
  logoWrap: { alignItems: 'center', marginBottom: 24 },
  logoCircle: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  brandName: { fontFamily: 'Manrope_700Bold', fontSize: 24 },
  tabRow: { flexDirection: 'row', borderRadius: 14, padding: 4, marginBottom: 24 },
  tab: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  tabText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, color: '#737373' },
  socialWrap: { gap: 12, marginBottom: 20 },
  socialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 15,
    borderRadius: 14,
    minHeight: 50,
  },
  googleBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#DADCE0',
  },
  appleBtn: {
    backgroundColor: '#000000',
  },
  socialBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  divLine: { flex: 1, height: 1 },
  divText: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
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
  input: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  forgotWrap: { alignSelf: 'flex-end', marginBottom: 16, marginTop: 2 },
  forgotText: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16, marginTop: 4 },
  checkbox: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 2,
    borderColor: '#E8E8E8', alignItems: 'center', justifyContent: 'center',
  },
  termsText: { fontFamily: 'Manrope_400Regular', fontSize: 13, flex: 1 },
  primaryBtn: { borderRadius: 28, paddingVertical: 16, alignItems: 'center', marginBottom: 16, minHeight: 52 },
  primaryBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: '#FFF' },
  switchRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  switchText: { fontFamily: 'Manrope_400Regular', fontSize: 14 },
  switchLink: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
});
