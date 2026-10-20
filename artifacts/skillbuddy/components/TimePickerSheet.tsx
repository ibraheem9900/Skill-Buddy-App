import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  LayoutChangeEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '@/components/BottomSheet';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import {
  angleForValue,
  hourFromAngle,
  minuteFromAngle,
  angleForPoint,
  isOutsideDeadZone,
  stepHour12,
  stepMinute,
} from '@/lib/clockMath';
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
  /** "Select time", or "Start time" / "End time" for the Anytime window. */
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

/** Dial geometry: the face is square and its centre is measured after layout. */
const DIAL = Math.min(Math.max(Dimensions.get('window').width - 140, 196), 264);
const HAND_RADIUS = DIAL / 2 - 42;
const LABEL_RADIUS = DIAL / 2 - 20;
const HOUR_LABELS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTE_LABELS = Array.from({ length: 60 / TIME_MINUTE_STEP }, (_, i) => i * TIME_MINUTE_STEP);

/** Where a dial label sits for a given angle (0° = 12 o'clock, clockwise). */
function labelPosition(angle: number, size: number): { left: number; top: number } {
  const radius = (size / 2) * (LABEL_RADIUS / (DIAL / 2));
  const rad = ((angle - 90) * Math.PI) / 180;
  return {
    left: size / 2 + radius * Math.cos(rad) - 16,
    top: size / 2 + radius * Math.sin(rad) - 13,
  };
}

/**
 * A stepper arrow that steps once on touch-down and then REPEATS while held.
 * Touch-down (not onPress) is used so the first step is instant and a hold needs
 * no second gesture.
 */
function StepperButton({
  icon,
  onStep,
  color,
  label,
}: {
  icon: 'chevron-up' | 'chevron-down';
  onStep: () => void;
  color: string;
  label: string;
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
      style={styles.stepperBtn}
      onPressIn={() => {
        onStep();
        hold.current = setTimeout(() => {
          repeat.current = setInterval(onStep, 90);
        }, 400);
      }}
      onPressOut={stop}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather name={icon} size={18} color={color} />
    </TouchableOpacity>
  );
}

