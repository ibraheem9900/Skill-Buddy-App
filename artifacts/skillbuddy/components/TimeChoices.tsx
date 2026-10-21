import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import TimeRangeSheet from '@/components/TimeRangeSheet';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import {
  FIXED_SLOTS,
  formatWindowLabel,
  hasSlotStarted,
  type TimeChoice,
} from '@/lib/jobBooking';
import { toggleSlot } from '@/lib/postWizard';

/**
 * ONE time control for the whole app: the five client windows plus Anytime.
 *
 *  • a second tap on the chosen window CLEARS the choice;
 *  • Anytime opens the same inline hours/minutes sheet the wizard always used
 *    (no clock face) and, once chosen, shows its window on the chip with a
 *    clear (x) so it can be removed without reopening the sheet;
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
  const [sheetOpen, setSheetOpen] = useState(false);

  const anytimeRange =
    choice?.kind === 'anytime' ? { start: choice.start, end: choice.end } : null;

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

        <TouchableOpacity
          style={[
            styles.slot,
            {
              backgroundColor: choice?.kind === 'anytime' ? c.primary : c.input,
              borderColor: choice?.kind === 'anytime' ? c.primary : c.border,
              opacity: disabled ? 0.55 : 1,
            },
          ]}
          onPress={() => {
            if (disabled) return;
            if (choice?.kind === 'anytime') onChange(null);
            else setSheetOpen(true);
          }}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ selected: choice?.kind === 'anytime', disabled }}
        >
          <View style={styles.slotBody}>
            <View style={styles.slotInnerRow}>
              <Feather
                name="clock"
                size={13}
                color={choice?.kind === 'anytime' ? c.primaryForeground : c.mutedForeground}
              />
              <Text
                style={[
                  styles.slotText,
                  { color: choice?.kind === 'anytime' ? c.primaryForeground : c.text },
                ]}
              >
                {t('post_time_anytime')}
              </Text>
            </View>
            {choice?.kind === 'anytime' ? (
              <Text
                style={[styles.slotNote, { color: c.primaryForeground }]}
                numberOfLines={1}
              >
                {formatWindowLabel(choice, meridiem)}
              </Text>
            ) : null}
          </View>
        </TouchableOpacity>
      </View>

      {choice?.kind === 'anytime' ? (
        <View style={styles.chipRow}>
          <View
            style={[styles.chip, { backgroundColor: c.primaryLight, borderColor: c.primary }]}
          >
            <Feather name="clock" size={13} color={c.primary} />
            <Text style={[styles.chipText, { color: c.primary }]}>
              {formatWindowLabel(choice, meridiem)}
            </Text>
            <TouchableOpacity
              onPress={() => onChange(null)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('post_time_clear')}
            >
              <Feather name="x" size={13} color={c.primary} />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <TimeRangeSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t('post_time_custom_title')}
        value={anytimeRange}
        day={day}
        onApply={(range) => {
          onChange({ kind: 'anytime', start: range.start, end: range.end });
          setSheetOpen(false);
        }}
      />
    </View>
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
  chipRow: { marginTop: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
});
