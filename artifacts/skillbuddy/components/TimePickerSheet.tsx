import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '@/components/BottomSheet';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import {
  TIME_MINUTE_STEP,
  composeInstant,
  formatClock24,
  localDay,
  pad2,
  to12Hour,
  to24Hour,
} from '@/lib/jobBooking';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Presented value (24-hour clock), or null while nothing is chosen. */
  value: { hour: number; minute: number } | null;
  onConfirm: (value: { hour: number; minute: number }) => void;
  /**
   * The local day the time applies to. When it is TODAY, a clock reading whose
   * instant has already passed is refused right here (not just on submit).
   */
  day: Date | null;
  /** Clock used for that refusal (injectable for tests). */
  now?: Date;
}

/** Dial geometry. */
const DIAL = Math.min(Math.max(Dimensions.get('window').width - 140, 196), 264);
const CENTER = DIAL / 2;
const HAND_RADIUS = DIAL / 2 - 44;
const LABEL_RADIUS = DIAL / 2 - 18;
const HOUR_LABELS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTE_LABELS = Array.from({ length: 60 / TIME_MINUTE_STEP }, (_, i) => i * TIME_MINUTE_STEP);

/** Clock position (degrees from 12 o'clock, clockwise) for a dial value. */
function dialAngle(value: number, mode: 'hour' | 'minute'): number {
  return mode === 'hour' ? (value % 12) * 30 : value * 6;
}

/** Where a label sits on the dial for a given angle. */
function labelPosition(angle: number): { left: number; top: number } {
  const rad = ((angle - 90) * Math.PI) / 180;
  return {
    left: CENTER + LABEL_RADIUS * Math.cos(rad) - 16,
    top: CENTER + LABEL_RADIUS * Math.sin(rad) - 13,
  };
}

/**
 * Clock-style time picker.
 *
 * A separate picker from the calendar, exactly as the brief requires: a real
 * CLOCK FACE (hour dial → minute dial), a large digital readout whose hour and
 * minute halves are tappable to switch mode, an AM/PM toggle, a spring-animated
 * hand, minute selection in 5-minute steps, and Cancel / OK.
 *
 * The dial is plain Views — no new native module — so the JS bundle ships as an
 * over-the-air update against the installed build.
 */
