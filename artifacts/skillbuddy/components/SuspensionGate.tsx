import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { CURRENT_USER } from '@/data/mockData';
import { useRole } from '@/context/RoleContext';
import colors from '@/constants/colors';

function formatDaysLeft(until: number): number {
  return Math.max(1, Math.ceil((until - Date.now()) / (24 * 60 * 60 * 1000)));
}

/**
 * Renders nothing unless the current user's Pilot account is suspended
 * (rating dropped below 4.0 after a cancellation) AND they're viewing the
 * app as a Provider — in that case it renders a full-screen, non-dismissible
 * notice in place of children, blocking the provider dashboard entirely
 * until the 28-day suspension has elapsed.
 */
export default function SuspensionGate({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { activeRole, toggleRole } = useRole();

  const suspendedUntil = CURRENT_USER.providerSuspendedUntil;
  const isSuspended = !!suspendedUntil && suspendedUntil > Date.now() && activeRole === 'PROVIDER';

  if (!isSuspended) return <>{children}</>;

  const daysLeft = formatDaysLeft(suspendedUntil!);

  return (
    <View style={[styles.root, { backgroundColor: colors.dark.background, paddingTop: insets.top + 40 }]}>
      <View style={styles.iconWrap}>
        <Feather name="alert-triangle" size={40} color="#E85D5D" />
      </View>
      <Text style={styles.title}>Pilot Account Suspended</Text>
      <Text style={styles.message}>
        Your rating dropped below 4.0 after a job cancellation. Per SkillBuddy policy, your
        Pilot account is suspended for 28 days from the cancellation date.
      </Text>
      <View style={styles.daysCard}>
        <Text style={styles.daysValue}>{daysLeft}</Text>
        <Text style={styles.daysLabel}>day{daysLeft !== 1 ? 's' : ''} remaining</Text>
      </View>
      <Text style={styles.hint}>
        You can still use SkillBuddy as a Client during this time.
      </Text>
      <TouchableOpacity style={styles.switchBtn} onPress={toggleRole}>
        <Text style={styles.switchText}>Switch to Client View</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', paddingHorizontal: 28 },
  iconWrap: { width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(232,93,93,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 20, color: '#FFF', textAlign: 'center', marginBottom: 12 },
  message: { fontFamily: 'Manrope_400Regular', fontSize: 14, color: 'rgba(255,255,255,0.75)', textAlign: 'center', lineHeight: 21, marginBottom: 24 },
  daysCard: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 20, paddingVertical: 20, paddingHorizontal: 32, marginBottom: 20 },
  daysValue: { fontFamily: 'Manrope_700Bold', fontSize: 40, color: '#FFF' },
  daysLabel: { fontFamily: 'Manrope_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.55)', textAlign: 'center', marginBottom: 20 },
  switchBtn: { backgroundColor: '#FFF', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28 },
  switchText: { fontFamily: 'Manrope_700Bold', fontSize: 14, color: colors.dark.background },
});
