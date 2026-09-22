import React, { useState } from 'react';
import { Alert, ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { authApi } from '@/services/api';
import BackButton from '@/components/BackButton';
import useProfilePictureUpload from '@/hooks/useProfilePictureUpload';

/** API field name (422 detail[].loc) → local error-state key. */
const FIELD_TO_STATE: Record<string, string> = {
  first_name: 'firstName',
  last_name: 'lastName',
  username: 'username',
  phone_number: 'phone',
};

/** Basic E.164-ish guard: optional '+', 7–15 digits, allowing spaces/dashes/parens. Generic on purpose. */
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;

export default function EditProfileScreen() {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const { pickAndUpload, uploading: picUploading, removePicture, deleting: picDeleting } = useProfilePictureUpload(!!user?.profile_picture);

  const [firstName, setFirstName] = useState(user?.first_name ?? '');
  const [lastName, setLastName] = useState(user?.last_name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const handleSave = async () => {
    setGeneralError(null);
    const errors: Record<string, string> = {};

    // ---- Client-side validation (mirrors signup.tsx patterns) ----
    if (!firstName.trim()) errors.firstName = t('edit_err_first_required');
    else if (firstName.trim().length > 100) errors.firstName = t('edit_err_first_max');
    if (!lastName.trim()) errors.lastName = t('edit_err_last_required');
    else if (lastName.trim().length > 100) errors.lastName = t('edit_err_last_max');
    if (username.trim().length > 100) errors.username = t('edit_err_username_max');
    const trimmedPhone = phone.trim();
    if (trimmedPhone && !PHONE_RE.test(trimmedPhone)) errors.phone = t('edit_err_phone');

    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return; // no network call on invalid input
    }
    setFieldErrors({});

    // True partial update: send only fields whose value differs from the
    // stored profile. Undefined (unchanged) fields are dropped in api.ts.
    const payload: { first_name?: string; last_name?: string; username?: string; phone_number?: string } = {};
    if (firstName.trim() !== (user?.first_name ?? '')) payload.first_name = firstName.trim();
    if (lastName.trim() !== (user?.last_name ?? '')) payload.last_name = lastName.trim();
    if (username.trim() !== (user?.username ?? '')) payload.username = username.trim();
    if (trimmedPhone !== (user?.phone ?? '')) payload.phone_number = trimmedPhone;

    if (Object.keys(payload).length === 0) {
      // Nothing changed — avoid a pointless round-trip.
      router.back();
      return;
    }

    setLoading(true);
    try {
      await authApi.updateUser(payload);
      await refreshUser(); // global state re-syncs every consumer instantly
      Alert.alert(t('edit_saved_title'), t('edit_saved_msg'));
      router.back();
    } catch (err: any) {
      // 422: map detail[].loc field errors back onto the form fields.
      const detail = err?.response?.data?.detail;
      if (Array.isArray(detail)) {
        if (__DEV__) console.log('[edit-profile] 422 detail:', JSON.stringify(detail));
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
        setGeneralError(t('edit_error_msg'));
      } else {
        setGeneralError(t('edit_err_network'));
      }
    } finally {
      setLoading(false);
    }
  };

  /** Avatar edit button: with a picture → Change/Remove menu; without → straight to the picker. */
  const handleAvatarAction = () => {
    if (!user?.profile_picture) {
      void pickAndUpload();
      return;
    }
    Alert.alert(t('pp_change_photo'), undefined, [
      { text: t('pp_change_photo'), onPress: () => void pickAndUpload() },
      { text: t('pp_remove_menu'), style: 'destructive', onPress: () => void removePicture() },
      { text: t('action_cancel'), style: 'cancel' },
    ]);
  };

  const renderField = (
    label: string,
    labelKey: string,
    value: string,
    set: (v: string) => void,
    icon: 'user' | 'phone' | 'at-sign',
    errorKey: string,
    keyboardType: 'default' | 'phone-pad' = 'default',
  ) => (
    <View key={labelKey}>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <View
        style={[
          styles.inputRow,
          { backgroundColor: c.muted, borderColor: fieldErrors[errorKey] ? c.destructive : c.border },
        ]}
      >
        <Feather name={icon} size={18} color={c.mutedForeground} style={{ marginRight: 10 }} />
        <TextInput
          style={[styles.input, { color: c.text }]}
          value={value}
          onChangeText={(v) => {
            set(v);
            if (fieldErrors[errorKey]) setFieldErrors((prev) => { const n = { ...prev }; delete n[errorKey]; return n; });
          }}
          placeholder={label}
          placeholderTextColor={c.mutedForeground}
          keyboardType={keyboardType}
          autoCapitalize={errorKey === 'phone' || errorKey === 'username' ? 'none' : 'words'}
          autoCorrect={errorKey !== 'username'}
        />
      </View>
      {fieldErrors[errorKey] ? (
        <Text style={[styles.errorText, { color: c.destructive }]}>{fieldErrors[errorKey]}</Text>
      ) : null}
    </View>
  );

  const renderReadOnly = (label: string, value: string, icon: 'mail' | 'hash', helperKey: TranslationKey) => (
    <View>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <View style={[styles.inputRow, styles.readOnlyRow, { backgroundColor: c.muted, borderColor: c.border }]}>
        <Feather name={icon} size={18} color={c.mutedForeground} style={{ marginRight: 10 }} />
        <Text style={[styles.readOnly, { color: c.mutedForeground }]}>{value}</Text>
      </View>
      <Text style={[styles.helperText, { color: c.mutedForeground }]}>{t(helperKey)}</Text>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: c.surface, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.title, { color: c.text }]}>{t('edit_title')}</Text>
        <TouchableOpacity onPress={handleSave} disabled={loading} accessibilityLabel={t('action_save')}>
          {loading ? <ActivityIndicator size="small" color={c.primary} /> : (
            <Text style={[styles.saveText, { color: c.primary, opacity: loading ? 0.5 : 1 }]}>{t('action_save')}</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={[styles.avatarWrap, { backgroundColor: c.primaryLight }]}>
          {user?.profile_picture ? (
            <Image source={{ uri: user.profile_picture }} style={styles.avatarImage} />
          ) : (
            <Text style={[styles.avatarText, { color: c.primary }]}>{firstName.charAt(0)}</Text>
          )}
          <TouchableOpacity
            style={[styles.cameraBtn, { backgroundColor: c.primary, opacity: picUploading || picDeleting ? 0.6 : 1 }]}
            onPress={handleAvatarAction}
            disabled={picUploading || picDeleting}
            accessibilityLabel={t('pp_change_photo')}
          >
            {picUploading || picDeleting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Feather name="camera" size={14} color="#FFF" />
            )}
          </TouchableOpacity>
        </View>

        {renderField(t('edit_first_name'), 'edit_first_name', firstName, setFirstName, 'user', 'firstName')}
        {renderField(t('edit_last_name'), 'edit_last_name', lastName, setLastName, 'user', 'lastName')}
        {renderField(t('edit_username'), 'edit_username', username, setUsername, 'at-sign', 'username')}
        {renderField(t('edit_phone'), 'edit_phone', phone, setPhone, 'phone', 'phone', 'phone-pad')}

        {renderReadOnly(t('edit_email_readonly'), user?.email ?? '', 'mail', 'edit_email_helper')}
        {renderReadOnly(t('edit_personal_code'), user?.personal_code ?? '—', 'hash', 'edit_personal_code_helper')}

        {generalError ? (
          <View style={[styles.errorBanner, { backgroundColor: c.destructive + '18', borderColor: c.destructive }]}>
            <Feather name="alert-circle" size={16} color={c.destructive} />
            <Text style={[styles.errorBannerText, { color: c.destructive }]}>{generalError}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  title: { flex: 1, fontFamily: 'Manrope_700Bold', fontSize: 18, color: '#1A1A1A' },
  saveText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  avatarWrap: { width: 88, height: 88, borderRadius: 44, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: 8, position: 'relative' },
  avatarText: { fontFamily: 'Manrope_700Bold', fontSize: 36 },
  avatarImage: { width: 88, height: 88, borderRadius: 44 },
  cameraBtn: { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFF' },
  label: { fontFamily: 'Manrope_500Medium', fontSize: 13, color: '#1A1A1A', marginBottom: 8 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F5F5',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1, borderColor: '#E8E8E8',
  },
  readOnlyRow: { opacity: 0.7 },
  input: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, color: '#1A1A1A' },
  readOnly: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, color: '#9E9E9E' },
  helperText: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 6 },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 12, marginTop: 6 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, padding: 12 },
  errorBannerText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 13 },
});
