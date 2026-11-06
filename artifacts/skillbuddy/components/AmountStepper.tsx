import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import {
  BID_CHIPS_CENTS,
  BID_STEP_CENTS,
  STEP_FIRST_DELAY_MS,
  canStep,
  nextRepeatDelay,
  repeatStepFor,
  stepCents,
} from '@/lib/amountStepper';
import { clampCents, formatCents, parseMoneyToCents } from '@/lib/money';
import {
  BID_MAX_CENTS,
  BID_MIN_CENTS,
  formatAdjustChipLabel,
  formatBidPriceLocale,
  type BidLocale,
} from '@/lib/bid';

/**
 * THE bid amount control — one component for every place a bid amount is set
 * (Submit Bid and the Edit bid sheet share it through BidFormFields).
 *
 *   ┌─────────────────────────────────────────────┐
 *   │      (−)            €29.98            (+)   │
 *   └─────────────────────────────────────────────┘
 *              [ +€1 ]  [ +€5 ]  [ +€10 ]
 *
 * • Tap − / + moves BID_STEP_CENTS (€1). Holding repeats after 400 ms, then
 *   every 100 ms, accelerating to 500 and then 1000 cents (lib/amountStepper).
 * • Tapping the amount turns it into a decimal-pad input. On blur the value is
 *   normalised to 2 decimals; unparseable text restores the last valid amount.
 * • Amounts are INTEGER CENTS end to end (lib/money), so no float can ever
 *   reach the field: "29.97833444215889632447" becomes €29.98.
 * • Minus/plus disable at the range ends, and the hold timers are cleared on
 *   release, blur and unmount.
 */
export interface AmountStepperProps {
  /** Integer cents, or null while the field is empty. */
  valueCents: number | null;
  onChange: (cents: number) => void;
  minCents?: number;
  maxCents?: number;
  disabled?: boolean;
  /** Shown under the control instead of the hint. */
  error?: string | null;
  /** Shown when there is no error (e.g. the VAT note). */
  hint?: string | null;
  /** Screen-reader labels for the two round buttons. */
  decreaseLabel: string;
  increaseLabel: string;
  /** Input placeholder, translated by the caller. */
  placeholder?: string;
}

