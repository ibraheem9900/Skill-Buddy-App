import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useAppAlert } from '@/context/AlertModalContext';
import { useRole } from '@/context/RoleContext';
import { createTicket } from '@/data/ticketStore';
import BackButton from '@/components/BackButton';
import InlineLoader from '@/components/InlineLoader';
import type { TicketCategory } from '@/types';

const CATEGORIES: { key: string; label: TicketCategory }[] = [
  { key: 'ticket_cat_payment', label: 'Payment Issue' },
  { key: 'ticket_cat_dispute', label: 'Job Dispute' },
  { key: 'ticket_cat_cancellation', label: 'Cancellation Issue' },
  { key: 'ticket_cat_noshow', label: 'No-show' },
  { key: 'ticket_cat_misconduct', label: 'Misconduct' },
  { key: 'ticket_cat_technical', label: 'Technical Issue' },
  { key: 'ticket_cat_verification', label: 'Account Verification' },
  { key: 'ticket_cat_other', label: 'Other' },
];

const CATEGORY_ICONS: Record<TicketCategory, keyof typeof Feather.glyphMap> = {
  'Payment Issue': 'credit-card',
  'Job Dispute': 'briefcase',
  'Cancellation Issue': 'x-circle',
  'No-show': 'user-x',
  'Misconduct': 'alert-triangle',
  'Technical Issue': 'tool',
  'Account Verification': 'shield',
  'Other': 'help-circle',
};

export default function RaiseTicketScreen() {
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const showAlert = useAppAlert();
  const { activeRole } = useRole();

  const [category, setCategory] = useState<TicketCategory | null>(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const pickImage = async () => {
    if (photos.length >= 3) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (!result.canceled && result.assets?.[0]) {
      setPhotos((prev) => [...prev, result.assets[0].uri].slice(0, 3));
    }
  };

  const submit = async () => {
    if (!category) {
      showAlert({ title: t('ticket_no_cat_title'), message: t('ticket_no_cat_msg'), icon: 'alert-circle' });
      return;
    }
    if (!description.trim()) {
      showAlert({ title: t('ticket_no_desc_title'), message: t('ticket_no_desc_msg'), icon: 'alert-circle' });
      return;
    }
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 500));
    const ticket = createTicket({
      category,
      description: description.trim(),
      attachments: photos,
      jobId: jobId as string | undefined,
      userRole: activeRole,
    });
    setSubmitting(false);
    showAlert({
      title: t('ticket_created_title'),
      message: t('ticket_created_msg', { id: ticket.id }),
      icon: 'check-circle',
      buttons: [{ text: t('ticket_view_mine'), onPress: () => router.replace('/profile/tickets' as any) }],
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('ticket_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionLabel, { color: c.text }]}>{t('ticket_about')}</Text>
        <View style={styles.catGrid}>
          {CATEGORIES.map((cat) => {
            const catValue = cat.label;
            return (
              <TouchableOpacity
                key={cat.key}
                style={[
                  styles.catChip,
                  { backgroundColor: category === catValue ? c.primary : c.card, borderColor: category === catValue ? c.primary : c.border },
                ]}
                onPress={() => setCategory(catValue)}
              >
                <Feather name={CATEGORY_ICONS[catValue]} size={16} color={category === catValue ? '#FFF' : c.primary} />
                <Text style={[styles.catText, { color: category === catValue ? '#FFF' : c.text }]}>{t(cat.key as any)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, { color: c.text, marginTop: 20 }]}>{t('ticket_describe')}</Text>
        <TextInput
          style={[styles.textArea, { backgroundColor: c.muted, color: c.text }]}
          value={description}
          onChangeText={setDescription}
          placeholder={t('ticket_placeholder')}
          placeholderTextColor={c.mutedForeground}
          multiline
        />

        <Text style={[styles.sectionLabel, { color: c.text, marginTop: 16 }]}>{t('ticket_attachments')}</Text>
        <View style={styles.photoRow}>
          {photos.map((uri) => (
            <View key={uri} style={[styles.photoThumb, { backgroundColor: c.muted }]} />
          ))}
          {photos.length < 3 && (
            <TouchableOpacity style={[styles.photoAdd, { backgroundColor: c.muted, borderColor: c.border }]} onPress={pickImage}>
              <Feather name="camera" size={18} color={c.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: c.primary, opacity: submitting ? 0.8 : 1 }]}
          onPress={submit}
          disabled={submitting}
        >
          {submitting ? <InlineLoader size={20} /> : <Text style={styles.submitText}>{t('ticket_submit')}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  sectionLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginBottom: 10 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  catText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  textArea: { borderRadius: 12, padding: 14, minHeight: 110, fontFamily: 'Manrope_400Regular', fontSize: 13 },
  photoRow: { flexDirection: 'row', gap: 10 },
  photoThumb: { width: 64, height: 64, borderRadius: 10 },
  photoAdd: { width: 64, height: 64, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  submitBtn: { marginTop: 24, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitText: { fontFamily: 'Manrope_700Bold', fontSize: 15, color: '#FFF' },
});
