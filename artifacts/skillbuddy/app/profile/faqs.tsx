import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import BackButton from '@/components/BackButton';

interface FAQ {
  id: string;
  category: string;
  question: string;
  answer: string;
}

const FAQS: FAQ[] = [
  { id: 'f1', category: 'Booking', question: 'How do I post a job?', answer: 'Go to the Jobs tab and tap "Post a Job". Fill in the details, choose Urgent or Regular, and submit — bidding starts immediately.' },
  { id: 'f2', category: 'Booking', question: 'What\'s the difference between Urgent and Regular jobs?', answer: 'Urgent jobs need to be done within 12 hours and have a 30-minute bidding window. Regular jobs need to be done within 72 hours with a 3-hour bidding window.' },
  { id: 'f3', category: 'Payments', question: 'How are Credit Points earned?', answer: 'You earn 1 point per €1 spent on completed bookings. Points can be redeemed for discounts on future bookings.' },
  { id: 'f4', category: 'Payments', question: 'When do SkillBuddy Pilots get paid?', answer: 'Payouts are processed after a job is marked complete and approved by the client, minus the platform fee.' },
  { id: 'f5', category: 'Account', question: 'Can I be both a Client and a SkillBuddy Pilot?', answer: 'Yes — if you register as both, a toggle appears on your Profile letting you switch between the two views at any time.' },
  { id: 'f6', category: 'Account', question: 'How is my match score calculated?', answer: 'Providers are scored out of 100 based on distance, star rating, badge tier, credibility %, and average response time.' },
];

const CATEGORIES = ['All', 'Booking', 'Payments', 'Account'];

export default function FaqsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return FAQS.filter((f) => {
      const matchesCategory = category === 'All' || f.category === category;
      const matchesQuery = !query.trim() || f.question.toLowerCase().includes(query.trim().toLowerCase());
      return matchesCategory && matchesQuery;
    });
  }, [query, category]);

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>FAQs</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchWrap}>
        <View style={[styles.searchBar, { backgroundColor: c.input }]}>
          <Feather name="search" size={16} color={c.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: c.text }]}
            placeholder="Search FAQs..."
            placeholderTextColor={c.mutedForeground}
            value={query}
            onChangeText={setQuery}
          />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsRow} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[styles.tab, { backgroundColor: category === cat ? c.primary : c.muted }]}
            onPress={() => setCategory(cat)}
          >
            <Text style={[styles.tabText, { color: category === cat ? '#FFF' : c.text }]}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {filtered.map((faq) => {
          const expanded = expandedId === faq.id;
          return (
            <TouchableOpacity
              key={faq.id}
              style={[styles.faqCard, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={() => setExpandedId(expanded ? null : faq.id)}
              activeOpacity={0.8}
            >
              <View style={styles.faqHeader}>
                <Text style={[styles.faqQuestion, { color: c.text }]}>{faq.question}</Text>
                <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.mutedForeground} />
              </View>
              {expanded && <Text style={[styles.faqAnswer, { color: c.mutedForeground }]}>{faq.answer}</Text>}
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[styles.contactBtn, { backgroundColor: c.primary }]}
          onPress={() => router.push('/chat/support' as any)}
        >
          <Feather name="message-circle" size={16} color="#FFF" />
          <Text style={styles.contactText}>Still need help? Chat with Support</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  searchWrap: { paddingHorizontal: 20, paddingTop: 16 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  searchInput: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14 },
  tabsRow: { marginTop: 14, marginBottom: 4, flexGrow: 0 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  tabText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  faqCard: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 },
  faqHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  faqQuestion: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  faqAnswer: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 20, marginTop: 10 },
  contactBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 14, marginTop: 10 },
  contactText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: '#FFF' },
});
