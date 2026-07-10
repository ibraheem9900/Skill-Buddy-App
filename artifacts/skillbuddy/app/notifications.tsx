import React from 'react';
import { SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { NOTIFICATIONS } from '@/data/mockData';
import type { Notification } from '@/types';

function NotifItem({ item, index, c }: { item: Notification; index: number; c: any }) {
  const NOTIF_ICONS: Record<string, { icon: keyof typeof MaterialIcons.glyphMap; bg: string; color: string }> = {
    booking: { icon: 'event',                    bg: c.primaryLight,  color: c.primary },
    offer:   { icon: 'local-offer',              bg: '#FFF8E6',       color: '#F39C12' },
    review:  { icon: 'star-border',              bg: c.muted,         color: c.mutedForeground },
    payment: { icon: 'account-balance-wallet',   bg: c.primaryLight,  color: c.primary },
    system:  { icon: 'notifications',            bg: c.muted,         color: c.mutedForeground },
  };
  const meta = NOTIF_ICONS[item.type] ?? NOTIF_ICONS.system;

  return (
    <Animated.View entering={FadeInDown.delay(index * 40).duration(300)}>
      <View style={[styles.item, { backgroundColor: !item.isRead ? c.primaryLight : c.surface }]}>
        <View style={[styles.notifIcon, { backgroundColor: meta.bg }]}>
          <MaterialIcons name={meta.icon} size={22} color={meta.color} />
        </View>
        <View style={styles.itemBody}>
          <View style={styles.itemTop}>
            <Text
              style={[styles.itemTitle, { color: c.text }, !item.isRead && { fontFamily: 'Inter_700Bold' }]}
            >
              {item.title}
            </Text>
            <Text style={[styles.itemTime, { color: c.mutedForeground }]}>{item.time}</Text>
          </View>
          <Text style={[styles.itemMsg, { color: c.mutedForeground }]} numberOfLines={3}>
            {item.message}
          </Text>
        </View>
        {!item.isRead && <View style={[styles.unreadDot, { backgroundColor: c.primary }]} />}
      </View>
    </Animated.View>
  );
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const unread = NOTIFICATIONS.filter((n) => !n.isRead).length;

  const sections = [
    { title: 'TODAY',     data: NOTIFICATIONS.filter((_, i) => i < 3) },
    { title: 'YESTERDAY', data: NOTIFICATIONS.filter((_, i) => i >= 3) },
  ];

  let globalIdx = 0;

  return (
    <View style={[styles.root, { backgroundColor: c.surface }]}>
      {/*
        ── Safe-area spacer ────────────────────────────────────────────────────
        A dedicated View sized exactly to insets.top pushes ALL header content
        safely below the notch / dynamic island on any device.
        This is more reliable than mixing paddingTop + paddingVertical in the
        same style array (RN style merging can silently drop one of them).
      */}
      <View style={{ height: insets.top, backgroundColor: c.surface }} />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: c.text }]}>Notification</Text>
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
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        renderSectionHeader={({ section }) => (
          <View style={[styles.sectionHdr, { backgroundColor: c.background }]}>
            <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>{section.title}</Text>
            <TouchableOpacity>
              <Text style={[styles.markAll, { color: c.primary }]}>Mark all as read</Text>
            </TouchableOpacity>
          </View>
        )}
        renderItem={({ item }) => {
          const idx = globalIdx++;
          return <NotifItem item={item} index={idx} c={c} />;
        }}
        ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.border }]} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  // header — NO paddingVertical here; vertical spacing is set explicitly below
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 20 },
  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  badgeText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: '#FFF' },

  sectionHdr: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.5 },
  markAll: { fontFamily: 'Inter_500Medium', fontSize: 12 },

  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 14,
  },
  notifIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  itemBody: { flex: 1 },
  itemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  itemTitle: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 14, marginRight: 8 },
  itemTime: { fontFamily: 'Inter_400Regular', fontSize: 12, flexShrink: 0 },
  itemMsg: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 20 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4, flexShrink: 0 },
  sep: { height: StyleSheet.hairlineWidth },
});
