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
  const [overlayColor, setOverlayColor] = useState('#111614');
  const [origin, setOrigin] = useState({ x: SCREEN_W / 2, y: SCREEN_H / 2 });
  // Whether a toggle is currently in flight — prevents double-taps.
  const isAnimating = useRef(false);
  const themeRef = useRef<ThemeMode>('light');
  themeRef.current = theme;

  const scaleAnim = useSharedValue(0);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((saved) => {
      if (saved === 'dark' || saved === 'light') setTheme(saved as ThemeMode);
    });
  }, []);

  // Runs on the JS thread once the overlay has fully expanded and covers the
  // screen — safe to swap the actual theme here since nothing is visible
  // underneath the overlay at this point.
  const applyThemeSwap = useCallback(() => {
    const next: ThemeMode = themeRef.current === 'light' ? 'dark' : 'light';
    setTheme(next);
    AsyncStorage.setItem(THEME_KEY, next);
    // Collapse the overlay now that the new theme is underneath it.
    scaleAnim.value = withTiming(0, { duration: 260, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) {
        isAnimating.current = false;
      }
    });
  }, [scaleAnim]);

  const toggleTheme = useCallback(
    (originX = SCREEN_W / 2, originY = SCREEN_H / 2) => {
      if (isAnimating.current) return;
      isAnimating.current = true;

      const next: ThemeMode = themeRef.current === 'light' ? 'dark' : 'light';
      const nextBg = next === 'dark' ? colors.dark.background : colors.light.background;

      // Plain state updates — no nested setState-inside-updater here, which
      // was the source of the crash (React may invoke updater functions more
      // than once, causing the side effects inside it to fire unpredictably).
      setOrigin({ x: originX, y: originY });
      setOverlayColor(nextBg);
      scaleAnim.value = 0;
      scaleAnim.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished) {
          runOnJS(applyThemeSwap)();
        } else {
          runOnJS(() => {
            isAnimating.current = false;
          })();
        }
      });
    },
    [scaleAnim, applyThemeSwap]
  );

  const palette = theme === 'dark' ? colors.dark : colors.light;

  return (
    <ThemeContext.Provider value={{ theme, colors: palette, toggleTheme }}>
      {children}
      <PaintRevealOverlay
        scaleAnim={scaleAnim}
        overlayColor={overlayColor}
        originX={origin.x}
        originY={origin.y}
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
