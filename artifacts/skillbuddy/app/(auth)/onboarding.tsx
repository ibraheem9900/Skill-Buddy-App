import React, { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';

const { width } = Dimensions.get('window');
const c = colors.light;

type Lang = { code: string; name: string; flag: string };
const LANGS: Lang[] = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'et', name: 'Estonian', flag: '🇪🇪' },
  { code: 'lv', name: 'Latvian', flag: '🇱🇻' },
  { code: 'lt', name: 'Lithuanian', flag: '🇱🇹' },
];

const SLIDES = [
  {
    id: 1,
    title: 'Explore Professional\nServices Provider',
    subtitle: 'Find the best local service providers around you and book instantly.',
    icon: 'home' as const,
  },
  {
    id: 2,
    title: 'Explore Services by\ninteractive Map',
    subtitle: 'Discover nearby providers on a live map and filter by category.',
    icon: 'map' as const,
  },
  {
    id: 3,
    title: 'Choose Your\nPayment Plan',
    subtitle: 'Pay now, pay later, or pay in monthly instalments. You choose.',
    icon: 'credit-card' as const,
  },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setOnboardingSeen } = useAuth();
  const [step, setStep] = useState<'language' | 'slides'>('language');
  const [selectedLang, setSelectedLang] = useState('en');
  const [slideIdx, setSlideIdx] = useState(0);
  const flatRef = useRef<FlatList>(null);

  const onViewRef = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0) {
      const idx = viewableItems[0].index ?? 0;
      setSlideIdx(idx);
    }
  });

  const finish = async () => {
    await setOnboardingSeen();
    router.replace('/(auth)/login');
  };

  const nextSlide = () => {
    if (slideIdx < SLIDES.length - 1) {
      flatRef.current?.scrollToIndex({ index: slideIdx + 1, animated: true });
    } else {
      finish();
    }
  };

  const prevSlide = () => {
    if (slideIdx > 0) {
      flatRef.current?.scrollToIndex({ index: slideIdx - 1, animated: true });
    }
  };

  if (step === 'language') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <TouchableOpacity style={styles.skipBtn} onPress={finish}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
        <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.langContent}>
          <Text style={styles.langTitle}>Select Language</Text>
          <Text style={styles.langSubtitle}>Tip: You can change this later in Settings</Text>
          <View style={styles.langList}>
            {LANGS.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.langItem,
                  selectedLang === lang.code && { backgroundColor: c.primaryLight, borderColor: c.primary },
                ]}
                onPress={() => setSelectedLang(lang.code)}
              >
                <Text style={styles.langFlag}>{lang.flag}</Text>
                <Text style={[styles.langName, selectedLang === lang.code && { color: c.primary, fontFamily: 'Inter_600SemiBold' }]}>
                  {lang.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>
        <View style={styles.dotsRow}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.dot, i === 0 && { backgroundColor: c.primary, width: 20 }]} />
          ))}
          <TouchableOpacity
            style={[styles.arrowBtn, { backgroundColor: c.primary }]}
            onPress={() => setStep('slides')}
          >
            <Feather name="arrow-right" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom + 20 }]}>
      <TouchableOpacity style={[styles.skipBtn, { top: insets.top + 12 }]} onPress={finish}>
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>
      <FlatList
        ref={flatRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(s) => String(s.id)}
        onViewableItemsChanged={onViewRef.current}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        renderItem={({ item }) => (
          <View style={styles.slide}>
            <View style={[styles.slideIconWrap, { backgroundColor: c.primaryLight }]}>
              <Feather name={item.icon} size={80} color={c.primary} />
            </View>
            <Animated.View entering={FadeIn.duration(400)}>
              <Text style={styles.slideTitle}>{item.title}</Text>
              <Text style={styles.slideSubtitle}>{item.subtitle}</Text>
            </Animated.View>
          </View>
        )}
      />
      <View style={styles.dotsRow}>
        {slideIdx > 0 ? (
          <TouchableOpacity style={[styles.arrowBtn, styles.arrowBtnOutline]} onPress={prevSlide}>
            <Feather name="arrow-left" size={20} color={c.primary} />
          </TouchableOpacity>
        ) : <View style={styles.arrowPlaceholder} />}
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === slideIdx && { backgroundColor: c.primary, width: 20 }]} />
          ))}
        </View>
        <TouchableOpacity style={[styles.arrowBtn, { backgroundColor: c.primary }]} onPress={nextSlide}>
          <Feather name="arrow-right" size={20} color="#FFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFF' },
  skipBtn: { position: 'absolute', top: 60, right: 24, zIndex: 10 },
  skipText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: colors.light.primary },
  langContent: { flex: 1, paddingHorizontal: 24, paddingTop: 40 },
  langTitle: { fontFamily: 'Inter_700Bold', fontSize: 28, color: '#1A1A1A', marginBottom: 6 },
  langSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#737373', marginBottom: 32 },
  langList: { gap: 14 },
  langItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
    backgroundColor: '#FAFAFA',
  },
  langFlag: { fontSize: 28 },
  langName: { fontFamily: 'Inter_500Medium', fontSize: 16, color: '#1A1A1A' },
  slide: { width, alignItems: 'center', paddingTop: 80, paddingHorizontal: 28 },
  slideIconWrap: {
    width: 200,
    height: 200,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 36,
  },
  slideTitle: { fontFamily: 'Inter_700Bold', fontSize: 26, color: '#1A1A1A', textAlign: 'center', lineHeight: 36, marginBottom: 12 },
  slideSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#737373', textAlign: 'center', lineHeight: 22 },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginTop: 24,
  },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#DDD' },
  arrowBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  arrowBtnOutline: { borderWidth: 1.5, borderColor: colors.light.primary, backgroundColor: 'transparent' },
  arrowPlaceholder: { width: 48 },
});
