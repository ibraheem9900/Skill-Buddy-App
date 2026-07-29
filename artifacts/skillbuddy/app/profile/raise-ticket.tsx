import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/context/ThemeContext';
import { useAppAlert } from '@/context/AlertModalContext';
import { useRole } from '@/context/RoleContext';
import { createTicket } from '@/data/ticketStore';
import BackButton from '@/components/BackButton';
import InlineLoader from '@/components/InlineLoader';
import type { TicketCategory } from '@/types';

const CATEGORIES: TicketCategory[] = [
  'Payment Issue',
  'Job Dispute',
  'Cancellation Issue',
  'No-show',
  'Misconduct',
  'Technical Issue',
  'Account Verification',
  'Other',
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
      showAlert({ title: 'Select a category', message: 'Please choose an issue type first.', icon: 'alert-circle' });
      return;
    }
    if (!description.trim()) {
      showAlert({ title: 'Description required', message: 'Please describe the issue.', icon: 'alert-circle' });
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
      title: 'Ticket Created',
      message: `Your ticket ${ticket.id} has been submitted. Our support team will follow up soon.`,
      icon: 'check-circle',
      buttons: [{ text: 'View My Tickets', onPress: () => router.replace('/profile/tickets' as any) }],
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>Raise a Ticket</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionLabel, { color: c.text }]}>What's this about?</Text>
        <View style={styles.catGrid}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[
                styles.catChip,
                { backgroundColor: category === cat ? c.primary : c.card, borderColor: category === cat ? c.primary : c.border },
              ]}
              onPress={() => setCategory(cat)}
            >
              <Feather name={CATEGORY_ICONS[cat]} size={16} color={category === cat ? '#FFF' : c.primary} />
              <Text style={[styles.catText, { color: category === cat ? '#FFF' : c.text }]}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.sectionLabel, { color: c.text, marginTop: 20 }]}>Describe the Issue</Text>
        <TextInput
          style={[styles.textArea, { backgroundColor: c.muted, color: c.text }]}
          value={description}
          onChangeText={setDescription}
          placeholder="Tell us what happened..."
          placeholderTextColor={c.mutedForeground}
          multiline
        />

        <Text style={[styles.sectionLabel, { color: c.text, marginTop: 16 }]}>Attachments (optional)</Text>
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
          {submitting ? <InlineLoader size={20} /> : <Text style={styles.submitText}>Submit Ticket</Text>}
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
