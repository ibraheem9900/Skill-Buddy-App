import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import LogoImage from '@/components/LogoImage';
import { useTheme } from '@/context/ThemeContext';

interface Props {
  size?: number;
}

export default function BrandedLoader({ size = 48 }: Props) {
  const { theme } = useTheme();
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.4, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    scale.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [opacity, scale]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const variant = theme === 'dark' ? 'light' : 'green';

  return (
    <View style={styles.container}>
      <Animated.View style={animStyle}>
        <LogoImage variant={variant} height={size} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
