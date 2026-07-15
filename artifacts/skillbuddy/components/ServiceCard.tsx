import React, { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useBookmarks } from '@/context/BookmarkContext';
import type { Service } from '@/types';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

interface Props {
  service: Service;
  variant?: 'horizontal' | 'vertical' | 'list';
}

function creditPoints(price: number): number {
  return Math.round(price);
}

export default function ServiceCard({ service, variant = 'vertical' }: Props) {
  const router = useRouter();
  const { isBookmarked, toggleBookmark } = useBookmarks();
  const { colors: c } = useTheme();
  const scale = useSharedValue(1);
  const bookmarked = isBookmarked(service.id);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const onPressIn = () => { scale.value = withSpring(0.97); };
  const onPressOut = () => { scale.value = withSpring(1); };

  const handleBookmark = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleBookmark(service);
  }, [service, toggleBookmark]);

  const handlePress = () => {
    router.push(`/service/${service.id}` as any);
  };

  const priceLabel = `€${service.price.toFixed(2)} · ${creditPoints(service.price)} pts`;

  if (variant === 'list') {
    return (
      <AnimatedTouchable
        style={[styles.listCard, { backgroundColor: c.card }, animStyle]}
        activeOpacity={1}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onPress={handlePress}
      >
        <Image source={{ uri: service.image }} style={styles.listImage} contentFit="cover" />
        <View style={styles.listBody}>
          <View style={[styles.chip, { backgroundColor: c.primaryLight }]}>
            <Text style={[styles.chipText, { color: c.primary }]}>{service.category}</Text>
          </View>
          <Text style={[styles.listTitle, { color: c.text }]} numberOfLines={2}>{service.title}</Text>
          <View style={styles.providerRow}>
            <Feather name="user" size={12} color={c.mutedForeground} />
            <Text style={[styles.providerName, { color: c.mutedForeground }]}>{service.provider.name}</Text>
          </View>
          <Text style={[styles.price, { color: c.primary }]}>{priceLabel}</Text>
        </View>
        <TouchableOpacity style={styles.listBookmark} onPress={handleBookmark}>
          <Feather name="bookmark" size={18} color={c.primary} />
        </TouchableOpacity>
      </AnimatedTouchable>
    );
  }

  // Vertical card (for horizontal scrolls on home)
  return (
    <AnimatedTouchable
      style={[styles.card, { backgroundColor: c.card }, animStyle]}
      activeOpacity={1}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={handlePress}
    >
      <View style={styles.imageWrap}>
        <Image source={{ uri: service.image }} style={styles.image} contentFit="cover" />
        <View style={styles.ratingBadge}>
          <MaterialIcons name="star" size={12} color={c.rating} />
          <Text style={styles.ratingText}>{service.rating}</Text>
        </View>
        <TouchableOpacity style={styles.bookmarkBtn} onPress={handleBookmark}>
          <View style={[styles.bookmarkBg, { backgroundColor: bookmarked ? c.primary : '#FFF' }]}>
            <Feather name="bookmark" size={14} color={bookmarked ? '#FFF' : '#1A1A1A'} />
          </View>
        </TouchableOpacity>
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>{service.title}</Text>
        <View style={styles.providerRow}>
          <Feather name="user" size={12} color={c.mutedForeground} />
          <Text style={[styles.providerName, { color: c.mutedForeground }]}>{service.provider.name}</Text>
        </View>
        <Text style={[styles.price, { color: c.primary }]}>{priceLabel}</Text>
      </View>
    </AnimatedTouchable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 175,
    borderRadius: 16,
    overflow: 'hidden',
    marginRight: 14,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  imageWrap: { position: 'relative' },
  image: { width: '100%', height: 130 },
  ratingBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 3,
    gap: 2,
  },
  ratingText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#1A1A1A' },
  bookmarkBtn: { position: 'absolute', top: 8, right: 8 },
  bookmarkBg: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 10, gap: 3 },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 18 },
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  providerName: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  price: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  listCard: {
    flexDirection: 'row',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    padding: 12,
    alignItems: 'center',
  },
  listImage: { width: 85, height: 85, borderRadius: 12 },
  listBody: { flex: 1, paddingHorizontal: 12, gap: 3 },
  listTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  listBookmark: { padding: 4 },
  chip: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  chipText: { fontFamily: 'Inter_500Medium', fontSize: 11 },
});
