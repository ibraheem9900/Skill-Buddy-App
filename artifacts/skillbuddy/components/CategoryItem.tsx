import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import type { Category } from '@/types';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

interface Props {
  category: Category;
  size?: 'sm' | 'md';
}

export default function CategoryItem({ category, size = 'md' }: Props) {
  const router = useRouter();
  const { colors: c } = useTheme();
  const scale = useSharedValue(1);
  const iconSize = size === 'sm' ? 24 : 28;
  const circleSize = size === 'sm' ? 56 : 64;

  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedTouchable
      style={[styles.container, animStyle, size === 'sm' && styles.containerSm]}
      activeOpacity={1}
      onPressIn={() => { scale.value = withSpring(0.9); }}
      onPressOut={() => { scale.value = withSpring(1); }}
      onPress={() => router.push(`/category/${category.id}` as any)}
    >
      <Animated.View
        style={[
          styles.circle,
          { width: circleSize, height: circleSize, borderRadius: circleSize / 2, backgroundColor: c.muted },
        ]}
      >
        <MaterialCommunityIcons name={category.iconName as any} size={iconSize} color={c.primary} />
      </Animated.View>
      <Text style={[styles.label, { color: c.text }, size === 'sm' && styles.labelSm]} numberOfLines={1}>
        {category.name.length > 7 ? category.name.substring(0, 6) + '..' : category.name}
      </Text>
    </AnimatedTouchable>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: 8, width: 72 },
  containerSm: { width: 64 },
  circle: { alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: 'Manrope_500Medium', fontSize: 13, textAlign: 'center' },
  labelSm: { fontSize: 11 },
});
