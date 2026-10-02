import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { useRole } from '@/context/RoleContext';
import { useAuth } from '@/context/AuthContext';
import { useCreditWallet, useProviderWallet } from '@/hooks/useWallet';
import { formatAmountSpent, useClientProfile } from '@/hooks/useClientProfile';
import BackButton from '@/components/BackButton';
import EmptyState from '@/components/EmptyState';
import type { CreditTransactionType, ProviderWalletTransactionType } from '@/types';

/**
 * Wallet screen — REAL data only.
 *
 *   PROVIDER → GET /api/v1/wallet/provider (balance + escrow/adjustment
 *              transactions; money amounts are decimal STRINGS per the schema)
 *   CLIENT   → GET /api/v1/wallet/credits (point balance + transactions) and
 *              GET /api/v1/clients/profile (total spent)
 *
 * The previous hardcoded summary/breakdown/card rows (fixed euro figures and a
 * fabricated IBAN / masked card) were removed with the mock data. Payment
 * methods and payout details have no endpoints yet, so that section is gone
 * rather than invented.
 */
const PROVIDER_TX_LABEL: Record<ProviderWalletTransactionType, TranslationKey> = {
  ESCROW_RELEASE: 'wallet_tx_escrow_release',
  ADJUSTMENT: 'wallet_tx_adjustment',
};

const CREDIT_TX_LABEL: Record<CreditTransactionType, TranslationKey> = {
  EARNED: 'credit_tx_earned',
  REDEEMED: 'credit_tx_redeemed',
  REFUND: 'credit_tx_refund',
  ADJUSTMENT: 'credit_tx_adjustment',
};

/** Decimal STRING (or number) → fixed 2-decimal money string. */
function formatMoney(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { activeRole } = useRole();
  const { user } = useAuth();
  const isProvider = activeRole === 'PROVIDER';

  const providerWallet = useProviderWallet();
  const creditWallet = useCreditWallet();
  const clientStats = useClientProfile();

  React.useEffect(() => {
    if (!user) return;
    if (isProvider) void providerWallet.load();
    else {
      void creditWallet.load();
      void clientStats.load();
    }
    // Load the active role's wallet; hooks are session-cached so switching
    // roles back and forth does not re-fetch.
  }, [user, isProvider, providerWallet.load, creditWallet.load, clientStats.load]);

  const status = isProvider ? providerWallet.status : creditWallet.status;
  const totalSpent = formatAmountSpent(clientStats.profile?.total_amount_spent);

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>
          {isProvider ? t('wallet_earnings') : t('wallet_payments')}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.summaryCard, { backgroundColor: c.heroCard }]}>
          <Text style={styles.summaryLabel}>
            {isProvider ? t('wallet_total_earned') : t('profile_credit_points')}
          </Text>
          {status === 'loading' ? (
            <ActivityIndicator color="#FFF" style={{ marginVertical: 12 }} />
          ) : (
            <Text style={styles.summaryValue}>
              {isProvider ? `€${formatMoney(providerWallet.balance)}` : creditWallet.balance}
            </Text>
          )}
          {!isProvider ? (
            <View style={styles.summaryRow}>
              <Text style={styles.summarySub}>{t('cstat_spent')}</Text>
              <Text style={styles.summarySubValue}>{totalSpent}</Text>
            </View>
          ) : null}
        </View>

        {status === 'error' ? (
          <View style={{ marginTop: 14 }}>
            <Text style={[styles.txMeta, { color: c.destructive }]}>{t('services_load_error')}</Text>
            <TouchableOpacity
              onPress={() => (isProvider ? void providerWallet.refresh() : void creditWallet.refresh())}
              hitSlop={6}
            >
              <Text style={[styles.txMeta, { color: c.primary }]}>{t('cats_retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>{t('wallet_transactions')}</Text>

        {isProvider
          ? providerWallet.transactions.map((tx) => {
              const amount = Number(tx.amount ?? 0);
              const positive = amount >= 0;
              return (
                <View key={String(tx.id)} style={[styles.txRow, { borderBottomColor: c.border }]}>
                  <View style={[styles.txIcon, { backgroundColor: positive ? c.successLight : c.urgentLight }]}>
                    <Feather name={positive ? 'plus' : 'minus'} size={14} color={positive ? c.success : c.urgent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.txDesc, { color: c.text }]}>
                      {tx.description || t(PROVIDER_TX_LABEL[tx.transaction_type])}
                    </Text>
                    <Text style={[styles.txMeta, { color: c.mutedForeground }]}>
                      {new Date(tx.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.txChange, { color: positive ? c.success : c.urgent }]}>
                      {positive ? '+' : ''}€{formatMoney(tx.amount)}
                    </Text>
                    <Text style={[styles.txMeta, { color: c.mutedForeground }]}>
                      €{formatMoney(tx.balance_after)}
                    </Text>
                  </View>
                </View>
              );
            })
          : creditWallet.transactions.map((tx) => {
              const points = tx.points ?? 0;
              const positive = points >= 0;
              return (
                <View key={String(tx.id)} style={[styles.txRow, { borderBottomColor: c.border }]}>
                  <View style={[styles.txIcon, { backgroundColor: positive ? c.successLight : c.urgentLight }]}>
                    <Feather name={positive ? 'plus' : 'minus'} size={14} color={positive ? c.success : c.urgent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.txDesc, { color: c.text }]}>
                      {tx.description || t(CREDIT_TX_LABEL[tx.transaction_type])}
                    </Text>
                    <Text style={[styles.txMeta, { color: c.mutedForeground }]}>
                      {new Date(tx.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.txChange, { color: positive ? c.success : c.urgent }]}>
                      {positive ? '+' : ''}{points}
                    </Text>
                    <Text style={[styles.txMeta, { color: c.mutedForeground }]}>{tx.balance_after}</Text>
                  </View>
                </View>
              );
            })}

        {status !== 'loading' &&
        (isProvider ? providerWallet.transactions : creditWallet.transactions).length === 0 ? (
          <EmptyState
            icon="credit-card"
            title={t('wallet_no_transactions')}
            subtitle={t('wallet_no_transactions_sub')}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  summaryCard: { borderRadius: 20, padding: 22, marginTop: 4 },
  summaryLabel: { fontFamily: 'Manrope_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  summaryValue: { fontFamily: 'Manrope_700Bold', fontSize: 34, color: '#FFF', marginTop: 4, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)', paddingTop: 12 },
  summarySub: { fontFamily: 'Manrope_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.85)' },
  summarySubValue: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: '#FFF' },
  sectionTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 22, marginBottom: 8 },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1 },
  txIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  txDesc: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  txMeta: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2 },
  txChange: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
});
