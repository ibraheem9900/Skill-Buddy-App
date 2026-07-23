import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';

interface Props { height?: number; borderRadius?: number; style?: object }

export function SkeletonBox({ height = 20, borderRadius = 8, style }: Props) {
  const { colors: c } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ])
    ).start();
  }, [anim]);

  const bg = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [c.skeletonBase, c.skeletonHighlight],
  });

  return <Animated.View style={[{ height, borderRadius, backgroundColor: bg }, style]} />;
}

export default function SkeletonCard() {
  const { colors: c } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: c.card, shadowColor: c.shadow }]}>
      <SkeletonBox height={110} borderRadius={12} />
      <View style={styles.body}>
        <SkeletonBox height={10} style={{ width: '50%' }} />
        <SkeletonBox height={14} style={{ width: '80%', marginTop: 6 }} />
        <SkeletonBox height={10} style={{ width: '60%', marginTop: 4 }} />
        <SkeletonBox height={12} style={{ width: '30%', marginTop: 6 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    width: 180,
    marginRight: 14,
  },
  body: { padding: 12, gap: 4 },
});
