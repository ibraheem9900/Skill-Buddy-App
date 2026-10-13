import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { BID_MESSAGE_MAX_CHARS } from '@/lib/bid';

/**
 * THE bid form fields — price, expected time (hours + minutes) and message —
 * shared by BOTH places a provider writes them:
 *
 *   - the Submit Bid screen (POST /jobs/{job_id}/bids), and
 *   - the Edit bid sheet on the "Your bid" card (PUT /jobs/{job_id}/bids/{bid_id}).
 *
 * They are literally the same fields because the two flows must not be able to
 * disagree: the live schema defines the same constraints for BidCreate and
 * BidUpdate (offered_price > 0 with at most 2 decimals, eta_minutes 0..1440,
 * message ≤ 1000 chars), so one component renders one set of rules, and the
 * callers run the SAME validators from lib/bid over the values it produces.
 *
 * PRESENTATION ONLY. All money/validation rules live in lib/bid (parseBidPrice,
 * validateBidPrice, validateEtaMinutes, validateBidMessage, bidEtaParts) and are
 * unit-tested there; this file decides nothing about what is acceptable, it only
 * clamps the steppers so a value can never leave the schema's window at all.
 *
 * `priceExtra` exists for one caller-specific block — the quick-adjust chips the
 * spec asks for after a client restarts the timer — rendered between the price
 * input and its hint so the chips sit next to the number they change.
 */
export interface BidFormFieldsProps {
  price: string;
  onPriceChange: (value: string) => void;
  priceError: string | null;
  etaHours: number;
  etaMinutes: number;
  onEtaHoursChange: (hours: number) => void;
  onEtaMinutesChange: (minutes: number) => void;
  etaError: string | null;
  message: string;
  onMessageChange: (value: string) => void;
  messageError: string | null;
  /** While a request is in flight every field is frozen. */
  disabled?: boolean;
  /** Rendered under the price input (e.g. the −10 / −5 / +5 / +10 chips). */
  priceExtra?: React.ReactNode;
}

export default function BidFormFields({
  price,
  onPriceChange,
  priceError,
  etaHours,
  etaMinutes,
  onEtaHoursChange,
  onEtaMinutesChange,
  etaError,
  message,
  onMessageChange,
  messageError,
  disabled = false,
  priceExtra,
}: BidFormFieldsProps) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  /**
   * One stepper: a −/+ pair around the current value. The caller receives an
   * already-clamped number, and the buttons disable at the ends, so the value
   * can never leave the schema's 0..1440 window at all.
   */
  const stepper = (
    label: string,
    value: number,
    step: number,
    min: number,
    max: number,
    onChange: (next: number) => void
  ) => (
    <View style={styles.stepper}>
      <Text style={[styles.stepperLabel, { color: c.mutedForeground }]}>{label}</Text>
      <View style={styles.stepperRow}>
        <TouchableOpacity
          style={[styles.stepBtn, { borderColor: c.border }]}
          onPress={() => onChange(Math.max(min, Math.min(max, value - step)))}
          disabled={value <= min || disabled}
        >
          <Feather name="minus" size={16} color={value <= min ? c.mutedForeground : c.text} />
        </TouchableOpacity>
        <Text style={[styles.stepValue, { color: c.text }]}>{String(value)}</Text>
        <TouchableOpacity
          style={[styles.stepBtn, { borderColor: c.border }]}
          onPress={() => onChange(Math.max(min, Math.min(max, value + step)))}
          disabled={value >= max || disabled}
        >
          <Feather name="plus" size={16} color={value >= max ? c.mutedForeground : c.text} />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <>
      {/* Offered price — the final total the client pays, VAT included. */}
      <Text style={[styles.label, { color: c.text }]}>{t('jobd_bid_price_label')}</Text>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: c.card,
            color: c.text,
            borderColor: priceError ? c.destructive : c.border,
          },
        ]}
        value={price}
        onChangeText={onPriceChange}
        placeholder={t('jobd_bid_price_ph')}
        placeholderTextColor={c.mutedForeground}
        keyboardType="decimal-pad"
        editable={!disabled}
      />
      {priceExtra}
      <Text style={[styles.hint, { color: priceError ? c.destructive : c.mutedForeground }]}>
        {priceError ?? t('jobd_bid_price_vat_note')}
      </Text>

      {/* Expected time → eta_minutes (the schema's "estimated time of arrival"). */}
      <Text style={[styles.label, { color: c.text }]}>{t('jobd_bid_eta_label')}</Text>
      <View style={styles.stepperRowWrap}>
        {stepper(t('jobd_bid_eta_hours_label'), etaHours, 1, 0, 24, (next) => {
          onEtaHoursChange(next);
          // 24 h is the schema's ceiling, so no minutes can join it.
          if (next === 24 && etaMinutes !== 0) onEtaMinutesChange(0);
        })}
        {stepper(
          t('jobd_bid_eta_minutes_label'),
          etaMinutes,
          5,
          0,
          etaHours === 24 ? 0 : 55,
          onEtaMinutesChange
        )}
      </View>
      <Text style={[styles.hint, { color: etaError ? c.destructive : c.mutedForeground }]}>
        {etaError ?? t('jobd_bid_eta_hint')}
      </Text>

      {/* Optional message, with a counter against the real limit. */}
      <Text style={[styles.label, { color: c.text }]}>{t('jobd_bid_message_label')}</Text>
      <TextInput
        style={[
          styles.input,
          styles.textarea,
          {
            backgroundColor: c.card,
            color: c.text,
            borderColor: messageError ? c.destructive : c.border,
          },
        ]}
        value={message}
        onChangeText={onMessageChange}
        placeholder={t('jobd_bid_message_ph')}
        placeholderTextColor={c.mutedForeground}
        multiline
        textAlignVertical="top"
        maxLength={BID_MESSAGE_MAX_CHARS}
        editable={!disabled}
      />
      <View style={styles.metaRow}>
        <Text style={[styles.hint, { color: messageError ? c.destructive : c.mutedForeground }]}>
          {messageError ?? t('jobd_bid_message_optional')}
        </Text>
        <Text style={[styles.counter, { color: c.mutedForeground }]}>
          {message.length}/{BID_MESSAGE_MAX_CHARS}
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginTop: 18, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
  },
  textarea: { minHeight: 96 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16, marginTop: 6 },
  stepperRowWrap: { flexDirection: 'row', gap: 12 },
  stepper: { flex: 1 },
  stepperLabel: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginBottom: 6 },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { fontFamily: 'Manrope_700Bold', fontSize: 18, minWidth: 40, textAlign: 'center' },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  counter: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
});
