import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useRole } from '@/context/RoleContext';
import { CURRENT_USER } from '@/data/mockData';
import BackButton from '@/components/BackButton';

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { activeRole } = useRole();
  const isProvider = activeRole === 'PROVIDER';

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{isProvider ? 'Wallet & Earnings' : 'Wallet & Payments'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.summaryCard, { backgroundColor: c.primary }]}>
          <Text style={styles.summaryLabel}>{isProvider ? 'Total Earned' : 'Total Spent'}</Text>
          <Text style={styles.summaryValue}>€{isProvider ? '2,140' : '860'}</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summarySub}>{isProvider ? 'Pending payout' : 'This month'}</Text>
            <Text style={styles.summarySubValue}>€{isProvider ? '180' : '210'}</Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>Breakdown</Text>
        <View style={[styles.breakdownCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.breakdownRow}>
            <Text style={[styles.breakdownLabel, { color: c.mutedForeground }]}>
              {isProvider ? 'Platform fee (10%)' : 'Platform fee'}
            </Text>
            <Text style={[styles.breakdownValue, { color: c.text }]}>€{isProvider ? '214' : '38'}</Text>
          </View>
          <View style={[styles.breakdownRow, { borderTopWidth: 1, borderTopColor: c.border }]}>
            <Text style={[styles.breakdownLabel, { color: c.mutedForeground }]}>Taxes</Text>
            <Text style={[styles.breakdownValue, { color: c.text }]}>€{isProvider ? '96' : '—'}</Text>
          </View>
          <View style={[styles.breakdownRow, { borderTopWidth: 1, borderTopColor: c.border }]}>
            <Text style={[styles.breakdownLabel, { color: c.mutedForeground }]}>
              {isProvider ? 'Pending payout' : 'Payment dues'}
            </Text>
            <Text style={[styles.breakdownValue, { color: c.text }]}>€{isProvider ? '180' : CURRENT_USER.duePayments}</Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>
          {isProvider ? 'Payout Details' : 'Payment Method'}
        </Text>
        <View style={[styles.cardRow, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={[styles.cardIcon, { backgroundColor: c.accent }]}>
            <MaterialCommunityIcons name={isProvider ? 'bank-outline' : 'credit-card-outline'} size={20} color={c.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardMasked, { color: c.text }]}>
              {isProvider ? CURRENT_USER.iban : CURRENT_USER.maskedCard}
            </Text>
            <Text style={[styles.cardSub, { color: c.mutedForeground }]}>
              {isProvider ? 'Payout account' : 'Default payment method'}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={c.border} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  summaryCard: { borderRadius: 20, padding: 22, marginTop: 4 },
  summaryLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  summaryValue: { fontFamily: 'Inter_700Bold', fontSize: 34, color: '#FFF', marginTop: 4, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)', paddingTop: 12 },
  summarySub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.85)' },
  summarySubValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#FFF' },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 22, marginBottom: 8 },
  breakdownCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13 },
  breakdownLabel: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  breakdownValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
  cardIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardMasked: { fontFamily: 'Inter_600SemiBold', fontSize: 14, letterSpacing: 1 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
});
