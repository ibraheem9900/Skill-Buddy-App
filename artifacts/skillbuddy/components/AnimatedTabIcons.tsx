import React, { useEffect } from 'react';
import Svg, { G, Rect, Circle, Ellipse, Path } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

interface IconProps {
  focused: boolean;
  color: string;
  size?: number;
}

/** Home — a door that swings open on its hinge when the tab is active. */
export function DoorTabIcon({ focused, color, size = 22 }: IconProps) {
  const progress = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    progress.value = withSpring(focused ? 1 : 0, { damping: 12, stiffness: 140 });
  }, [focused]);

  const doorProps = useAnimatedProps(() => ({
    transform: [{ scaleX: 1 - progress.value * 0.72 }],
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* frame */}
      <Rect x={3} y={2.5} width={18} height={19} rx={1.5} stroke={color} strokeWidth={1.6} fill="none" opacity={0.55} />
      {/* door panel — hinge at left edge (x=4.5) */}
      <AnimatedG origin="4.5, 12" animatedProps={doorProps}>
        <Rect x={4.5} y={3.5} width={14.5} height={17} rx={1} fill={color} opacity={0.9} />
        <Circle cx={16.5} cy={12} r={0.9} fill="#FFF" opacity={0.9} />
      </AnimatedG>
    </Svg>
  );
}

/** Services — a 2x2 grid whose blocks expand outward from the center when active. */
export function GridBlocksTabIcon({ focused, color, size = 22 }: IconProps) {
  const progress = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    progress.value = withSpring(focused ? 1 : 0, { damping: 11, stiffness: 160 });
  }, [focused]);

  const tl = useAnimatedProps(() => ({
    transform: [{ translateX: -1.2 * progress.value }, { translateY: -1.2 * progress.value }],
  }));
  const tr = useAnimatedProps(() => ({
    transform: [{ translateX: 1.2 * progress.value }, { translateY: -1.2 * progress.value }],
  }));
  const bl = useAnimatedProps(() => ({
    transform: [{ translateX: -1.2 * progress.value }, { translateY: 1.2 * progress.value }],
  }));
  const br = useAnimatedProps(() => ({
    transform: [{ translateX: 1.2 * progress.value }, { translateY: 1.2 * progress.value }],
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <AnimatedRect animatedProps={tl} x={4} y={4} width={7} height={7} rx={1.8} fill={color} opacity={0.9} />
      <AnimatedRect animatedProps={tr} x={13} y={4} width={7} height={7} rx={1.8} fill={color} opacity={0.9} />
      <AnimatedRect animatedProps={bl} x={4} y={13} width={7} height={7} rx={1.8} fill={color} opacity={0.9} />
      <AnimatedRect animatedProps={br} x={13} y={13} width={7} height={7} rx={1.8} fill={color} opacity={0.9} />
    </Svg>
  );
}

/** Jobs — a briefcase whose lid flips open on activation. */
export function BriefcaseTabIcon({ focused, color, size = 22 }: IconProps) {
  const progress = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    progress.value = withSpring(focused ? 1 : 0, { damping: 12, stiffness: 150 });
  }, [focused]);

  const lidProps = useAnimatedProps(() => ({
    transform: [{ translateY: -progress.value * 2.2 }, { scaleY: 1 - progress.value * 0.35 }],
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* handle */}
      <Rect x={9} y={3} width={6} height={3.4} rx={1} stroke={color} strokeWidth={1.6} fill="none" opacity={0.8} />
      {/* body */}
      <Rect x={3} y={8.5} width={18} height={12} rx={2} fill={color} opacity={0.85} />
      {/* lid — hinge at bottom edge of the flap */}
      <AnimatedG origin="12, 10" animatedProps={lidProps}>
        <Rect x={3} y={7.5} width={18} height={4.5} rx={1.5} fill={color} />
      </AnimatedG>
    </Svg>
  );
}

/** Inbox — a chat bubble with a message dot that pops in when active. */
export function ChatPopTabIcon({ focused, color, size = 22 }: IconProps) {
  const progress = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    progress.value = withSpring(focused ? 1 : 0, { damping: 9, stiffness: 200 });
  }, [focused]);

  const dotProps = useAnimatedProps(() => ({
    transform: [{ scale: progress.value }],
    opacity: progress.value,
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 5.5C4 4.12 5.12 3 6.5 3h11C18.88 3 20 4.12 20 5.5v8c0 1.38-1.12 2.5-2.5 2.5H9l-4 4v-4h-.5C3.12 16 2 14.88 2 13.5"
        stroke={color}
        strokeWidth={1.7}
        fill="none"
        opacity={0.85}
      />
      <AnimatedCircle animatedProps={dotProps} cx={8} cy={8.5} r={1.15} fill={color} />
      <AnimatedCircle animatedProps={dotProps} cx={12} cy={8.5} r={1.15} fill={color} />
      <AnimatedCircle animatedProps={dotProps} cx={16} cy={8.5} r={1.15} fill={color} />
    </Svg>
  );
}

/** Profile — a face whose eyes open (scale from a closed line to a full circle). */
export function EyesTabIcon({ focused, color, size = 22 }: IconProps) {
  const progress = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(focused ? 1 : 0, { duration: 260, easing: Easing.out(Easing.ease) });
  }, [focused]);

  const eyeProps = useAnimatedProps(() => ({
    ry: 0.25 + progress.value * 1.05,
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* head/shoulders (person silhouette) */}
      <Circle cx={12} cy={8} r={4} stroke={color} strokeWidth={1.7} fill="none" opacity={0.9} />
      <Path
        d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        fill="none"
        opacity={0.9}
      />
      {/* eyes — closed line that opens into a full ellipse when active */}
      <AnimatedEllipse animatedProps={eyeProps} cx={10} cy={7.6} rx={1.1} fill={color} />
      <AnimatedEllipse animatedProps={eyeProps} cx={14} cy={7.6} rx={1.1} fill={color} />
    </Svg>
  );
}
