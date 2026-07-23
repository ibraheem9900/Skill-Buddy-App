import React, { useRef, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { useTheme } from '@/context/ThemeContext';
import { CHAT_THREADS } from '@/data/mockData';
import BackButton from '@/components/BackButton';
import type { ChatMessage } from '@/types';


const INITIAL_MESSAGES: ChatMessage[] = [
  { id: 'm1', text: 'Lorem Ipsum is simply dummy text of the printing and typesetting industry.', sender: 'other', timestamp: '08:04 pm', senderName: 'Jenny Wilson' },
  { id: 'm2', text: 'Lorem Ipsum is simply dummy text of the printing and typesetting industry.', sender: 'me', timestamp: '08:04 pm', senderName: 'Esther Howard' },
  { id: 'm3', image: 'https://images.unsplash.com/photo-1527515673510-8aa78ce21f9b?w=300&q=80', sender: 'other', timestamp: '08:04 pm', senderName: 'Jenny Wilson' },
  { id: 'm4', voice: 'audio', voiceDuration: 13, sender: 'me', timestamp: '08:04 pm', senderName: 'Esther Howard' },
];

export default function ChatThreadScreen() {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const thread = CHAT_THREADS.find((t) => t.id === id) ?? CHAT_THREADS[0];
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const flatRef = useRef<FlatList>(null);

  const sendMessage = () => {
    if (!input.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newMsg: ChatMessage = {
      id: Date.now().toString(),
      text: input.trim(),
      sender: 'me',
      timestamp: new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }),
      senderName: 'You',
    };
    setMessages((prev) => [newMsg, ...prev]);
    setInput('');
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isMe = item.sender === 'me';
    return (
      <Animated.View entering={FadeIn.duration(200)} style={[styles.msgRow, isMe && styles.msgRowMe]}>
        {!isMe && (
          <View style={[styles.avatar, { backgroundColor: c.primaryLight }]}>
            <Text style={[styles.avatarText, { color: c.primary }]}>{thread.participant.name.charAt(0)}</Text>
          </View>
        )}
        <View style={styles.msgContent}>
          {item.image ? (
            <View style={[styles.bubble, isMe ? { backgroundColor: c.primary, borderBottomRightRadius: 4 } : { backgroundColor: c.card, borderBottomLeftRadius: 4 }, { padding: 4 }]}>
              <Image source={{ uri: item.image }} style={[styles.msgImage, { borderRadius: 12 }]} contentFit="cover" />
            </View>
          ) : item.voice ? (
            <View style={[styles.bubble, isMe ? { backgroundColor: c.primary, borderBottomRightRadius: 4 } : { backgroundColor: c.card, borderBottomLeftRadius: 4 }, styles.voiceBubble]}>
              <TouchableOpacity style={styles.playBtn}>
                <Feather name="play" size={18} color="#FFF" />
              </TouchableOpacity>
              <View style={styles.waveform}>
                {Array.from({ length: 20 }, (_, i) => (
                  <View key={i} style={[styles.bar, { height: 4 + Math.sin(i) * 12 + 8 }]} />
                ))}
              </View>
              <Text style={styles.voiceDuration}>0:{String(item.voiceDuration ?? 0).padStart(2, '0')}</Text>
            </View>
          ) : (
            <View style={[styles.bubble, isMe ? { backgroundColor: c.primary, borderBottomRightRadius: 4 } : { backgroundColor: c.card, borderBottomLeftRadius: 4 }]}>
              <Text style={[styles.msgText, { color: c.text }, isMe && styles.msgTextMe]}>{item.text}</Text>
            </View>
          )}
          <View style={[styles.metaRow, isMe && { justifyContent: 'flex-end' }]}>
            <Text style={styles.timestamp}>{item.timestamp}</Text>
            {!isMe && <Text style={styles.senderName}>{item.senderName}</Text>}
          </View>
        </View>
        {isMe && (
          <View style={[styles.avatar, { backgroundColor: c.primary }]}>
            <Text style={[styles.avatarText, { color: '#FFF' }]}>E</Text>
          </View>
        )}
      </Animated.View>
    );
  };

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: c.primary }]}>
        <View style={styles.headerLeft}>
          <BackButton color="#FFF" style={{ backgroundColor: 'rgba(255,255,255,0.25)', shadowOpacity: 0 }} />
          <View style={[styles.headerAvatar, { backgroundColor: '#FFF' }]}>
            <Text style={[styles.headerAvatarText, { color: c.primary }]}>{thread.participant.name.charAt(0)}</Text>
          </View>
          <View>
            <Text style={styles.headerName}>{thread.participant.name}</Text>
            <Text style={styles.headerStatus}>{thread.participant.isOnline ? 'Online' : 'Offline'}</Text>
          </View>
        </View>
        <TouchableOpacity>
          <Feather name="more-vertical" size={22} color="#FFF" />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        {/* Date separator */}
        <View style={styles.dateSep}>
          <Text style={styles.dateText}>TODAY</Text>
        </View>

        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={(m) => m.id}
          inverted
          contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
          renderItem={renderMessage}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        />

        {/* Input Bar */}
        <View style={[styles.inputBar, { backgroundColor: c.surface, borderTopColor: c.border, paddingBottom: insets.bottom + 8 }]}>
          <TouchableOpacity style={[styles.attachBtn, { backgroundColor: c.primaryLight }]}>
            <Feather name="plus" size={20} color={c.primary} />
          </TouchableOpacity>
          <TextInput
            style={[styles.textInput, { backgroundColor: c.muted, color: c.text }]}
            value={input}
            onChangeText={setInput}
            placeholder="Type a message here..."
            placeholderTextColor={c.mutedForeground}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: input.trim() ? c.primary : c.muted }]}
            onPress={sendMessage}
          >
            <Feather name={input.trim() ? 'send' : 'mic'} size={18} color={input.trim() ? '#FFF' : c.mutedForeground} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F8F8' },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 14 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: {},
  headerAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerAvatarText: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  headerName: { fontFamily: 'Manrope_600SemiBold', fontSize: 15, color: '#FFF' },
  headerStatus: { fontFamily: 'Manrope_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  dateSep: { alignItems: 'center', marginVertical: 8 },
  dateText: { fontFamily: 'Manrope_500Medium', fontSize: 12, color: '#9E9E9E', backgroundColor: '#F0F0F0', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowMe: { flexDirection: 'row-reverse' },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  msgContent: { maxWidth: '70%', gap: 4 },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleOther: { backgroundColor: '#FFF', borderBottomLeftRadius: 4 },
  bubbleMe: { backgroundColor: colors.light.primary, borderBottomRightRadius: 4 },
  msgText: { fontFamily: 'Manrope_400Regular', fontSize: 14, color: '#1A1A1A', lineHeight: 20 },
  msgTextMe: { color: '#FFF' },
  msgImage: { width: 200, height: 150, borderRadius: 12 },
  voiceBubble: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  playBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  waveform: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2 },
  bar: { width: 3, backgroundColor: 'rgba(255,255,255,0.8)', borderRadius: 1.5 },
  voiceDuration: { fontFamily: 'Manrope_500Medium', fontSize: 12, color: '#FFF' },
  metaRow: { flexDirection: 'row-reverse', gap: 6, alignItems: 'center' },
  timestamp: { fontFamily: 'Manrope_400Regular', fontSize: 11, color: '#9E9E9E' },
  senderName: { fontFamily: 'Manrope_400Regular', fontSize: 11, color: '#9E9E9E' },
  inputBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 10,
    backgroundColor: '#FFF',
    borderTopWidth: 1, borderTopColor: '#F0F0F0',
  },
  attachBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  textInput: {
    flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, color: '#1A1A1A',
    backgroundColor: '#F5F5F5', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10,
    maxHeight: 100,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
