import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

interface Props {
  total: number;
  current: number;
  activeColor: string;
  inactiveColor: string;
}

/**
 * Animated progress dots used on onboarding screens 2-4.
 * Each dot expands when active and collapses when not.
 */
export default function OnboardingProgress({ total, current, activeColor, inactiveColor }: Props) {
  return (
    <View style={styles.row}>
      {Array.from({ length: total }, (_, i) => (
        <Dot
          key={i}
          isActive={i === current}
          activeColor={activeColor}
          inactiveColor={inactiveColor}
        />
      ))}
    </View>
  );
}

function Dot({ isActive, activeColor, inactiveColor }: { isActive: boolean; activeColor: string; inactiveColor: string }) {
  const style = useAnimatedStyle(() => ({
    width: withTiming(isActive ? 24 : 8, { duration: 250 }),
    backgroundColor: withTiming(isActive ? activeColor : inactiveColor, { duration: 250 }),
  }));

  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
});
