import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '@/components/BottomSheet';
import TimeRangeFields, { type ClockRange } from '@/components/TimeRangeFields';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import {
  TIME_MINUTE_STEP,
  formatWindowLabel,
  localDay,
  validateTimeChoice,
} from '@/lib/jobBooking';

/** 09:00 - 12:00, or the next quarter-hour + a 3-hour window for today. */
function seedRange(day: Date | null, now: Date): ClockRange {
  const isToday = !!day && localDay(day).getTime() === localDay(now).getTime();
  if (!isToday) {
    return { start: { hour: 9, minute: 0 }, end: { hour: 12, minute: 0 } };
  }
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const start = Math.min(
    Math.ceil((nowMinutes + 1) / TIME_MINUTE_STEP) * TIME_MINUTE_STEP,
    23 * 60 + 50
  );
  const end = Math.min(start + 180, 23 * 60 + 55);
  return {
    start: { hour: Math.floor(start / 60), minute: start % 60 },
    end: { hour: Math.floor(end / 60), minute: end % 60 },
  };
}

/**
 * ONE sheet with two rows for "Anytime": Start time and End time, each an
 * hours/minutes stepper with AM/PM. The round clock face is gone — no dial, no
 * drag, no hour-then-minute mode; the sheet opens instantly on a value the user
 * can adjust with repeated taps (or a held arrow) and shows the resulting window
 * live. It also refuses an End that is not after Start, and a start already in
 * the past for today, before Apply can be pressed.
 */
export default function TimeRangeSheet({
  visible,
  onClose,
  title,
  value,
  day,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** The current window, or null when nothing is chosen yet. */
  value: ClockRange | null;
  /** The day the window belongs to (today refuses past readings). */
  day: Date | null;
  onApply: (range: ClockRange) => void;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const [range, setRange] = useState<ClockRange>(() => value ?? seedRange(day, new Date()));

  // Re-seed every time the sheet OPENS, so it always starts on the real value.
  // Deliberately not keyed on `value`: that object is rebuilt by the parent on
  // every render, and re-seeding on it would wipe what the user is adjusting.
  useEffect(() => {
    if (!visible) return;
    setRange(value ?? seedRange(day, new Date()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const errorKey = useMemo(
    () => validateTimeChoice({ kind: 'anytime', ...range }, day, new Date()),
    [range, day]
  );

  const label = formatWindowLabel({ kind: 'anytime', ...range }, {
    am: t('post_sched_am'),
    pm: t('post_sched_pm'),
  });

  const close = () => {
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={title}
      height={430}
      footer={
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          {errorKey ? (
            <View style={styles.errorRow}>
              <Feather name="alert-circle" size={13} color={c.destructive} />
              <Text style={[styles.errorText, { color: c.destructive }]}>{t(errorKey)}</Text>
            </View>
          ) : (
            <Text style={[styles.summary, { color: c.primary }]}>{label}</Text>
          )}
          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.cancel, { borderColor: c.border }]}
              onPress={close}
              accessibilityRole="button"
            >
              <Text style={[styles.cancelText, { color: c.text }]}>{t('action_cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.apply, { backgroundColor: c.primary, opacity: errorKey ? 0.5 : 1 }]}
              onPress={() => onApply(range)}
              disabled={!!errorKey}
              accessibilityRole="button"
            >
              <Text style={[styles.applyText, { color: c.primaryForeground }]}>
                {t('post_sched_apply')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      }
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <TimeRangeFields value={range} onChange={setRange} />
        <Text style={[styles.hint, { color: c.mutedForeground }]}>
          {t('post_time_stepper_hint')}
        </Text>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, paddingTop: 14, gap: 10 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16, marginTop: 2 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  summary: { fontFamily: 'Manrope_700Bold', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  errorText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 11, lineHeight: 15 },
  buttons: { flexDirection: 'row', gap: 10 },
  cancel: { flex: 1, borderWidth: 1.5, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  apply: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  applyText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
});
