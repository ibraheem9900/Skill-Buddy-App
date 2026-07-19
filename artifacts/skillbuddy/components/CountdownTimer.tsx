import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';

interface Props {
  endsAt: number; // epoch ms
  urgency: 'urgent' | 'regular';
  onExpire?: () => void;
  compact?: boolean;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function CountdownTimer({ endsAt, urgency, onExpire, compact }: Props) {
  const { colors: c } = useTheme();
  const [remaining, setRemaining] = useState(endsAt - Date.now());
  const expiredFired = React.useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      const diff = endsAt - Date.now();
      setRemaining(diff);
      if (diff <= 0 && !expiredFired.current) {
        expiredFired.current = true;
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [endsAt, onExpire]);

  const accent = urgency === 'urgent' ? c.urgent : c.success;
  const accentLight = urgency === 'urgent' ? c.urgentLight : c.successLight;
  const expired = remaining <= 0;

  if (compact) {
    return (
      <View style={[styles.compactWrap, { backgroundColor: accentLight }]}>
        <Feather name="clock" size={12} color={accent} />
        <Text style={[styles.compactText, { color: accent }]}>
          {expired ? 'Expired' : formatRemaining(remaining)}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { backgroundColor: accentLight, borderColor: accent }]}>
      <Feather name={urgency === 'urgent' ? 'zap' : 'clock'} size={16} color={accent} />
      <Text style={[styles.label, { color: accent }]}>
        {urgency === 'urgent' ? 'Urgent — bidding closes in' : 'Bidding window closes in'}
      </Text>
      <Text style={[styles.time, { color: accent }]}>
        {expired ? 'Expired' : formatRemaining(remaining)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 4,
  },
  label: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  time: { fontFamily: 'Inter_700Bold', fontSize: 24 },
  compactWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  compactText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
});
