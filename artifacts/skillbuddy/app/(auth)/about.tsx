import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
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

  const skip = () => router.replace('/(auth)/login');

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
        {/* Illustration — large icon in a circle */}
        <Animated.View entering={FadeInDown.delay(100).duration(400)} style={[styles.illustration, { backgroundColor: c.primaryLight }]}>
          <Feather name="users" size={72} color={c.primary} />
        </Animated.View>

        {/* Title */}
        <Animated.View entering={FadeInDown.delay(200).duration(400)}>
          <Text style={[styles.title, { color: c.text }]}>{t('onb_about_title')}</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('onb_about_desc')}</Text>
        </Animated.View>

        {/* Feature points */}
        <View style={styles.pointsWrap}>
          {POINTS.map((p, i) => (
            <Animated.View
              key={p.titleKey}
              entering={FadeInDown.delay(300 + i * 120).duration(400)}
              style={[styles.pointRow, { backgroundColor: c.card, borderColor: c.border }]}
            >
              <View style={[styles.pointIcon, { backgroundColor: c.primaryLight }]}>
                <Feather name={p.icon} size={22} color={c.primary} />
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
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <OnboardingProgress total={4} current={1} activeColor={c.primary} inactiveColor={c.border} />
        <TouchableOpacity
          style={[styles.nextBtn, { backgroundColor: c.primary }]}
          onPress={() => router.push('/(auth)/privacy' as any)}
        >
          <Text style={styles.nextText}>{t('onb_next')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  skipBtn: { position: 'absolute', right: 24, zIndex: 10 },
  skipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  content: { paddingHorizontal: 24, alignItems: 'center' },
  illustration: {
    width: 160,
    height: 160,
    borderRadius: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
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
    marginBottom: 32,
    paddingHorizontal: 8,
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
    width: 48,
    height: 48,
    borderRadius: 14,
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
