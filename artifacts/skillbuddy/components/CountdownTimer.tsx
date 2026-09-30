import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';

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
  const { t } = useLanguage();
  const [remaining, setRemaining] = useState(endsAt - Date.now());
  const expiredFired = React.useRef(false);
  const lastEndsAt = React.useRef(endsAt);

  useEffect(() => {
    // A NEW deadline is a NEW bidding window (e.g. the Restart Timer action
    // moved it), so expiry must be able to fire again for it. This is keyed to
    // an actual change of `endsAt` — resetting on every effect run would re-fire
    // onExpire in a loop while a deadline already in the past is on screen.
    if (lastEndsAt.current !== endsAt) {
      lastEndsAt.current = endsAt;
      expiredFired.current = false;
    }

    const tick = () => {
      const diff = endsAt - Date.now();
      setRemaining(diff);
      if (diff <= 0 && !expiredFired.current) {
        expiredFired.current = true;
        onExpire?.();
      }
    };

    tick(); // start from the true remaining time, not the mount-time guess
    const interval = setInterval(tick, 1000);

    // A suspended app freezes the JS timer, so on return the displayed value
    // can be minutes behind. Native timers cannot be trusted across a suspend:
    // recompute from `endsAt` (the absolute deadline) as soon as we are active
    // again, and let the interval carry on from there.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') tick();
    });

    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [endsAt, onExpire]);

  const accent = urgency === 'urgent' ? c.urgent : c.success;
  const accentLight = urgency === 'urgent' ? c.urgentLight : c.successLight;
  const expired = remaining <= 0;

  if (compact) {
    return (
      <View style={[styles.compactWrap, { backgroundColor: accentLight }]}>
        <Feather name="clock" size={12} color={accent} />
        <Text style={[styles.compactText, { color: accent }]}>
          {expired ? t('countdown_expired') : formatRemaining(remaining)}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { backgroundColor: accentLight, borderColor: accent }]}>
      <Feather name={urgency === 'urgent' ? 'zap' : 'clock'} size={16} color={accent} />
      <Text style={[styles.label, { color: accent }]}>
        {urgency === 'urgent' ? t('countdown_urgent') : t('countdown_closes')}
      </Text>
      <Text style={[styles.time, { color: accent }]}>
        {expired ? t('countdown_expired') : formatRemaining(remaining)}
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
  label: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  time: { fontFamily: 'Manrope_700Bold', fontSize: 24 },
  compactWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  compactText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
});
