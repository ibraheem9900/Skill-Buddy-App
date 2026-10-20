import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePathname } from 'expo-router';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import BrandedLoader from '@/components/BrandedLoader';
import { useTheme } from '@/context/ThemeContext';
import { isTabPath } from '@/lib/tabNav';

/**
 * Mounted once near the root. Watches the current route (pathname) and, when a
 * NON-tab screen is pushed, briefly shows the branded loader while that screen
 * settles.
 *
 * It deliberately does NOT cover the five bottom tabs: switching tabs is a swap
 * between screens that are already mounted, and a 320 ms full-screen overlay on
 * every tab press made navigation feel slow. Tab screens show their own scoped
 * skeletons/spinners only while a request is genuinely in flight.
 */
export default function NavigationLoaderOverlay() {
  const pathname = usePathname();
  const { colors: c } = useTheme();
  const [visible, setVisible] = useState(false);
  const isFirstRender = useRef(true);
  const previousPath = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Skip the very first mount (app boot already has its own splash/font-load gate).
    if (isFirstRender.current) {
      isFirstRender.current = false;
      previousPath.current = pathname;
      return;
    }
    const from = previousPath.current;
    previousPath.current = pathname;
    // Tab → tab (and back into a tab): both screens are mounted, so there is
    // nothing to wait for. Never block the bar itself.
    if (isTabPath(pathname)) return;
    // The filter sheet is a transparent modal — a solid loader flash would
    // defeat its see-through backdrop, so skip it for that route only.
    if (pathname === '/filter') return;
    // A push from one non-tab screen to another still gets the settle loader.
    if (from === pathname) return;
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
