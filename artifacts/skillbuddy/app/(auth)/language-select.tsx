import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, LanguageCode } from '@/context/LanguageContext';
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

  const handleSelect = (code: LanguageCode) => {
    setLanguage(code);
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Icon */}
        <Animated.View entering={FadeInDown.delay(100).duration(400)} style={[styles.iconWrap, { backgroundColor: c.primaryLight }]}>
          <Feather name="globe" size={64} color={c.primary} />
        </Animated.View>

        {/* Title */}
        <Animated.View entering={FadeInDown.delay(200).duration(400)}>
          <Text style={[styles.title, { color: c.text }]}>{t('onb_lang_title')}</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{t('onb_lang_subtitle')}</Text>
        </Animated.View>

        {/* Language list */}
        <View style={styles.langList}>
          {LANGS.map((lang, i) => {
            const isSelected = language === lang.code;
            return (
              <Animated.View key={lang.code} entering={FadeInDown.delay(300 + i * 80).duration(350)}>
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
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <OnboardingProgress total={4} current={3} activeColor={c.primary} inactiveColor={c.border} />
        <TouchableOpacity
          style={[styles.nextBtn, { backgroundColor: c.primary }]}
          onPress={() => router.replace('/(auth)/login' as any)}
        >
          <Text style={styles.nextText}>{t('onb_next')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 24, alignItems: 'center' },
  iconWrap: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
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
