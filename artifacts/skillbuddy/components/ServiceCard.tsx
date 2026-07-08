import React, { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { useBookmarks } from '@/context/BookmarkContext';
import type { Service } from '@/types';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

interface Props {
  service: Service;
  variant?: 'horizontal' | 'vertical' | 'list';
}

export default function ServiceCard({ service, variant = 'vertical' }: Props) {
  const router = useRouter();
  const { isBookmarked, toggleBookmark } = useBookmarks();
  const scale = useSharedValue(1);
  const bookmarked = isBookmarked(service.id);
  const c = colors.light;

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

  if (variant === 'list') {
    return (
      <AnimatedTouchable
        style={[styles.listCard, animStyle]}
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
          <Text style={styles.listTitle} numberOfLines={2}>{service.title}</Text>
          <View style={styles.providerRow}>
            <Feather name="user" size={12} color={c.mutedForeground} />
            <Text style={styles.providerName}>{service.provider.name}</Text>
          </View>
          <Text style={[styles.price, { color: c.primary }]}>${service.price.toFixed(2)}</Text>
        </View>
        <TouchableOpacity style={styles.listBookmark} onPress={handleBookmark}>
          <Feather name="bookmark" size={18} color={bookmarked ? c.primary : c.primary} fill={bookmarked ? c.primary : 'none'} />
        </TouchableOpacity>
      </AnimatedTouchable>
    );
  }

  // Vertical card (for horizontal scrolls on home)
  return (
    <AnimatedTouchable
      style={[styles.card, animStyle]}
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
        <Text style={styles.title} numberOfLines={2}>{service.title}</Text>
        <View style={styles.providerRow}>
          <Feather name="user" size={12} color={c.mutedForeground} />
          <Text style={styles.providerName}>{service.provider.name}</Text>
        </View>
        <Text style={[styles.price, { color: c.primary }]}>${service.price.toFixed(2)}</Text>
      </View>
    </AnimatedTouchable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 175,
    backgroundColor: '#FFF',
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
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#1A1A1A', lineHeight: 18 },
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  providerName: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#737373' },
  price: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  // List variant
  listCard: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
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
  listTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#1A1A1A' },
  listBookmark: { padding: 4 },
  chip: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  chipText: { fontFamily: 'Inter_500Medium', fontSize: 11 },
});
