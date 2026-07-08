import React, { useState } from 'react';
import { SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { NOTIFICATIONS } from '@/data/mockData';
import type { Notification } from '@/types';

const c = colors.light;

const NOTIF_ICONS: Record<string, { icon: keyof typeof MaterialIcons.glyphMap; bg: string; color: string }> = {
  booking: { icon: 'event', bg: '#E8F5F3', color: c.primary },
  offer: { icon: 'local-offer', bg: '#FFF8E6', color: '#F39C12' },
  review: { icon: 'star-border', bg: '#F0F0F0', color: '#737373' },
  payment: { icon: 'account-balance-wallet', bg: '#E8F5F3', color: c.primary },
  system: { icon: 'notifications', bg: '#F0F0F0', color: '#737373' },
};

function NotifItem({ item, index }: { item: Notification; index: number }) {
  const meta = NOTIF_ICONS[item.type] ?? NOTIF_ICONS.system;
  return (
    <Animated.View entering={FadeInDown.delay(index * 40).duration(300)}>
      <View style={[styles.item, !item.isRead && { backgroundColor: '#F0FAF9' }]}>
        <View style={[styles.notifIcon, { backgroundColor: meta.bg }]}>
          <MaterialIcons name={meta.icon} size={22} color={meta.color} />
        </View>
        <View style={styles.itemBody}>
          <View style={styles.itemTop}>
            <Text style={[styles.itemTitle, !item.isRead && { fontFamily: 'Inter_700Bold' }]}>{item.title}</Text>
            <Text style={styles.itemTime}>{item.time}</Text>
          </View>
          <Text style={styles.itemMsg} numberOfLines={3}>{item.message}</Text>
        </View>
        {!item.isRead && <View style={[styles.unreadDot, { backgroundColor: c.primary }]} />}
      </View>
    </Animated.View>
  );
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const unread = NOTIFICATIONS.filter((n) => !n.isRead).length;

  const sections = [
    { title: 'TODAY', data: NOTIFICATIONS.filter((_, i) => i < 3) },
    { title: 'YESTERDAY', data: NOTIFICATIONS.filter((_, i) => i >= 3) },
  ];

  let globalIdx = 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.title}>Notification</Text>
        {unread > 0 && (
          <View style={[styles.badge, { backgroundColor: c.primary }]}>
            <Text style={styles.badgeText}>{unread} NEW</Text>
          </View>
        )}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(n) => n.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <TouchableOpacity><Text style={[styles.markAll, { color: c.primary }]}>Mark all as read</Text></TouchableOpacity>
          </View>
        )}
        renderItem={({ item }) => {
          const idx = globalIdx++;
          return <NotifItem item={item} index={idx} />;
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  title: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 20, color: '#1A1A1A' },
  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  badgeText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: '#FFF' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#F8F8F8' },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: '#9E9E9E', letterSpacing: 0.5 },
  markAll: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  item: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 20, paddingVertical: 14, gap: 14 },
  notifIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  itemBody: { flex: 1 },
  itemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  itemTitle: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#1A1A1A', marginRight: 8 },
  itemTime: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#9E9E9E', flexShrink: 0 },
  itemMsg: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#737373', lineHeight: 20 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4, flexShrink: 0 },
  separator: { height: 1, backgroundColor: '#F5F5F5' },
});
