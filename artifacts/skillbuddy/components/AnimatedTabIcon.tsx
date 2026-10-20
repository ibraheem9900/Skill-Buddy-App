import React, { useEffect } from 'react';
import { View, type ColorValue } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { TAB_ICON_DURATION } from '@/components/AnimatedTabIcons';

interface Props {
  focused: boolean;
  /** RN 0.86 / React Navigation 7 type the tab-bar tint as `ColorValue`. */
  color: ColorValue;
  activeColor: string;
  children: (color: ColorValue) => React.ReactNode;
}

/** The bounce is split into the same two halves for every tab: 90 ms up, 110 ms back. */
const BOUNCE_UP_MS = 90;
const BOUNCE_DOWN_MS = 110;

/**
 * Wraps a tab bar icon with the SAME selection motion for all five tabs: a
 * short scale pop (200 ms total) plus a 180 ms fade of the active pill behind
 * it. No spring with a variable settling time, so every tab feels identical and
 * the interaction never outlasts a quick tap.
 */
export default function AnimatedTabIcon({ focused, color, activeColor, children }: Props) {
  const scale = useSharedValue(1);
  const pillOpacity = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    pillOpacity.value = withTiming(focused ? 1 : 0, {
      duration: TAB_ICON_DURATION,
      easing: Easing.out(Easing.quad),
    });

    if (focused) {
      scale.value = withSequence(
        withTiming(1.1, { duration: BOUNCE_UP_MS, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: BOUNCE_DOWN_MS, easing: Easing.quad })
      );
    } else {
      scale.value = withTiming(1, { duration: TAB_ICON_DURATION });
    }
  }, [focused, pillOpacity, scale]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const pillStyle = useAnimatedStyle(() => ({
    opacity: pillOpacity.value,
  }));

  return (
    <View style={{ width: 44, height: 30, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 44,
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
