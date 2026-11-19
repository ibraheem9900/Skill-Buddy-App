import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '@/components/BottomSheet';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import {
  DEFAULT_JOB_SORT,
  type JobSort,
  type JobSortKey,
  type SortDirection,
} from '@/lib/jobSort';
import type { TranslationKey } from '@/context/LanguageContext';

interface Props {
  visible: boolean;
  value: JobSort;
  onChange: (next: JobSort) => void;
  onClose: () => void;
  /** Keys with no data in this list are shown disabled, never silently ignored. */
  disabledKeys?: JobSortKey[];
}

const OPTIONS: { key: JobSortKey; label: TranslationKey; icon: keyof typeof Feather.glyphMap }[] = [
  // Date posted is the default: it is the only key that orders every job in
  // every state (a closed job has no "time left" to sort by).
  { key: 'created', label: 'jobs_sort_created', icon: 'calendar' },
  { key: 'time', label: 'jobs_sort_time', icon: 'clock' },
  { key: 'amount', label: 'jobs_sort_amount', icon: 'credit-card' },
  { key: 'distance', label: 'jobs_sort_distance', icon: 'map-pin' },
  { key: 'hours', label: 'jobs_sort_hours', icon: 'activity' },
];

/**
 * Sort by: fixed header / scrollable options / fixed footer.
 *
 * The direction control and the Reset/Done actions live in the footer, so they
 * can never overlap the last option. The options are the only scrolling part;
 * the footer and safe-area padding are always visible above the Android nav bar.
 */
export default function JobsSortSheet({
  visible,
  value,
  onChange,
  onClose,
  disabledKeys = [],
}: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  const choose = (key: JobSortKey) => {
    if (disabledKeys.includes(key)) return;
    // Newest-first for "Date posted", soonest-ending for "Time left"; the other
    // keys keep whatever direction the user already chose.
    const direction: SortDirection =
      key === 'created' ? 'desc' : key === 'time' ? 'asc' : value.direction;
    onChange({ key, direction });
  };

  const direction: SortDirection = value.direction;
  const setDirection = (next: SortDirection) => {
    if (next === direction) return;
    onChange({ ...value, direction: next });
  };

  const segment = (next: SortDirection, icon: 'arrow-up' | 'arrow-down', label: TranslationKey) => {
    const active = direction === next;
    return (
      <TouchableOpacity
        onPress={() => setDirection(next)}
        style={[
          styles.segment,
          { backgroundColor: active ? c.primaryLight : 'transparent' },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
      >
        <Feather name={icon} size={14} color={active ? c.primary : c.mutedForeground} />
        <Text
          style={[styles.segmentText, { color: active ? c.primary : c.mutedForeground }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {t(label)}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('jobs_sort_title')}
      height={560}
      footer={
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          <View style={[styles.segmented, { borderColor: c.border, backgroundColor: c.card }]}>
            {segment('asc', 'arrow-up', 'jobs_sort_asc')}
            {segment('desc', 'arrow-down', 'jobs_sort_desc')}
          </View>
          <View style={styles.footerActions}>
            <TouchableOpacity
              onPress={() => onChange(DEFAULT_JOB_SORT)}
              style={[styles.secondary, { borderColor: c.border }]}
              accessibilityRole="button"
            >
              <Feather name="rotate-ccw" size={14} color={c.mutedForeground} />
              <Text style={[styles.secondaryText, { color: c.mutedForeground }]} numberOfLines={1}>
                {t('jobs_sort_reset')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.primary, { backgroundColor: c.primary }]}
              accessibilityRole="button"
            >
              <Text style={[styles.primaryText, { color: c.primaryForeground }]} numberOfLines={1}>
                {t('jobs_sort_done')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      }
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {OPTIONS.map((option) => {
          const active = value.key === option.key;
          const disabled = disabledKeys.includes(option.key);
          return (
            <TouchableOpacity
              key={option.key}
              onPress={() => choose(option.key)}
              disabled={disabled}
              style={[
                styles.row,
                {
                  backgroundColor: active ? c.primaryLight : c.card,
                  borderColor: active ? c.primary : c.border,
                  opacity: disabled ? 0.5 : 1,
                },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
            >
              <View style={[styles.iconWrap, { backgroundColor: active ? c.primary : c.muted }]}>
                <Feather
                  name={option.icon}
                  size={16}
                  color={active ? c.primaryForeground : c.mutedForeground}
                />
              </View>
              <Text
                style={[styles.rowText, { color: active ? c.primary : c.text }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                {t(option.label)}
              </Text>
              {disabled ? (
                <Text
                  style={[styles.disabledText, { color: c.mutedForeground }]}
                  numberOfLines={1}
                >
                  {t('jobs_sort_unavailable')}
                </Text>
              ) : active ? (
                <Feather name="check-circle" size={20} color={c.primary} />
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    minHeight: 56,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0, fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  disabledText: {
    maxWidth: '44%',
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: 'Manrope_400Regular',
    fontSize: 10,
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  segmentText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, flexShrink: 1 },
  footerActions: { flexDirection: 'row', gap: 10 },
  secondary: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
  },
  secondaryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  primary: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 10,
  },
  primaryText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
});
