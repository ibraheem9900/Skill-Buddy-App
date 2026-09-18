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
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import type { TranslationKey } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import LogoImage from '@/components/LogoImage';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

// Same rule as Signup/Reset: min 8 chars, uppercase + lowercase + number,
// max 128 per the API schema.
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$/;

/**
 * Change Password (logged-in user, Settings → Account).
 *
 * POST /api/v1/auth/change-password — Bearer token is attached automatically
 * by the shared axios instance. The backend invalidates existing sessions on
 * success (docs description + docs screenshots), so on 200 the user is logged
 * out locally and pushed to Login to sign in with the new password.
 */
export default function ChangePasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { logout } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
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

  const handleChange = async () => {
    if (loading || succeeded) return;
    setFormError(null);

    // ---- Client-side validation (before any network call) ----
    const errors: Record<string, string> = {};
    if (!currentPassword) errors.currentPassword = t('rp_err_required');
    if (!newPassword) errors.newPassword = t('rp_err_required');
    else if (newPassword === currentPassword)
      errors.newPassword = t('cp_err_same');
    else if (!PASSWORD_RE.test(newPassword)) errors.newPassword = t('onb_err_password_weak');
    if (!confirmPassword) errors.confirmPassword = t('rp_err_required');
    else if (newPassword && confirmPassword && newPassword !== confirmPassword)
      errors.confirmPassword = t('onb_err_confirm_password');

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setLoading(true);
    setFieldErrors({});
    try {
      // POST /api/v1/auth/change-password — protected endpoint, Bearer token
      // attached automatically by the shared instance (with silent refresh).
      await authApi.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      // Success → the backend has invalidated existing sessions. Clear all
      // local credential state immediately and force a fresh login.
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSucceeded(true);
      await logout();
    } catch (err: any) {
      const status = err?.response?.status;
      if (!err?.response) {
        setFormError(t('rp_err_network'));
      } else if (status === 401) {
        // Access token invalid/expired even after refresh → the axios layer
        // already cleared tokens and fired the session-expired handler; send
        // the user to Login with an explanatory message.
        setSucceeded(false);
        setFormError(t('cp_err_session'));
        await logout();
      } else if (status === 422) {
        // Pydantic detail[].input echoes submitted values — map fields in
        // memory, never log the raw detail array.
        const detail = err.response.data?.detail;
        const fields: Record<string, string> = {};
        let general: string | null = null;
        if (Array.isArray(detail)) {
          for (const d of detail) {
            const field = Array.isArray(d?.loc) ? String(d.loc[d.loc.length - 1]) : null;
            const msg = typeof d?.msg === 'string' ? d.msg : '';
            const clean = msg.startsWith('Value error, ') ? msg.slice('Value error, '.length) : msg;
            if (field === 'current_password') fields.currentPassword = clean || t('cp_err_current');
            else if (field === 'new_password') fields.newPassword = clean || t('onb_err_password_weak');
            else if (field === 'body' && /same|identical|different/i.test(clean))
              fields.newPassword = clean;
            else general = clean || general || t('rp_err_generic');
          }
        } else if (typeof detail === 'string') {
          // Backend may return a plain-string detail for business rules.
          if (/current password/i.test(detail)) fields.currentPassword = t('cp_err_current');
          else general = detail;
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

  const passwordField = (
    labelKey: TranslationKey,
    value: string,
    setter: (v: string) => void,
    keyName: string,
    show: boolean,
    setShow: (v: boolean) => void,
  ) => (
    <View style={styles.fieldWrap}>
      <Text style={[styles.label, { color: c.text }]}>{t(labelKey)}</Text>
      <View
        style={[
          styles.inputRow,
          { backgroundColor: c.input, borderColor: fieldBorder(keyName), borderWidth: focusedField === keyName || fieldErrors[keyName] ? 1.5 : 1 },
        ]}
      >
        <Feather name="lock" size={18} color={focusedField === keyName ? c.primary : c.mutedForeground} style={styles.inputIcon} />
        <TextInput
          style={[styles.input, { color: c.text }]}
          placeholder="••••••••••••"
          placeholderTextColor={c.mutedForeground}
          value={value}
          onChangeText={(v) => { setter(v); clearError(keyName); }}
          onFocus={() => setFocusedField(keyName)}
          onBlur={() => setFocusedField(null)}
          secureTextEntry={!show}
          autoCapitalize="none"
          editable={!loading}
        />
        <Pressable hitSlop={8} onPress={() => setShow(!show)}>
          <Feather name={show ? 'eye' : 'eye-off'} size={18} color={c.mutedForeground} />
        </Pressable>
      </View>
      {renderFieldError(keyName)}
    </View>
  );

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
        {/* Back — hidden after success so the confirmation is the only way forward */}
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
            <Text style={[styles.title, { color: c.text }]}>{t('cp_success_title')}</Text>
            <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('cp_success_msg')}</Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: c.primary, alignSelf: 'stretch' }]}
              onPress={() => router.replace('/(auth)/login' as any)}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>{t('cp_goto_login')}</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <>
            {/* Standalone logo — auth/profile template */}
            <Animated.View entering={FadeInDown.delay(0).duration(350)} style={styles.logoWrap}>
              <LogoImage variant={c.background === '#0A0D0D' ? 'light' : 'green'} height={40} animateOnMount={false} />
            </Animated.View>

            {/* Title + subtitle */}
            <Animated.View entering={FadeInDown.delay(100).duration(350)} style={styles.titleWrap}>
              <Text style={[styles.title, { color: c.text }]}>{t('settings_change_password')}</Text>
              <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('cp_subtitle')}</Text>
            </Animated.View>

            {/* General error banner (network / session / unmapped errors) */}
            {!!formError && (
              <Animated.View entering={FadeIn.duration(200)} style={[styles.errorBanner, { backgroundColor: c.card, borderColor: c.destructive }]}>
                <Feather name="alert-circle" size={16} color={c.destructive} />
                <Text style={[styles.errorBannerText, { color: c.destructive }]}>{formError}</Text>
              </Animated.View>
            )}

            <Animated.View entering={FadeInDown.delay(180).duration(350)}>
              {passwordField('cp_current_label', currentPassword, setCurrentPassword, 'currentPassword', showCurrent, setShowCurrent)}
              {passwordField('cp_new_label', newPassword, setNewPassword, 'newPassword', showNew, setShowNew)}
              {passwordField('cp_confirm_label', confirmPassword, setConfirmPassword, 'confirmPassword', showConfirm, setShowConfirm)}

              {/* Primary action button — disabled + spinner while submitting */}
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: loading ? c.primaryDark : c.primary, marginTop: 8 }]}
                onPress={handleChange}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>{t('settings_change_password')}</Text>
                )}
              </TouchableOpacity>

              {/* Session note so the forced logout doesn't surprise the user */}
              <Text style={[styles.sessionNote, { color: c.mutedForeground }]}>{t('cp_session_note')}</Text>
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
  primaryBtn: {
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  primaryBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: '#FFF' },
  sessionNote: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 14 },
});
