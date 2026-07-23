/**
 * Quote Request screen — formSheet presentation (single screen, no nested nav).
 * Opened from: Category Gallery bottom banner, Search no-results empty state.
 */
import React, { useRef, useState } from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useTheme } from '@/context/ThemeContext';

type ContactPref = 'Phone' | 'Email' | 'Chat';
const CONTACT_OPTIONS: ContactPref[] = ['Phone', 'Email', 'Chat'];

export default function QuoteRequestScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();

  const [description, setDescription] = useState('');
  const [contact, setContact] = useState<ContactPref>('Chat');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!description.trim()) {
      Alert.alert('Missing Info', 'Please describe the service you need.');
      return;
    }
    setSubmitting(true);
    // Mock stub — simulate a short network delay then show success
    setTimeout(() => {
      setSubmitting(false);
      setSubmitted(true);
    }, 1200);
  };

  if (submitted) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <View style={styles.successWrap}>
          <View style={[styles.successIcon, { backgroundColor: c.primaryLight }]}>
            <Feather name="check-circle" size={48} color={c.primary} />
          </View>
          <Text style={[styles.successTitle, { color: c.text }]}>Request Sent!</Text>
          <Text style={[styles.successSub, { color: c.mutedForeground }]}>
            Our team will review your request and get back to you via {contact}.
          </Text>
          <TouchableOpacity
            style={[styles.doneBtn, { backgroundColor: c.primary }]}
            onPress={() => router.back()}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.closeBtn, { backgroundColor: c.muted }]}>
          <Feather name="x" size={18} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.text }]}>Request a Custom Quote</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}
        bottomOffset={60}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.sectionLabel, { color: c.text }]}>Describe what you need</Text>
        <Text style={[styles.sectionHint, { color: c.mutedForeground }]}>
          Tell us about the service you're looking for — the more detail, the better.
        </Text>
        <View style={[styles.textAreaWrap, { borderColor: c.border, backgroundColor: c.input }]}>
          <TextInput
            style={[styles.textArea, { color: c.text }]}
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. I need a deep kitchen clean in a 3-bedroom apartment every two weeks…"
            placeholderTextColor={c.mutedForeground}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            autoCorrect
          />
        </View>
        <Text style={[styles.charCount, { color: c.mutedForeground }]}>{description.length} chars</Text>

        <Text style={[styles.sectionLabel, { color: c.text, marginTop: 24 }]}>Preferred contact method</Text>
        <View style={styles.segRow}>
          {CONTACT_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt}
              style={[
                styles.segBtn,
                { borderColor: c.border, backgroundColor: c.muted },
                contact === opt && { backgroundColor: c.primary, borderColor: c.primary },
              ]}
              onPress={() => setContact(opt)}
              activeOpacity={0.8}
            >
              <Feather
                name={opt === 'Phone' ? 'phone' : opt === 'Email' ? 'mail' : 'message-circle'}
                size={16}
                color={contact === opt ? '#FFF' : c.mutedForeground}
              />
              <Text style={[styles.segText, { color: contact === opt ? '#FFF' : c.text }]}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[
            styles.submitBtn,
            { backgroundColor: submitting ? c.mutedForeground : c.primary },
          ]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <Text style={styles.submitBtnText}>Sending…</Text>
          ) : (
            <>
              <Feather name="send" size={18} color="#FFF" />
              <Text style={styles.submitBtnText}>Submit Request</Text>
            </>
          )}
        </TouchableOpacity>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 17, flex: 1, textAlign: 'center' },
  sectionLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 15, marginBottom: 4 },
  sectionHint: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 18, marginBottom: 12 },
  textAreaWrap: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    minHeight: 140,
  },
  textArea: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    lineHeight: 22,
    minHeight: 120,
  },
  charCount: { fontFamily: 'Manrope_400Regular', fontSize: 11, textAlign: 'right', marginTop: 4 },
  segRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  segBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 28,
    borderWidth: 1,
  },
  segText: { fontFamily: 'Manrope_500Medium', fontSize: 14 },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 32,
    borderRadius: 28,
    paddingVertical: 16,
  },
  submitBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: '#FFF' },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  successIcon: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontFamily: 'Manrope_700Bold', fontSize: 24 },
  successSub: { fontFamily: 'Manrope_400Regular', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  doneBtn: { marginTop: 8, paddingHorizontal: 40, paddingVertical: 14, borderRadius: 28 },
  doneBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: '#FFF' },
});
