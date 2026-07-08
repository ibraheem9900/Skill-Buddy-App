import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';

interface Props {
  icon?: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({ icon = 'inbox', title, subtitle, actionLabel, onAction }: Props) {
  const c = colors.light;
  return (
    <View style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: c.primaryLight }]}>
        <Feather name={icon} size={36} color={c.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {actionLabel && onAction && (
        <TouchableOpacity style={[styles.btn, { backgroundColor: c.primary }]} onPress={onAction}>
          <Text style={styles.btnText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  iconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 18, color: '#1A1A1A', textAlign: 'center' },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#737373', textAlign: 'center', lineHeight: 20 },
  btn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 25 },
  btnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#FFFFFF' },
});
