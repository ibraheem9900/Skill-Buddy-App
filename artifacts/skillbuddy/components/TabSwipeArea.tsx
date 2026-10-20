import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { usePathname, useRouter } from 'expo-router';
import { adjacentTabPath, isTabPath } from '@/lib/tabNav';

/**
 * Horizontal swipe between the five bottom tabs, in tab-bar order.
 *
 * Deliberately conservative so it cannot steal gestures from content:
 *   • it only exists on the five root tab screens (a detail screen keeps its
 *     own back gesture and is never swiped sideways);
 *   • the pan activates 24 px into a HORIZONTAL move and fails after 16 px
 *     vertical movement, so vertical scrolling always wins;
 *   • that 24 px head start also lets a horizontal carousel / chip row activate
 *     its own native scroll gesture first, so those keep working;
 *   • a swipe must travel 70 px or be fast (>650 px/s), so a flick that belongs
 *     to a list is not mistaken for navigation;
 *   • no wraparound: the first tab cannot be swiped right, the last one left.
 */
const ACTIVATE_X = 24;
const FAIL_Y = 16;
const MIN_DISTANCE = 70;
const MIN_VELOCITY = 650;
const MIN_FAST_DISTANCE = 30;

export default function TabSwipeArea({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const go = useCallback(
    (direction: -1 | 1) => {
      const next = adjacentTabPath(pathname, direction);
      if (next) router.navigate(next as any);
    },
    [pathname, router]
  );

  const pan = Gesture.Pan()
    .enabled(isTabPath(pathname))
    .activeOffsetX([-ACTIVATE_X, ACTIVATE_X])
    .failOffsetY([-FAIL_Y, FAIL_Y])
    .maxPointers(1)
    .onEnd((event) => {
      'worklet';
      const dx = event.translationX;
      const fast = Math.abs(event.velocityX) > MIN_VELOCITY && Math.abs(dx) > MIN_FAST_DISTANCE;
      if (Math.abs(dx) < MIN_DISTANCE && !fast) return;
      runOnJS(go)(dx > 0 ? -1 : 1);
    });

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.fill}>{children}</View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
