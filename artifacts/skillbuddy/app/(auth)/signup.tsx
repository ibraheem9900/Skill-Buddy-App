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

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { signup, mockSignIn } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const handleSignup = async () => {
    if (!firstName || !email || !password) {
      Alert.alert(t('login_err_title'), t('signup_err_required'));
      return;
    }
    if (!agreed) {
      Alert.alert(t('login_err_title'), t('signup_err_terms'));
      return;
    }
    if (password.length < 8) {
      Alert.alert(t('login_err_title'), t('signup_err_password'));
      return;
    }
    setLoading(true);
    try {
      // TEMPORARY: using mockSignIn since signup validation is disabled for now
      await mockSignIn({
        first_name: firstName.trim() || 'User',
        last_name: lastName.trim(),
        email: email.trim() || 'user@example.com',
      });
      // RouteGate in app/_layout.tsx sees isAuthenticated flip to true and
      // automatically redirects into (tabs)
    } catch (err: any) {
      Alert.alert(t('signup_failed_title'), t('signup_failed_msg'));
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

  const fieldBorder = (field: string) =>
    focusedField === field ? c.primary : c.border;

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

        {/* Form fields */}
        <Animated.View entering={FadeInDown.delay(180).duration(350)}>
          {/* First Name */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.text }]}>{t('onb_signup_first_name')}</Text>
            <View style={[styles.inputRow, { backgroundColor: c.input, borderColor: fieldBorder('firstName'), borderWidth: focusedField === 'firstName' ? 1.5 : 1 }]}>
              <Feather name="user" size={18} color={focusedField === 'firstName' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder={t('onb_signup_first_name')}
                placeholderTextColor={c.mutedForeground}
                value={firstName}
                onChangeText={setFirstName}
                onFocus={() => setFocusedField('firstName')}
                onBlur={() => setFocusedField(null)}
                autoCapitalize="words"
              />
            </View>
          </View>

          {/* Last Name */}
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

          {/* Email */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.text }]}>{t('onb_signup_email')}</Text>
            <View style={[styles.inputRow, { backgroundColor: c.input, borderColor: fieldBorder('email'), borderWidth: focusedField === 'email' ? 1.5 : 1 }]}>
              <Feather name="mail" size={18} color={focusedField === 'email' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="example@email.com"
                placeholderTextColor={c.mutedForeground}
                value={email}
                onChangeText={setEmail}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

          {/* Password */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.text }]}>{t('onb_signup_password')}</Text>
            <View style={[styles.inputRow, { backgroundColor: c.input, borderColor: fieldBorder('password'), borderWidth: focusedField === 'password' ? 1.5 : 1 }]}>
              <Feather name="lock" size={18} color={focusedField === 'password' ? c.primary : c.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="••••••••••••"
                placeholderTextColor={c.mutedForeground}
                value={password}
                onChangeText={setPassword}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
                secureTextEntry={!showPassword}
              />
              <Pressable hitSlop={8} onPress={() => setShowPassword(!showPassword)}>
                <Feather name={showPassword ? 'eye' : 'eye-off'} size={18} color={c.mutedForeground} />
              </Pressable>
            </View>
          </View>

          {/* Terms checkbox */}
          <TouchableOpacity style={styles.termsRow} onPress={() => setAgreed(!agreed)} activeOpacity={0.7}>
            <View style={[styles.checkbox, { borderColor: c.border }, agreed && { backgroundColor: c.primary, borderColor: c.primary }]}>
              {agreed && <Feather name="check" size={12} color="#FFF" />}
            </View>
            <Text style={[styles.termsText, { color: c.text }]}>
              {t('onb_signup_agree')}
              <Text style={{ color: c.primary, fontFamily: 'Manrope_500Medium' }}>{t('onb_signup_terms')}</Text>
            </Text>
          </TouchableOpacity>

          {/* Primary action button */}
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
