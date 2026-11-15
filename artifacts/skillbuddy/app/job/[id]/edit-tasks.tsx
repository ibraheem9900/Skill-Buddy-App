import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useJobDetail } from '@/hooks/useJobDetail';
import { authApi } from '@/services/api';
import BackButton from '@/components/BackButton';
import BrandedLoader from '@/components/BrandedLoader';
import TaskEditSheet from '@/components/TaskEditSheet';
import { fixedSlots, formatWindowLabel } from '@/lib/jobBooking';
import { formatDayLabel, parseScheduleSegments, segmentsForTasks } from '@/lib/timeSlots';
import { applyTaskSlots, buildTask, sortTasks, type TaskDraft } from '@/lib/postWizard';
import { parseLocalDateKey } from '@/lib/jobUpdate';
import type { JobMilestoneCreate } from '@/types';

/**
 * Edit tasks — PATCH /api/v1/jobs/{job_id} with `milestones` for a MULTI_DAY job.
 *
 * ONE task per day; a task may allow SEVERAL slots (the pilot still picks ONE
 * arrival time). This screen edits the SAME model the post wizard produces and
 * uses the SAME TaskEditSheet, so the two can never drift.
 *
 * Rules: at least one task survives, a day is added only within today + 6 days
 * (one task per day), the expected hours follow the 11 PM ceiling, and the save
 * goes through only when something actually changed.
 */
