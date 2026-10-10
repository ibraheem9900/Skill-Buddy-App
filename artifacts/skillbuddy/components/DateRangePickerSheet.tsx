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
  formatRangeLabel,
  inclusiveDayCount,
  isRangeDaySelectable,
  isSameLocalDay,
  isValidDate,
  localDay,
  maxEndDay,
  rangeExceedsMaxDays,
} from '@/lib/jobBooking';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Confirmed range, or null while nothing is chosen. */
  value: { start: Date; end: Date } | null;
  onConfirm: (range: { start: Date; end: Date }) => void;
  /** Earliest selectable day — today, so no past date is ever offered. */
  minDay: Date;
}

/**
 * Calendar-only date picker for LONG-TERM (MULTI_DAY) bookings.
 *
 * Deliberately NOT combined with the clock: this sheet has a calendar and
 * nothing else. It is used in range mode — tap a start day, then an end day —
 * and the API's one-week ceiling is built into the calendar itself: while a
 * start day is chosen, every day after start + 6 is disabled, so an 8-day
 * range cannot even be assembled. The same rule is re-checked on confirm as
 * belt-and-braces, with the translated "maximum 7 days" message.
 *
 * Latitude-free, dependency-free: it reuses the unit-tested monthMatrix /
 * shiftMonth / canPageMonth helpers, so the grid on screen is the grid the
 * tests assert on.
 */
export default function DateRangePickerSheet({
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
  const [end, setEnd] = useState<Date | null>(null);
  const [view, setView] = useState(() => ({ year: minDay.getFullYear(), month: minDay.getMonth() }));
  const [rangeError, setRangeError] = useState<string | null>(null);

  // Re-seed on every open so the sheet never shows a stale month.
  useEffect(() => {
    if (!visible) return;
    const seed = value ?? null;
    setStart(seed?.start ?? null);
    setEnd(seed?.end ?? null);
    setRangeError(null);
    const month = seed?.start ?? minDay;
    setView({ year: month.getFullYear(), month: month.getMonth() });
    // minDay is derived from the clock at open time by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, value]);

  const months = useMemo(() => splitTable(t('post_sched_months')), [t]);
  const weekdays = useMemo(() => splitTable(t('post_sched_weekdays')), [t]);
  const weeks = useMemo(() => monthMatrix(view.year, view.month), [view]);
  const paging = canPageMonth(view.year, view.month, minDay);

  const pick = (day: Date) => {
    setRangeError(null);
    // No start yet, or a completed range → this tap starts a new range.
    if (!start || (start && end)) {
      setStart(day);
      setEnd(null);
      return;
    }
    // Tapping before the current start restarts the range from that day.
    if (day.getTime() < start.getTime()) {
      setStart(day);
      setEnd(null);
      return;
    }
    setEnd(day);
  };

  const confirm = () => {
    if (!isValidDate(start)) return;
    const to = end ?? start;
    if (rangeExceedsMaxDays(start, to)) {
      setRangeError(t('post_err_dates_max'));
      return;
    }
    onConfirm({ start, end: to });
  };

  const summary = start
    ? formatRangeLabel(start, end ?? start, months, weekdays)
    : t('post_err_dates_pick');
  const dayCount = start ? inclusiveDayCount(start, end ?? start) : 0;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      header={
        <View style={[styles.summary, { borderBottomColor: c.border }]}>
          <Feather name="calendar" size={15} color={c.primary} />
          <Text style={[styles.summaryText, { color: c.text }]} numberOfLines={1}>
            {summary}
          </Text>
          {dayCount > 0 ? (
            <Text style={[styles.summaryCount, { color: c.primary }]}>
              {t('post_days_selected', { n: dayCount })}
            </Text>
          ) : null}
        </View>
      }
      footer={
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          {rangeError ? (
            <Animated.View entering={FadeIn.duration(180)} style={styles.errorRow}>
              <Feather name="alert-circle" size={13} color={c.destructive} />
              <Text style={[styles.errorText, { color: c.destructive }]}>{rangeError}</Text>
            </Animated.View>
          ) : (
            <Text style={[styles.hint, { color: c.mutedForeground }]}>
              {t('post_dates_hint', { n: MAX_MILESTONE_DAYS })}
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
              const enabled = isRangeDaySelectable(cell, minDay, start);
              const isStart = !!start && isSameLocalDay(cell, start);
              const isEnd = !!end && isSameLocalDay(cell, end);
              const inRange =
                !!start &&
                !!end &&
                cell.getTime() > start.getTime() &&
                cell.getTime() < end.getTime();
              const isToday = isSameLocalDay(cell, localDay(minDay));
              const edge = isStart || isEnd;
              return (
                <View
                  key={`c-${wi}-${ci}`}
                  style={[styles.cell, (inRange || edge) && { backgroundColor: c.primaryLight }]}
                >
                  <TouchableOpacity
                    style={[
                      styles.day,
                      edge && { backgroundColor: c.primary },
                      !edge && isToday && { borderColor: c.primary, borderWidth: 1 },
                    ]}
                    onPress={() => pick(cell)}
                    disabled={!enabled}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !enabled, selected: edge }}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        {
                          color: edge ? c.primaryForeground : enabled ? c.text : c.mutedForeground,
                          opacity: enabled ? 1 : 0.4,
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

        <Text style={[styles.rangeHint, { color: c.mutedForeground }]}>
          {start
            ? t('post_dates_max_last', {
                date: formatRangeLabel(start, maxEndDay(start), months, weekdays),
              })
            : t('post_dates_hint', { n: MAX_MILESTONE_DAYS })}
        </Text>
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
  summaryCount: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
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
  dayText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  rangeHint: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 12, lineHeight: 16 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  footerButtons: { flexDirection: 'row', gap: 10, marginTop: 10 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 15 },
  cancel: { flex: 1, borderWidth: 1.5, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  confirm: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  confirmText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 11, lineHeight: 15 },
});
