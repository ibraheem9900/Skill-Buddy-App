import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import type { Bid } from '@/types';

interface Props {
  bid: Bid;
  rank?: number; // 1-3 for "Recommended" badge
  onViewProfile: () => void;
  onChat: () => void;
  onAccept: () => void;
}

export default function BidCard({ bid, rank, onViewProfile, onChat, onAccept }: Props) {
  const { colors: c } = useTheme();
  const { provider } = bid;

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      {rank && (
        <View style={[styles.rankBadge, { backgroundColor: c.primary }]}>
          <MaterialCommunityIcons name="star" size={11} color="#FFF" />
          <Text style={styles.rankText}>#{rank} Recommended · {bid.score}/100</Text>
        </View>
      )}

      <View style={styles.topRow}>
        <View style={[styles.avatar, { backgroundColor: c.primaryLight }]}>
          <Text style={[styles.avatarText, { color: c.primary }]}>{provider.name.charAt(0)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: c.text }]}>{provider.name}</Text>
          <View style={styles.metaRow}>
            <Feather name="star" size={12} color={c.rating} />
            <Text style={[styles.metaText, { color: c.mutedForeground }]}>{provider.rating?.toFixed(1)}</Text>
            <View style={[styles.badgeDot, { backgroundColor: c.mutedForeground }]} />
            <MaterialCommunityIcons name="shield-check-outline" size={13} color={c.mutedForeground} />
            <Text style={[styles.metaText, { color: c.mutedForeground }]}>{provider.badge} badge</Text>
            <View style={[styles.badgeDot, { backgroundColor: c.mutedForeground }]} />
            <Text style={[styles.metaText, { color: c.mutedForeground }]}>{provider.distanceKm}km away</Text>
          </View>
        </View>
        <View style={styles.priceWrap}>
          <Text style={[styles.price, { color: c.primary }]}>€{bid.price}</Text>
          <Text style={[styles.eta, { color: c.mutedForeground }]}>ETA {bid.eta}</Text>
        </View>
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity style={[styles.actionBtn, { borderColor: c.border }]} onPress={onViewProfile}>
          <Text style={[styles.actionText, { color: c.text }]}>View Profile</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { borderColor: c.border }]} onPress={onChat}>
          <Feather name="message-circle" size={14} color={c.text} />
          <Text style={[styles.actionText, { color: c.text }]}>Chat</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.acceptBtn, { backgroundColor: c.primary }]} onPress={onAccept}>
          <Text style={styles.acceptText}>Accept Bid</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 12, marginBottom: 12 },
  rankBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginBottom: -2 },
  rankText: { fontFamily: 'Manrope_600SemiBold', fontSize: 10, color: '#FFF' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Manrope_700Bold', fontSize: 17 },
  name: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginBottom: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  metaText: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  badgeDot: { width: 2.5, height: 2.5, borderRadius: 1.25 },
  priceWrap: { alignItems: 'flex-end' },
  price: { fontFamily: 'Manrope_700Bold', fontSize: 17 },
  eta: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  actionsRow: { flexDirection: 'row', gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1 },
  actionText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  acceptBtn: { flex: 1.2, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 10 },
  acceptText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#FFF' },
});