/**
 * Clock-style time picker — the ONE clock in the app (single time, and the
 * Start/End fields of "Anytime" all open this same sheet).
 *
 * THE BUG THIS REPLACES: the needle used to jump around and never stay put,
 * because (a) the angle was tweened with `withTiming` on EVERY move, so the hand
 * lagged the finger, and (b) the tween from 355° to 0° rotated the long way
 * round, so crossing 12 o'clock or 59 → 0 spun the hand a full turn. On top of
 * that, releasing the finger immediately switched the dial to minutes, moving
 * the hand somewhere else — the "it does not stay on a value" half of the bug.
 *
 * How it works now:
 *  - the angle is ALWAYS derived from the value (`angleForValue`), never
 *    accumulated, and it is applied with NO animation, so the hand snaps to the
 *    value the finger is over and stays there;
 *  - one transparent touch layer covers the whole face, so the coordinates are
 *    the dial's own; the centre is measured with onLayout (and re-measured when
 *    the layout changes) instead of being assumed;
 *  - a tap anywhere picks the NEAREST label (hours) or the nearest 5 minutes;
 *  - an hour is selected first, then the dial advances to minutes by itself;
 *
 * The dial is plain Views — no native module — so this ships as an OTA update.
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
  /** Measured centre of the face, in the touch layer's coordinates. */
  const [centre, setCentre] = useState({ x: DIAL / 2, y: DIAL / 2 });
  const dragging = useRef(false);

  /**
   * The opening selection. A remembered value wins; otherwise 09:00 — except
   * when the sheet is for TODAY and 09:00 has already gone, in which case the
   * next 5-minute slot after now is used, so the dial never opens on a reading
   * the picker is about to refuse.
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
    dragging.current = false;
  }, [visible, value, defaultClock]);

  const hour24 = to24Hour(hour12, isPm);

  /**
   * Where the hand points: DERIVED from the value on every render. No tween, so
   * there is nothing to spin and nothing to lag behind the finger.
   */
  const angle = angleForValue(mode === 'hour' ? hour12 : minute, mode);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setCentre({ x: width / 2, y: height / 2 });
  };

  /** Read a touch into the active field. Returns false when it was ignored. */
  const applyTouch = (locationX: number, locationY: number): boolean => {
    const dx = locationX - centre.x;
    const dy = locationY - centre.y;
    if (!isOutsideDeadZone(dx, dy)) return false;
    const deg = angleForPoint(dx, dy);
    if (mode === 'hour') {
      setHour12(hourFromAngle(deg));
    } else {
      setMinute(minuteFromAngle(deg, TIME_MINUTE_STEP));
    }
    return true;
  };

  /** Finger lifted: an hour choice advances the dial to minutes, by itself. */
  const finishTouch = (locationX: number, locationY: number) => {
    const applied = dragging.current || applyTouch(locationX, locationY);
    dragging.current = false;
    if (mode === 'hour' && applied) setMode('minute');
  };

  /** Stepper arrows act on the ACTIVE field only. */
  const step = (delta: number) => {
    if (mode === 'hour') setHour12((current) => stepHour12(current, delta));
    else setMinute((current) => stepMinute(current, delta));
  };

  /** A reading that is already in the past (only possible for TODAY). */
  const isPast = useMemo(() => {
    if (!day) return false;
    const now = nowProp ?? new Date();
    if (localDay(day).getTime() !== localDay(now).getTime()) return false;
    return composeInstant(day, hour24, minute).getTime() <= now.getTime();
  }, [day, hour24, minute, nowProp]);

  const segments = mode === 'hour' ? HOUR_LABELS : MINUTE_LABELS;
  const activeValue = mode === 'hour' ? hour12 : minute;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          {isPast ? (
            <View style={styles.errorRow}>
              <Feather name="alert-circle" size={13} color={c.destructive} />
              <Text style={[styles.errorText, { color: c.destructive }]}>
                {t('post_err_time_past')}
              </Text>
            </View>
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
        {/* ── Stepper (up) · readout · stepper (down) ─────────────────── */}
        <View style={styles.readoutWrap}>
          <StepperButton
            icon="chevron-up"
            onStep={() => step(1)}
            color={c.primary}
            label={`${t(mode === 'hour' ? 'post_sched_hour' : 'post_sched_minute')} +1`}
          />

          <View style={styles.readout}>
            <TouchableOpacity
              onPress={() => setMode('hour')}
              style={[styles.readoutPart, mode === 'hour' && { backgroundColor: c.primaryLight }]}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === 'hour' }}
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
              accessibilityState={{ selected: mode === 'minute' }}
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

          <StepperButton
            icon="chevron-down"
            onStep={() => step(-1)}
            color={c.primary}
            label={`${t(mode === 'hour' ? 'post_sched_hour' : 'post_sched_minute')} -1`}
          />
        </View>

        {/* ── Clock face ────────────────────────────────────────────────── */}
        <View style={styles.dialWrap}>
          <View
            style={[
              styles.dial,
              {
                width: DIAL,
                height: DIAL,
                borderRadius: DIAL / 2,
                backgroundColor: c.input,
                borderColor: c.border,
              },
            ]}
            onLayout={onLayout}
          >
            {/* The hand: a plain rotated view, angle derived, never animated. */}
            <View
              pointerEvents="none"
              style={[
                styles.hand,
                { width: DIAL, height: DIAL, transform: [{ rotate: `${angle}deg` }] },
              ]}
            >
              <View style={{ height: DIAL / 2 - HAND_RADIUS - 8 }} />
              <View style={[styles.handTip, { backgroundColor: c.primary }]} />
              <View
                style={[
                  styles.handLine,
                  { height: HAND_RADIUS - 8, backgroundColor: c.primary },
                ]}
              />
            </View>

            {/* Labels for the ACTIVE mode only. */}
            {segments.map((segment) => {
              const position = labelPosition(
                angleForValue(segment, mode),
                DIAL
              );
              const active = segment === activeValue;
              return (
                <View
                  key={`d-${mode}-${segment}`}
                  style={[styles.labelWrap, position]}
                  pointerEvents="none"
                >
                  <Text
                    style={[
                      styles.labelText,
                      { color: active ? c.primary : c.mutedForeground },
                      active && styles.labelActive,
                    ]}
                  >
                    {mode === 'hour' ? segment : pad2(segment)}
                  </Text>
                </View>
              );
            })}

            <View
              pointerEvents="none"
              style={[
                styles.knob,
                {
                  top: DIAL / 2 - 6,
                  left: DIAL / 2 - 6,
                  backgroundColor: c.primary,
                },
              ]}
            />

            {/* ONE transparent touch layer over the whole face. Its own
                coordinates are the dial's, so a tap is measured against the
                measured centre and nothing else. */}
            <View
              style={[styles.touchLayer, { width: DIAL, height: DIAL }]}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderTerminationRequest={() => false}
              onResponderGrant={(event) => {
                dragging.current = false;
                const { locationX, locationY } = event.nativeEvent;
                if (applyTouch(locationX, locationY)) dragging.current = true;
              }}
              onResponderMove={(event) => {
                const { locationX, locationY } = event.nativeEvent;
                if (applyTouch(locationX, locationY)) dragging.current = true;
              }}
              onResponderRelease={(event) => {
                const { locationX, locationY } = event.nativeEvent;
                finishTouch(locationX, locationY);
              }}
              onResponderTerminate={() => {
                dragging.current = false;
              }}
            />
          </View>
        </View>

        <Text style={[styles.modeHint, { color: c.mutedForeground }]}>
          {mode === 'hour' ? t('post_sched_hour') : t('post_sched_minute')}
        </Text>
        <Text style={[styles.selected, { color: c.primary }]}>{formatClock24(hour24, minute)}</Text>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', paddingTop: 10 },
  readoutWrap: { alignItems: 'center', gap: 2 },
  readout: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  readoutPart: { paddingHorizontal: 12, paddingVertical: 2, borderRadius: 12 },
  readoutText: { fontFamily: 'Manrope_700Bold', fontSize: 38 },
  readoutColon: { fontFamily: 'Manrope_700Bold', fontSize: 34, marginTop: -4 },
  stepperBtn: { paddingHorizontal: 24, paddingVertical: 3 },
  meridiem: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 3,
    gap: 3,
    marginLeft: 8,
  },
  meridiemBtn: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9 },
  meridiemText: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
  dialWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  dial: { alignItems: 'center', justifyContent: 'flex-start', borderWidth: 1 },
  hand: { position: 'absolute', left: 0, top: 0, alignItems: 'center' },
  handTip: { width: 14, height: 14, borderRadius: 7 },
  handLine: { width: 2, borderRadius: 1 },
  touchLayer: { position: 'absolute', left: 0, top: 0 },
  labelWrap: {
    position: 'absolute',
    width: 32,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  labelActive: { fontFamily: 'Manrope_700Bold' },
  knob: { position: 'absolute', width: 12, height: 12, borderRadius: 6 },
  modeHint: { fontFamily: 'Manrope_600SemiBold', fontSize: 11, marginTop: 10, letterSpacing: 0.4 },
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
