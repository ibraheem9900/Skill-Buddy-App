import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import colors from '@/constants/colors';
import type { Offer } from '@/types';

interface Props { offer: Offer }

export default function SpecialOfferCard({ offer }: Props) {
  const c = colors.light;
  return (
    <View style={[styles.card, { backgroundColor: offer.bg }]}>
      <View style={styles.content}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Limited time!</Text>
        </View>
        <Text style={styles.title}>{offer.title}</Text>
        <View style={styles.discountRow}>
          <Text style={styles.upTo}>Up to</Text>
          <Text style={styles.discount}>{offer.discount}</Text>
          <Text style={styles.percent}>%</Text>
        </View>
        <Text style={styles.subtitle}>{offer.subtitle}</Text>
      </View>
      <Pressable style={[styles.claimBtn, { backgroundColor: c.rating }]}>
        <Text style={styles.claimText}>Claim</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 290,
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: 14,
    overflow: 'hidden',
  },
  content: { flex: 1, gap: 4 },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 4,
  },
  badgeText: { fontFamily: 'Inter_500Medium', fontSize: 11, color: '#FFF' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 18, color: '#FFF' },
  discountRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  upTo: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#CCC', marginBottom: 2 },
  discount: { fontFamily: 'Inter_700Bold', fontSize: 42, color: '#FFF', lineHeight: 48 },
  percent: { fontFamily: 'Inter_700Bold', fontSize: 22, color: '#FFF', marginBottom: 4 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 11, color: '#AAA', marginTop: 2 },
  claimBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 25,
    alignSelf: 'center',
    marginLeft: 12,
  },
  claimText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: '#FFF' },
});
