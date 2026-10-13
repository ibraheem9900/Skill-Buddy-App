import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import BottomSheet from '@/components/BottomSheet';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import {
  BID_REJECT_REASON_MAX_CHARS,
  bidEtaParts,
  formatBidPriceLocale,
  type BidLocale,
} from '@/lib/bid';
import type { BidResponse } from '@/types';

interface Props {
  visible: boolean;
  /** The offer the client is about to decline (the one this dialog is showing). */
  bid: BidResponse | null;
  locale: BidLocale;
  /** The client's optional free-text reason. Kept by the CALLER, so a failure
   *  cannot lose what they typed. */
  reason: string;
  onReasonChange: (value: string) => void;
  /** The server's own 422 message for `reason`, shown on the input. */
  reasonError: string | null;
  /** A decline is in flight: every control is locked, no second submit. */
  confirming: boolean;
  onBack: () => void;
  onConfirm: () => void;
}

/**
 * The CLIENT's confirmation before declining one bid
 * (POST /api/v1/jobs/{job_id}/bids/{bid_id}/reject).
 *
 * It names exactly WHAT is being declined, from the server's own object: the
 * provider (photo / name / badge tier) and the offered price — the two things the
 * task requires the dialog to state — plus the offer's expected time, which is
 * what the client is judging as suitable or not, formatted with the same helpers
 * the card and the accept dialog use.
 *
 * THE REASON IS OPTIONAL AND FREE TEXT, and that is the contract, not a
 * convenience: the live schema declares no `required` array, no enum and no
 * minLength for BidRejectRequest.reason (`string maxLength 255 | null`), and the
 * deployed backend accepted `{}`, `{"reason":null}` and `{"reason":""}`. The Dev
 * Modules doc defines no reason picker for a declined bid (it does for cancelling
 * a job), and the app has no predefined-reason component — so this is a plain
 * text field whose only rule is the schema's 255-character cap. The product team
 * still has to decide whether a reason list is wanted; see the task report.
 *
 * Nothing is scored, ranked or recomputed here: no *_score field and no
 * `is_recommended` is read. "Back" closes the dialog and sends NO request.
 */
export default function RejectBidSheet({
  visible,
  bid,
  locale,
  reason,
  onReasonChange,
  reasonError,
  confirming,
  onBack,
  onConfirm,
}: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const [photoFailed, setPhotoFailed] = useState(false);

  const row = (label: string, value: string | null) =>
    value === null ? null : (
      <View key={label} style={[styles.row, { borderTopColor: c.border }]}>
        <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>{label}</Text>
        <Text style={[styles.rowValue, { color: c.text }]}>{value}</Text>
      </View>
    );

  const price = bid ? formatBidPriceLocale(bid.offered_price, locale) : null;
  const eta = bid ? bidEtaParts(bid.eta_minutes) : null;
  const etaText = eta
    ? eta.kind === 'now'
      ? t('jobd_bid_eta_now')
      : eta.kind === 'minutes'
        ? t('jobd_bid_eta_min', { n: eta.minutes })
        : t('jobd_bid_eta_hm', { h: eta.hours, m: eta.minutes })
    : null;

  const provider = bid?.provider ?? null;
  const photo = provider?.profile_photo_url ?? null;
  const showPhoto = !!photo && !photoFailed;
  const initial = provider?.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <BottomSheet
      visible={visible}
      onClose={onBack}
      title={t('cbids_reject_title')}
      footer={
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.back, { borderColor: c.border }]}
              onPress={onBack}
              disabled={confirming}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={[styles.backText, { color: c.text }]}>{t('cbids_reject_back')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.confirm,
                { backgroundColor: c.destructive },
                confirming && styles.confirmBusy,
              ]}
              onPress={onConfirm}
              disabled={confirming}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              {confirming ? (
                <ActivityIndicator size="small" color={c.destructiveForeground} />
              ) : (
                <Feather name="x" size={16} color={c.destructiveForeground} />
              )}
              <Text style={[styles.confirmText, { color: c.destructiveForeground }]}>
                {confirming ? t('cbids_reject_working') : t('cbids_reject_confirm')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      }
    >
      {bid ? (
        <KeyboardAwareScrollViewCompat contentContainerStyle={styles.body}>
          <View style={styles.head}>
            {showPhoto ? (
              <Image
                source={{ uri: photo as string }}
                style={styles.avatar}
                contentFit="cover"
                onError={() => setPhotoFailed(true)}
              />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: c.muted }]}>
                <Text style={[styles.avatarInitial, { color: c.primary }]}>{initial}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                {provider?.name ?? ''}
              </Text>
              {provider?.badge_tier ? (
                <Text style={[styles.tier, { color: c.primary }]}>{provider.badge_tier}</Text>
              ) : null}
            </View>
          </View>

          <View style={[styles.priceBlock, { borderColor: c.border, backgroundColor: c.muted }]}>
            <Text style={[styles.priceLabel, { color: c.mutedForeground }]}>
              {t('cbids_reject_price')}
            </Text>
            {price ? <Text style={[styles.price, { color: c.text }]}>{price}</Text> : null}
          </View>

          {row(t('jobd_bid_summary_eta'), etaText)}

          <View style={[styles.noteBlock, { borderTopColor: c.border }]}>
            <Feather name="alert-triangle" size={14} color={c.destructive} />
            <Text style={[styles.noteText, { color: c.mutedForeground }]}>
              {t('cbids_reject_note')}
            </Text>
          </View>

          <Text style={[styles.label, { color: c.text }]}>{t('cbids_reject_reason_label')}</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: c.card,
                color: c.text,
                borderColor: reasonError ? c.destructive : c.border,
              },
            ]}
            value={reason}
            onChangeText={onReasonChange}
            placeholder={t('cbids_reject_reason_ph')}
            placeholderTextColor={c.mutedForeground}
            multiline
            textAlignVertical="top"
            maxLength={BID_REJECT_REASON_MAX_CHARS}
            editable={!confirming}
          />
          <View style={styles.metaRow}>
            <Text
              style={[styles.hint, { color: reasonError ? c.destructive : c.mutedForeground }]}
            >
              {reasonError ?? t('cbids_reject_reason_hint')}
            </Text>
            <Text style={[styles.counter, { color: c.mutedForeground }]}>
              {reason.length}/{BID_REJECT_REASON_MAX_CHARS}
            </Text>
          </View>
        </KeyboardAwareScrollViewCompat>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 20 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  name: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  tier: { fontFamily: 'Manrope_500Medium', fontSize: 11, marginTop: 2 },
  priceBlock: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  priceLabel: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  price: { fontFamily: 'Manrope_700Bold', fontSize: 22 },
  row: { borderTopWidth: 1, paddingVertical: 10, gap: 3 },
  rowLabel: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  rowValue: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  noteBlock: { borderTopWidth: 1, paddingTop: 12, marginTop: 4, flexDirection: 'row', gap: 8 },
  noteText: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 18, flex: 1 },
  label: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginTop: 18, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 88,
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16, flex: 1 },
  counter: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
  footer: { borderTopWidth: 1, paddingHorizontal: 20, paddingVertical: 12 },
  actions: { flexDirection: 'row', gap: 10 },
  back: { flex: 1, borderWidth: 1, borderRadius: 24, paddingVertical: 12, alignItems: 'center' },
  backText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  confirm: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 24,
    paddingVertical: 12,
  },
  confirmBusy: { opacity: 0.75 },
  confirmText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
});
