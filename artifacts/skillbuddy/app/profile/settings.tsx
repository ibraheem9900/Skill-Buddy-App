import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import BackButton from '@/components/BackButton';
import { useLanguage } from '@/context/LanguageContext';
import type { LanguageCode } from '@/context/LanguageContext';

const LANGUAGES: { code: LanguageCode; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'German' },
  { code: 'et', name: 'Estonian' },
  { code: 'lv', name: 'Latvian' },
  { code: 'lt', name: 'Lithuanian' },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c, theme, toggleTheme } = useTheme();
  const [notifBooking, setNotifBooking] = useState(true);
  const [notifOffers, setNotifOffers] = useState(true);
  const [notifChat, setNotifChat] = useState(true);
  const { language, setLanguage, t } = useLanguage();

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('settings_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>{t('settings_appearance')}</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: c.text }]}>{t('settings_dark_mode')}</Text>
            <Switch value={theme === 'dark'} onValueChange={() => toggleTheme()} trackColor={{ true: c.primary }} />
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>{t('settings_notifications')}</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: c.border }]}>
            <Text style={[styles.rowLabel, { color: c.text }]}>{t('settings_booking_updates')}</Text>
            <Switch value={notifBooking} onValueChange={setNotifBooking} trackColor={{ true: c.primary }} />
          </View>
          <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: c.border }]}>
            <Text style={[styles.rowLabel, { color: c.text }]}>{t('settings_offers')}</Text>
            <Switch value={notifOffers} onValueChange={setNotifOffers} trackColor={{ true: c.primary }} />
          </View>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: c.text }]}>{t('settings_chat_messages')}</Text>
            <Switch value={notifChat} onValueChange={setNotifChat} trackColor={{ true: c.primary }} />
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>{t('settings_language')}</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          {LANGUAGES.map((lang, i) => (
            <TouchableOpacity
              key={lang.code}
              style={[styles.row, i < LANGUAGES.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.border }]}
              onPress={() => setLanguage(lang.code)}
            >
              <Text style={[styles.rowLabel, { color: c.text }]}>{lang.name}</Text>
              {language === lang.code && <Feather name="check" size={18} color={c.primary} />}
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>{t('settings_account')}</Text>
        <TouchableOpacity
          style={[styles.card, styles.row, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => router.push('/profile/edit' as any)}
        >
          <Text style={[styles.rowLabel, { color: c.text }]}>{t('settings_change_password')}</Text>
          <Feather name="chevron-right" size={18} color={c.border} />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  sectionTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 20, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  rowLabel: { fontFamily: 'Manrope_500Medium', fontSize: 14 },
});
