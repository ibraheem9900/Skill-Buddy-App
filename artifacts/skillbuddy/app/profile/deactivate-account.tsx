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
import { authApi } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import LogoImage from '@/components/LogoImage';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

/**
 * Deactivate Account (Settings → Account → danger zone).
 *
 * DELETE /api/v1/auth/../users/me with body { reason } — deactivation, NOT
 * permanent deletion (the record persists with deactivated=true server-side).
 * Flow: warning screen → pick/type a reason → explicit typed-free confirm →
 * API → on 200 only: clearSession() → out of the authenticated app.
 * On network/5xx failure NOTHING is cleared (retry stays possible); a 401
 * mid-flight means the session was already dead server-side → clear + Login.
 */
export default function DeactivateAccountScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { clearSession } = useAuth();

  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [customReason, setCustomReason] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deactivated, setDeactivated] = useState(false);
  const [serverMsg, setServerMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const REASONS: { key: string; label: string }[] = [
    { key: 'not_useful', label: t('da_reason_not_useful') },
    { key: 'privacy', label: t('da_reason_privacy') },
    { key: 'too_few_providers', label: t('da_reason_too_few_providers') },
    { key: 'switching', label: t('da_reason_switching') },
    { key: 'support', label: t('da_reason_support') },
    { key: 'other', label: t('da_reason_other') },
  ];

  const effectiveReason =
    selectedReason === 'other'
      ? customReason.trim()
      : selectedReason
        ? REASONS.find((r) => r.key === selectedReason)?.label || ''
        : '';

  const reasonError =
    !selectedReason
      ? null
      : selectedReason === 'other' && !customReason.trim()
        ? t('da_err_reason_required')
        : null;

  const handleDeactivate = async () => {
    if (loading || deactivated) return;
    setFormError(null);

    // ---- Client-side gates (before any network call) ----
    if (!selectedReason) {
      setFormError(t('da_err_reason_required'));
      return;
    }
    if (selectedReason === 'other' && !customReason.trim()) {
      setFormError(t('da_err_reason_required'));
      return;
    }
    if (!confirmChecked) {
      setFormError(t('da_err_confirm'));
      return;
    }

    setLoading(true);
    try {
      // DELETE /api/v1/users/me — reason in the JSON body, Bearer auto-attached.
      const res = await authApi.deactivateAccount(effectiveReason);
      // Session is over server-side → wipe local state FIRST, then show the
      // post-deactivation card (this screen, now unauthenticated — RouteGate
      // leaves /profile/* alone, so the card renders safely).
      await clearSession();
      setServerMsg(
        typeof res?.data?.message === 'string' && res.data.message ? res.data.message : null
      );
      setDeactivated(true);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        // Session already dead server-side → clean up and go to Login.
        await clearSession();
        router.replace('/(auth)/login' as any);
      } else if (status === 422) {
        // e.g. reason rejected server-side — let the user correct it.
        setFormError(t('da_err_reason_rejected'));
      } else if (!err?.response) {
        // Request never reached the server → do NOT clear tokens; retry.
        setFormError(t('rp_err_network'));
      } else {
        setFormError(t('da_err_generic'));
      }
    } finally {
      setLoading(false);
    }
  };

  if (deactivated) {
    return (
      <View style={[styles.screen, { backgroundColor: c.background }]}>
        <View style={[styles.center, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 32 }]}>
          <Animated.View entering={FadeInDown.duration(350)} style={styles.centerInner}>
            <View style={[styles.iconCircle, { backgroundColor: c.card }]}>
              <Feather name="user-x" size={48} color={c.mutedForeground} />
            </View>
            <Text style={[styles.title, { color: c.text }]}>{t('da_success_title')}</Text>
            <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
              {serverMsg || t('da_success_msg')}
            </Text>
            <TouchableOpacity
              style={[styles.dangerBtn, { backgroundColor: c.destructive }]}
              onPress={() => router.replace('/(auth)/login' as any)}
              activeOpacity={0.85}
            >
              <Text style={styles.dangerBtnText}>{t('da_success_btn')}</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>
    );
  }

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
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={c.text} />
        </TouchableOpacity>

        <Animated.View entering={FadeInDown.delay(0).duration(350)} style={styles.logoWrap}>
          <LogoImage variant={c.background === '#0A0D0D' ? 'light' : 'green'} height={40} animateOnMount={false} />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(100).duration(350)} style={styles.titleWrap}>
          <View style={[styles.dangerIconWrap, { backgroundColor: c.card }]}>
            <Feather name="alert-triangle" size={30} color={c.destructive} />
          </View>
          <Text style={[styles.title, { color: c.destructive }]}>{t('da_title')}</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('da_subtitle')}</Text>
        </Animated.View>

        {/* What deactivation means */}
        <Animated.View entering={FadeInDown.delay(160).duration(350)} style={[styles.infoBox, { backgroundColor: c.card, borderColor: c.border }]}>
          {['da_point_1', 'da_point_2', 'da_point_3'].map((k, i) => (
            <React.Fragment key={k}>
              {i > 0 && <View style={[styles.infoDivider, { backgroundColor: c.border }]} />}
              <View style={styles.infoRow}>
                <Feather name="info" size={15} color={c.mutedForeground} style={styles.infoIcon} />
                <Text style={[styles.infoText, { color: c.text }]}>{t(k as any)}</Text>
              </View>
            </React.Fragment>
          ))}
        </Animated.View>

        {/* Reason selection — required by the API schema */}
        <Animated.View entering={FadeInDown.delay(220).duration(350)}>
          <Text style={[styles.label, { color: c.text }]}>{t('da_reason_label')}</Text>
          {REASONS.map((r) => (
            <TouchableOpacity
              key={r.key}
              style={[
                styles.reasonRow,
                {
                  backgroundColor: c.card,
                  borderColor: selectedReason === r.key ? c.destructive : c.border,
                  borderWidth: selectedReason === r.key ? 1.5 : 1,
                },
              ]}
              onPress={() => { setSelectedReason(r.key); setFormError(null); }}
              activeOpacity={0.8}
            >
              <View
                style={[
                  styles.radio,
                  { borderColor: selectedReason === r.key ? c.destructive : c.border },
                  selectedReason === r.key && { borderColor: c.destructive },
                ]}
              >
                {selectedReason === r.key && <View style={[styles.radioDot, { backgroundColor: c.destructive }]} />}
              </View>
              <Text style={[styles.reasonText, { color: c.text }]}>{r.label}</Text>
            </TouchableOpacity>
          ))}

          {/* Custom reason input when "Other" is selected */}
          {selectedReason === 'other' && (
            <Animated.View entering={FadeIn.duration(200)} style={styles.fieldWrap}>
              <Text style={[styles.label, { color: c.text }]}>{t('da_reason_custom_label')}</Text>
              <View
                style={[
                  styles.inputRow,
                  { backgroundColor: c.input, borderColor: reasonError ? c.destructive : c.border, borderWidth: reasonError ? 1.5 : 1 },
                ]}
              >
                <TextInput
                  style={[styles.input, { color: c.text }]}
                  placeholder={t('da_reason_custom_placeholder')}
                  placeholderTextColor={c.mutedForeground}
                  value={customReason}
                  onChangeText={(v) => { setCustomReason(v); setFormError(null); }}
                  multiline
                  maxLength={500}
                  editable={!loading}
                />
              </View>
            </Animated.View>
          )}
        </Animated.View>

        {/* Strong confirmation checkbox */}
        <Animated.View entering={FadeInDown.delay(280).duration(350)}>
          <TouchableOpacity
            style={styles.termsRow}
            onPress={() => { setConfirmChecked(!confirmChecked); setFormError(null); }}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.checkbox,
                { borderColor: c.border },
                confirmChecked && { backgroundColor: c.destructive, borderColor: c.destructive },
              ]}
            >
              {confirmChecked && <Feather name="check" size={12} color="#FFF" />}
            </View>
            <Text style={[styles.termsText, { color: c.text }]}>{t('da_confirm_text')}</Text>
          </TouchableOpacity>

          {/* General error banner (validation, network, 422, other) */}
          {!!formError && (
            <Animated.View entering={FadeIn.duration(200)} style={[styles.errorBanner, { backgroundColor: c.card, borderColor: c.destructive }]}>
              <Feather name="alert-circle" size={16} color={c.destructive} />
              <Text style={[styles.errorBannerText, { color: c.destructive }]}>{formError}</Text>
            </Animated.View>
          )}

          {/* Destructive action button — disabled + spinner while in flight */}
          <TouchableOpacity
            style={[styles.dangerBtn, { backgroundColor: c.destructive, opacity: loading ? 0.6 : 1 }]}
            onPress={handleDeactivate}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.dangerBtnText}>{t('da_submit')}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.keepBtn} onPress={() => router.back()} disabled={loading}>
            <Text style={[styles.keepBtnText, { color: c.primary }]}>{t('da_keep')}</Text>
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
  logoWrap: { alignItems: 'center', marginTop: 8, marginBottom: 16 },
  titleWrap: { alignItems: 'center', marginBottom: 20 },
  dangerIconWrap: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 24, marginBottom: 8, textAlign: 'center' },
  subtitle: { fontFamily: 'Manrope_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  centerInner: { alignItems: 'center', gap: 14, width: '100%' },
  iconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  infoBox: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 20 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8 },
  infoIcon: { marginTop: 2 },
  infoText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 18 },
  infoDivider: { height: 1 },
  label: { fontFamily: 'Manrope_500Medium', fontSize: 13, marginBottom: 8 },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    marginBottom: 8,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  reasonText: { fontFamily: 'Manrope_400Regular', fontSize: 14, flex: 1 },
  fieldWrap: { marginTop: 4, marginBottom: 8 },
  inputRow: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1 },
  input: { fontFamily: 'Manrope_400Regular', fontSize: 14, minHeight: 44, textAlignVertical: 'top' },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 8, marginBottom: 16 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  termsText: { fontFamily: 'Manrope_400Regular', fontSize: 13, flex: 1, lineHeight: 18 },
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
  dangerBtn: {
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  dangerBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: '#FFF' },
  keepBtn: { alignItems: 'center', paddingVertical: 14 },
  keepBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
});
