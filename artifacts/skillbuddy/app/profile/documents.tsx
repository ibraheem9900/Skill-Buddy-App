import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { CURRENT_USER } from '@/data/mockData';
import BackButton from '@/components/BackButton';

type DocStatus = 'verified' | 'pending' | 'rejected';

const STATUS_META: Record<DocStatus, { labelKey: string; icon: keyof typeof Feather.glyphMap }> = {
  verified: { labelKey: 'documents_verified', icon: 'check-circle' },
  pending: { labelKey: 'documents_pending', icon: 'clock' },
  rejected: { labelKey: 'documents_rejected', icon: 'alert-circle' },
};

function DocumentRow({ title, titleKey, status }: { title: string; titleKey: string; status: DocStatus }) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const meta = STATUS_META[status];
  const accent = status === 'verified' ? c.success : status === 'pending' ? c.warning : c.destructive;
  const accentLight = status === 'verified' ? c.successLight : status === 'pending' ? '#FFF6E8' : c.urgentLight;

  const handleAction = async () => {
    if (status === 'verified') return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    Alert.alert(t('documents_reupload_title'), t('documents_reupload_msg', { title: t(titleKey as any) }));
  };

  return (
    <View style={[styles.docCard, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={[styles.docIcon, { backgroundColor: c.accent }]}>
        <Feather name="file-text" size={18} color={c.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.docTitle, { color: c.text }]}>{t(titleKey as any)}</Text>
        <View style={[styles.statusChip, { backgroundColor: accentLight }]}>
          <Feather name={meta.icon} size={11} color={accent} />
          <Text style={[styles.statusText, { color: accent }]}>{t(meta.labelKey as any)}</Text>
        </View>
      </View>
      <TouchableOpacity style={[styles.docAction, { borderColor: c.border }]} onPress={handleAction}>
        <Text style={[styles.docActionText, { color: c.text }]}>
          {status === 'verified' ? t('documents_view') : t('documents_reupload')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function DocumentsScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('documents_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.hint, { color: c.mutedForeground }]}>
          {t('documents_hint')}
        </Text>
        <DocumentRow title="face" titleKey="documents_face" status={CURRENT_USER.faceVerification} />
        <DocumentRow title="residence" titleKey="documents_residence" status={CURRENT_USER.residencePermit} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19, marginBottom: 16 },
  docCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 },
  docIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  docTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginBottom: 6 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
  docAction: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  docActionText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
});
