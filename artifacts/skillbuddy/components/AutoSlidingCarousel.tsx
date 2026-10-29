/**
 * AutoSlidingCarousel — ONE reusable, data-driven carousel for the client Home
 * (the top banners in Fix 3 and Special Offers in Fix 4).
 *
 * React Native core only: FlatList + Animated (no new dependency, nothing
 * native). Behaviour:
 *   • advances every CAROUSEL_INTERVAL_MS, wrapping to the first slide;
 *   • swipe works (paging when `peek` is 0, snapping when the next card peeks);
 *   • pagination dots, tappable, with the active one on the primary color;
 *   • a FIXED height comes from the caller, so the page never jumps while a
 *     slide is measured or an image loads;
 *   • the timer pauses while the user drags, while the screen is not focused
 *     (tab switched away) and while the app is in the background, and it is
 *     cleared on unmount;
 *   • the OS "reduce motion" setting switches auto-advance off completely —
 *     swiping still works.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import useReduceMotion from '@/components/tabBar/useReduceMotion';
import {
  CAROUSEL_INTERVAL_MS,
  canAutoAdvance,
  indexFromOffset,
  nextCarouselIndex,
} from '@/lib/carousel';

export interface AutoSlidingCarouselProps<T> {
  data: readonly T[];
  renderItem: (item: T, index: number) => React.ReactElement;
  keyExtractor: (item: T, index: number) => string;
  /** Fixed slide height — the carousel never resizes, so the layout is stable. */
  height: number;
  /** Pixels of the next slide that stay visible (0 = full-width pages). */
  peek?: number;
  /** Space between slides. */
  gap?: number;
  /** Rounded corners, matching the app's cards. */
  radius?: number;
  accessibilityLabel?: string;
  testID?: string;
}

export default function AutoSlidingCarousel<T>({
  data,
  renderItem,
  keyExtractor,
  height,
  peek = 0,
  gap = 12,
  radius = 18,
  accessibilityLabel,
  testID,
}: AutoSlidingCarouselProps<T>) {
  const { colors: c } = useTheme();
  const reduceMotion = useReduceMotion();
  const listRef = useRef<FlatList<T>>(null);
  const indexRef = useRef(0);
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);
  const [focused, setFocused] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [dragging, setDragging] = useState(false);

  const count = data.length;
  const stride = Math.max(1, width - peek + gap);

  // Focus: pause while the Home tab is not the visible one.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  // Background: pause while the app is not on screen.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  // Slides can arrive after the first render (or shrink): keep the index valid.
  useEffect(() => {
    if (count === 0) {
      indexRef.current = 0;
      setIndex(0);
      return;
    }
    if (indexRef.current > count - 1) {
      indexRef.current = count - 1;
      setIndex(count - 1);
    }
  }, [count]);

  const goTo = useCallback(
    (next: number, animated = true) => {
      indexRef.current = next;
      setIndex(next);
      if (width > 0) {
        listRef.current?.scrollToOffset({ offset: next * stride, animated });
      }
    },
    [stride, width]
  );

  // The auto-advance timer. Recreated only when a pause condition flips.
  const mayAdvance = canAutoAdvance({
    count,
    focused,
    appActive,
    dragging,
    reduceMotion,
  });
  useEffect(() => {
    if (!mayAdvance) return;
    const timer = setInterval(() => {
      goTo(nextCarouselIndex(indexRef.current, count));
    }, CAROUSEL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [mayAdvance, count, goTo]);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (next > 0 && Math.abs(next - width) > 1) setWidth(next);
  };

  const onMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const next = indexFromOffset(event.nativeEvent.contentOffset.x, stride, count);
    indexRef.current = next;
    setIndex(next);
    setDragging(false);
  };

  if (count === 0) return null;

  return (
    <View testID={testID} onLayout={onLayout} accessibilityLabel={accessibilityLabel}>
      {width > 0 ? (
        <FlatList
          ref={listRef}
          data={data as T[]}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={keyExtractor}
          renderItem={({ item, index: itemIndex }) => (
            <View style={{ width: Math.max(1, width - peek) }}>
              {renderItem(item, itemIndex)}
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ width: gap }} />}
          style={{ height }}
          contentContainerStyle={{ paddingRight: peek > 0 ? peek + gap : 0 }}
          onScrollBeginDrag={() => setDragging(true)}
          onScrollEndDrag={() => setDragging(false)}
          onMomentumScrollEnd={onMomentumEnd}
          pagingEnabled={peek === 0}
          snapToInterval={peek === 0 ? undefined : stride}
          decelerationRate={peek === 0 ? 'normal' : 'fast'}
          getItemLayout={(_d, i) => ({ length: stride, offset: stride * i, index: i })}
        />
      ) : (
        // First frame: a fixed-height box, so nothing below it moves once the
        // width is measured and the slides mount.
        <View style={{ height }} />
      )}

      {count > 1 ? (
        <View style={styles.dotsRow}>
          {data.map((item, i) => (
            <TouchableOpacity
              key={keyExtractor(item, i)}
              onPress={() => goTo(i)}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={`${i + 1}/${count}`}
            >
              <Animated.View
                style={[
                  styles.dot,
                  {
                    backgroundColor: i === index ? c.primary : c.border,
                    width: i === index ? 16 : 6,
                  },
                ]}
              />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 8,
  },
  dot: { height: 6, borderRadius: 3 },
});
