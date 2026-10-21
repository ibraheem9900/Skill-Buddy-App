import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/**
 * The Post-a-Job submit indicator: three dots fading and lifting in sequence,
 * never the rotating brand logo. It says "this is being sent" without looking
 * like the app is starting up, and it is pure Views/Reanimated so it ships OTA.
 */
function Dot({
  index,
  color,
  size,
}: {
  index: number;
  color: string;
  size: number;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    // Staggered: each dot waits a little longer before its first lift, then the
    // loop reverses, so the row reads left → right → left forever.
    progress.value = withDelay(
      index * 150,
      withRepeat(
        withTiming(1, { duration: 420, easing: Easing.inOut(Easing.quad) }),
        -1,
        true
      )
    );
  }, [index, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + progress.value * 0.65,
    transform: [{ translateY: -4 * progress.value }],
  }));

  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

export default function DotsLoader({
  color,
  size = 7,
  gap = 5,
}: {
  color: string;
  size?: number;
  gap?: number;
}) {
  return (
    <View style={[styles.row, { gap }]} accessibilityRole="progressbar">
      {[0, 1, 2].map((index) => (
        <Dot key={index} index={index} color={color} size={size} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
