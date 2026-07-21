import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { CURRENT_USER, CREDIT_HISTORY } from '@/data/mockData';
import BackButton from '@/components/BackButton';

export default function CreditPointsScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>Credit Points</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.balanceCard, { backgroundColor: c.primary }]}>
        <Feather name="star" size={28} color="#FFF" />
        <Text style={styles.balanceValue}>{CURRENT_USER.creditPoints}</Text>
        <Text style={styles.balanceLabel}>Current Balance</Text>
        <Text style={styles.balanceSub}>Earn 1 pt per €1 spent</Text>
      </View>

      <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>Redemption History</Text>

      <FlatList
        data={CREDIT_HISTORY}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        renderItem={({ item }) => (
          <View style={[styles.txRow, { borderBottomColor: c.border }]}>
            <View style={[styles.txIcon, { backgroundColor: item.change > 0 ? c.successLight : c.urgentLight }]}>
              <Feather name={item.change > 0 ? 'plus' : 'minus'} size={14} color={item.change > 0 ? c.success : c.urgent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.txDesc, { color: c.text }]}>{item.description}</Text>
              <Text style={[styles.txDate, { color: c.mutedForeground }]}>{item.date}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.txChange, { color: item.change > 0 ? c.success : c.urgent }]}>
                {item.change > 0 ? '+' : ''}{item.change}
              </Text>
              <Text style={[styles.txBalance, { color: c.mutedForeground }]}>Bal: {item.balanceAfter}</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  balanceCard: { margin: 20, borderRadius: 20, padding: 24, alignItems: 'center', gap: 4 },
  balanceValue: { fontFamily: 'Inter_700Bold', fontSize: 40, color: '#FFF', marginTop: 4 },
  balanceLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.9)' },
  balanceSub: { fontFamily: 'Inter_400Regular', fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 6 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.7, paddingHorizontal: 20, marginBottom: 8 },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1 },
  txIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  txDesc: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  txDate: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  txChange: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  txBalance: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
});
