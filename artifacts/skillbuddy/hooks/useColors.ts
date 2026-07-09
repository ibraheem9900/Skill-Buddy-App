import { useTheme } from '@/context/ThemeContext';

/**
 * Returns the design tokens for the current theme.
 *
 * Theme is controlled by ThemeContext (user toggle + AsyncStorage persistence).
 * Import and call this hook anywhere you need color tokens.
 */
export function useColors() {
  const { colors } = useTheme();
  return colors;
}
