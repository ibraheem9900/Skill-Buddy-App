import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { agendaWindow, dayKey, monthSpanLabel } from '@/lib/postWizard';

/**
 * The inline seven-day strip on the Date & Time step.
 *
 * Contract (see lib/postWizard for the rules):
 *  • exactly the seven days starting TODAY, in one row — no month grid;
 *  • ONE ACTIVE day at a time: tapping an unselected day selects AND activates
 *    it, tapping a selected-but-inactive day only activates it, tapping the
 *    active day again removes it (its time goes with it);
 *  • states are visually distinct: a filled circle means selected, an extra
 *    ring means active, and a marker under the number says whether that day
 *    already has a time (solid dot) or still needs one (hollow dot);
 *  • a day with no remaining windows (today, late in the day) is visibly
 *    disabled and cannot be picked.
 */
export default function DateStrip({
  selected,
  activeKey,
  onToggle,
  weekdays,
  months,
  disabled,
  status,
  count,
}: {
  selected: Date[];
  /** `YYYY-MM-DD` of the day whose time grid is shown, or null. */
  activeKey: string | null;
  onToggle: (day: Date) => void;
  /** Mon → Sun, from the translated `post_sched_weekdays` table. */
  weekdays: string[];
  /** Jan → Dec, from the translated `post_sched_months` table. */
  months: string[];
  /** True when the day cannot be picked (today with no windows left). */
  disabled: (day: Date) => boolean;
  /** 'timed' when the day's task has a time, 'untimed' when it still needs one. */
  status: (day: Date) => 'timed' | 'untimed' | null;
  /** Number of time windows on that day; a small badge appears above 1. */
  count?: (day: Date) => number;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const days = agendaWindow(new Date());

  return (
    <View style={styles.wrap}>
      <View style={styles.monthRow}>
        <Feather name="calendar" size={13} color={c.mutedForeground} />
        <Text style={[styles.month, { color: c.mutedForeground }]}>
          {monthSpanLabel(days, months)}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // `flexGrow` keeps the row full-width on tablets; the seven columns fit a
        // 360dp phone, so nothing scrolls unless the platform genuinely cannot.
        contentContainerStyle={styles.scrollContent}
      >
        {days.map((day) => {
          const key = dayKey(day);
          const isSelected = selected.some((picked) => dayKey(picked) === key);
          const isActive = activeKey === key;
          const off = disabled(day) && !isSelected;
          const dayStatus = status(day);
          const dayCount = count ? count(day) : 0;
          const weekday = weekdays[(day.getDay() + 6) % 7] ?? '';
          return (
            <TouchableOpacity
              key={key}
              style={styles.col}
              onPress={() => onToggle(day)}
              disabled={off}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected, disabled: off }}
              accessibilityLabel={`${weekday} ${day.getDate()}`}
            >
              <Text
                style={[
                  styles.weekday,
                  { color: isSelected ? c.primary : off ? c.mutedForeground : c.text },
                  off && styles.off,
                ]}
                numberOfLines={1}
              >
                {weekday.slice(0, 3)}
              </Text>
              <View
                style={[
                  styles.pill,
                  {
                    backgroundColor: isSelected ? c.primary : 'transparent',
                    borderColor: isSelected ? c.primary : c.border,
                    // The ACTIVE day gets a second ring outside the fill.
                    borderWidth: isActive ? 2 : 1,
                  },
                  isActive && styles.pillActive,
                ]}
              >
                <Text
                  style={[
                    styles.date,
                    {
                      color: isSelected ? c.primaryForeground : off ? c.mutedForeground : c.text,
                    },
                    off && styles.off,
                  ]}
                >
                  {day.getDate()}
                </Text>
                {dayCount > 1 ? (
                  <View
                    style={[
                      styles.countBadge,
                      { backgroundColor: isSelected ? c.primaryForeground : c.primary },
                    ]}
                  >
                    <Text
                      style={[styles.countText, { color: isSelected ? c.primary : c.primaryForeground }]}
                    >
                      {dayCount}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.markerSlot}>
                {dayStatus === 'timed' ? (
                  <View
                    style={[styles.marker, { backgroundColor: isSelected ? c.primary : c.success }]}
                    accessibilityLabel={t('post_day_time_set')}
                  />
                ) : dayStatus === 'untimed' ? (
                  <View
                    style={[styles.markerEmpty, { borderColor: c.destructive }]}
                    accessibilityLabel={t('post_day_need_time')}
                  />
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 2 },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  month: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 0.2 },
  scrollContent: { flexGrow: 1, minWidth: '100%' },
  col: { flex: 1, minWidth: 40, alignItems: 'center', paddingVertical: 4, gap: 6 },
  weekday: { fontFamily: 'Manrope_600SemiBold', fontSize: 10, letterSpacing: 0.4 },
  off: { opacity: 0.45 },
  pill: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, elevation: 2 },
  countBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontFamily: 'Manrope_700Bold', fontSize: 9 },
  date: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  markerSlot: { height: 8, alignItems: 'center', justifyContent: 'center' },
  marker: { width: 4, height: 4, borderRadius: 2 },
  markerEmpty: { width: 6, height: 6, borderRadius: 3, borderWidth: 1.2 },
});
