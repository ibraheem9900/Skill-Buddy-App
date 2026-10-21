import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import {
  TIME_MINUTE_STEP,
  type ClockTime,
  to12Hour,
  to24Hour,
} from '@/lib/jobBooking';

/** A start/end pair on the 24-hour clock (the shape TimeChoice uses). */
export interface ClockRange {
  start: ClockTime;
  end: ClockTime;
}

/**
 * One arrow that steps once on touch-down and then REPEATS while held — the
 * same feel as the clock sheet's arrows, so a time is one thumb away and never
 * needs a dial.
 */
function StepArrow({
  direction,
  onStep,
  label,
  color,
  disabled,
}: {
  direction: 'up' | 'down';
  onStep: () => void;
  label: string;
  color: string;
  disabled?: boolean;
}) {
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (hold.current) clearTimeout(hold.current);
    if (repeat.current) clearInterval(repeat.current);
    hold.current = null;
    repeat.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  return (
    <TouchableOpacity
      style={styles.arrow}
      onPressIn={() => {
        if (disabled) return;
        onStep();
        // 400 ms before repeating keeps a deliberate single tap a single step.
        hold.current = setTimeout(() => {
          repeat.current = setInterval(onStep, 90);
        }, 400);
      }}
      onPressOut={stop}
      disabled={disabled}
      hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather name={direction === 'up' ? 'chevron-up' : 'chevron-down'} size={16} color={color} />
    </TouchableOpacity>
  );
}

/** 12-hour reading → the legal 12-hour numbers, wrapping 12 → 1 → … → 12. */
function stepHour(hour12: number, delta: number): number {
  const next = ((hour12 - 1 + delta + 12) % 12) + 1;
  return next;
}

/** Minutes move in 5-minute steps and wrap inside the hour. */
function stepMinute(minute: number, delta: number): number {
  return (minute + delta * TIME_MINUTE_STEP + 60) % 60;
}

function Row({
  label,
  value,
  onChange,
  prefix,
}: {
  label: string;
  value: ClockTime;
  onChange: (next: ClockTime) => void;
  prefix: string;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { hour12, isPm } = to12Hour(value.hour);

  const setHour = (delta: number) => {
    const nextHour = stepHour(hour12, delta);
    onChange({ hour: to24Hour(nextHour, isPm), minute: value.minute });
  };
  const setMinute = (delta: number) => {
    onChange({ hour: value.hour, minute: stepMinute(value.minute, delta) });
  };
  const setMeridiem = (pm: boolean) => {
    if (pm === isPm) return;
    onChange({ hour: to24Hour(hour12, pm), minute: value.minute });
  };

  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>{label}</Text>
      <View
        style={[styles.control, { backgroundColor: c.input, borderColor: c.border }]}
        accessibilityLabel={`${prefix} ${hour12}:${pad(value.minute)} ${isPm ? 'PM' : 'AM'}`}
      >
        {/* Hours */}
        <View style={styles.unit}>
          <StepArrow
            direction="up"
            onStep={() => setHour(1)}
            label={`${t('post_sched_hour')} +1`}
            color={c.primary}
          />
          <Text style={[styles.value, { color: c.text }]}>{pad(hour12)}</Text>
          <StepArrow
            direction="down"
            onStep={() => setHour(-1)}
            label={`${t('post_sched_hour')} -1`}
            color={c.primary}
          />
        </View>

        <Text style={[styles.colon, { color: c.mutedForeground }]}>:</Text>

        {/* Minutes */}
        <View style={styles.unit}>
          <StepArrow
            direction="up"
            onStep={() => setMinute(1)}
            label={`${t('post_sched_minute')} +5`}
            color={c.primary}
          />
          <Text style={[styles.value, { color: c.text }]}>{pad(value.minute)}</Text>
          <StepArrow
            direction="down"
            onStep={() => setMinute(-1)}
            label={`${t('post_sched_minute')} -5`}
            color={c.primary}
          />
        </View>

        {/* AM / PM */}
        <View style={[styles.meridiem, { backgroundColor: c.muted }]}>
          {[false, true].map((pm) => {
            const active = pm === isPm;
            return (
              <TouchableOpacity
                key={pm ? 'pm' : 'am'}
                style={[styles.meridiemBtn, active && { backgroundColor: c.primary }]}
                onPress={() => setMeridiem(pm)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.meridiemText,
                    { color: active ? c.primaryForeground : c.mutedForeground },
                  ]}
                >
                  {t(pm ? 'post_sched_pm' : 'post_sched_am')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

/**
 * "Start time" and "End time", each an HOURS control, a MINUTES control (5-minute
 * steps) and an AM/PM toggle — the whole replacement for the clock face. There is
 * no dial anywhere: both rows are visible at once, one thumb reaches every arrow,
 * and the same component edits a task's own time.
 */
export default function TimeRangeFields({
  value,
  onChange,
  startLabel,
  endLabel,
}: {
  value: ClockRange;
  onChange: (next: ClockRange) => void;
  startLabel?: string;
  endLabel?: string;
}) {
  const { t } = useLanguage();
  return (
    <View style={styles.wrap}>
      <Row
        label={startLabel ?? t('post_time_start')}
        prefix={t('post_time_start')}
        value={value.start}
        onChange={(start) => onChange({ ...value, start })}
      />
      <Row
        label={endLabel ?? t('post_time_end')}
        prefix={t('post_time_end')}
        value={value.end}
        onChange={(end) => onChange({ ...value, end })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  row: { gap: 6 },
  rowLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 4,
  },
  unit: { alignItems: 'center', minWidth: 44 },
  arrow: { paddingVertical: 1 },
  value: { fontFamily: 'Manrope_700Bold', fontSize: 20, lineHeight: 24 },
  colon: { fontFamily: 'Manrope_700Bold', fontSize: 18, marginTop: -2 },
  meridiem: { flexDirection: 'row', borderRadius: 10, padding: 3, gap: 2 },
  meridiemBtn: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 },
  meridiemText: { fontFamily: 'Manrope_700Bold', fontSize: 11 },
});
