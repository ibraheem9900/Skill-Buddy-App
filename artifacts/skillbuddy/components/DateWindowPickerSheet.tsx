import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '@/components/BottomSheet';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { canPageMonth, monthMatrix, shiftMonth, splitTable } from '@/lib/jobSchedule';
import {
  MAX_MILESTONE_DAYS,
  formatDayButton,
  formatDayLabel,
  isDayInWindow,
  isSameLocalDay,
  isStartDaySelectable,
  isValidDate,
  localDay,
  selectionForStart,
  toggleSelectedDay,
  windowEndDay,
} from '@/lib/jobBooking';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Confirmed choice: one start day plus the selected days inside its window. */
  value: { start: Date | null; days: Date[] } | null;
  onConfirm: (choice: { start: Date; days: Date[] }) => void;
  /** Earliest selectable day — today, so no past date is ever offered. */
  minDay: Date;
}

/**
 * The Multiple-days date sheet.
 *
 * The RANGE picker is gone. Instead:
 *   1. the user taps ONE start date (past dates disabled);
 *   2. that start opens a SEVEN-calendar-day window (start .. start+6, across
 *      month boundaries if needed) and EVERY date outside it is disabled;
 *   3. a row of seven day buttons appears — the start day is selected and
 *      locked, and any of the other six can be toggled on or off, so 20, 22 and
 *      25 is a legal choice ("3 of 7 days selected");
 *   4. "Change start date" clears the choice and re-enables the calendar.
 *
 * Apply commits, Cancel discards, and reopening the sheet restores whatever was
 * committed — the draft lives here, not on the screen.
 */
