import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  focused: boolean;
  color: string;
  activeColor: string;
  children: (color: string) => React.ReactNode;
}

/**
 * Wraps a tab bar icon with a satisfying scale-bounce on activation and a
 * smooth sliding "pill" background behind the active icon, so switching
 * tabs feels tactile instead of an instant flat swap.
 */
export default function AnimatedTabIcon({ focused, color, activeColor, children }: Props) {
  const scale = useSharedValue(focused ? 1 : 0.94);
  const pillOpacity = useSharedValue(focused ? 1 : 0);
  const pillScale = useSharedValue(focused ? 1 : 0.6);

  useEffect(() => {
    scale.value = withSpring(focused ? 1.08 : 0.94, { damping: 12, stiffness: 180 });
    pillOpacity.value = withTiming(focused ? 1 : 0, { duration: 200 });
    pillScale.value = withSpring(focused ? 1 : 0.6, { damping: 14, stiffness: 200 });
    if (focused) {
      // settle back to 1 after the bounce
      const t = setTimeout(() => {
        scale.value = withSpring(1, { damping: 12, stiffness: 180 });
      }, 120);
      return () => clearTimeout(t);
    }
  }, [focused]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const pillStyle = useAnimatedStyle(() => ({
    opacity: pillOpacity.value,
    transform: [{ scale: pillScale.value }],
  }));

  return (
    <View style={{ width: 40, height: 32, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 40,
            height: 28,
            borderRadius: 14,
            backgroundColor: `${activeColor}1A`,
          },
          pillStyle,
        ]}
      />
      <Animated.View style={iconStyle}>{children(color)}</Animated.View>
    </View>
  );
}
