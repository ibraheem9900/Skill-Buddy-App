import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '@/components/BottomSheet';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import {
  fixedSlots,
  formatWindowLabel,
  slotByKey,
  type TimeChoice,
} from '@/lib/jobBooking';
import { clampHours, maxHoursForStart, minutesOf, slotAvailableToday } from '@/lib/timeSlots';
import type { TaskDraft } from '@/lib/postWizard';

/**
 * One task's editor. A task is ONE DAY and may allow SEVERAL slots; a pilot picks
 * ONE arrival time per task. Several slots on a day never become several tasks.
 *
 * Rows: every allowed slot with Delete + Change. The LAST remaining slot cannot
 * be deleted (a task must allow at least one time). "Add slot" offers the slots
 * that day does not already allow, never duplicates, and stops at all five.
 * Expected hours are clamped to the LATEST allowed start (the 11 PM rule).
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
  onSave: (timeSlots: string[], expectedHours: number) => void;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const meridiem = { am: t('post_sched_am'), pm: t('post_sched_pm') };

  const [codes, setCodes] = useState<string[]>([]);
  const [hours, setHours] = useState(1);
  /** null = list; 'add' = adding; a code = changing that row. */
  const [picker, setPicker] = useState<'add' | string | null>(null);

  useEffect(() => {
    if (!visible || !task) return;
    const initial = task.timeSlots?.length
      ? [...task.timeSlots]
      : task.time?.kind === 'slot'
      ? [task.time.key]
      : task.time?.kind === 'anytime'
      ? ['anytime']
      : [];
    setCodes(initial);
    setHours(Math.max(1, task.hours || 1));
    setPicker(null);
  }, [visible, task]);

  const latestStart = useMemo(() => {
    const starts = codes
      .map((code) => slotByKey(code))
      .filter((slot): slot is NonNullable<typeof slot> => slot !== null)
      .map((slot) => slot.start.hour * 60 + slot.start.minute)
      .sort((a, b) => b - a);
    return starts.length > 0 ? starts[0] : null;
  }, [codes]);

  const cap = latestStart === null ? null : maxHoursForStart(latestStart);
  const clamped = cap === null ? Math.max(1, hours) : clampHours(hours, cap);
  const atCap = cap !== null && clamped >= cap;

  const day = task?.day ?? null;
  const isTaken = (code: string) => codes.includes(code);
  const isStarted = (code: string) =>
    day ? !slotAvailableToday({ kind: 'slot', key: code } as TimeChoice, day) : false;

  const options = fixedSlots();
  const addable = options.filter((slot) => !isTaken(slot.key) && !isStarted(slot.key));

  const addSlot = (code: string) => {
    setCodes((current) => (current.includes(code) ? current : [...current, code]));
    setPicker(null);
  };

  const changeSlot = (from: string, to: string) => {
    setCodes((current) => {
      const next = current.filter((code) => code !== from);
      return next.includes(to) ? next : [...next, to];
    });
    setPicker(null);
  };

  const removeSlot = (code: string) => {
    setCodes((current) => (current.length <= 1 ? current : current.filter((entry) => entry !== code)));
  };

  const canSave = codes.length > 0 && day !== null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('post_task_edit_title', { n: index + 1 })}
      footer={
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          {clamped !== hours ? (
            <Text style={[styles.notice, { color: c.mutedForeground }]}>
              {t('post_hours_cap_short', { n: clamped })}
            </Text>
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
              style={[styles.save, { backgroundColor: c.primary, opacity: canSave ? 1 : 0.5 }]}
              onPress={() => onSave(codes, clamped)}
              disabled={!canSave}
              accessibilityRole="button"
            >
              <Text style={[styles.saveText, { color: c.primaryForeground }]}>{t('post_task_save')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      }
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>{t('post_available_slots')}</Text>

        {codes.map((code) => {
          const slot = slotByKey(code);
          const label = slot
            ? formatWindowLabel({ kind: 'slot', key: slot.key }, meridiem)
            : t('post_task_time_missing');
          const changing = picker === code;
          const changeable = options.filter(
            (option) => option.key !== code && !isTaken(option.key) && !isStarted(option.key)
          );
          return (
            <View key={code} style={[styles.rowCard, { borderColor: c.border, backgroundColor: c.card }]}>
              <View style={styles.rowHead}>
                <Feather name="clock" size={14} color={c.primary} />
                <Text style={[styles.rowLabel, { color: c.text }]} numberOfLines={1}>
                  {label}
                </Text>
                <TouchableOpacity
                  onPress={() => setPicker(changing ? null : code)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('post_task_change_slot')}
                >
                  <Text style={[styles.rowAction, { color: c.primary }]}>{t('post_task_change_slot')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => removeSlot(code)}
                  disabled={codes.length <= 1}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('post_task_remove_slot')}
                >
                  <Feather
                    name="trash-2"
                    size={15}
                    color={codes.length <= 1 ? c.mutedForeground : c.destructive}
                  />
                </TouchableOpacity>
              </View>

              {changing ? (
                <View style={styles.options}>
                  {changeable.length === 0 ? (
                    <Text style={[styles.hint, { color: c.mutedForeground }]}>{t('post_err_at_least_one_slot')}</Text>
                  ) : (
                    changeable.map((option) => (
                      <TouchableOpacity
                        key={option.key}
                        style={[styles.option, { borderColor: c.border, backgroundColor: c.input }]}
                        onPress={() => changeSlot(code, option.key)}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.optionText, { color: c.text }]} numberOfLines={1}>
                          {formatWindowLabel({ kind: 'slot', key: option.key }, meridiem)}
                        </Text>
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              ) : null}
            </View>
          );
        })}

        {codes.length <= 1 ? (
          <Text style={[styles.hint, { color: c.mutedForeground }]}>{t('post_err_at_least_one_slot')}</Text>
        ) : null}

        {picker === 'add' ? (
          <View style={styles.options}>
            {addable.length === 0 ? (
              <Text style={[styles.hint, { color: c.mutedForeground }]}>{t('post_available_slots')}</Text>
            ) : (
              addable.map((option) => (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.option, { borderColor: c.border, backgroundColor: c.input }]}
                  onPress={() => addSlot(option.key)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.optionText, { color: c.text }]} numberOfLines={1}>
                    {formatWindowLabel({ kind: 'slot', key: option.key }, meridiem)}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.addRow, { borderColor: c.primary }]}
            onPress={() => setPicker('add')}
            disabled={addable.length === 0}
            accessibilityRole="button"
            accessibilityLabel={t('post_task_add_slot')}
          >
            <Feather name="plus" size={14} color={addable.length === 0 ? c.mutedForeground : c.primary} />
            <Text
              style={[styles.addText, { color: addable.length === 0 ? c.mutedForeground : c.primary }]}
            >
              {t('post_task_add_slot')}
            </Text>
          </TouchableOpacity>
        )}

        <View style={[styles.hoursRow, { borderColor: c.border, backgroundColor: c.card }]}>
          <Text style={[styles.rowLabel, { color: c.text }]}>{t('post_task_hours')}</Text>
          <View style={styles.stepper}>
            <TouchableOpacity
              onPress={() => setHours((value) => Math.max(1, value - 1))}
              disabled={clamped <= 1}
              accessibilityRole="button"
            >
              <Feather name="minus" size={16} color={clamped <= 1 ? c.mutedForeground : c.primary} />
            </TouchableOpacity>
            <Text style={[styles.stepperValue, { color: c.text }]}>{clamped}</Text>
            <TouchableOpacity
              onPress={() => setHours((value) => (atCap ? value : value + 1))}
              disabled={atCap}
              accessibilityRole="button"
            >
              <Feather name="plus" size={16} color={atCap ? c.mutedForeground : c.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {clamped !== hours ? (
          <Text style={[styles.hint, { color: c.mutedForeground }]}>
            {t('post_hours_cap_short', { n: clamped })}
          </Text>
        ) : null}

        <Text style={[styles.hint, { color: c.mutedForeground }]}>{t('post_task_time_hint')}</Text>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, paddingBottom: 24, gap: 10 },
  sectionLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  rowCard: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  rowAction: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  optionText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 11,
  },
  addText: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepperValue: { fontFamily: 'Manrope_700Bold', fontSize: 15, minWidth: 20, textAlign: 'center' },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16 },
  notice: { fontFamily: 'Manrope_500Medium', fontSize: 11, marginBottom: 8, textAlign: 'center' },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  buttons: { flexDirection: 'row', gap: 10 },
  cancel: { flex: 1, borderWidth: 1.5, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  save: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
});
