import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { isSameLocalDay } from '@/lib/jobBooking';
import { agendaWindow, monthSpanLabel } from '@/lib/postWizard';

/**
 * The inline seven-day strip that replaced the calendar sheet.
 *
 * Contract (see lib/postWizard for the rules):
 *  • exactly the seven days starting TODAY, in one row — no month grid, no
 *    start-date lock, no "change start date";
 *  • any day toggles on and off, in any order;
 *  • the month label above spans both months when the week crosses one;
 *  • a day with no remaining slots (today, late in the day) is visibly disabled;
 *  • seven EQUAL columns that fit a 360dp screen without scrolling; the
 *    ScrollView only moves if the platform genuinely cannot fit them.
 */
export default function DateStrip({
  selected,
  onToggle,
  weekdays,
  months,
  disabled,
}: {
  selected: Date[];
  onToggle: (day: Date) => void;
  /** Mon → Sun, from the translated `post_sched_weekdays` table. */
  weekdays: string[];
  /** Jan → Dec, from the translated `post_sched_months` table. */
  months: string[];
  /** True when the day cannot be picked (today with no slots left). */
  disabled: (day: Date) => boolean;
}) {
  const { colors: c } = useTheme();
  const days = agendaWindow(new Date());
  const isSelected = (day: Date) => selected.some((picked) => isSameLocalDay(picked, day));

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
        // `flexGrow` keeps the row full-width on tablets; on a 360dp phone the
        // seven 40dp-minimum columns fit inside it and no scrolling happens.
        contentContainerStyle={styles.scrollContent}
      >
        {days.map((day) => {
          const active = isSelected(day);
          const off = disabled(day) && !active;
          const weekday = weekdays[(day.getDay() + 6) % 7] ?? '';
          return (
            <TouchableOpacity
              key={day.toISOString()}
              style={styles.col}
              onPress={() => onToggle(day)}
              disabled={off}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: off }}
              accessibilityLabel={`${weekday} ${day.getDate()}`}
            >
              <Text
                style={[
                  styles.weekday,
                  { color: active ? c.primary : off ? c.mutedForeground : c.text },
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
                    backgroundColor: active ? c.primary : 'transparent',
                    borderColor: active ? c.primary : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.date,
                    { color: active ? c.primaryForeground : off ? c.mutedForeground : c.text },
                    off && styles.off,
                  ]}
                >
                  {day.getDate()}
                </Text>
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
  date: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
});
