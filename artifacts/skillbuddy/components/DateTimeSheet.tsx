import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import BottomSheet from '@/components/BottomSheet';
import {
  BOOKING_MAX_LEAD_DAYS,
  BOOKING_MIN_LEAD_MINUTES,
  MINUTE_STEP,
  bookingWindow,
  canPageMonth,
  composeDateTime,
  formatClockLabel,
  formatScheduleLabel,
  isDayWithinWindow,
  isSameDay,
  isWithinBookingWindow,
  monthMatrix,
  shiftMonth,
  splitTable,
  startOfDay,
} from '@/lib/jobSchedule';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Confirmed custom slot — always a valid, in-window Date. */
  onConfirm: (value: Date) => void;
  /** Previously confirmed slot, re-opened as the starting selection. */
  value: Date | null;
  /** Clock used for the booking window (injectable for tests). */
  now?: Date;
  /** Start month override (tests). */
  nowOverride?: Date;
}

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: Math.ceil(60 / MINUTE_STEP) }, (_, i) => i * MINUTE_STEP);

/** Round a Date up to the next MINUTE_STEP boundary, zeroing seconds. */
function ceilToStep(at: Date): Date {
  const next = new Date(at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes(), 0, 0);
  const remainder = next.getMinutes() % MINUTE_STEP;
  if (remainder !== 0) next.setMinutes(next.getMinutes() + (MINUTE_STEP - remainder));
  if (next.getTime() < at.getTime()) next.setMinutes(next.getMinutes() + MINUTE_STEP);
  return next;
}

/** Sensible opening selection when nothing was chosen yet. */
function defaultSelection(now: Date): Date {
  const { min } = bookingWindow(now);
  const nextMorning = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
  return nextMorning.getTime() >= min.getTime() ? nextMorning : ceilToStep(min);
}

/**
 * Custom date & time sheet (Issue 2 of the Post-a-Job brief).
 *
 *  - a real month calendar with prev/next paging; days OUTSIDE the booking
 *    window are greyed out and not tappable (never merely validated on submit)
 *  - a specific hour + minute clock (12-hour with an AM/PM toggle, matching
 *    the quick chips' wording), not just the six fixed slots
 *  - an in-sheet message whenever the composed slot falls outside the window,
 *    which also disables Apply
 *  - month / weekday names come from the translations table, so nothing is
 *    hardcoded and no ICU/Intl support is required at runtime.
 */
