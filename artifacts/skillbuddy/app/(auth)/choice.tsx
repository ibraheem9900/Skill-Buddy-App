import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import LogoImage from '@/components/LogoImage';

export default function ChoiceScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      {/* Top spacer to push content down */}
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        {/* Logo */}
        <Animated.View entering={FadeInDown.delay(100).duration(500)} style={styles.logoWrap}>
          <LogoImage variant={c.background === '#0A0D0D' ? 'light' : 'green'} height={48} animateOnMount={false} />
        </Animated.View>

        {/* Title */}
        <Animated.View entering={FadeInDown.delay(200).duration(500)} style={styles.titleWrap}>
          <Text style={[styles.title, { color: c.text }]}>{t('onb_choice_title')}</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('onb_choice_subtitle')}</Text>
        </Animated.View>
      </View>

      {/* Bottom actions */}
      <View style={[styles.bottomWrap, { paddingBottom: insets.bottom + 24 }]}>
        <Animated.View entering={FadeInUp.delay(300).duration(500)}>
          {/* Primary: Log In */}
          <TouchableOpacity
            style={[styles.loginBtn, { backgroundColor: c.primary }]}
            onPress={() => router.push('/(auth)/login')}
            activeOpacity={0.85}
          >
            <Text style={styles.loginBtnText}>{t('onb_choice_login')}</Text>
          </TouchableOpacity>

          {/* Secondary: Sign Up */}
          <TouchableOpacity
            style={[styles.signupBtn, { borderColor: c.border }]}
            onPress={() => router.push('/(auth)/signup')}
            activeOpacity={0.85}
          >
            <Text style={[styles.signupBtnText, { color: c.text }]}>{t('onb_choice_signup')}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 28,
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 32,
  },
  titleWrap: {
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  title: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 28,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  bottomWrap: {
    paddingTop: 16,
    gap: 14,
  },
  loginBtn: {
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: 'center',
  },
  loginBtnText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  signupBtn: {
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  signupBtnText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 16,
  },
});
