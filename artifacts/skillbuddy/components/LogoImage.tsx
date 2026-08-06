/**
 * LogoImage — renders the real SkillBuddy brand mark from the actual asset file.
 * The asset is a transparent-background PNG so we can tintColor it for any surface.
 *
 * Usage:
 *   <LogoImage variant="white" height={32} />   ← on green header
 *   <LogoImage variant="green" height={32} />   ← on light surface
 *   <LogoImage variant="light" height={32} />   ← on dark surface (light-green tint)
 */
import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import colors from '@/constants/colors';

type Variant = 'white' | 'green' | 'light';

interface Props {
  variant?: Variant;
  height?: number;
  animateOnMount?: boolean;
}

// Original aspect ratio of the brand mark asset (cropped to content bounds):
// 278 x 115 = 2.417 : 1
const ASPECT = 2.417;

const TINTS: Record<Variant, string> = {
  white: '#FFFFFF',
  green: colors.light.primaryDark,
  light: colors.dark.primary, // softer green for dark surfaces
};

export default function LogoImage({ variant = 'green', height = 32, animateOnMount = true }: Props) {
  const width = Math.round(height * ASPECT);

  const opacity = useSharedValue(animateOnMount ? 0 : 1);
  const scale = useSharedValue(animateOnMount ? 0.9 : 1);

  useEffect(() => {
    if (!animateOnMount) return;
    opacity.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) });
    scale.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) });
  }, [animateOnMount]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.Image
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  source={require('@/assets/images/logo-icon.png')}
  style={[styles.img, { width, height }, animatedStyle]}
  tintColor={TINTS[variant]}
  resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  img: {},
});
