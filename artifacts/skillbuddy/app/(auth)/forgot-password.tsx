import React, { useState } from 'react';
import { Alert, ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { authApi } from '@/services/api';

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!email.trim()) { Alert.alert(t('fp_err_title'), t('fp_err_email')); return; }
    setLoading(true);
    try {
      await authApi.forgotPassword(email.trim());
      setSent(true);
    } catch {
      Alert.alert(t('fp_err_title'), t('fp_err_send'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Feather name="arrow-left" size={22} color={c.text} />
      </TouchableOpacity>
      {sent ? (
        <View style={styles.center}>
          <View style={[styles.iconCircle, { backgroundColor: c.primaryLight }]}>
            <Feather name="check-circle" size={48} color={c.primary} />
          </View>
          <Text style={[styles.title, { color: c.text }]}>{t('fp_check_email')}</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('fp_sent', { email })}</Text>
          <TouchableOpacity style={[styles.btn, { backgroundColor: c.primary }]} onPress={() => router.replace('/(auth)/login')}>
            <Text style={styles.btnText}>{t('fp_back_login')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.content}>
          <View style={[styles.iconCircle, { backgroundColor: c.primaryLight }]}>
            <Feather name="lock" size={40} color={c.primary} />
          </View>
          <Text style={[styles.title, { color: c.text }]}>{t('fp_title')}</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('fp_subtitle')}</Text>
          <Text style={[styles.label, { color: c.text }]}>{t('fp_email_label')}</Text>
          <View style={[styles.inputRow, { backgroundColor: c.input, borderColor: c.border }]}>
            <Feather name="mail" size={18} color={c.mutedForeground} style={{ marginRight: 10 }} />
            <TextInput
              style={[styles.input, { color: c.text }]}
              placeholder="example@gmail.com"
              placeholderTextColor={c.mutedForeground}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
          <TouchableOpacity style={[styles.btn, { backgroundColor: loading ? c.primaryDark : c.primary }]} onPress={handleSend} disabled={loading}>
            {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnText}>{t('fp_send')}</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
  back: { marginBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  content: { gap: 12 },
  iconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 8, alignSelf: 'center' },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 24, textAlign: 'center' },
  subtitle: { fontFamily: 'Manrope_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 8 },
  label: { fontFamily: 'Manrope_500Medium', fontSize: 13, marginTop: 8 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1,
  },
  input: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14 },
  btn: { borderRadius: 28, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  btnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: '#FFF' },
});
