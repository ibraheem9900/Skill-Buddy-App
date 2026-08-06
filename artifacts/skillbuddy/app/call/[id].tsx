import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { useLanguage } from '@/context/LanguageContext';
import { BID_PROVIDERS, CHAT_THREADS } from '@/data/mockData';

const MAX_CALL_SECONDS = 5 * 60;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function ActiveCallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const provider = BID_PROVIDERS.find((p) => p.id === id);
  const thread = CHAT_THREADS.find((t) => t.participant.id === id);
  const { t } = useLanguage();
  const name = provider?.name ?? thread?.participant.name ?? t('call_unknown');

  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    if (ended) return;
    const interval = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_CALL_SECONDS) {
          setEnded(true);
          clearInterval(interval);
          return MAX_CALL_SECONDS;
        }
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [ended]);

  const endCall = () => {
    setEnded(true);
    router.back();
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.dark.background, paddingTop: insets.top }]}>
      <Animated.View entering={FadeIn.duration(300)} style={styles.center}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name.charAt(0)}</Text>
        </View>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.status}>
          {seconds >= MAX_CALL_SECONDS - 30 && !ended ? t('call_ending') : t('call_ongoing')}
        </Text>
        <Text style={styles.duration}>{formatDuration(seconds)}</Text>
      </Animated.View>

      <View style={[styles.controls, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={[styles.controlBtn, muted && styles.controlBtnActive]}
            onPress={() => setMuted((m) => !m)}
          >
            <Feather name={muted ? 'mic-off' : 'mic'} size={22} color="#FFF" />
            <Text style={styles.controlLabel}>{muted ? t('call_unmute') : t('call_mute')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.controlBtn, speaker && styles.controlBtnActive]}
            onPress={() => setSpeaker((s) => !s)}
          >
            <Feather name={speaker ? 'volume-2' : 'headphones'} size={22} color="#FFF" />
            <Text style={styles.controlLabel}>{speaker ? t('call_speaker') : t('call_earpiece')}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.endBtn} onPress={endCall}>
          <Feather name="phone-off" size={26} color="#FFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  avatar: { width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { fontFamily: 'Manrope_700Bold', fontSize: 40, color: '#FFF' },
  name: { fontFamily: 'Manrope_700Bold', fontSize: 22, color: '#FFF' },
  status: { fontFamily: 'Manrope_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
  duration: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: 'rgba(255,255,255,0.85)', marginTop: 14 },
  controls: { alignItems: 'center', gap: 28, paddingTop: 20 },
  controlsRow: { flexDirection: 'row', gap: 32 },
  controlBtn: { width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', gap: 4 },
  controlBtnActive: { backgroundColor: 'rgba(255,255,255,0.28)' },
  controlLabel: { fontFamily: 'Manrope_500Medium', fontSize: 10, color: '#FFF', marginTop: 2 },
  endBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#E85D5D', alignItems: 'center', justifyContent: 'center' },
});
