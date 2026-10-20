import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '@/components/BottomSheet';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import {
  EMPTY_JOB_FILTERS,
  JOB_STATUS_VALUES,
  jobStatusLabelKey,
  type JobListFilters,
} from '@/lib/jobList';
import type { JobRequestType } from '@/types';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The filters currently applied to the list. */
  value: JobListFilters;
  /** Apply commits the draft, closes the sheet and refetches from offset 0. */
  onApply: (filters: JobListFilters) => void;
}

/** The three-way request-type control, `null` meaning "All types". */
const REQUEST_TYPE_OPTIONS: Array<{ value: JobRequestType | null; labelKey: 'jobs_filter_all_types' | 'jobs_urgent' | 'jobs_regular' }> = [
  { value: null, labelKey: 'jobs_filter_all_types' },
  { value: 'URGENT', labelKey: 'jobs_urgent' },
  { value: 'REGULAR', labelKey: 'jobs_regular' },
];

/**
 * The Jobs filters sheet.
 *
 * One sheet, built with the SAME BottomSheet every other picker uses, so its
 * position, header, close button and footer behave identically to "Choose dates"
 * and "Select time".
 *
 * It edits a LOCAL DRAFT: Apply commits it (and the screen refetches from offset
 * 0), while the close X and a backdrop tap discard it — so merely opening the
 * sheet can never narrow the list behind the user's back.
 *
 * The status pills are the 14 values the live OpenAPI documents, rendered as a
 * wrapped grid (no horizontal scrolling, nothing off-screen) and always with
 * translated labels — never a raw enum.
 */
export default function JobsFilterSheet({ visible, onClose, value, onApply }: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const [draft, setDraft] = useState<JobListFilters>(value);

  // Re-seed from the applied filters every time the sheet opens.
  useEffect(() => {
    if (visible) setDraft(value);
    // `value` alone must not re-seed while the sheet is open (that would throw
    // away the draft on every parent render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const statusPills = useMemo(
    () =>
      JOB_STATUS_VALUES.map((status) => {
        const key = jobStatusLabelKey(status);
        return key ? { status, label: t(key) } : null;
      }).filter((entry): entry is { status: (typeof JOB_STATUS_VALUES)[number]; label: string } => entry !== null),
    [t]
  );

  const reset = () => setDraft(EMPTY_JOB_FILTERS);
  const apply = () => onApply(draft);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('jobs_filter_title')}
      footer={
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          <TouchableOpacity
            style={[styles.reset, { borderColor: c.border }]}
            onPress={reset}
            accessibilityRole="button"
          >
            <Text style={[styles.resetText, { color: c.text }]}>{t('jobs_filter_reset')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.apply, { backgroundColor: c.primary }]}
            onPress={apply}
            accessibilityRole="button"
          >
            <Text style={[styles.applyText, { color: c.primaryForeground }]}>
              {t('jobs_filter_apply')}
            </Text>
          </TouchableOpacity>
        </View>
      }
    >
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Status ────────────────────────────────────────────────────── */}
        <Text style={[styles.section, { color: c.text }]}>{t('jobs_filter_status')}</Text>
        <View style={styles.pillGrid}>
          <TouchableOpacity
            style={[
              styles.pill,
              {
                backgroundColor: draft.status === null ? c.primary : c.muted,
                borderColor: draft.status === null ? c.primary : c.border,
              },
            ]}
            onPress={() => setDraft({ ...draft, status: null })}
            accessibilityRole="button"
            accessibilityState={{ selected: draft.status === null }}
          >
            <Text
              style={[
                styles.pillText,
                { color: draft.status === null ? c.primaryForeground : c.text },
              ]}
            >
              {t('jobs_filter_all')}
            </Text>
          </TouchableOpacity>

          {statusPills.map(({ status, label }) => {
            const active = draft.status === status;
            return (
              <TouchableOpacity
                key={status}
                style={[
                  styles.pill,
                  {
                    backgroundColor: active ? c.primary : c.muted,
                    borderColor: active ? c.primary : c.border,
                  },
                ]}
                onPress={() => setDraft({ ...draft, status })}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.pillText, { color: active ? c.primaryForeground : c.text }]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Request type ──────────────────────────────────────────────── */}
        <Text style={[styles.section, { color: c.text }]}>{t('jobs_filter_request_type')}</Text>
        <View style={[styles.segmented, { backgroundColor: c.muted, borderColor: c.border }]}>
          {REQUEST_TYPE_OPTIONS.map((option) => {
            const active = draft.requestType === option.value;
            return (
              <TouchableOpacity
                key={option.value ?? 'all'}
                style={[styles.segment, active && { backgroundColor: c.primary }]}
                onPress={() => setDraft({ ...draft, requestType: option.value })}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: active ? c.primaryForeground : c.mutedForeground },
                  ]}
                  numberOfLines={1}
                >
                  {t(option.labelKey)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Bidding ───────────────────────────────────────────────────── */}
        <Text style={[styles.section, { color: c.text }]}>{t('jobs_filter_bidding')}</Text>
        <View style={[styles.switchRow, { backgroundColor: c.input, borderColor: c.border }]}>
          <View style={styles.switchBody}>
            <Feather name="radio" size={15} color={c.mutedForeground} />
            <Text style={[styles.switchLabel, { color: c.text }]}>
              {t('jobs_filter_only_bidding')}
            </Text>
          </View>
          <Switch
            value={draft.onlyActivelyBidding}
            onValueChange={(next) => setDraft({ ...draft, onlyActivelyBidding: next })}
            trackColor={{ false: c.border, true: c.primary }}
            thumbColor={c.surface}
            ios_backgroundColor={c.border}
          />
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, paddingBottom: 24, gap: 10 },
  section: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, marginTop: 6 },
  pillGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    // Keeps the grid even when a translated label is long.
    maxWidth: '100%',
  },
  pillText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  segmented: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, padding: 3, gap: 3 },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 9,
  },
  segmentText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  switchBody: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  switchLabel: { fontFamily: 'Manrope_500Medium', fontSize: 13, flex: 1 },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  reset: { flex: 1, borderWidth: 1.5, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  resetText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  apply: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  applyText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
});