export default function DateTimeSheet({
  visible,
  onClose,
  onConfirm,
  value,
  now: nowProp,
  nowOverride,
}: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  // Frozen clock for tests only; in the app the window is recomputed every
  // time the sheet opens, so a form left open for hours cannot grey out the
  // wrong days.
  const fixedNow = nowProp ?? nowOverride ?? null;
  const [now, setNow] = useState<Date>(() => fixedNow ?? new Date());

  const [day, setDay] = useState<Date>(() => value ?? defaultSelection(now));
  const [hour12, setHour12] = useState<number>(() => (value ?? defaultSelection(now)).getHours() % 12 || 12);
  const [minute, setMinute] = useState<number>(() => (value ?? defaultSelection(now)).getMinutes());
  const [isPm, setIsPm] = useState<boolean>(() => (value ?? defaultSelection(now)).getHours() >= 12);
  const [view, setView] = useState(() => {
    const seed = value ?? defaultSelection(now);
    return { year: seed.getFullYear(), month: seed.getMonth() };
  });

  // Re-seed every time the sheet opens so it never shows a stale month or a
  // stale booking window.
  useEffect(() => {
    if (!visible) return;
    const fresh = fixedNow ?? new Date();
    setNow(fresh);
    const seed = value ?? defaultSelection(fresh);
    setDay(seed);
    setHour12(seed.getHours() % 12 || 12);
    setMinute(seed.getMinutes() - (seed.getMinutes() % MINUTE_STEP));
    setIsPm(seed.getHours() >= 12);
    setView({ year: seed.getFullYear(), month: seed.getMonth() });
  }, [visible, value, fixedNow]);

  const months = useMemo(() => splitTable(t('post_sched_months')), [t]);
  const weekdays = useMemo(() => splitTable(t('post_sched_weekdays')), [t]);

  // monthMatrix is the unit-tested helper — the grid on screen is the grid the
  // tests assert on, not a second copy of the same arithmetic.
  const weeks = useMemo(() => monthMatrix(view.year, view.month), [view]);

  const composed = useMemo(
    () => composeDateTime(day, hour12, minute, isPm),
    [day, hour12, minute, isPm]
  );

  const { min, max } = useMemo(() => bookingWindow(now), [now]);
  const windowError = useMemo(() => {
    if (!composed) return t('post_sched_err_pick');
    if (composed.getTime() < min.getTime()) {
      return t('post_sched_err_early', { n: BOOKING_MIN_LEAD_MINUTES });
    }
    if (composed.getTime() > max.getTime()) {
      return t('post_sched_err_late', { n: BOOKING_MAX_LEAD_DAYS });
    }
    return null;
  }, [composed, min, max, t]);

  const paging = canPageMonth(view.year, view.month, now);
  const today = startOfDay(now);

  const page = (delta: number) => setView((prev) => shiftMonth(prev.year, prev.month, delta));

  const apply = () => {
    if (!composed || windowError) return;
    if (!isWithinBookingWindow(composed, now)) return;
    onConfirm(composed);
  };

  const summary = composed ? formatScheduleLabel(composed, months, weekdays) : t('post_sched_err_pick');

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('post_sched_title')}
      header={
        <View style={[styles.summary, { borderBottomColor: c.border }]}>
          <Feather name="calendar" size={15} color={c.primary} />
          <Text style={[styles.summaryText, { color: c.text }]} numberOfLines={1}>
            {summary}
          </Text>
          <Text style={[styles.summaryClock, { color: c.primary }]}>
            {formatClockLabel(hour12, minute, isPm)}
          </Text>
        </View>
      }
      footer={
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          {windowError ? (
            <Animated.View
              entering={FadeIn.duration(180)}
              exiting={FadeOut.duration(140)}
              style={styles.errorRow}
            >
              <Feather name="alert-circle" size={13} color={c.destructive} />
              <Text style={[styles.errorText, { color: c.destructive }]}>{windowError}</Text>
            </Animated.View>
          ) : null}
          <TouchableOpacity
            style={[styles.apply, { backgroundColor: c.primary, opacity: windowError ? 0.5 : 1 }]}
            onPress={apply}
            disabled={!!windowError}
            accessibilityRole="button"
            accessibilityLabel={t('post_sched_apply')}
          >
            <Text style={[styles.applyText, { color: c.primaryForeground }]}>
              {t('post_sched_apply')}
            </Text>
          </TouchableOpacity>
        </View>
      }
    >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Month pager ─────────────────────────────────────────────── */}
        <View style={styles.monthRow}>
          <TouchableOpacity
            style={[
              styles.monthBtn,
              { backgroundColor: c.muted, opacity: paging.prev ? 1 : 0.35 },
            ]}
            onPress={() => page(-1)}
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
            style={[
              styles.monthBtn,
              { backgroundColor: c.muted, opacity: paging.next ? 1 : 0.35 },
            ]}
            onPress={() => page(1)}
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
              const enabled = isDayWithinWindow(cell, now);
              const selected = isSameDay(cell, day);
              const isToday = isSameDay(cell, today);
              return (
                <View key={`c-${wi}-${ci}`} style={styles.cell}>
                  <TouchableOpacity
                    style={[
                      styles.day,
                      selected && { backgroundColor: c.primary },
                      !selected && isToday && { borderColor: c.primary, borderWidth: 1 },
                    ]}
                    onPress={() => setDay(cell)}
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

        {/* ── Clock ───────────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>{t('post_sched_hour')}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {HOURS.map((h) => {
            const active = h === hour12;
            return (
              <TouchableOpacity
                key={`h-${h}`}
                style={[styles.chip, { backgroundColor: active ? c.primary : c.muted }]}
                onPress={() => setHour12(h)}
              >
                <Text style={[styles.chipText, { color: active ? c.primaryForeground : c.text }]}>
                  {h}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>
          {t('post_sched_minute')}
        </Text>
        <View style={styles.chipRow}>
          {MINUTES.map((m) => {
            const active = m === minute;
            return (
              <TouchableOpacity
                key={`m-${m}`}
                style={[styles.chip, { backgroundColor: active ? c.primary : c.muted }]}
                onPress={() => setMinute(m)}
              >
                <Text style={[styles.chipText, { color: active ? c.primaryForeground : c.text }]}>
                  {m < 10 ? `0${m}` : m}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={[styles.meridiem, { backgroundColor: c.muted, borderColor: c.border }]}>
          {[false, true].map((pm) => {
            const active = pm === isPm;
            return (
              <TouchableOpacity
                key={pm ? 'pm' : 'am'}
                style={[styles.meridiemBtn, active && { backgroundColor: c.primary }]}
                onPress={() => setIsPm(pm)}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: active ? c.primaryForeground : c.mutedForeground },
                  ]}
                >
                  {t(pm ? 'post_sched_pm' : 'post_sched_am')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.hint, { color: c.mutedForeground }]}>
          {t('post_sched_window_hint', {
            min: BOOKING_MIN_LEAD_MINUTES,
            max: BOOKING_MAX_LEAD_DAYS,
          })}
        </Text>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  summaryText: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  summaryClock: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
  scroll: { paddingHorizontal: 16, paddingBottom: 20 },
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
  sectionLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 11, marginTop: 14, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingRight: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  chipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  meridiem: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    gap: 4,
    marginTop: 14,
    alignSelf: 'flex-start',
  },
  meridiemBtn: { paddingHorizontal: 22, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 14, lineHeight: 16 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  errorText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 11, lineHeight: 15 },
  apply: { borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  applyText: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
});
