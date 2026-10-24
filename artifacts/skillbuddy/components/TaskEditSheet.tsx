import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '@/components/BottomSheet';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import {
  FIXED_SLOTS,
  formatWindowLabel,
  hasSlotStarted,
  validateTimeChoice,
  type TimeChoice,
} from '@/lib/jobBooking';
import { maxHoursForStart, minutesOf, selectionWindowOf } from '@/lib/timeSlots';
import { toggleAnytime, type TaskDraft } from '@/lib/postWizard';

/**
 * One task's editor: its TIME, and nothing else.
 *
 * Task names were removed from the product (a task is "Task N") and the day is
 * owned by the strip on the previous step, so this sheet offers exactly the five
 * client windows plus the fixed "8AM-11PM (Anytime)" slot — always a plain
 * 8:00 AM - 11:00 PM window, with NO start/end pickers. Save is refused until a
 * valid time is chosen, and a window that leaves no hour before 11 PM is refused
 * with its own message.
 *
 * The expected-hours stepper is NOT here on purpose: it lives on the task card
 * (Part C), and the card re-clamps the value when this sheet returns a time with
 * a lower ceiling.
 */
export default function TaskEditSheet({
  visible,
  onClose,
  task,
  index,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  task: TaskDraft | null;
  /** 0-based position in the list, for the "Task N" title. */
  index: number;
  onSave: (time: TimeChoice | null) => void;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const meridiem = { am: t('post_sched_am'), pm: t('post_sched_pm') };

  const [time, setTime] = useState<TimeChoice | null>(null);

  // Re-seed on every open so Cancel never leaves a half-edit behind.
  useEffect(() => {
    if (!visible || !task) return;
    setTime(task.time);
  }, [visible, task]);

  const errorKey = task ? validateTimeChoice(time, task.day, new Date()) : 'post_err_time';
  const label = formatWindowLabel(time, meridiem);
  const window = selectionWindowOf(time);
  const cap = window ? maxHoursForStart(minutesOf(window.start)) : null;

  const preset = (key: string) => {
    setTime((current) =>
      current?.kind === 'slot' && current.key === key ? null : { kind: 'slot', key }
    );
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('post_task_edit_title', { n: index + 1 })}
      footer={
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          {errorKey ? (
            <View style={styles.errorRow}>
              <Feather name="alert-circle" size={13} color={c.destructive} />
              <Text style={[styles.errorText, { color: c.destructive }]}>{t(errorKey)}</Text>
            </View>
          ) : (
            <Text style={[styles.summary, { color: c.primary }]}>
              {label}
              {cap !== null ? ` · ${t('post_hours_cap_short', { n: cap })}` : ''}
            </Text>
          )}
          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.cancel, { borderColor: c.border }]}
              onPress={onClose}
              accessibilityRole="button"
            >
              <Text style={[styles.cancelText, { color: c.text }]}>{t('action_cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.save, { backgroundColor: c.primary, opacity: errorKey ? 0.5 : 1 }]}
              onPress={() => onSave(time)}
              disabled={!!errorKey}
              accessibilityRole="button"
            >
              <Text style={[styles.saveText, { color: c.primaryForeground }]}>
                {t('post_task_save')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      }
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: c.mutedForeground }]}>{t('post_time')}</Text>
        <View style={styles.grid}>
          {FIXED_SLOTS.map((slot) => {
            const choice: TimeChoice = { kind: 'slot', key: slot.key };
            const active = time?.kind === 'slot' && time.key === slot.key;
            const started = task ? hasSlotStarted(choice, task.day) : false;
            return (
              <TouchableOpacity
                key={slot.key}
                style={[
                  styles.slot,
                  {
                    backgroundColor: active ? c.primary : c.input,
                    borderColor: active ? c.primary : c.border,
                    opacity: started ? 0.45 : 1,
                  },
                ]}
                onPress={() => preset(slot.key)}
                disabled={started}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled: started }}
              >
                <Text
                  style={[styles.slotText, { color: active ? c.primaryForeground : c.text }]}
                  numberOfLines={1}
                >
                  {formatWindowLabel(choice, meridiem)}
                </Text>
                {started ? (
                  <Text
                    style={[
                      styles.slotNote,
                      { color: active ? c.primaryForeground : c.mutedForeground },
                    ]}
                  >
                    {t('post_time_slot_started')}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            style={[
              styles.slot,
              {
                backgroundColor: time?.kind === 'anytime' ? c.primary : c.input,
                borderColor: time?.kind === 'anytime' ? c.primary : c.border,
              },
            ]}
            onPress={() => setTime((current) => toggleAnytime(current))}
            accessibilityRole="button"
            accessibilityState={{ selected: time?.kind === 'anytime' }}
          >
            <Feather
              name="clock"
              size={13}
              color={time?.kind === 'anytime' ? c.primaryForeground : c.mutedForeground}
            />
            <Text
              style={[
                styles.slotText,
                { color: time?.kind === 'anytime' ? c.primaryForeground : c.text },
              ]}
              numberOfLines={1}
            >
              {t('post_time_anytime')}
            </Text>
          </TouchableOpacity>
        </View>

        {time ? (
          <Text style={[styles.hint, { color: c.mutedForeground }]}>
            {t('post_task_time_hint')}
          </Text>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, paddingBottom: 24, gap: 10 },
  label: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  slot: {
    width: '47.5%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 11,
    minHeight: 48,
  },
  slotText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, flexShrink: 1 },
  slotNote: { fontFamily: 'Manrope_400Regular', fontSize: 9 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16, marginTop: 4 },
  summary: { fontFamily: 'Manrope_700Bold', fontSize: 12, textAlign: 'center', marginBottom: 10 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  errorText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 11, lineHeight: 15 },
  buttons: { flexDirection: 'row', gap: 10 },
  cancel: { flex: 1, borderWidth: 1.5, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  save: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
});
