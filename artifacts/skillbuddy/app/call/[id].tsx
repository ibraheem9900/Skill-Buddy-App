import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import EmptyState from '@/components/EmptyState';

/**
 * Call screen.
 *
 * There is no calling/VoIP backend (the live API exposes no call endpoints),
 * so the previous screen — a locally simulated call with a self-ticking timer
 * and mock provider names looked up from `BID_PROVIDERS`/`CHAT_THREADS` — was
 * fake end to end. It now shows an honest empty state until real calling
 * (or at least call metadata) ships.
 */
export default function ActiveCallScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
      </View>
      <EmptyState
        icon="phone-off"
        title={t('calls_unavailable_title')}
        subtitle={t('calls_unavailable_sub')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
  },
});
