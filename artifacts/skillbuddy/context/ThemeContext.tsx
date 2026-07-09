import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  SharedValue,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import colors from '@/constants/colors';

export type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
  theme: ThemeMode;
  colors: typeof colors.light;
  toggleTheme: (originX?: number, originY?: number) => void;
}

const THEME_KEY = 'sb_theme';

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  colors: colors.light,
  toggleTheme: () => {},
});

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const DIAGONAL = Math.sqrt(SCREEN_W * SCREEN_W + SCREEN_H * SCREEN_H);

/**
 * Paint-reveal overlay.
 *
 * Animation sequence (no-flicker):
 * 1. Overlay (next-theme bg color) starts at scale 0 → expands to scale 1 (full screen).
 * 2. At the midpoint (50% through), apply the new theme state — it becomes visible
 *    under the still-expanding overlay, so the swap is never seen directly.
 * 3. Once fully expanded, hold for 1 frame then collapse instantly (scale → 0).
 *    The user now sees the new theme with no overlay.
 */
function PaintRevealOverlay({
  scaleAnim,
  overlayColor,
  originX,
  originY,
}: {
  scaleAnim: SharedValue<number>;
  overlayColor: string;
  originX: number;
  originY: number;
}) {
  const radius = DIAGONAL;
  const animStyle = useAnimatedStyle(() => ({
    opacity: scaleAnim.value > 0.001 ? 1 : 0,
    transform: [{ scale: scaleAnim.value }],
  }));

  return (
    <Animated.View
      style={[
        { pointerEvents: 'none' } as any,
        styles.overlay,
        {
          width: radius * 2,
          height: radius * 2,
          borderRadius: radius,
          backgroundColor: overlayColor,
          top: originY - radius,
          left: originX - radius,
        },
        animStyle,
      ]}
    />
  );
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>('light');
  const originRef = useRef({ x: SCREEN_W / 2, y: SCREEN_H / 2 });
  const [overlayColor, setOverlayColor] = useState('#111614');
  // Whether a toggle is currently in flight — prevents double-taps.
  const isAnimating = useRef(false);

  const scaleAnim = useSharedValue(0);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((saved) => {
      if (saved === 'dark' || saved === 'light') setTheme(saved as ThemeMode);
    });
  }, []);

  const toggleTheme = useCallback(
    (originX = SCREEN_W / 2, originY = SCREEN_H / 2) => {
      if (isAnimating.current) return;
      isAnimating.current = true;

      setTheme((current) => {
        const next: ThemeMode = current === 'light' ? 'dark' : 'light';
        const nextBg = next === 'dark' ? colors.dark.background : colors.light.background;
        originRef.current = { x: originX, y: originY };
        setOverlayColor(nextBg);

        // Kick off expand animation.
        // After half the duration, apply the theme swap under the still-covering overlay.
        // After the full expand, collapse the overlay instantly.
        scaleAnim.value = 0;

        // Phase 1: expand 0 → 1 over 480ms
        scaleAnim.value = withTiming(
          1,
          { duration: 480, easing: Easing.out(Easing.cubic) },
          (finished) => {
            if (!finished) {
              runOnJS(() => { isAnimating.current = false; })();
              return;
            }
            // Phase 2: collapse instantly (sets opacity to 0 via the animated style)
            scaleAnim.value = 0;
            runOnJS(() => { isAnimating.current = false; })();
          }
        );

        // Apply the theme after 240ms (mid-point) — overlay fully covers the screen by then.
        setTimeout(() => {
          setTheme(next);
          AsyncStorage.setItem(THEME_KEY, next);
        }, 240);

        return current; // Return current for the outer setTheme — we handle it in setTimeout above
      });
    },
    [scaleAnim]
  );

  const palette = theme === 'dark' ? colors.dark : colors.light;

  return (
    <ThemeContext.Provider value={{ theme, colors: palette, toggleTheme }}>
      {children}
      <PaintRevealOverlay
        scaleAnim={scaleAnim}
        overlayColor={overlayColor}
        originX={originRef.current.x}
        originY={originRef.current.y}
      />
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    zIndex: 9999,
  },
});
