import React from 'react';
import { ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { Offer } from '@/types';

interface Props { offer: Offer; cardWidth?: number }

export default function SpecialOfferCard({ offer, cardWidth }: Props) {
  return (
    <View style={[styles.card, cardWidth ? { width: cardWidth } : undefined]}>
      <ImageBackground
        source={{ uri: offer.bgImage }}
        style={styles.bg}
        imageStyle={styles.bgImage}
        resizeMode="cover"
      >
        {/* Dark overlay for readability */}
        <View style={[styles.overlay, { backgroundColor: offer.bg + 'CC' }]} />

        <View style={styles.content}>
          <View style={styles.left}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Limited time</Text>
            </View>
            <Text style={styles.title} numberOfLines={1}>{offer.title}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{offer.subtitle}</Text>
          </View>

          <View style={styles.right}>
            <View style={styles.discountBox}>
              <Text style={styles.discountNum}>{offer.discount}</Text>
              <Text style={styles.discountPct}>%{'\n'}OFF</Text>
            </View>
            <Pressable style={styles.claimBtn} android_ripple={{ color: 'rgba(255,255,255,0.2)' }}>
              <Feather name="arrow-right" size={14} color="#FFF" />
            </Pressable>
          </View>
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 280,
    height: 110,
    borderRadius: 16,
    overflow: 'hidden',
    marginRight: 12,
  },
  bg: {
    flex: 1,
  },
  bgImage: {
    borderRadius: 16,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  left: {
    flex: 1,
    gap: 3,
    marginRight: 10,
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
  },
  badgeText: { fontFamily: 'Manrope_500Medium', fontSize: 10, color: '#FFF' },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 14, color: '#FFF' },
  subtitle: { fontFamily: 'Manrope_400Regular', fontSize: 10, color: 'rgba(255,255,255,0.75)' },
  right: {
    alignItems: 'center',
    gap: 6,
  },
  discountBox: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  discountNum: { fontFamily: 'Manrope_700Bold', fontSize: 32, color: '#FFF', lineHeight: 36 },
  discountPct: { fontFamily: 'Manrope_700Bold', fontSize: 11, color: 'rgba(255,255,255,0.85)', marginBottom: 4, lineHeight: 14 },
  claimBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
});
