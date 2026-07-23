import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePathname } from 'expo-router';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import BrandedLoader from '@/components/BrandedLoader';
import { useTheme } from '@/context/ThemeContext';

/**
 * Mounted once near the root. Watches the current route (pathname) and,
 * on every change, briefly shows a full-screen branded loader before the
 * destination screen's content is considered "settled" — guarantees every
 * navigation has a visible loading state instead of an abrupt instant swap
 * or a blank white gap.
 */
export default function NavigationLoaderOverlay() {
  const pathname = usePathname();
  const { colors: c } = useTheme();
  const [visible, setVisible] = useState(false);
  const isFirstRender = useRef(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Skip the very first mount (app boot already has its own splash/font-load gate).
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // The filter sheet is a transparent modal — a solid loader flash would
    // defeat its see-through backdrop, so skip it for that route only.
    if (pathname === '/filter') return;
    setVisible(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(false), 320);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [pathname]);

  if (!visible) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(90)}
      exiting={FadeOut.duration(180)}
      style={[StyleSheet.absoluteFill, styles.wrap, { backgroundColor: c.background }]}
      pointerEvents="none"
    >
      <BrandedLoader size={46} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', zIndex: 9998, elevation: 20 },
});
