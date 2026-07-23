import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import colors from '@/constants/colors';
import { useTheme } from '@/context/ThemeContext';
import { SERVICES } from '@/data/mockData';
import BackButton from '@/components/BackButton';
import { useAppAlert } from '@/context/AlertModalContext';


const DAYS = [
  { day: 'Mon', date: '15', month: 'Jan' },
  { day: 'Tue', date: '16', month: 'Jan' },
  { day: 'Wed', date: '17', month: 'Jan' },
  { day: 'Thu', date: '18', month: 'Jan' },
  { day: 'Fri', date: '19', month: 'Jan' },
  { day: 'Sat', date: '20', month: 'Jan' },
  { day: 'Sun', date: '21', month: 'Jan' },
];

const TIME_SLOTS = [
  '12:00 AM - 01:00 AM', '01:00 AM - 02:00 AM', '03:00 AM - 04:00 AM',
  '04:00 AM - 05:00 AM', '05:00 AM - 06:00 AM', '06:00 AM - 07:00 AM',
  '07:00 AM - 08:00 AM', '08:00 AM - 09:00 AM', '09:00 AM - 10:00 AM',
  '10:00 AM - 11:00 AM', '11:00 AM - 12:00 PM', '12:00 PM - 01:00 PM',
  '01:00 PM - 02:00 PM', '02:00 PM - 03:00 PM', '03:00 PM - 04:00 PM',
  '04:00 PM - 05:00 PM',
];

export default function BookingScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const service = SERVICES.find((s) => s.id === id) ?? SERVICES[0];

  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedTime, setSelectedTime] = useState('11:00 AM - 12:00 PM');
  const showAlert = useAppAlert();

  const handleSubmit = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert({
      title: 'Booking Confirmed!',
      message: `Your ${service.title} service is booked for ${DAYS[selectedDay].month} ${DAYS[selectedDay].date} at ${selectedTime}.`,
      icon: 'check-circle',
      buttons: [{ text: 'View Bookings', onPress: () => router.replace('/(tabs)') }],
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: c.surface, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: c.primary }]}>
        <BackButton />
        <View style={styles.headerMid}>
          <Text style={styles.headerTitle}>Select Service</Text>
          <Text style={styles.headerSubtitle}>Appointment Time:</Text>
        </View>
        <TouchableOpacity>
          <Feather name="more-vertical" size={22} color="#FFF" />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Day Selector */}
        <Animated.View entering={FadeInDown.delay(50).duration(350)} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: c.text }]}>Select Day</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 16 }}>
            {DAYS.map((d, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.dayTab, { backgroundColor: c.muted }, i === selectedDay && { backgroundColor: c.primary }]}
                onPress={() => setSelectedDay(i)}
              >
                <Text style={[styles.dayMonth, { color: c.mutedForeground }, i === selectedDay && { color: 'rgba(255,255,255,0.8)' }]}>{d.month}</Text>
                <Text style={[styles.dayDate, { color: c.text }, i === selectedDay && { color: '#FFF' }]}>{d.date}</Text>
                <Text style={[styles.dayName, { color: c.mutedForeground }, i === selectedDay && { color: 'rgba(255,255,255,0.8)' }]}>{d.day}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Animated.View>

        {/* Time Slots */}
        <Animated.View entering={FadeInDown.delay(100).duration(350)} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: c.text }]}>Select Time</Text>
          <View style={styles.timeGrid}>
            {TIME_SLOTS.map((slot) => (
              <TouchableOpacity
                key={slot}
                style={[styles.timeSlot, { backgroundColor: c.muted, borderColor: c.border }, selectedTime === slot && { backgroundColor: c.primary, borderColor: c.primary }]}
                onPress={() => { setSelectedTime(slot); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              >
                <Text style={[styles.timeText, { color: c.text }, selectedTime === slot && { color: '#FFF', fontFamily: 'Manrope_600SemiBold' }]}>{slot}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>
      </ScrollView>

      {/* Submit Button */}
      <View style={[styles.bottomBar, { backgroundColor: c.surface, borderTopColor: c.border, paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity style={[styles.submitBtn, { backgroundColor: c.primary }]} onPress={handleSubmit}>
          <Text style={styles.submitText}>Submit</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  headerMid: { flex: 1 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16, color: '#FFF' },
  headerSubtitle: { fontFamily: 'Manrope_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.8)' },
  section: { marginTop: 20, paddingHorizontal: 16 },
  sectionLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 15, color: '#1A1A1A', marginBottom: 12 },
  dayTab: {
    alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14,
    backgroundColor: '#F5F5F5', minWidth: 56,
  },
  dayMonth: { fontFamily: 'Manrope_400Regular', fontSize: 11, color: '#737373' },
  dayDate: { fontFamily: 'Manrope_700Bold', fontSize: 20, color: '#1A1A1A', marginVertical: 2 },
  dayName: { fontFamily: 'Manrope_400Regular', fontSize: 11, color: '#737373' },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  timeSlot: {
    width: '47%', paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#F5F5F5', borderWidth: 1.5, borderColor: '#F0F0F0', alignItems: 'center',
  },
  timeText: { fontFamily: 'Manrope_400Regular', fontSize: 13, color: '#1A1A1A' },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingTop: 16,
    backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#F0F0F0',
  },
  submitBtn: { borderRadius: 28, paddingVertical: 16, alignItems: 'center' },
  submitText: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: '#FFF' },
});
