import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useCreditWallet } from '@/hooks/useWallet';
import BackButton from '@/components/BackButton';
import EmptyState from '@/components/EmptyState';
import type { CreditTransactionType } from '@/types';

/** Human label per credit transaction type (server enum → i18n key). */
const TX_LABEL_KEY: Record<CreditTransactionType, TranslationKey> = {
  EARNED: 'credit_tx_earned',
  REDEEMED: 'credit_tx_redeemed',
  REFUND: 'credit_tx_refund',
  ADJUSTMENT: 'credit_tx_adjustment',
};

export default function CreditPointsScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuth();

  // Real wallet: GET /api/v1/wallet/credits (balance is an integer count).
  const { status, balance, transactions, load, refresh } = useCreditWallet();

  React.useEffect(() => {
    if (user) void load();
  }, [user, load]);

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('credit_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.balanceCard, { backgroundColor: c.heroCard }]}>
        <Feather name="star" size={28} color="#FFF" />
        <Text style={styles.balanceValue}>{balance}</Text>
        <Text style={styles.balanceLabel}>{t('credit_balance')}</Text>
        <Text style={styles.balanceSub}>{t('credit_earn_note')}</Text>
      </View>

      <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>{t('credit_history')}</Text>

      {status === 'error' ? (
        <View style={{ paddingHorizontal: 20, marginBottom: 8 }}>
          <Text style={[styles.txDate, { color: c.destructive }]}>{t('services_load_error')}</Text>
          <TouchableOpacity onPress={() => void refresh()} hitSlop={6}>
            <Text style={[styles.txDesc, { color: c.primary }]}>{t('cats_retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <FlatList
        data={transactions}
        keyExtractor={(row) => String(row.id)}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 }}
        ListEmptyComponent={
          status === 'loading' ? null : (
            <EmptyState
              icon="star"
              title={t('empty_credit_history_title')}
              subtitle={t('empty_credit_history_sub')}
            />
          )
        }
        renderItem={({ item }) => {
          const points = item.points ?? 0;
          const positive = points >= 0;
          return (
            <View style={[styles.txRow, { borderBottomColor: c.border }]}>
              <View style={[styles.txIcon, { backgroundColor: positive ? c.successLight : c.urgentLight }]}>
                <Feather name={positive ? 'plus' : 'minus'} size={14} color={positive ? c.success : c.urgent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.txDesc, { color: c.text }]}>
                  {item.description || t(TX_LABEL_KEY[item.transaction_type])}
                </Text>
                <Text style={[styles.txDate, { color: c.mutedForeground }]}>
                  {new Date(item.created_at).toLocaleDateString()}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.txChange, { color: positive ? c.success : c.urgent }]}>
                  {positive ? '+' : ''}{points}
                </Text>
                <Text style={[styles.txBalance, { color: c.mutedForeground }]}>
                  {t('credit_bal', { n: item.balance_after })}
                </Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  balanceCard: { margin: 20, borderRadius: 20, padding: 24, alignItems: 'center', gap: 4 },
  balanceValue: { fontFamily: 'Manrope_700Bold', fontSize: 40, color: '#FFF', marginTop: 4 },
  balanceLabel: { fontFamily: 'Manrope_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.9)' },
  balanceSub: { fontFamily: 'Manrope_400Regular', fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 6 },
  sectionTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.7, paddingHorizontal: 20, marginBottom: 8 },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1 },
  txIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  txDesc: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
  txDate: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2 },
  txChange: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  txBalance: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2 },
});
