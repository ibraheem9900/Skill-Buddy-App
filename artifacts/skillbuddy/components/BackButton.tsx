import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';

interface Props {
  onPress?: () => void;
  color?: string;
  style?: object;
}

/**
 * Standard circular back button — used on every screen with a back action.
 * Theme-surface-colored circle, subtle shadow, ChevronLeft icon.
 */
export default function BackButton({ onPress, color, style }: Props) {
  const router = useRouter();
  const { colors: c } = useTheme();

  return (
    <TouchableOpacity
      style={[styles.btn, { backgroundColor: c.surface, shadowColor: '#000' }, style]}
      onPress={onPress ?? (() => router.back())}
      activeOpacity={0.75}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Feather name="chevron-left" size={22} color={color ?? c.text} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
});
