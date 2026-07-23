import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import colors from '@/constants/colors';

const c = colors.light;

export default function VerifyEmailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Feather name="arrow-left" size={22} color="#1A1A1A" />
      </TouchableOpacity>
      <Animated.View entering={FadeInDown.duration(500)} style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: c.primaryLight }]}>
          <Feather name="mail" size={56} color={c.primary} />
        </View>
        <Text style={styles.title}>Check Your Email</Text>
        <Text style={styles.subtitle}>
          We've sent a verification link to your email address. Please check your inbox and click the link to verify your account.
        </Text>
        <View style={styles.infoBox}>
          <Feather name="info" size={16} color={c.primary} />
          <Text style={styles.infoText}>
            After verifying your email, you can complete your profile setup to start using SkillBuddy.
          </Text>
        </View>
        <TouchableOpacity style={[styles.btn, { backgroundColor: c.primary }]} onPress={() => router.replace('/(auth)/login')}>
          <Text style={styles.btnText}>Back to Login</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.resendBtn}>
          <Text style={[styles.resendText, { color: c.primary }]}>Didn't receive it? Resend email</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFF', paddingHorizontal: 24 },
  back: { marginBottom: 24 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  iconCircle: { width: 110, height: 110, borderRadius: 55, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 26, color: '#1A1A1A', textAlign: 'center' },
  subtitle: { fontFamily: 'Manrope_400Regular', fontSize: 14, color: '#737373', textAlign: 'center', lineHeight: 22 },
  infoBox: { flexDirection: 'row', gap: 10, backgroundColor: '#E8F5F3', borderRadius: 12, padding: 14, alignItems: 'flex-start' },
  infoText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 13, color: '#2D7A6E', lineHeight: 20 },
  btn: { width: '100%', borderRadius: 28, paddingVertical: 16, alignItems: 'center' },
  btnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: '#FFF' },
  resendBtn: { paddingVertical: 8 },
  resendText: { fontFamily: 'Manrope_500Medium', fontSize: 14 },
});
