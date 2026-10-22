import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { splitTable } from '@/lib/jobSchedule';
import {
  arrivalOptionsFor,
  taskWindowLabel,
  type BidTaskWindow,
  type ProposedArrival,
} from '@/lib/bidTimes';
import { formatDayLabel, formatTimeLabel, minutesOf } from '@/lib/timeSlots';

/**
 * "Select your arrival time" — the pilot's ONLY time control.
 *
 * One row per task: the task number, its date, the CLIENT's window, then every
 * half-hour mark from that window's start to just before its end
 * (lib/bidTimes.arrivalOptionsFor). Up to six chips are laid out three to a row
 * with an equal width each, so a 360 dp screen never overflows or truncates and
 * a 7-task job stays a simple vertical scroll.
 *
 * There is no other time input anywhere in the bid flow, so a pilot can only
 * ever propose a moment the client's own booking allows.
 *
 * One choice is REQUIRED per task; tapping another chip changes it. The window
 * and date are shown so a multi-day job's rows are never ambiguous.
 */
export default function BidArrivalTimes({
  tasks,
  arrivals,
  onChange,
  error,
  disabled = false,
}: {
  tasks: BidTaskWindow[];
  arrivals: ProposedArrival[];
  onChange: (next: ProposedArrival[]) => void;
  /** Translated error shown under the rows (missing choice, schema refusal). */
  error?: string | null;
  disabled?: boolean;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const months = useMemo(() => splitTable(t('post_sched_months')), [t]);
  const weekdays = useMemo(() => splitTable(t('post_sched_weekdays')), [t]);
  const meridiem = { am: t('post_sched_am'), pm: t('post_sched_pm') };

  const choose = (taskNumber: number, minutes: number) => {
    const rest = arrivals.filter((entry) => entry.taskNumber !== taskNumber);
    onChange([...rest, { taskNumber, minutes }].sort((a, b) => a.taskNumber - b.taskNumber));
  };

  return (
    <View>
      <View style={styles.titleRow}>
        <Text style={[styles.label, { color: c.text }]}>{t('jobd_bid_arrival_title')}</Text>
        <Feather name="clock" size={14} color={c.mutedForeground} />
      </View>
      <Text style={[styles.hint, { color: c.mutedForeground }]}>
        {t('jobd_bid_arrival_hint')}
      </Text>

      {tasks.map((task) => {
        const chosen = arrivals.find((entry) => entry.taskNumber === task.number)?.minutes ?? null;
        const options = arrivalOptionsFor(task);
        const dayLabel = formatDayLabel(task.day, months, weekdays);
        const windowLabel = taskWindowLabel(task, meridiem);
        return (
          <View
            key={task.number}
            style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}
          >
            <View style={styles.rowHead}>
              <View style={[styles.badge, { backgroundColor: c.primary }]}>
                <Text style={[styles.badgeText, { color: c.primaryForeground }]}>
                  {task.number}
                </Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={[styles.rowTitle, { color: c.text }]} numberOfLines={1}>
                  {t('post_task_n', { n: task.number })}
                  {dayLabel ? ` · ${dayLabel}` : ''}
                </Text>
                <Text style={[styles.rowMeta, { color: c.mutedForeground }]} numberOfLines={1}>
                  {`${t('jobd_bid_arrival_window')} ${windowLabel}`}
                </Text>
              </View>
            </View>

            <View style={styles.chips}>
              {options.map((option) => {
                const minutes = minutesOf(option) ?? 0;
                const active = chosen === minutes;
                return (
                  <TouchableOpacity
                    key={`${task.number}-${minutes}`}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? c.primary : c.muted,
                        borderColor: active ? c.primary : c.border,
                      },
                    ]}
                    onPress={() => choose(task.number, minutes)}
                    disabled={disabled}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled }}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.chipText,
                        { color: active ? c.primaryForeground : c.text },
                      ]}
                    >
                      {formatTimeLabel(option, meridiem)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })}

      {error ? (
        <View style={styles.errorRow}>
          <Feather name="alert-circle" size={13} color={c.destructive} />
          <Text style={[styles.errorText, { color: c.destructive }]}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 6,
  },
  label: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16, marginBottom: 10 },
  row: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 10,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: 'Manrope_700Bold', fontSize: 11 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  rowMeta: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2 },
  // Three equal chips per row: 30 % + gap × 2 always fits the card's content
  // width, and the same basis is used for every chip so none ever differs in
  // size — including a short Anytime window with fewer than six marks.
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 8 },
  chip: {
    flexBasis: '30%',
    flexGrow: 0,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  chipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  errorText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16 },
});
