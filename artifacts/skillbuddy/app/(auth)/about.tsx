import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import LogoImage from '@/components/LogoImage';
import OnboardingProgress from '@/components/OnboardingProgress';

const POINTS = [
  { icon: 'briefcase' as const, titleKey: 'onb_about_point_1' as const, descKey: 'onb_about_point_1_desc' as const },
  { icon: 'shield' as const, titleKey: 'onb_about_point_2' as const, descKey: 'onb_about_point_2_desc' as const },
  { icon: 'credit-card' as const, titleKey: 'onb_about_point_3' as const, descKey: 'onb_about_point_3_desc' as const },
];

export default function OnboardingAbout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  const skip = () => router.replace('/(auth)/choice');

  const isDark = c.background === '#0A0D0D';

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      {/* Skip button */}
      <TouchableOpacity style={[styles.skipBtn, { top: insets.top + 12 }]} onPress={skip}>
        <Text style={[styles.skipText, { color: c.primary }]}>{t('onb_skip')}</Text>
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Standalone SkillBuddy logo */}
        <Animated.View entering={FadeInDown.delay(80).duration(500)} style={styles.logoWrap}>
          <LogoImage variant={isDark ? 'light' : 'green'} height={40} animateOnMount={false} />
        </Animated.View>

        {/* Heading + description */}
        <Animated.View entering={FadeInDown.delay(180).duration(500)} style={styles.textWrap}>
          <Text style={[styles.title, { color: c.text }]}>{t('onb_about_title')}</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('onb_about_desc')}</Text>
        </Animated.View>

        {/* Feature points — staggered slide-in */}
        <View style={styles.pointsWrap}>
          {POINTS.map((p, i) => (
            <Animated.View
              key={p.titleKey}
              entering={FadeInDown.delay(320 + i * 120).duration(450)}
              style={[styles.pointRow, { backgroundColor: c.card, borderColor: c.border }]}
            >
              <View style={[styles.pointIcon, { backgroundColor: c.primaryLight }]}>
                <Feather name={p.icon} size={20} color={c.primary} />
              </View>
              <View style={styles.pointText}>
                <Text style={[styles.pointTitle, { color: c.text }]}>{t(p.titleKey)}</Text>
                <Text style={[styles.pointDesc, { color: c.mutedForeground }]}>{t(p.descKey)}</Text>
              </View>
            </Animated.View>
          ))}
        </View>
      </ScrollView>

      {/* Bottom: progress dots + Next */}
      <Animated.View entering={FadeInUp.delay(600).duration(500)} style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <OnboardingProgress total={4} current={1} activeColor={c.primary} inactiveColor={c.border} />
        <TouchableOpacity
          style={[styles.nextBtn, { backgroundColor: c.primary }]}
          onPress={() => router.push('/(auth)/privacy' as any)}
        >
          <Text style={styles.nextText}>{t('onb_next')}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  skipBtn: { position: 'absolute', right: 24, zIndex: 10 },
  skipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  content: { paddingHorizontal: 24, alignItems: 'center' },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 28,
  },
  textWrap: {
    alignItems: 'center',
    marginBottom: 32,
    paddingHorizontal: 4,
  },
  title: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 26,
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  pointsWrap: { width: '100%', gap: 14 },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  pointIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointText: { flex: 1 },
  pointTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 15, marginBottom: 2 },
  pointDesc: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 18 },
  bottomBar: {
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 20,
  },
  nextBtn: {
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: 'center',
  },
  nextText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
});
