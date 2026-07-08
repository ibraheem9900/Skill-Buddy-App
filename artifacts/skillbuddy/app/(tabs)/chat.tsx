import React from 'react';
import { FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { CHAT_THREADS } from '@/data/mockData';
import EmptyState from '@/components/EmptyState';

const c = colors.light;

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const TAB_HEIGHT = Platform.OS === 'web' ? 84 : 60;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <TouchableOpacity style={[styles.headerBtn, { backgroundColor: c.primaryLight }]}>
          <Feather name="edit" size={18} color={c.primary} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={CHAT_THREADS}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingBottom: TAB_HEIGHT + 16, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<EmptyState icon="message-circle" title="No Conversations" subtitle="Your chats with service providers will appear here." />}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 60).duration(350)}>
            <TouchableOpacity
              style={styles.threadItem}
              onPress={() => router.push(`/chat/${item.id}` as any)}
              activeOpacity={0.75}
            >
              {/* Avatar */}
              <View style={[styles.avatar, { backgroundColor: c.primaryLight }]}>
                <Text style={[styles.avatarText, { color: c.primary }]}>
                  {item.participant.name.charAt(0)}
                </Text>
                {item.participant.isOnline && <View style={styles.onlineDot} />}
              </View>
              {/* Info */}
              <View style={styles.threadInfo}>
                <View style={styles.threadTop}>
                  <Text style={styles.participantName}>{item.participant.name}</Text>
                  <Text style={styles.threadTime}>{item.lastTime}</Text>
                </View>
                {item.jobTitle && (
                  <View style={[styles.jobChip, { backgroundColor: c.primaryLight }]}>
                    <Text style={[styles.jobChipText, { color: c.primary }]}>{item.jobTitle}</Text>
                  </View>
                )}
                <View style={styles.threadBottom}>
                  <Text style={styles.lastMessage} numberOfLines={1}>{item.lastMessage}</Text>
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
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF' },
  header: {
    paddingHorizontal: 20, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22, color: '#1A1A1A' },
  headerBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  threadItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  onlineDot: { position: 'absolute', bottom: 2, right: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: '#27AE60', borderWidth: 2, borderColor: '#FFF' },
  threadInfo: { flex: 1 },
  threadTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  participantName: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#1A1A1A' },
  threadTime: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#9E9E9E' },
  jobChip: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginBottom: 4 },
  jobChipText: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  threadBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lastMessage: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, color: '#737373' },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#FFF' },
  separator: { height: 1, backgroundColor: '#F5F5F5', marginLeft: 86 },
});