export default function TimePickerSheet({
  visible,
  onClose,
  title,
  value,
  onConfirm,
  day,
  now: nowProp,
}: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  const [hour12, setHour12] = useState(9);
  const [minute, setMinute] = useState(0);
  const [isPm, setIsPm] = useState(false);
  const [mode, setMode] = useState<'hour' | 'minute'>('hour');

  const angle = useSharedValue(0);
  const handStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));

  /**
   * The opening selection. A remembered value wins; otherwise 09:00 — except
   * when the sheet is for TODAY and 09:00 has already gone, in which case the
   * next 5-minute slot after now is used, so the user never opens the dial on a
   * reading the picker is about to refuse.
   */
  const defaultClock = useCallback((): { hour: number; minute: number } => {
    const now = nowProp ?? new Date();
    const isToday = !!day && localDay(day).getTime() === localDay(now).getTime();
    if (!isToday) return { hour: 9, minute: 0 };
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const nextSlot = Math.min(
      Math.ceil((nowMinutes + 1) / TIME_MINUTE_STEP) * TIME_MINUTE_STEP,
      23 * 60 + 55
    );
    return { hour: Math.floor(nextSlot / 60), minute: nextSlot % 60 };
  }, [day, nowProp]);

  // Seed (and re-seed) on every open: the hour dial is always the first step.
  useEffect(() => {
    if (!visible) return;
    const seed = value ?? defaultClock();
    const twelve = to12Hour(seed.hour);
    setHour12(twelve.hour12);
    setMinute(seed.minute - (seed.minute % TIME_MINUTE_STEP));
    setIsPm(twelve.isPm);
    setMode('hour');
  }, [visible, value, defaultClock]);

  const targetAngle =
    mode === 'hour' ? dialAngle(hour12 === 12 ? 0 : hour12, 'hour') : dialAngle(minute, 'minute');

  useEffect(() => {
    angle.value = withTiming(targetAngle, { duration: 180, easing: Easing.out(Easing.cubic) });
  }, [targetAngle, angle]);

  const hour24 = to24Hour(hour12, isPm);

  /** A reading that is already in the past (only possible for TODAY). */
  const isPast = useMemo(() => {
    if (!day) return false;
    const now = nowProp ?? new Date();
    if (localDay(day).getTime() !== localDay(now).getTime()) return false;
    return composeInstant(day, hour24, minute).getTime() <= now.getTime();
  }, [day, hour24, minute, nowProp]);

  const pick = (locationX: number, locationY: number) => {
    const dx = locationX - CENTER;
    const dy = locationY - CENTER;
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (deg < 0) deg += 360;

    if (mode === 'hour') {
      const raw = Math.round(deg / 30) % 12;
      setHour12(raw === 0 ? 12 : raw);
      return;
    }
    const snapped = (Math.round(deg / TIME_MINUTE_STEP) * TIME_MINUTE_STEP) % 60;
    setMinute((snapped + 60) % 60);
  };

  const onDialRelease = (locationX: number, locationY: number) => {
    pick(locationX, locationY);
    // Hour first, then minutes — the hand advances by itself, as on a clock.
    if (mode === 'hour') setMode('minute');
  };

  const hourSegments: Array<{ value: number; active: boolean }> = useMemo(
    () => HOUR_LABELS.map((h) => ({ value: h, active: mode === 'hour' && h === hour12 })),
    [mode, hour12]
  );

  const minuteSegments: Array<{ value: number; active: boolean }> = useMemo(
    () => MINUTE_LABELS.map((m) => ({ value: m, active: mode === 'minute' && m === minute })),
    [mode, minute]
  );

  const segments = mode === 'hour' ? hourSegments : minuteSegments;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          {isPast ? (
            <Animated.View entering={FadeIn.duration(180)} style={styles.errorRow}>
              <Feather name="alert-circle" size={13} color={c.destructive} />
              <Text style={[styles.errorText, { color: c.destructive }]}>
                {t('post_err_time_past')}
              </Text>
            </Animated.View>
          ) : null}
          <View style={styles.footerButtons}>
            <TouchableOpacity
              style={[styles.cancel, { borderColor: c.border }]}
              onPress={onClose}
              accessibilityRole="button"
            >
              <Text style={[styles.cancelText, { color: c.text }]}>{t('action_cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirm, { backgroundColor: c.primary, opacity: isPast ? 0.5 : 1 }]}
              onPress={() => onConfirm({ hour: hour24, minute })}
              disabled={isPast}
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
        {/* ── Digital readout ─────────────────────────────────────────── */}
        <View style={styles.readout}>
          <TouchableOpacity
            onPress={() => setMode('hour')}
            style={[styles.readoutPart, mode === 'hour' && { backgroundColor: c.primaryLight }]}
            accessibilityRole="button"
          >
            <Text style={[styles.readoutText, { color: mode === 'hour' ? c.primary : c.text }]}>
              {pad2(hour12)}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.readoutColon, { color: c.mutedForeground }]}>:</Text>
          <TouchableOpacity
            onPress={() => setMode('minute')}
            style={[styles.readoutPart, mode === 'minute' && { backgroundColor: c.primaryLight }]}
            accessibilityRole="button"
          >
            <Text style={[styles.readoutText, { color: mode === 'minute' ? c.primary : c.text }]}>
              {pad2(minute)}
            </Text>
          </TouchableOpacity>
          <View style={[styles.meridiem, { backgroundColor: c.muted, borderColor: c.border }]}>
            {[false, true].map((pm) => {
              const active = pm === isPm;
              return (
                <TouchableOpacity
                  key={pm ? 'pm' : 'am'}
                  style={[styles.meridiemBtn, active && { backgroundColor: c.primary }]}
                  onPress={() => setIsPm(pm)}
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

        {/* ── Clock face ──────────────────────────────────────────────── */}
        <View style={styles.dialWrap}>
          <View
            style={[
              styles.dial,
              { width: DIAL, height: DIAL, borderRadius: CENTER, backgroundColor: c.input, borderColor: c.border },
            ]}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={(e) => pick(e.nativeEvent.locationX, e.nativeEvent.locationY)}
            onResponderMove={(e) => pick(e.nativeEvent.locationX, e.nativeEvent.locationY)}
            onResponderRelease={(e) =>
              onDialRelease(e.nativeEvent.locationX, e.nativeEvent.locationY)
            }
          >
            {/* Hand */}
            <Animated.View
              pointerEvents="none"
              style={[styles.hand, { width: DIAL, height: DIAL }, handStyle]}
            >
              <View style={{ height: CENTER - HAND_RADIUS - 7 }} />
              <View style={[styles.handTip, { backgroundColor: c.primary }]} />
              <View style={[styles.handLine, { height: HAND_RADIUS - 7, backgroundColor: c.primary }]} />
            </Animated.View>

            {/* Dial labels for the active mode */}
            {segments.map((seg) => {
              const pos = labelPosition(
                mode === 'hour'
                  ? dialAngle(seg.value === 12 ? 0 : seg.value, 'hour')
                  : dialAngle(seg.value, 'minute')
              );
              return (
                <View key={`d-${mode}-${seg.value}`} style={[styles.labelWrap, pos]} pointerEvents="none">
                  <Text
                    style={[
                      styles.labelText,
                      { color: seg.active ? c.primary : c.mutedForeground },
                      seg.active && styles.labelActive,
                    ]}
                  >
                    {mode === 'hour' ? seg.value : pad2(seg.value)}
                  </Text>
                </View>
              );
            })}

            <View style={[styles.knob, { backgroundColor: c.primary }]} pointerEvents="none" />
          </View>
        </View>

        <Text style={[styles.modeHint, { color: c.mutedForeground }]}>
          {mode === 'hour' ? t('post_sched_hour') : t('post_sched_minute')}
        </Text>
        <Text style={[styles.selected, { color: c.primary }]}>
          {formatClock24(hour24, minute)}
        </Text>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', paddingTop: 14 },
  readout: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  readoutPart: { paddingHorizontal: 12, paddingVertical: 2, borderRadius: 12 },
  readoutText: { fontFamily: 'Manrope_700Bold', fontSize: 38 },
  readoutColon: { fontFamily: 'Manrope_700Bold', fontSize: 34, marginTop: -4 },
  meridiem: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 3,
    gap: 3,
    marginLeft: 10,
  },
  meridiemBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9 },
  meridiemText: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
  dialWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  dial: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    borderWidth: 1,
    overflow: 'hidden',
  },
  hand: { position: 'absolute', left: 0, top: 0, alignItems: 'center' },
  handTip: { width: 14, height: 14, borderRadius: 7 },
  handLine: { width: 2, borderRadius: 1 },
  labelWrap: {
    position: 'absolute',
    width: 32,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  labelActive: { fontFamily: 'Manrope_700Bold' },
  knob: { position: 'absolute', top: CENTER - 6, left: CENTER - 6, width: 12, height: 12, borderRadius: 6 },
  modeHint: { fontFamily: 'Manrope_600SemiBold', fontSize: 11, marginTop: 12, letterSpacing: 0.4 },
  selected: { fontFamily: 'Manrope_700Bold', fontSize: 15, marginTop: 2 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  footerButtons: { flexDirection: 'row', gap: 10 },
  cancel: { flex: 1, borderWidth: 1.5, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  confirm: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  confirmText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  errorText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 11, lineHeight: 15 },
});
