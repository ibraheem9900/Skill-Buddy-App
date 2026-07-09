import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';

interface Props {
  rating: number;
  size?: number;
  showValue?: boolean;
  reviewCount?: number;
  color?: string;
}

export default function RatingStars({ rating, size = 14, showValue = true, reviewCount, color }: Props) {
  const { colors: c } = useTheme();
  const starColor = color ?? c.rating;
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.5;

  return (
    <View style={styles.row}>
      {Array.from({ length: 5 }, (_, i) => {
        const filled = i < fullStars;
        const half = !filled && i === fullStars && hasHalf;
        return (
          <MaterialIcons
            key={i}
            name={filled ? 'star' : half ? 'star-half' : 'star-border'}
            size={size}
            color={filled || half ? starColor : c.border}
          />
        );
      })}
      {showValue && (
        <Text style={[styles.value, { fontSize: size, color: c.text }]}>{rating.toFixed(1)}</Text>
      )}
      {reviewCount !== undefined && (
        <Text style={[styles.count, { fontSize: size, color: c.mutedForeground }]}>
          ({reviewCount} reviews)
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  value: { fontFamily: 'Inter_600SemiBold', marginLeft: 3 },
  count: { fontFamily: 'Inter_400Regular', marginLeft: 2 },
});