export default function DateWindowPickerSheet({
  visible,
  onClose,
  title,
  value,
  onConfirm,
  minDay,
}: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  const [start, setStart] = useState<Date | null>(null);
  const [days, setDays] = useState<Date[]>([]);
  const [view, setView] = useState(() => ({ year: minDay.getFullYear(), month: minDay.getMonth() }));

  // Re-seed on every open, so the sheet always shows what is committed.
  useEffect(() => {
    if (!visible) return;
    const seedStart = value?.start ?? null;
    setStart(seedStart);
    setDays(value?.days?.length ? value.days : selectionForStart(seedStart));
    const month = seedStart ?? minDay;
    setView({ year: month.getFullYear(), month: month.getMonth() });
    // minDay is derived from the clock at open time by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, value]);

  const months = useMemo(() => splitTable(t('post_sched_months')), [t]);
  const weekdays = useMemo(() => splitTable(t('post_sched_weekdays')), [t]);
  const weeks = useMemo(() => monthMatrix(view.year, view.month), [view]);
  const paging = canPageMonth(view.year, view.month, minDay);

  const windowDays = useMemo(() => {
    if (!start) return [];
    return Array.from({ length: MAX_MILESTONE_DAYS }, (_, index) => {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      return day;
    });
  }, [start]);

  const pick = (day: Date) => {
    if (!start) {
      setStart(localDay(day));
      setDays(selectionForStart(day));
      return;
    }
    setDays((current) => toggleSelectedDay(current, start, day));
  };

  const changeStart = () => {
    setStart(null);
    setDays([]);
  };

  const confirm = () => {
    if (!isValidDate(start)) return;
    const chosen = days.some((day) => isSameLocalDay(day, start)) ? days : selectionForStart(start);
    onConfirm({ start, days: chosen });
  };

  const selectedLabel = start ? `${t('post_date_start')}: ${formatDayLabel(start, months, weekdays)}` : t('post_date_start_pick');

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      header={
        <View style={[styles.summary, { borderBottomColor: c.border }]}>
          <Feather name="calendar" size={15} color={c.primary} />
          <Text style={[styles.summaryText, { color: c.text }]} numberOfLines={1}>
            {selectedLabel}
          </Text>
          {start ? (
            <Text style={[styles.summaryCount, { color: c.primary }]}>
              {t('post_days_selected_of', { n: days.length, total: MAX_MILESTONE_DAYS })}
            </Text>
          ) : null}
        </View>
      }
      footer={
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          {start ? (
            <TouchableOpacity
              style={styles.changeBtn}
              onPress={changeStart}
              accessibilityRole="button"
            >
              <Feather name="refresh-cw" size={12} color={c.primary} />
              <Text style={[styles.changeText, { color: c.primary }]}>
                {t('post_date_change_start')}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={[styles.hint, { color: c.mutedForeground }]}>
              {t('post_date_window_hint', { n: MAX_MILESTONE_DAYS })}
            </Text>
          )}
          <View style={styles.footerButtons}>
            <TouchableOpacity
              style={[styles.cancel, { borderColor: c.border }]}
              onPress={onClose}
              accessibilityRole="button"
            >
              <Text style={[styles.cancelText, { color: c.text }]}>{t('action_cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirm, { backgroundColor: c.primary, opacity: start ? 1 : 0.5 }]}
              onPress={confirm}
              disabled={!start}
              accessibilityRole="button"
            >
              <Text style={[styles.confirmText, { color: c.primaryForeground }]}>
                {t('post_sched_apply')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      }
    >
      <View style={styles.body}>
        {/* ── Month pager ─────────────────────────────────────────────── */}
        <View style={styles.monthRow}>
          <TouchableOpacity
            style={[styles.monthBtn, { backgroundColor: c.muted, opacity: paging.prev ? 1 : 0.35 }]}
            onPress={() => setView((prev) => shiftMonth(prev.year, prev.month, -1))}
            disabled={!paging.prev}
            accessibilityRole="button"
            accessibilityLabel={t('post_sched_prev_month')}
          >
            <Feather name="chevron-left" size={18} color={c.text} />
          </TouchableOpacity>
          <Text style={[styles.monthLabel, { color: c.text }]}>
            {months[view.month]} {view.year}
          </Text>
          <TouchableOpacity
            style={[styles.monthBtn, { backgroundColor: c.muted, opacity: paging.next ? 1 : 0.35 }]}
            onPress={() => setView((prev) => shiftMonth(prev.year, prev.month, 1))}
            disabled={!paging.next}
            accessibilityRole="button"
            accessibilityLabel={t('post_sched_next_month')}
          >
            <Feather name="chevron-right" size={18} color={c.text} />
          </TouchableOpacity>
        </View>

        {/* ── Weekday header ──────────────────────────────────────────── */}
        <View style={styles.weekRow}>
          {weekdays.map((label, index) => (
            <View key={`wd-${index}`} style={styles.cell}>
              <Text style={[styles.weekText, { color: c.mutedForeground }]} numberOfLines={1}>
                {label}
              </Text>
            </View>
          ))}
        </View>

        {/* ── Calendar grid ───────────────────────────────────────────── */}
        {weeks.map((week, wi) => (
          <View key={`w-${wi}`} style={styles.weekRow}>
            {week.map((cell, ci) => {
              if (!cell) return <View key={`c-${wi}-${ci}`} style={styles.cell} />;

              // Before a start date: any day from today on. After it: only the
              // seven days of the window, so an eighth day cannot be picked.
              const enabled = start
                ? isDayInWindow(cell, start)
                : isStartDaySelectable(cell, minDay);
              const inWindow = !!start && isDayInWindow(cell, start);
              const selected = days.some((day) => isSameLocalDay(day, cell));
              const isStart = !!start && isSameLocalDay(cell, start);
              const isToday = isSameLocalDay(cell, localDay(minDay));

              return (
                <View
                  key={`c-${wi}-${ci}`}
                  style={[styles.cell, inWindow && { backgroundColor: c.primaryLight }]}
                >
                  <TouchableOpacity
                    style={[
                      styles.day,
                      selected && { backgroundColor: c.primary },
                      !selected && isToday && { borderColor: c.primary, borderWidth: 1 },
                    ]}
                    onPress={() => pick(cell)}
                    disabled={!enabled}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !enabled, selected }}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        {
                          color: selected
                            ? c.primaryForeground
                            : enabled
                              ? c.text
                              : c.mutedForeground,
                          opacity: enabled ? 1 : 0.4,
                          fontFamily: isStart || selected ? 'Manrope_700Bold' : 'Manrope_500Medium',
                        },
                      ]}
                    >
                      {cell.getDate()}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        ))}

        {/* ── The seven day buttons ───────────────────────────────────── */}
        {start ? (
          <Animated.View entering={FadeIn.duration(180)} style={styles.dayButtonsWrap}>
            <View style={styles.dayButtons}>
              {windowDays.map((day) => {
                const isStart = isSameLocalDay(day, start);
                const selected = days.some((d) => isSameLocalDay(d, day));
                return (
                  <TouchableOpacity
                    key={day.toISOString()}
                    style={[
                      styles.dayBtn,
                      {
                        backgroundColor: selected ? c.primary : c.input,
                        borderColor: selected ? c.primary : c.border,
                      },
                    ]}
                    onPress={() => pick(day)}
                    disabled={isStart}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: isStart }}
                  >
                    <Text
                      style={[
                        styles.dayBtnText,
                        { color: selected ? c.primaryForeground : c.text },
                      ]}
                      numberOfLines={1}
                    >
                      {formatDayButton(day, weekdays)}
                    </Text>
                    {isStart ? (
                      <Feather name="lock" size={9} color={c.primaryForeground} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[styles.rangeHint, { color: c.mutedForeground }]}>
              {start
                ? t('post_date_window_until', {
                    date: formatDayLabel(windowEndDay(start), months, weekdays),
                  })
                : ''}
            </Text>
          </Animated.View>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: 16, paddingBottom: 12 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  summaryText: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  summaryCount: { fontFamily: 'Manrope_700Bold', fontSize: 11 },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  monthBtn: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  weekRow: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  weekText: { fontFamily: 'Manrope_600SemiBold', fontSize: 10, paddingVertical: 6 },
  day: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 2,
  },
  dayText: { fontSize: 12 },
  dayButtonsWrap: { marginTop: 10 },
  dayButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    minWidth: 74,
  },
  dayBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  rangeHint: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 10, lineHeight: 16 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  footerButtons: { flexDirection: 'row', gap: 10, marginTop: 10 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 15 },
  changeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  changeText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
  cancel: { flex: 1, borderWidth: 1.5, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  confirm: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  confirmText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
});