export default function EditTasksScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = Number(id);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { job, status, refetch } = useJobDetail(Number.isFinite(jobId) ? jobId : null);

  const [tasks, setTasks] = useState<TaskDraft[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meridiem = { am: t('post_sched_am'), pm: t('post_sched_pm') };
  const months = t('post_sched_months').split(',');
  const weekdays = t('post_sched_weekdays').split(',');

  // Seed from the server's milestones: ONE task per day, all its slot codes.
  useEffect(() => {
    if (!job) return;
    const milestones = [...(job.milestones ?? [])].sort((a, b) => a.sequence - b.sequence);
    const segments = parseScheduleSegments(job.description ?? '');
    const paired = segmentsForTasks(segments, Math.max(1, milestones.length));
    const seeded: TaskDraft[] = milestones.map((milestone, index) => {
      const dateKey = milestone.scheduled_date ?? (paired[index] ? '' : '');
      const codes =
        milestone.time_slots && milestone.time_slots.length > 0
          ? milestone.time_slots.map((slot) => slot.code)
          : paired[index]
          ? [
              `slot_${paired[index]!.startMinutes}_${paired[index]!.endMinutes}`,
            ]
          : [];
      const day = parseLocalDateKey(dateKey) ?? new Date();
      const primary = codes[0] ? { kind: 'slot' as const, key: codes[0] } : null;
      const hours = Math.max(1, Number.parseInt(String(milestone.expected_hours ?? '1'), 10) || 1);
      return {
        key: `${dateKey}#${codes[0] ?? 'none'}`,
        dayKey: dateKey,
        day,
        time: primary,
        hours,
        timeSlots: codes,
      };
    });
    setTasks(sortTasks(seeded));
  }, [job]);

  const editingTask = useMemo(
    () => (editingKey ? tasks.find((task) => task.key === editingKey) ?? null : null),
    [editingKey, tasks]
  );
  const editingIndex = useMemo(
    () => (editingKey ? tasks.findIndex((task) => task.key === editingKey) : -1),
    [editingKey, tasks]
  );

  const isOwner = !!job && !!user && Number(user.id) === job.client_id;

  const nextAvailableDay = useCallback((): Date | null => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let offset = 0; offset <= 6; offset += 1) {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      if (!tasks.some((task) => task.dayKey === key)) return day;
    }
    return null;
  }, [tasks]);

  const addDay = () => {
    const day = nextAvailableDay();
    if (!day) return;
    const fresh = buildTask(day);
    // A brand-new day starts with the first slot that is not already used.
    const firstSlot = fixedSlots()[0];
    const seeded = firstSlot
      ? applyTaskSlots([...tasks, fresh], fresh.key, [firstSlot.key], 1).tasks
      : sortTasks([...tasks, fresh]);
    setTasks(seeded);
    const added = seeded.find((task) => task.dayKey === fresh.dayKey);
    if (added) setEditingKey(added.key);
  };

  const removeTask = (key: string) => {
    if (tasks.length <= 1) return;
    setTasks((current) => current.filter((task) => task.key !== key));
  };

  const save = async () => {
    if (!job || saving) return;
    setSaving(true);
    setError(null);
    try {
      const milestones: JobMilestoneCreate[] = tasks
        .filter((task) => task.timeSlots.length > 0)
        .map((task) => ({
          date: task.dayKey,
          time_slots: task.timeSlots,
          expected_hours: Math.max(1, task.hours),
        }));
      if (milestones.length === 0) {
        setError(t('post_err_at_least_one_slot'));
        setSaving(false);
        return;
      }
      await authApi.updateJob(job.id, { milestones });
      await refetch();
      router.back();
    } catch (err: any) {
      setError(
        err?.response?.data?.detail
          ? String(err.response.data.detail)
          : t('jobd_edit_err_server')
      );
    } finally {
      setSaving(false);
    }
  };

  if (status === 'loading' && !job) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <BrandedLoader />
      </View>
    );
  }

  if (!job || !isOwner) {
    return (
      <View style={[styles.center, { backgroundColor: c.background, paddingTop: insets.top + 20 }]}>
        <Text style={[styles.empty, { color: c.mutedForeground }]}>{t('jobd_edit_tasks')}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />
        <Text style={[styles.title, { color: c.text }]}>{t('jobd_edit_tasks')}</Text>
        <TouchableOpacity
          onPress={save}
          disabled={saving}
          accessibilityRole="button"
          style={[styles.saveBtn, { backgroundColor: c.primary, opacity: saving ? 0.6 : 1 }]}
        >
          <Text style={[styles.saveText, { color: c.primaryForeground }]}>
            {saving ? '…' : t('action_save')}
          </Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={[styles.errorRow, { backgroundColor: c.destructive }]}>
          <Feather name="alert-circle" size={13} color={c.primaryForeground} />
          <Text style={[styles.errorText, { color: c.primaryForeground }]}>{error}</Text>
        </View>
      ) : null}

      <Text style={[styles.notice, { color: c.mutedForeground }]}>{t('post_task_time_hint')}</Text>

      {tasks.map((task, index) => {
        const labels = task.timeSlots
          .map((code) => formatWindowLabel({ kind: 'slot', key: code }, meridiem))
          .filter(Boolean)
          .join(', ');
        return (
          <View key={task.key} style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.cardHead}>
              <View style={[styles.badge, { backgroundColor: c.primary }]}>
                <Text style={[styles.badgeText, { color: c.primaryForeground }]}>{index + 1}</Text>
              </View>
              <View style={styles.cardBody}>
                <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={1}>
                  {t('post_task_n', { n: index + 1 })}
                </Text>
                <Text style={[styles.cardMeta, { color: c.mutedForeground }]} numberOfLines={2}>
                  {`${formatDayLabel(task.day, months, weekdays)} · ${labels || t('post_task_time_missing')}`}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setEditingKey(task.key)} hitSlop={8} accessibilityRole="button">
                <Feather name="edit-2" size={15} color={c.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => removeTask(task.key)}
                disabled={tasks.length <= 1}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Feather
                  name="trash-2"
                  size={15}
                  color={tasks.length <= 1 ? c.mutedForeground : c.destructive}
                />
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      <TouchableOpacity
        onPress={addDay}
        disabled={nextAvailableDay() === null}
        style={[styles.addDay, { borderColor: c.primary }]}
        accessibilityRole="button"
      >
        <Feather name="plus" size={14} color={c.primary} />
        <Text style={[styles.addDayText, { color: c.primary }]}>{t('post_tasks_back_to_dates')}</Text>
      </TouchableOpacity>

      <TaskEditSheet
        visible={editingTask !== null}
        onClose={() => setEditingKey(null)}
        task={editingTask}
        index={editingIndex < 0 ? 0 : editingIndex}
        onSave={(slots, hours) => {
          if (!editingTask) return;
          setTasks((current) => applyTaskSlots(current, editingTask.key, slots, hours).tasks);
          setEditingKey(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  title: { flex: 1, fontFamily: 'Manrope_700Bold', fontSize: 17 },
  saveBtn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  saveText: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, padding: 10, marginBottom: 8 },
  errorText: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 11 },
  notice: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16, marginBottom: 10 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
  cardMeta: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 15 },
  addDay: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 12, marginTop: 4 },
  addDayText: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
});
