import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import EmptyState from '@/components/EmptyState';

/**
 * Live support chat.
 *
 * There is no support/chat backend (the live API exposes no chat, message or
 * ticket endpoints), so the previous screen — a locally simulated support
 * conversation with an invented welcome message and local-only replies — was
 * mock end to end. It now shows an honest unavailable state; the form can
 * return wired to a real support channel when one ships.
 */
export default function SupportChatScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('support_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <EmptyState
        icon="message-square"
        title={t('tickets_unavailable_title')}
        subtitle={t('tickets_unavailable_sub')}
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
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
});
