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
  const [overlayColor, setOverlayColor] = useState('#0A0D0D');
  const [origin, setOrigin] = useState({ x: SCREEN_W / 2, y: SCREEN_H / 2 });
  const themeRef = useRef<ThemeMode>('light');
  themeRef.current = theme;

  const scaleAnim = useSharedValue(0);
  // Safety-net: if any animation callback misfires (interrupted, unmount,
  // etc.), this guarantees the "in flight" guard clears itself and never
  // permanently blocks future taps — this was the root cause of the
  // "sometimes it just doesn't apply" bug.
  const safetyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((saved) => {
      if (saved === 'dark' || saved === 'light') setTheme(saved as ThemeMode);
    });
    return () => {
      if (safetyTimeout.current) clearTimeout(safetyTimeout.current);
    };
  }, []);

  const toggleTheme = useCallback(
    (originX = SCREEN_W / 2, originY = SCREEN_H / 2) => {
      const next: ThemeMode = themeRef.current === 'light' ? 'dark' : 'light';
      const nextBg = next === 'dark' ? colors.dark.background : colors.light.background;

      // The theme itself always applies immediately and synchronously —
      // this is the correctness-critical part, and it can never be blocked
      // or delayed by the animation below misbehaving.
      setTheme(next);
      AsyncStorage.setItem(THEME_KEY, next);

      // Cosmetic paint-reveal overlay, entirely decoupled from the above —
      // if this animation glitches or gets interrupted, dark/light mode has
      // already applied correctly regardless.
      if (safetyTimeout.current) clearTimeout(safetyTimeout.current);
      setOrigin({ x: originX, y: originY });
      setOverlayColor(nextBg);
      scaleAnim.value = 0;
      scaleAnim.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished) {
          scaleAnim.value = withTiming(0, { duration: 240, easing: Easing.in(Easing.cubic) });
        }
      });
      // Belt-and-braces: force the overlay to fully reset shortly after,
      // even if a callback above never fires for any reason.
      safetyTimeout.current = setTimeout(() => {
        scaleAnim.value = 0;
      }, 900);
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
