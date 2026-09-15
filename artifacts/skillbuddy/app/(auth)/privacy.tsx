import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeInUp, Layout } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import LogoImage from '@/components/LogoImage';
import OnboardingProgress from '@/components/OnboardingProgress';

export default function OnboardingPrivacy() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);

  const isDark = c.background === '#0A0D0D';

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
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
          <Text style={[styles.title, { color: c.text }]}>{t('onb_privacy_title')}</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('onb_privacy_desc')}</Text>
        </Animated.View>

        {/* Privacy points — staggered slide-in */}
        <View style={styles.pointsWrap}>
          {[
            { icon: 'lock' as const, titleKey: 'onb_privacy_point_1' as const, descKey: 'onb_privacy_point_1_desc' as const },
            { icon: 'eye-off' as const, titleKey: 'onb_privacy_point_2' as const, descKey: 'onb_privacy_point_2_desc' as const },
            { icon: 'check-circle' as const, titleKey: 'onb_privacy_point_3' as const, descKey: 'onb_privacy_point_3_desc' as const },
          ].map((p, i) => (
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

        {/* Expandable full policy */}
        <Animated.View entering={FadeInDown.delay(700).duration(400)}>
          <TouchableOpacity
            style={[styles.expandBtn, { borderColor: c.border, backgroundColor: c.card }]}
            onPress={() => setExpanded(!expanded)}
            activeOpacity={0.7}
          >
            <Text style={[styles.expandText, { color: c.primary }]}>{t('onb_privacy_view_full')}</Text>
            <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.primary} />
          </TouchableOpacity>

          {expanded && (
            <Animated.View
              layout={Layout.springify()}
              style={[styles.policyBox, { backgroundColor: c.card, borderColor: c.border }]}
            >
              <Text style={[styles.policyText, { color: c.mutedForeground }]}>
                SkillBuddy OÜ collects and processes personal data solely to provide our services. We collect your name, email, phone number, and location to match you with service providers. Payment data is processed by our PCI-compliant payment partners and never stored on our servers.
                {'\n\n'}
                We do not sell or share your personal data with third parties for marketing purposes. Your data is encrypted in transit and at rest. You may request data deletion at any time by contacting support@skillbuddy.ee.
                {'\n\n'}
                We use cookies and analytics to improve the app experience. You can opt out of analytics in Settings. For full details, visit skillbuddy.ee/privacy.
              </Text>
            </Animated.View>
          )}
        </Animated.View>
      </ScrollView>

      {/* Bottom: progress dots + Next */}
      <Animated.View entering={FadeInUp.delay(600).duration(500)} style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <OnboardingProgress total={4} current={2} activeColor={c.primary} inactiveColor={c.border} />
        <TouchableOpacity
          style={[styles.nextBtn, { backgroundColor: c.primary }]}
          onPress={() => router.push('/(auth)/language-select' as any)}
        >
          <Text style={styles.nextText}>{t('onb_next')}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 24, alignItems: 'center' },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 28,
  },
  textWrap: {
    alignItems: 'center',
    marginBottom: 28,
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
  pointsWrap: { width: '100%', gap: 12 },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 12,
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
  pointTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginBottom: 2 },
  pointDesc: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 17 },
  expandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
  },
  expandText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  policyBox: {
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  policyText: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 20 },
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
