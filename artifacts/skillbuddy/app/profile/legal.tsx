import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import BackButton from '@/components/BackButton';

const CONTENT: Record<string, { title: string; body: string[] }> = {
  about: {
    title: 'About Us',
    body: [
      'SkillBuddy connects people who need everyday services done with verified local professionals — SkillBuddy Pilots — across the Baltic region.',
      'Our mission is to make booking trusted help as simple as a few taps: post a job or browse services, compare real bids, and get it done.',
      'Every SkillBuddy Pilot is verified through our documents and credibility system before they can bid on jobs.',
    ],
  },
  privacy: {
    title: 'Privacy & Cookie Policy',
    body: [
      'We collect only the information needed to connect clients with SkillBuddy Pilots and process bookings: account details, job/service data, and payment records.',
      'We never sell personal data to third parties. Location data is used only to match nearby providers and is never shared beyond what a job requires.',
      'Cookies and similar technologies are used to keep you signed in and to remember your preferences (theme, language).',
    ],
  },
  terms: {
    title: 'Terms & Conditions',
    body: [
      'By using SkillBuddy, you agree to provide accurate information when posting jobs or bidding on them.',
      'Cancellation fees apply only after a provider has been assigned to a job — cancelling before assignment is always free.',
      'SkillBuddy Pilots are independent providers; SkillBuddy facilitates the connection and payment but is not the employer of any Pilot.',
    ],
  },
};

export default function LegalScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const content = CONTENT[type as string] ?? CONTENT.about;

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{content.title}</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {content.body.map((p, i) => (
          <Text key={i} style={[styles.paragraph, { color: c.text }]}>{p}</Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  paragraph: { fontFamily: 'Manrope_400Regular', fontSize: 14, lineHeight: 22, marginBottom: 16 },
});
