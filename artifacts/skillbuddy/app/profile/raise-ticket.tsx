import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import EmptyState from '@/components/EmptyState';

/**
 * Raise-a-ticket screen.
 *
 * There is no support-ticket backend yet (the live API exposes no /tickets
 * endpoints), so this screen honestly says so instead of showing a form whose
 * submissions only ever wrote to a device-local fixture (the old `createTicket`
 * helper never reached a server). When the endpoint ships, the form can return
 * wired to POST /tickets.
 */
export default function RaiseTicketScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('ticket_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <EmptyState
        icon="life-buoy"
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