export default function AmountStepper({
  valueCents,
  onChange,
  minCents = BID_MIN_CENTS,
  maxCents = BID_MAX_CENTS,
  disabled = false,
  error = null,
  hint = null,
  decreaseLabel,
  increaseLabel,
  placeholder = '0.00',
}: AmountStepperProps) {
  const { colors: c } = useTheme();
  const { language } = useLanguage();
  const locale = (language ?? 'en') as BidLocale;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [lastValid, setLastValid] = useState<number | null>(valueCents);

  /** The value the hold loop reads — a ref, so no stale closure can step twice. */
  const valueRef = useRef<number | null>(valueCents);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStart = useRef(0);

  useEffect(() => {
    valueRef.current = valueCents;
    // Only an IN-RANGE amount can be restored after unreadable text. An
    // out-of-range typed value is shown with its own error; it must never
    // become the fallback that silently replaces the next typo.
    if (valueCents !== null && valueCents >= minCents && valueCents <= maxCents) {
      setLastValid(valueCents);
    }
  }, [maxCents, minCents, valueCents]);

  const stopHold = useCallback(() => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  // No timer may outlive the component.
  useEffect(() => stopHold, [stopHold]);

  const commit = useCallback(
    (cents: number) => {
      const next = clampCents(cents, minCents, maxCents);
      valueRef.current = next;
      setLastValid(next);
      onChange(next);
    },
    [maxCents, minCents, onChange]
  );

  const beginHold = useCallback(
    (direction: -1 | 1) => {
      if (disabled) return;
      const empty = valueRef.current === null;
      const current = valueRef.current ?? minCents;
      if (!canStep(current, direction, minCents, maxCents, disabled)) return;
      stopHold();
      // The first tap on an empty field sets the minimum itself (€1.00), not
      // minimum + one step (€2.00).
      commit(
        empty ? minCents : stepCents(current, direction, BID_STEP_CENTS, minCents, maxCents)
      );
      holdStart.current = Date.now();

      const tick = () => {
        const elapsed = Date.now() - holdStart.current;
        const nowCents = valueRef.current ?? minCents;
        const next = stepCents(nowCents, direction, repeatStepFor(elapsed), minCents, maxCents);
        if (next !== nowCents) commit(next);
        // Stop at the end instead of looping pointlessly.
        if (next === nowCents && (direction === -1 ? next <= minCents : next >= maxCents)) {
          stopHold();
          return;
        }
        holdTimer.current = setTimeout(tick, nextRepeatDelay(elapsed));
      };

      holdTimer.current = setTimeout(tick, STEP_FIRST_DELAY_MS);
    },
    [commit, disabled, maxCents, minCents, stopHold]
  );

  const chips = BID_CHIPS_CENTS.map((chip) => {
    // An empty field starts from zero, so +€1 becomes exactly the €1 minimum
    // instead of the last amount the field happened to hold.
    const base = valueRef.current ?? 0;
    const target = clampCents(base + chip, minCents, maxCents);
    // "+€1" / "+1 €" — whole euros, the way the spec writes the chips.
    const label = formatAdjustChipLabel(chip / 100, locale);
    return (
      <TouchableOpacity
        key={chip}
        style={[styles.chip, { borderColor: c.border, backgroundColor: c.card }]}
        onPress={() => {
          if (disabled) return;
          stopHold();
          commit(target);
        }}
        disabled={disabled}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={[styles.chipText, { color: disabled ? c.mutedForeground : c.primary }]}>{label}</Text>
      </TouchableOpacity>
    );
  });

  const minusEnabled = canStep(valueCents ?? minCents, -1, minCents, maxCents, disabled);
  const plusEnabled = canStep(valueCents ?? minCents, 1, minCents, maxCents, disabled);
  const display = valueCents === null ? null : formatBidPriceLocale(formatCents(valueCents), locale) ?? null;

  const finishEditing = () => {
    setEditing(false);
    stopHold();
    const cents = parseMoneyToCents(draft);
    if (cents === null) {
      // Unreadable text never replaces a real amount: restore the last valid one.
      if (lastValid !== null) onChange(lastValid);
      return;
    }
    // Out-of-range amounts are NOT silently clamped: the typed value is kept
    // and lib/bid's validator shows the translated min/max error under the
    // field, which is also what keeps Submit disabled.
    if (cents < minCents || cents > maxCents) {
      valueRef.current = cents;
      onChange(cents);
      return;
    }
    setLastValid(cents);
    valueRef.current = cents;
    onChange(cents);
  };

  return (
    <View>
      <View
        style={[
          styles.box,
          { backgroundColor: c.card, borderColor: error ? c.destructive : c.border },
        ]}
      >
        <TouchableOpacity
          style={[styles.roundBtn, { borderColor: c.border, backgroundColor: c.muted }]}
          onPressIn={() => beginHold(-1)}
          onPressOut={stopHold}
          disabled={!minusEnabled}
          accessibilityRole="button"
          accessibilityLabel={decreaseLabel}
          activeOpacity={0.7}
        >
          <Feather name="minus" size={22} color={minusEnabled ? c.text : c.mutedForeground} />
        </TouchableOpacity>

        {editing ? (
          <TextInput
            style={[styles.amountInput, { color: c.text }]}
            value={draft}
            onChangeText={setDraft}
            onBlur={finishEditing}
            onSubmitEditing={finishEditing}
            keyboardType="decimal-pad"
            autoFocus
            selectTextOnFocus
            placeholder={placeholder}
            placeholderTextColor={c.mutedForeground}
            editable={!disabled}
            maxLength={15}
          />
        ) : (
          <TouchableOpacity
            style={styles.amountBtn}
            onPress={() => {
              if (disabled) return;
              setDraft(valueCents === null ? '' : formatCents(valueCents));
              setEditing(true);
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={display ?? placeholder}
          >
            <Text style={[styles.amount, { color: display ? c.text : c.mutedForeground }]}>
              {display ?? placeholder}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.roundBtn, { borderColor: c.border, backgroundColor: c.muted }]}
          onPressIn={() => beginHold(1)}
          onPressOut={stopHold}
          disabled={!plusEnabled}
          accessibilityRole="button"
          accessibilityLabel={increaseLabel}
          activeOpacity={0.7}
        >
          <Feather name="plus" size={22} color={plusEnabled ? c.text : c.mutedForeground} />
        </TouchableOpacity>
      </View>

      <View style={styles.chipRow}>{chips}</View>

      {(error ?? hint) ? (
        <Text style={[styles.hint, { color: error ? c.destructive : c.mutedForeground }]}>
          {error ?? hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  roundBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  amount: { fontFamily: 'Manrope_700Bold', fontSize: 30, letterSpacing: -0.5 },
  amountInput: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'Manrope_700Bold',
    fontSize: 30,
    letterSpacing: -0.5,
    paddingVertical: 0,
    minHeight: 48,
  },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  chip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  chipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16, marginTop: 6 },
});
