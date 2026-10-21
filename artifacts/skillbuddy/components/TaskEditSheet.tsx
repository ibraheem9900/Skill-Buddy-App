import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '@/components/BottomSheet';
import TimeRangeFields, { type ClockRange } from '@/components/TimeRangeFields';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { splitTable } from '@/lib/jobSchedule';
import {
  FIXED_SLOTS,
  formatDayLabel,
  formatWindowLabel,
  hasSlotStarted,
  validateTimeChoice,
  type TimeChoice,
} from '@/lib/jobBooking';
import type { TaskDraft } from '@/lib/postWizard';

/**
 * One task's editor: its NAME and its OWN time.
 *
 * The shared time grid that used to sit under the list is gone — every task now
 * carries its own window, chosen here, so there is never a question of which
 * task a time belongs to. The presets are the same five slots (a slot that has
 * already started today is disabled), and "Anytime" reveals the same two-row
 * hours/minutes stepper the single-day flow uses.
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
  /** 0-based position in the list, for the "Task N" default name. */
  index: number;
  onSave: (name: string | null, time: TimeChoice | null) => void;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const months = useMemo(() => splitTable(t('post_sched_months')), [t]);
  const weekdays = useMemo(() => splitTable(t('post_sched_weekdays')), [t]);
  const meridiem = useMemo(
    () => ({ am: t('post_sched_am'), pm: t('post_sched_pm') }),
    [t]
  );

  const [name, setName] = useState('');
  const [time, setTime] = useState<TimeChoice | null>(null);

  // Re-seed on every open so Cancel never leaves a half-edit behind.
  useEffect(() => {
    if (!visible || !task) return;
    setName(task.name ?? '');
    setTime(task.time);
  }, [visible, task]);

  const errorKey = task ? validateTimeChoice(time, task.day, new Date()) : 'post_err_time';
  const year = task?.day.getFullYear();

  const custom: ClockRange =
    time?.kind === 'anytime' ? { start: time.start, end: time.end } : {
      start: { hour: 9, minute: 0 },
      end: { hour: 12, minute: 0 },
    };

  const preset = (key: string) => {
    const choice: TimeChoice = { kind: 'slot', key };
    setTime((current) =>
      current?.kind === 'slot' && current.key === key ? null : choice
    );
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('post_task_edit_title')}
      footer={
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          {errorKey ? (
            <View style={styles.errorRow}>
              <Feather name="alert-circle" size={13} color={c.destructive} />
              <Text style={[styles.errorText, { color: c.destructive }]}>{t(errorKey)}</Text>
            </View>
          ) : null}
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
              onPress={() => onSave(name.trim().length > 0 ? name.trim() : null, time)}
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
        <View style={styles.fieldWrap}>
          <Text style={[styles.label, { color: c.mutedForeground }]}>{t('post_task_name')}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: c.input, color: c.text, borderColor: c.border }]}
            value={name}
            onChangeText={setName}
            placeholder={t('post_task_n', { n: index + 1 })}
            placeholderTextColor={c.mutedForeground}
            maxLength={40}
          />
        </View>

        <View style={styles.fieldWrap}>
          <Text style={[styles.label, { color: c.mutedForeground }]}>{t('post_task_date')}</Text>
          <View style={[styles.readonly, { backgroundColor: c.muted, borderColor: c.border }]}>
            <Feather name="calendar" size={14} color={c.mutedForeground} />
            <Text style={[styles.readonlyText, { color: c.text }]}>
              {task
                ? `${formatDayLabel(task.day, months, weekdays)}${year ? ` ${year}` : ''}`
                : ''}
            </Text>
          </View>
        </View>

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
            onPress={() =>
              setTime(
                time?.kind === 'anytime'
                  ? null
                  : { kind: 'anytime', start: custom.start, end: custom.end }
              )
            }
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
            >
              {t('post_time_anytime')}
            </Text>
          </TouchableOpacity>
        </View>

        {time?.kind === 'anytime' ? (
          <View style={styles.customWrap}>
            <TimeRangeFields
              value={custom}
              onChange={(range) =>
                setTime({ kind: 'anytime', start: range.start, end: range.end })
              }
            />
          </View>
        ) : null}

        {time ? (
          <Text style={[styles.summary, { color: c.primary }]}>
            {formatWindowLabel(time, meridiem)}
          </Text>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, paddingBottom: 24, gap: 10 },
  fieldWrap: { gap: 6 },
  label: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
  },
  readonly: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  readonlyText: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
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
  customWrap: { marginTop: 6 },
  summary: { fontFamily: 'Manrope_700Bold', fontSize: 12, textAlign: 'center', marginTop: 4 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  errorText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 11, lineHeight: 15 },
  buttons: { flexDirection: 'row', gap: 10 },
  cancel: { flex: 1, borderWidth: 1.5, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  save: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
});
