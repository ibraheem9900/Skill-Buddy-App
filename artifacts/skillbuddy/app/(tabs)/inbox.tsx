import React from 'react';
import { FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { CHAT_THREADS } from '@/data/mockData';
import EmptyState from '@/components/EmptyState';

export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const TAB_HEIGHT = Platform.OS === 'web' ? 84 : 60;

  return (
    <View style={[styles.root, { backgroundColor: c.surface, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <Text style={[styles.title, { color: c.text }]}>Messages</Text>
        <TouchableOpacity style={[styles.headerBtn, { backgroundColor: c.primaryLight }]}>
          <Feather name="edit" size={18} color={c.primary} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={CHAT_THREADS}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingBottom: TAB_HEIGHT + insets.bottom + 16, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            icon="message-circle"
            title="No Conversations"
            subtitle="Your chats with service providers will appear here."
          />
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 60).duration(350)}>
            <TouchableOpacity
              style={[styles.threadItem, { backgroundColor: c.surface }]}
              onPress={() => router.push(`/chat/${item.id}` as any)}
              activeOpacity={0.75}
            >
              <View style={[styles.avatar, { backgroundColor: c.primaryLight }]}>
                <Text style={[styles.avatarText, { color: c.primary }]}>
                  {item.participant.name.charAt(0)}
                </Text>
                {item.participant.isOnline && (
                  <View style={[styles.onlineDot, { borderColor: c.surface }]} />
                )}
              </View>
              <View style={styles.threadInfo}>
                <View style={styles.threadTop}>
                  <Text style={[styles.participantName, { color: c.text }]}>
                    {item.participant.name}
                  </Text>
                  <Text style={[styles.threadTime, { color: c.mutedForeground }]}>
                    {item.lastTime}
                  </Text>
                </View>
                {item.jobTitle && (
                  <View style={[styles.jobChip, { backgroundColor: c.primaryLight }]}>
                    <Text style={[styles.jobChipText, { color: c.primary }]}>{item.jobTitle}</Text>
                  </View>
                )}
                <View style={styles.threadBottom}>
                  <Text style={[styles.lastMessage, { color: c.mutedForeground }]} numberOfLines={1}>
                    {item.lastMessage}
                  </Text>
                  {item.unreadCount > 0 && (
                    <View style={[styles.badge, { backgroundColor: c.primary }]}>
                      <Text style={styles.badgeText}>{item.unreadCount}</Text>
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          </Animated.View>
        )}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: c.border, marginLeft: 86 }]} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 22 },
  headerBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  threadItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  avatarText: { fontFamily: 'Manrope_700Bold', fontSize: 20 },
  onlineDot: { position: 'absolute', bottom: 2, right: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: '#27AE60', borderWidth: 2 },
  threadInfo: { flex: 1 },
  threadTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  participantName: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  threadTime: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  jobChip: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginBottom: 4 },
  jobChipText: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
  threadBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lastMessage: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 13 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11, color: '#FFF' },
  separator: { height: 1 },
});
