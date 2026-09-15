import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, LanguageCode } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import LogoImage from '@/components/LogoImage';
import OnboardingProgress from '@/components/OnboardingProgress';

type Lang = { code: LanguageCode; name: string; flag: string };

const LANGS: Lang[] = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'et', name: 'Eesti', flag: '🇪🇪' },
  { code: 'lv', name: 'Latviešu', flag: '🇱🇻' },
  { code: 'lt', name: 'Lietuvių', flag: '🇱🇹' },
];

export default function OnboardingLanguageSelect() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const { setOnboardingSeen } = useAuth();

  const handleSelect = (code: LanguageCode) => {
    setLanguage(code);
  };

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
          <Text style={[styles.title, { color: c.text }]}>{t('onb_lang_title')}</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('onb_lang_subtitle')}</Text>
        </Animated.View>

        {/* Language list — staggered slide-in */}
        <View style={styles.langList}>
          {LANGS.map((lang, i) => {
            const isSelected = language === lang.code;
            return (
              <Animated.View key={lang.code} entering={FadeInDown.delay(320 + i * 80).duration(400)}>
                <TouchableOpacity
                  style={[
                    styles.langItem,
                    {
                      backgroundColor: isSelected ? c.primaryLight : c.card,
                      borderColor: isSelected ? c.primary : c.border,
                    },
                  ]}
                  onPress={() => handleSelect(lang.code)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.langFlag}>{lang.flag}</Text>
                  <Text
                    style={[
                      styles.langName,
                      {
                        color: isSelected ? c.primary : c.text,
                        fontFamily: isSelected ? 'Manrope_600SemiBold' : 'Manrope_500Medium',
                      },
                    ]}
                  >
                    {lang.name}
                  </Text>
                  {isSelected && (
                    <Feather name="check-circle" size={22} color={c.primary} />
                  )}
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </View>
      </ScrollView>

      {/* Bottom: progress dots + Next */}
      <Animated.View entering={FadeInUp.delay(600).duration(500)} style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <OnboardingProgress total={4} current={3} activeColor={c.primary} inactiveColor={c.border} />
        <TouchableOpacity
          style={[styles.nextBtn, { backgroundColor: c.primary }]}
          onPress={async () => {
            await setOnboardingSeen();
            router.replace('/(auth)/choice' as any);
          }}
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
  langList: { width: '100%', gap: 14 },
  langItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  langFlag: { fontSize: 28 },
  langName: { flex: 1, fontSize: 16 },
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
