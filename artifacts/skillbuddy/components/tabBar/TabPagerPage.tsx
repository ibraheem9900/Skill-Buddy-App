import React, { useContext, useMemo } from 'react';
import { Animated, StyleSheet } from 'react-native';
// Internal expo-router entry: the material-top-tabs context is the only place
// the pager's continuous position is exposed to a scene. It is pinned with
// expo-router 57 and the hook falls back to a plain page when absent (iOS
// liquid-glass NativeTabs renders these same screens without a pager).
import { TabAnimationContext } from 'expo-router/build/react-navigation/material-top-tabs/utils/TabAnimationContext';
import { TabPagerIndexContext } from '@/components/tabBar/TabPagerContext';
import useReduceMotion from '@/components/tabBar/useReduceMotion';
import {
  PAGE_PARALLAX_PX,
  pageOpacityRange,
  pageScaleRange,
} from '@/lib/tabPager';

interface Props {
  /** 0 = Home … 4 = Profile, matching the tab order in lib/tabNav. */
  index: number;
  children: React.ReactNode;
}

/**
 * Subtle depth for a tab page while it moves:
 *   • fades to 0.86 and scales to 0.972 at the far end of a swipe;
 *   • lags a few pixels behind the pager (parallax), scaled by how far the drag
 *     has travelled so nothing shifts when the pager is at rest;
 *   • does nothing at all when the OS reduce-motion setting is on.
 *
 * All values are Animated interpolations of the pager's native position, so the
 * page never re-renders during a drag.
 */
export default function TabPagerPage({ index, children }: Props) {
  const animation = useContext(TabAnimationContext);
  const activeIndex = useContext(TabPagerIndexContext);
  const reduceMotion = useReduceMotion();
  const position = animation?.position ?? null;

  const animatedStyle = useMemo(() => {
    if (!position || reduceMotion) return null;

    // 1 → 0 → 1 weight for how far this page is from the finger's centre.
    const distance = position.interpolate({
      inputRange: [index - 1, index, index + 1],
      outputRange: [1, 0, 1],
      extrapolate: 'clamp',
    });
    // 0 at rest, 1 once the drag has moved a whole tab.
    const drag = position.interpolate({
      inputRange: [activeIndex - 1, activeIndex, activeIndex + 1],
      outputRange: [1, 0, 1],
      extrapolate: 'clamp',
    });
    // +1 while swiping toward the next tab, -1 toward the previous one.
    const direction = position.interpolate({
      inputRange: [activeIndex - 0.0001, activeIndex],
      outputRange: [-1, 1],
      extrapolate: 'clamp',
    });

    const translateX = Animated.multiply(
      Animated.multiply(distance, drag),
      Animated.multiply(direction, PAGE_PARALLAX_PX)
    );

    return {
      opacity: position.interpolate(pageOpacityRange(index)),
      transform: [
        { translateX },
        { scale: position.interpolate(pageScaleRange(index)) },
      ],
    };
  }, [position, index, activeIndex, reduceMotion]);

  return (
    <Animated.View style={[styles.page, animatedStyle]}>{children}</Animated.View>
  );
}

/**
 * Wrap a tab screen's default export. Keeps the screen's own component (and its
 * navigation context) intact — only a presentational layer is added.
 */
export function withTabPagerPage<P extends object>(
  Screen: React.ComponentType<P>,
  index: number
): React.ComponentType<P> {
  function TabPagerScreen(props: P) {
    return (
      <TabPagerPage index={index}>
        <Screen {...props} />
      </TabPagerPage>
    );
  }
  TabPagerScreen.displayName = `withTabPagerPage(${Screen.displayName ?? Screen.name ?? 'Screen'})`;
  return TabPagerScreen;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
});
