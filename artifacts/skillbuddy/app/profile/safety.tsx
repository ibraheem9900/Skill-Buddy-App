import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';

export default function SafetyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  const handleSOS = () => {
    Alert.alert(
      t('safety_emergency_title'),
      t('safety_emergency_msg'),
      [{ text: t('pay_ok') }]
    );
  };

  const LINKS = [
    { icon: 'shield' as const, labelKey: 'profile_privacy', route: '/profile/legal?type=privacy' },
    { icon: 'file' as const, labelKey: 'profile_terms', route: '/profile/legal?type=terms' },
    { icon: 'message-circle' as const, labelKey: 'safety_contact_us', route: '/chat/support' },
  ];

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('safety_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={[styles.sosBtn, { backgroundColor: c.destructive }]} onPress={handleSOS}>
          <View style={styles.sosIconWrap}>
            <Feather name="alert-triangle" size={22} color="#FFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sosTitle}>{t('safety_sos')}</Text>
            <Text style={styles.sosSub}>{t('safety_sos_sub')}</Text>
          </View>
          <Feather name="chevron-right" size={20} color="#FFF" />
        </TouchableOpacity>

        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>{t('safety_legal')}</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          {LINKS.map((l, i) => (
            <TouchableOpacity
              key={l.labelKey}
              style={[styles.row, i < LINKS.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.border }]}
              onPress={() => router.push(l.route as any)}
            >
              <Feather name={l.icon} size={18} color={c.primary} />
              <Text style={[styles.rowLabel, { color: c.text }]}>{t(l.labelKey as any)}</Text>
              <Feather name="chevron-right" size={18} color={c.border} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  sosBtn: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, padding: 16, marginTop: 4 },
  sosIconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  sosTitle: { fontFamily: 'Manrope_700Bold', fontSize: 15, color: '#FFF' },
  sosSub: { fontFamily: 'Manrope_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  sectionTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 24, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowLabel: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 14 },
});
