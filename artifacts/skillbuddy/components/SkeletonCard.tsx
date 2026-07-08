import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import colors from '@/constants/colors';

interface Props { height?: number; borderRadius?: number; style?: object }

export function SkeletonBox({ height = 20, borderRadius = 8, style }: Props) {
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
    outputRange: [colors.light.skeletonBase, colors.light.skeletonHighlight],
  });

  return <Animated.View style={[{ height, borderRadius, backgroundColor: bg }, style]} />;
}

export default function SkeletonCard() {
  return (
    <View style={styles.card}>
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
    backgroundColor: '#FFF',
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    width: 180,
    marginRight: 14,
  },
  body: { padding: 12, gap: 4 },
});
