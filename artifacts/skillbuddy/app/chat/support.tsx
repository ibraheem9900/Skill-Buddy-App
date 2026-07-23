import React, { useState } from 'react';
import {
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import BackButton from '@/components/BackButton';
import type { ChatMessage } from '@/types';

const ISSUE_CATEGORIES = [
  { id: 'booking', label: 'Booking Issue', icon: 'calendar' as const },
  { id: 'payment', label: 'Payment & Billing', icon: 'credit-card' as const },
  { id: 'account', label: 'Account & Profile', icon: 'user' as const },
  { id: 'safety', label: 'Safety Concern', icon: 'shield' as const },
  { id: 'other', label: 'Something Else', icon: 'help-circle' as const },
];

export default function SupportChatScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const [category, setCategory] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');

  const startChat = (catId: string, label: string) => {
    setCategory(catId);
    setMessages([
      {
        id: 'sys1',
        text: `Thanks for reaching out about "${label}". A SkillBuddy Support agent will be with you shortly. In the meantime, tell us more about the issue.`,
        sender: 'other',
        timestamp: new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }),
        senderName: 'SkillBuddy Support',
      },
    ]);
  };

  const send = () => {
    if (!input.trim()) return;
    const msg: ChatMessage = {
      id: Date.now().toString(),
      text: input.trim(),
      sender: 'me',
      timestamp: new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }),
      senderName: 'You',
    };
    setMessages((prev) => [msg, ...prev]);
    setInput('');
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.primary }]}>
        <BackButton />
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>SkillBuddy Support</Text>
          <View style={styles.supportBadge}>
            <Feather name="headphones" size={11} color="#FFF" />
            <Text style={styles.supportBadgeText}>Support</Text>
          </View>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {!category ? (
        <View style={{ padding: 20 }}>
          <Text style={[styles.prompt, { color: c.text }]}>What can we help you with?</Text>
          {ISSUE_CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              style={[styles.catCard, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={() => startChat(cat.id, cat.label)}
            >
              <View style={[styles.catIcon, { backgroundColor: c.accent }]}>
                <Feather name={cat.icon} size={18} color={c.primary} />
              </View>
              <Text style={[styles.catLabel, { color: c.text }]}>{cat.label}</Text>
              <Feather name="chevron-right" size={18} color={c.border} />
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            inverted
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => {
              const isMe = item.sender === 'me';
              return (
                <Animated.View entering={FadeIn.duration(200)} style={[styles.msgRow, isMe && styles.msgRowMe]}>
                  <View style={[styles.bubble, isMe ? { backgroundColor: c.primary } : { backgroundColor: c.card, borderWidth: 1, borderColor: c.border }]}>
                    <Text style={[styles.msgText, { color: isMe ? '#FFF' : c.text }]}>{item.text}</Text>
                  </View>
                </Animated.View>
              );
            }}
          />
          <View style={[styles.inputBar, { backgroundColor: c.surface, borderTopColor: c.border, paddingBottom: insets.bottom + 10 }]}>
            <TextInput
              style={[styles.input, { backgroundColor: c.input, color: c.text }]}
              value={input}
              onChangeText={setInput}
              placeholder="Describe your issue..."
              placeholderTextColor={c.mutedForeground}
              multiline
            />
            <TouchableOpacity style={[styles.sendBtn, { backgroundColor: input.trim() ? c.primary : c.muted }]} onPress={send}>
              <Feather name="send" size={16} color={input.trim() ? '#FFF' : c.mutedForeground} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerCenter: { alignItems: 'center', gap: 4 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16, color: '#FFF' },
  supportBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  supportBadgeText: { fontFamily: 'Manrope_600SemiBold', fontSize: 10, color: '#FFF' },
  prompt: { fontFamily: 'Manrope_700Bold', fontSize: 18, marginBottom: 16 },
  catCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 },
  catIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  catLabel: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  msgRow: { marginBottom: 10, maxWidth: '80%' },
  msgRowMe: { alignSelf: 'flex-end' },
  bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  msgText: { fontFamily: 'Manrope_400Regular', fontSize: 14, lineHeight: 20 },
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1 },
  input: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 100 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
