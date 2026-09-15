import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';

export default function VerifyEmailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Feather name="arrow-left" size={22} color={c.text} />
      </TouchableOpacity>
      <Animated.View entering={FadeInDown.duration(500)} style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: c.primaryLight }]}>
          <Feather name="mail" size={56} color={c.primary} />
        </View>
        <Text style={[styles.title, { color: c.text }]}>{t('ve_title')}</Text>
        <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('ve_subtitle')}</Text>
        <View style={[styles.infoBox, { backgroundColor: c.primaryLight }]}>
          <Feather name="info" size={16} color={c.primary} />
          <Text style={[styles.infoText, { color: c.primary }]}>{t('ve_info')}</Text>
        </View>
        <TouchableOpacity style={[styles.btn, { backgroundColor: c.primary }]} onPress={() => router.replace('/(auth)/login')}>
          <Text style={styles.btnText}>{t('ve_back')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.resendBtn}>
          <Text style={[styles.resendText, { color: c.primary }]}>{t('ve_resend')}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
  back: { marginBottom: 24 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  iconCircle: { width: 110, height: 110, borderRadius: 55, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 26, textAlign: 'center' },
  subtitle: { fontFamily: 'Manrope_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  infoBox: { flexDirection: 'row', gap: 10, borderRadius: 12, padding: 14, alignItems: 'flex-start' },
  infoText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 20 },
  btn: { width: '100%', borderRadius: 28, paddingVertical: 16, alignItems: 'center' },
  btnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: '#FFF' },
  resendBtn: { paddingVertical: 8 },
  resendText: { fontFamily: 'Manrope_500Medium', fontSize: 14 },
});
