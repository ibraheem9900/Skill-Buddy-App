import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import {
  FIXED_SLOTS,
  formatWindowLabel,
  hasSlotStarted,
  type TimeChoice,
} from '@/lib/jobBooking';
import { toggleSlot, toggleAnytime } from '@/lib/postWizard';

/**
 * ONE time control for the whole app: the five client windows plus the fixed
 * "8AM-11PM (Anytime)" slot.
 *
 *  • a second tap on the chosen window CLEARS the choice;
 *  • Anytime is a plain slot like the others: one tap selects a FIXED
 *    8:00 AM - 11:00 PM window, a second tap clears it — no modal, no clock,
 *    no start/end pickers;
 *  • a window that has already started on `day` is disabled and says
 *    "Already started" on a SECOND line, so the window text is never truncated.
 *
 * Used by the Post-a-Job wizard (single day and the active multi-day) and by
 * Edit Job, so the two screens can never disagree about the options.
 */
export default function TimeChoices({
  choice,
  day,
  onChange,
  disabled = false,
}: {
  choice: TimeChoice | null;
  /** The day the choice belongs to (today refuses started windows). */
  day: Date | null;
  onChange: (next: TimeChoice | null) => void;
  disabled?: boolean;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const meridiem = { am: t('post_sched_am'), pm: t('post_sched_pm') };

  return (
    <View>
      <View style={styles.grid}>
        {FIXED_SLOTS.map((slot) => {
          const slotChoice: TimeChoice = { kind: 'slot', key: slot.key };
          const active = choice?.kind === 'slot' && choice.key === slot.key;
          const started = hasSlotStarted(slotChoice, day);
          const off = disabled || started;
          return (
            <TouchableOpacity
              key={slot.key}
              style={[
                styles.slot,
                {
                  backgroundColor: active ? c.primary : c.input,
                  borderColor: active ? c.primary : c.border,
                  opacity: started ? 0.45 : disabled ? 0.55 : 1,
                },
              ]}
              onPress={() => onChange(toggleSlot(choice, slot.key))}
              disabled={off}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: off }}
            >
              <View style={styles.slotBody}>
                <Text
                  style={[styles.slotText, { color: active ? c.primaryForeground : c.text }]}
                  numberOfLines={1}
                >
                  {formatWindowLabel(slotChoice, meridiem)}
                </Text>
                {started ? (
                  <Text
                    style={[
                      styles.slotNote,
                      { color: active ? c.primaryForeground : c.mutedForeground },
                    ]}
                    numberOfLines={1}
                  >
                    {t('post_time_slot_started')}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}

        <AnytimeSlot
          choice={choice}
          day={day}
          disabled={disabled}
          label={t('post_time_anytime')}
          startedLabel={t('post_time_slot_started')}
          meridiem={meridiem}
          onChange={onChange}
        />
      </View>
    </View>
  );
}

/**
 * The "8AM-11PM (Anytime)" slot: a FIXED 8:00 AM - 11:00 PM window, selectable
 * and unselectable exactly like the five preset windows (including the
 * "Already started" state for today once 8:00 AM has passed).
 */
function AnytimeSlot({
  choice,
  day,
  disabled,
  label,
  startedLabel,
  meridiem,
  onChange,
}: {
  choice: TimeChoice | null;
  day: Date | null;
  disabled: boolean;
  label: string;
  startedLabel: string;
  meridiem: { am: string; pm: string };
  onChange: (next: TimeChoice | null) => void;
}) {
  const { colors: c } = useTheme();
  const active = choice?.kind === 'anytime';
  const started = hasSlotStarted(choice, day);
  const off = disabled || started;
  return (
    <TouchableOpacity
      style={[
        styles.slot,
        {
          backgroundColor: active ? c.primary : c.input,
          borderColor: active ? c.primary : c.border,
          opacity: started ? 0.45 : disabled ? 0.55 : 1,
        },
      ]}
      onPress={() => onChange(toggleAnytime(choice))}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: off }}
    >
      <View style={styles.slotBody}>
        <View style={styles.slotInnerRow}>
          <Feather
            name="clock"
            size={13}
            color={active ? c.primaryForeground : c.mutedForeground}
          />
          <Text
            style={[styles.slotText, { color: active ? c.primaryForeground : c.text }]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
        {active ? (
          <Text style={[styles.slotNote, { color: c.primaryForeground }]} numberOfLines={1}>
            {formatWindowLabel(choice, meridiem)}
          </Text>
        ) : started ? (
          <Text style={[styles.slotNote, { color: c.mutedForeground }]} numberOfLines={1}>
            {startedLabel}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
    columnGap: 8,
  },
  slot: {
    width: '47.5%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 12,
    minHeight: 52,
  },
  slotBody: { alignItems: 'center', gap: 2, maxWidth: '100%' },
  slotInnerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  slotText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, flexShrink: 1 },
  slotNote: { fontFamily: 'Manrope_400Regular', fontSize: 9 },
});
