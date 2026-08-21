import React, { useEffect, useRef } from 'react';
import { Dimensions, Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';

const { width: SCREEN_W } = Dimensions.get('window');

export default function OnboardingSplash() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  // Logo breathing animation
  const logoScale = useSharedValue(1);
  const logoOpacity = useSharedValue(0);

  // Button visibility (appears after ~2.5s)
  const [showButton, setShowButton] = React.useState(false);

  useEffect(() => {
    // Fade in logo
    logoOpacity.value = withTiming(1, { duration: 800 });

    // Breathing loop: scale 1 → 1.05 → 1, repeating
    logoScale.value = withDelay(
      800,
      withRepeat(
        withSequence(
          withTiming(1.06, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
        ),
        -1, // infinite
        false,
      ),
    );

    // Show button after 2.5 seconds
    const timer = setTimeout(() => setShowButton(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  const logoAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }],
    opacity: logoOpacity.value,
  }));

  return (
    <View style={[styles.container, { backgroundColor: '#0A0D0D' }]}>
      {/* Logo with breathing animation */}
      <Animated.View style={[styles.logoWrap, logoAnimStyle]}>
        <Image
          source={require('@/assets/images/logo-icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>

      {/* Brand name */}
      <Animated.Text
        entering={FadeIn.delay(1200).duration(600)}
        style={styles.brandName}
      >
        SkillBuddy
      </Animated.Text>

      {/* Get Started button — fades in + slides up */}
      {showButton && (
        <Animated.View
          entering={FadeInUp.delay(100).duration(500)}
          style={[styles.btnWrap, { bottom: insets.bottom + 40 }]}
        >
          <Animated.View
            entering={FadeInDown.delay(200).duration(400)}
          >
            <Text
              style={styles.btnText}
              onPress={() => router.replace('/(auth)/about' as any)}
            >
              {t('onb_splash_get_started')}
            </Text>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  logo: {
    width: 160,
    height: 160,
  },
  brandName: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 32,
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  btnWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  btnText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 17,
    color: '#FFFFFF',
    backgroundColor: '#2E9E7A',
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 30,
    overflow: 'hidden',
    textAlign: 'center',
    minWidth: 200,
    textAlignVertical: 'center',
  },
});
