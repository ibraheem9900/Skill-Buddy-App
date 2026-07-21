import React, { useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/context/ThemeContext';
import BackButton from '@/components/BackButton';
import InlineLoader from '@/components/InlineLoader';
import { CATEGORIES, CURRENT_USER, MOCK_JOBS } from '@/data/mockData';
import type { Job, JobUrgency } from '@/types';

const TIME_SLOTS = ['9:00 AM', '11:00 AM', '1:00 PM', '3:00 PM', '5:00 PM', '7:00 PM'];
const DATE_OPTIONS = ['Today', 'Tomorrow', 'This Weekend', 'Pick a date'];

export default function PostJobScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [date, setDate] = useState('Today');
  const [time, setTime] = useState('11:00 AM');
  const [hours, setHours] = useState(2);
  const [hourlyRate, setHourlyRate] = useState('20');
  const [photos, setPhotos] = useState<string[]>([]);
  const [urgency, setUrgency] = useState<JobUrgency>('regular');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const wordCount = description.trim().length ? description.trim().split(/\s+/).length : 0;
  const rateNum = parseFloat(hourlyRate) || 0;
  const total = rateNum * hours;

  const category = CATEGORIES.find((cat) => cat.id === categoryId);

  const pickImage = async () => {
    if (photos.length >= 5) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]) {
      setPhotos((prev) => [...prev, result.assets[0].uri].slice(0, 5));
    }
  };

  const removePhoto = (uri: string) => setPhotos((prev) => prev.filter((p) => p !== uri));

  const validate = () => {
    const next: Record<string, string> = {};
    if (!title.trim()) next.title = 'Job title is required.';
    if (!description.trim()) next.description = 'Description is required.';
    else if (wordCount > 500) next.description = 'Description must be 500 words or fewer.';
    if (!categoryId) next.category = 'Please select a category.';
    if (!hourlyRate || rateNum <= 0) next.rate = 'Enter a valid hourly rate.';
    if (hours <= 0) next.hours = 'Expected hours must be at least 1.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);

    const durationMs = urgency === 'urgent' ? 30 * 60 * 1000 : 3 * 60 * 60 * 1000;
    const newJob: Job = {
      id: `j${Date.now()}`,
      clientId: CURRENT_USER.id,
      clientName: CURRENT_USER.name,
      title: title.trim(),
      description: description.trim(),
      categoryId: categoryId!,
      category: category?.name ?? '',
      date,
      time,
      expectedHours: hours,
      hourlyRate: rateNum,
      expectedPrice: Math.round(total),
      photos,
      urgency,
      status: 'bidding',
      biddingEndsAt: Date.now() + durationMs,
      biddingDurationMs: durationMs,
      location: 'Riga, Latvia',
    };
    // Small delay so the loading state is visible — mirrors a real network round-trip.
    await new Promise((resolve) => setTimeout(resolve, 500));
    MOCK_JOBS.unshift(newJob);
    router.replace(`/job/${newJob.id}` as any);
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>Post a Job</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Title */}
        <Text style={[styles.label, { color: c.text }]}>Job Title</Text>
        <TextInput
          style={[styles.input, { backgroundColor: c.input, color: c.text, borderColor: errors.title ? c.destructive : c.border }]}
          placeholder="e.g. Deep clean my apartment"
          placeholderTextColor={c.mutedForeground}
          value={title}
          onChangeText={setTitle}
        />
        {errors.title && <Text style={[styles.error, { color: c.destructive }]}>{errors.title}</Text>}

        {/* Description */}
        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: c.text }]}>Description</Text>
          <Text style={[styles.counter, { color: wordCount > 500 ? c.destructive : c.mutedForeground }]}>
            {wordCount}/500 words
          </Text>
        </View>
        <TextInput
          style={[styles.textArea, { backgroundColor: c.input, color: c.text, borderColor: errors.description ? c.destructive : c.border }]}
          placeholder="Describe what you need done, any special instructions, and access details."
          placeholderTextColor={c.mutedForeground}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />
        {errors.description && <Text style={[styles.error, { color: c.destructive }]}>{errors.description}</Text>}

        {/* Category */}
        <Text style={[styles.label, { color: c.text }]}>Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              style={[
                styles.categoryChip,
                {
                  backgroundColor: categoryId === cat.id ? c.primary : c.muted,
                  borderColor: categoryId === cat.id ? c.primary : c.border,
                },
              ]}
              onPress={() => setCategoryId(cat.id)}
            >
              <MaterialCommunityIcons
                name={cat.iconName as any}
                size={16}
                color={categoryId === cat.id ? '#FFF' : c.text}
              />
              <Text style={[styles.categoryText, { color: categoryId === cat.id ? '#FFF' : c.text }]}>
                {cat.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {errors.category && <Text style={[styles.error, { color: c.destructive }]}>{errors.category}</Text>}

        {/* Date */}
        <Text style={[styles.label, { color: c.text }]}>Date Needed</Text>
        <View style={styles.chipWrapRow}>
          {DATE_OPTIONS.map((d) => (
            <TouchableOpacity
              key={d}
              style={[styles.chip, { backgroundColor: date === d ? c.primary : c.muted }]}
              onPress={() => setDate(d)}
            >
              <Text style={[styles.chipText, { color: date === d ? '#FFF' : c.text }]}>{d}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Time */}
        <Text style={[styles.label, { color: c.text }]}>Time</Text>
        <View style={styles.chipWrapRow}>
          {TIME_SLOTS.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.chip, { backgroundColor: time === t ? c.primary : c.muted }]}
              onPress={() => setTime(t)}
            >
              <Text style={[styles.chipText, { color: time === t ? '#FFF' : c.text }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Expected hours */}
        <Text style={[styles.label, { color: c.text }]}>Expected Hours of Work</Text>
        <View style={[styles.stepper, { backgroundColor: c.input, borderColor: errors.hours ? c.destructive : c.border }]}>
          <TouchableOpacity
            style={[styles.stepperBtn, { backgroundColor: c.muted }]}
            onPress={() => setHours((h) => Math.max(1, h - 1))}
          >
            <Feather name="minus" size={16} color={c.text} />
          </TouchableOpacity>
          <Text style={[styles.stepperValue, { color: c.text }]}>{hours} hr{hours !== 1 ? 's' : ''}</Text>
          <TouchableOpacity
            style={[styles.stepperBtn, { backgroundColor: c.muted }]}
            onPress={() => setHours((h) => Math.min(24, h + 1))}
          >
            <Feather name="plus" size={16} color={c.text} />
          </TouchableOpacity>
        </View>
        {errors.hours && <Text style={[styles.error, { color: c.destructive }]}>{errors.hours}</Text>}

        {/* Photo upload */}
        <Text style={[styles.label, { color: c.text }]}>Photos (up to 5)</Text>
        <View style={styles.photoRow}>
          {photos.map((uri) => (
            <View key={uri} style={styles.photoThumbWrap}>
              <Image source={{ uri }} style={styles.photoThumb} />
              <TouchableOpacity
                style={[styles.photoRemove, { backgroundColor: c.destructive }]}
                onPress={() => removePhoto(uri)}
              >
                <Feather name="x" size={12} color="#FFF" />
              </TouchableOpacity>
            </View>
          ))}
          {photos.length < 5 && (
            <TouchableOpacity
              style={[styles.photoAdd, { backgroundColor: c.muted, borderColor: c.border }]}
              onPress={pickImage}
            >
              <Feather name="camera" size={20} color={c.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        {/* Expected price */}
        <Text style={[styles.label, { color: c.text }]}>Hourly Rate (€)</Text>
        <TextInput
          style={[styles.input, { backgroundColor: c.input, color: c.text, borderColor: errors.rate ? c.destructive : c.border }]}
          placeholder="20"
          placeholderTextColor={c.mutedForeground}
          value={hourlyRate}
          onChangeText={setHourlyRate}
          keyboardType="numeric"
        />
        {errors.rate && <Text style={[styles.error, { color: c.destructive }]}>{errors.rate}</Text>}

        <View style={[styles.totalCard, { backgroundColor: c.primaryLight }]}>
          <Text style={[styles.totalLabel, { color: c.primary }]}>Expected Budget</Text>
          <Text style={[styles.totalValue, { color: c.primary }]}>€{total.toFixed(0)}</Text>
          <Text style={[styles.totalSub, { color: c.primary }]}>
            {hours} hr{hours !== 1 ? 's' : ''} × €{rateNum || 0}/hr — shown to bidders as your budget
          </Text>
        </View>

        {/* Urgency toggle */}
        <Text style={[styles.label, { color: c.text }]}>Request Type</Text>
        <View style={styles.urgencyRow}>
          <TouchableOpacity
            style={[
              styles.urgencyOption,
              {
                backgroundColor: urgency === 'urgent' ? c.urgentLight : c.muted,
                borderColor: urgency === 'urgent' ? c.urgent : c.border,
              },
            ]}
            onPress={() => setUrgency('urgent')}
          >
            <Feather name="zap" size={20} color={urgency === 'urgent' ? c.urgent : c.mutedForeground} />
            <Text style={[styles.urgencyTitle, { color: urgency === 'urgent' ? c.urgent : c.text }]}>Urgent</Text>
            <Text style={[styles.urgencyDesc, { color: c.mutedForeground }]}>
              Need this within 12 hours — 30-minute live bidding window
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.urgencyOption,
              {
                backgroundColor: urgency === 'regular' ? c.successLight : c.muted,
                borderColor: urgency === 'regular' ? c.success : c.border,
              },
            ]}
            onPress={() => setUrgency('regular')}
          >
            <Feather name="clock" size={20} color={urgency === 'regular' ? c.success : c.mutedForeground} />
            <Text style={[styles.urgencyTitle, { color: urgency === 'regular' ? c.success : c.text }]}>Regular</Text>
            <Text style={[styles.urgencyDesc, { color: c.mutedForeground }]}>
              Need this within 72 hours — 3-hour bidding window
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: c.primary, opacity: submitting ? 0.8 : 1 }]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? <InlineLoader size={20} /> : <Text style={styles.submitText}>Post Job & Start Bidding</Text>}
        </TouchableOpacity>
      </ScrollView>
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
  backBtn: { padding: 4 },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  scroll: { padding: 20, paddingBottom: 60, gap: 6 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginTop: 16, marginBottom: 8 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  counter: { fontFamily: 'Inter_400Regular', fontSize: 11, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_400Regular', fontSize: 14 },
  textArea: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_400Regular', fontSize: 14, minHeight: 110 },
  error: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 4 },
  categoryRow: { gap: 8, paddingRight: 8 },
  categoryChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1 },
  categoryText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  chipWrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  chipText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 12, padding: 8 },
  stepperBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoThumbWrap: { width: 72, height: 72, borderRadius: 12, position: 'relative' },
  photoThumb: { width: 72, height: 72, borderRadius: 12 },
  photoRemove: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  photoAdd: { width: 72, height: 72, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  totalCard: { borderRadius: 14, padding: 16, marginTop: 16, alignItems: 'center', gap: 2 },
  totalLabel: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  totalValue: { fontFamily: 'Inter_700Bold', fontSize: 28 },
  totalSub: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'center' },
  urgencyRow: { flexDirection: 'row', gap: 10 },
  urgencyOption: { flex: 1, borderWidth: 1.5, borderRadius: 14, padding: 14, alignItems: 'center', gap: 6 },
  urgencyTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  urgencyDesc: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'center', lineHeight: 15 },
  submitBtn: { marginTop: 28, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#FFF' },
});
