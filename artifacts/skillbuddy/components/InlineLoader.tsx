import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import LogoImage from '@/components/LogoImage';
import { useTheme } from '@/context/ThemeContext';

interface Props {
  size?: number;
  variant?: 'white' | 'green' | 'light';
}

/**
 * Small inline branded loader — a smooth rotation loop of the logo mark,
 * meant to replace a button's label while a quick async action completes.
 * Pairs with BrandedLoader (full-screen) for the two-tier loading pattern.
 */
export default function InlineLoader({ size = 18, variant }: Props) {
  const { theme } = useTheme();
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 1100, easing: Easing.linear }),
      -1,
      false
    );
  }, [rotation]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const resolvedVariant = variant ?? (theme === 'dark' ? 'light' : 'white');

  return (
    <View style={styles.wrap}>
      <Animated.View style={animStyle}>
        <LogoImage variant={resolvedVariant} height={size} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
