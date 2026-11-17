import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { useRole } from '@/context/RoleContext';
import { useAppAlert } from '@/context/AlertModalContext';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import BackButton from '@/components/BackButton';
import DotsLoader from '@/components/DotsLoader';
import MediaViewer, { type MediaViewerItem } from '@/components/MediaViewer';
import TaskFeedbackCard from '@/components/TaskFeedbackCard';
import { useFeedbackOptionLabels } from '@/hooks/useFeedbackOptionLabels';
import { useTaskFeedback } from '@/hooks/useTaskFeedback';
import { useDisputeAttachmentRemoval } from '@/hooks/useDisputeAttachmentRemoval';
import { POPUP_FADE_IN_MS, POPUP_FADE_OUT_MS } from '@/lib/motion';
import type { FeedbackFailureKind } from '@/lib/feedback';
import type { DisputeAttachment, DisputeRemoveFailure } from '@/lib/disputeImages';
import { authorLabelKind, type FeedbackSide, type TaskFeedback } from '@/lib/taskFeedback';

/**
 * Task feedback history — GET /api/v1/jobs/{job_id}/milestones/{milestone_id}/feedback
 * ("List Milestone Feedback": every denial/dispute on one Task).
 *
 * Reached from the Task cards on Job Details (a subtle "Feedback" link with a
 * count badge when the Task already has entries). Route:
 *   /job/{id}/task-feedback?milestoneId={id}&task={n}&role=CLIENT|PROVIDER
 *
 * The viewer's side comes from the JOB (owner vs assigned pilot) so the author
 * labels ("You" / "Client" / "Pilot") stay correct even when the role switch is
 * on the other mode; a direct open falls back to the active role.
 *
 * TODO(feedback-submit): once the denial/dispute submit API is wired, call
 * invalidateTaskFeedback(jobId, milestoneId) after a successful submit and
 * refetch this list (or navigate here) so the new entry shows immediately.
 */

const REMOVE_FAILURE_KEY: Record<DisputeRemoveFailure, TranslationKey> = {
  offline: 'fb_remove_err_offline',
  unauthorized: 'fb_remove_err_unauthorized',
  forbidden: 'fb_remove_err_forbidden',
  gone: 'fb_remove_gone_toast',
  invalid: 'fb_remove_err_invalid',
  conflict: 'fb_remove_err_conflict',
  server: 'fb_remove_err_server',
  unknown: 'fb_remove_err_unknown',
};

const FAILURE_KEY: Record<FeedbackFailureKind, TranslationKey> = {
  unauthorized: 'fb_err_unauthorized',
  validation: 'fb_err_generic',
  network: 'fb_err_network',
  forbidden: 'fb_err_generic',
  notfound: 'fb_err_generic',
  server: 'fb_err_server',
  unknown: 'fb_err_generic',
};

function toId(value: string | undefined): number | null {
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

export default function TaskFeedbackScreen() {
  const { id, milestoneId, task, role } = useLocalSearchParams<{
    id?: string;
    milestoneId?: string;
    task?: string;
    role?: string;
  }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { activeRole } = useRole();

  const jobId = toId(id);
  const taskId = toId(milestoneId);
  const taskNumber = toId(task);
  const viewerSide: FeedbackSide =
    role === 'CLIENT' || role === 'PROVIDER' ? role : activeRole;

  const { items, status, failure, refreshing, refetch } = useTaskFeedback(jobId, taskId);
  const { labels } = useFeedbackOptionLabels();

  const showAlert = useAppAlert();

  // The viewer keeps the feedback entry it belongs to, so the header's trash
  // action knows WHOSE photo it is and which attachment id to delete.
  const [viewer, setViewer] = useState<{
    item: TaskFeedback;
    attachments: DisputeAttachment[];
    index: number;
  } | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  const showToast = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    setToast({ text, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  const openImages = useCallback(
    (item: TaskFeedback, attachments: DisputeAttachment[], index: number) => {
      setViewer({ item, attachments, index });
    },
    []
  );

  const viewerRemoval = useDisputeAttachmentRemoval(viewer?.item.id ?? null);
  const viewerAttachment = viewer ? viewer.attachments[viewer.index] ?? null : null;
  const viewerEntry =
    viewerAttachment?.id != null ? viewerRemoval.stateOf(viewerAttachment.id) : undefined;
  // Only the author may delete, and only when the item carried a numeric id.
  const viewerCanDelete =
    !!viewer &&
    !!viewerAttachment &&
    viewerAttachment.id !== null &&
    authorLabelKind(viewer.item.author_side, viewerSide) === 'you';

  const handleRemovalResult = useCallback(
    (result: 'removed' | 'gone' | 'failed', failure?: DisputeRemoveFailure) => {
      if (result === 'failed') {
        showToast(t(REMOVE_FAILURE_KEY[failure ?? 'unknown']), 'error');
        return;
      }
      void refetch('refresh');
      showToast(t(result === 'gone' ? 'fb_remove_gone_toast' : 'fb_remove_toast'));
    },
    [refetch, showToast, t]
  );

  const finishViewerRemoval = useCallback(
    (result: 'removed' | 'gone' | 'failed', failure?: DisputeRemoveFailure) => {
      const current = viewer;
      const attachment = viewerAttachment;
      if (!current || !attachment) return;
      if (result === 'failed') {
        showToast(t(REMOVE_FAILURE_KEY[failure ?? 'unknown']), 'error');
        return;
      }
      // 204 (or 404 = already gone): drop it from the viewer's own copy after
      // the server agreed, then move to the next photo or close.
      const remaining = current.attachments.filter((entry) => entry.url !== attachment.url);
      void refetch('refresh');
      showToast(t(result === 'gone' ? 'fb_remove_gone_toast' : 'fb_remove_toast'));
      if (remaining.length === 0) {
        setViewer(null);
        return;
      }
      setViewer({
        item: current.item,
        attachments: remaining,
        index: Math.min(current.index, remaining.length - 1),
      });
    },
    [refetch, showToast, t, viewer, viewerAttachment]
  );

  const confirmViewerRemoval = useCallback(() => {
    const attachment = viewerAttachment;
    if (!attachment || attachment.id === null) return;
    showAlert({
      title: t('fb_remove_title'),
      message: t('fb_remove_msg'),
      icon: 'trash-2',
      buttons: [
        {
          text: t('fb_remove_cta'),
          style: 'destructive',
          onPress: () => {
            void viewerRemoval.remove(attachment.id as number).then((result) => {
              if (result.status === 'ok') finishViewerRemoval('removed');
              else if (result.status === 'gone') finishViewerRemoval('gone');
              else if (result.status === 'failed') finishViewerRemoval('failed', result.failure);
            });
          },
        },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [finishViewerRemoval, showAlert, t, viewerAttachment, viewerRemoval]);

  const header = (
    <View style={[styles.header, { backgroundColor: c.headerBg, paddingTop: insets.top + 10 }]}>
      <StatusBar style="light" />
      <View style={styles.headerRow}>
        <BackButton />
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={2}>
            {t('fb_task_feedback_title')}
          </Text>
          {taskNumber !== null ? (
            <Text style={styles.headerSub} numberOfLines={1}>
              {t('jobd_milestone_n', { n: taskNumber })}
            </Text>
          ) : null}
        </View>
        <View style={styles.headerSpacer} />
      </View>
    </View>
  );

  const body = useMemo(() => {
    if (jobId === null || taskId === null) {
      return null;
    }
    if (status === 'idle' || status === 'loading') {
      return (
        <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <DotsLoader color={c.primary} />
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>
            {t('fb_task_feedback_loading')}
          </Text>
        </View>
      );
    }
    if (status === 'notavailable') {
      return (
        <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="lock" size={24} color={c.mutedForeground} />
          <Text style={[styles.stateTitle, { color: c.text }]}>
            {t('fb_task_feedback_unavailable_title')}
          </Text>
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>
            {t('fb_task_feedback_unavailable_msg')}
          </Text>
          <TouchableOpacity
            style={[styles.stateBtn, { backgroundColor: c.primary }]}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <Text style={[styles.stateBtnText, { color: c.primaryForeground }]}>
              {t('fb_back')}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (status === 'error') {
      return (
        <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="alert-circle" size={24} color={c.destructive} />
          <Text style={[styles.stateTitle, { color: c.text }]}>
            {t('fb_task_feedback_error_title')}
          </Text>
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>
            {t(FAILURE_KEY[failure ?? 'unknown'])}
          </Text>
          <TouchableOpacity
            style={[styles.stateBtn, { backgroundColor: c.primary }]}
            onPress={() => void refetch('retry')}
            activeOpacity={0.85}
          >
            <Text style={[styles.stateBtnText, { color: c.primaryForeground }]}>
              {t('fb_try_again')}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (items.length === 0) {
      return (
        <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="inbox" size={24} color={c.mutedForeground} />
          <Text style={[styles.stateTitle, { color: c.text }]}>
            {t('fb_task_feedback_empty_title')}
          </Text>
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>
            {t('fb_task_feedback_empty_msg')}
          </Text>
        </View>
      );
    }
    return (
      <>
        <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
          {t('fb_task_feedback_sub')}
        </Text>
        <View style={styles.list}>
          {items.map((item) => (
            <TaskFeedbackCard
              key={item.id}
              item={item}
              viewerSide={viewerSide}
              optionLookup={labels}
              onOpenImages={openImages}
              onUploaded={() => void refetch('refresh')}
              onRemovalResult={handleRemovalResult}
            />
          ))}
        </View>
      </>
    );
  }, [
    c,
    failure,
    handleRemovalResult,
    items,
    jobId,
    labels,
    openImages,
    refetch,
    router,
    status,
    t,
    taskId,
    viewerSide,
  ]);

  if (jobId === null || taskId === null) {
    return (
      <View style={[styles.root, { backgroundColor: c.background }]}>
        {header}
        <View style={styles.stateWrap}>
          <Feather name="slash" size={28} color={c.mutedForeground} />
          <Text style={[styles.stateTitle, { color: c.text }]}>{t('fb_notfound_title')}</Text>
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>
            {t('fb_notfound_msg')}
          </Text>
          <TouchableOpacity
            style={[styles.stateBtn, { backgroundColor: c.primary }]}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <Text style={[styles.stateBtnText, { color: c.primaryForeground }]}>
              {t('fb_back')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {header}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refetch('refresh')}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      >
        {body}
      </ScrollView>

      <MediaViewer
        visible={viewer !== null}
        items={(viewer?.attachments ?? []).map((attachment) => ({
          uri: attachment.url,
          title: '',
          kind: 'image' as const,
        }))}
        initialIndex={viewer?.index ?? 0}
        onClose={() => setViewer(null)}
        onDelete={viewerCanDelete ? confirmViewerRemoval : undefined}
        deleteLabel={t('fb_remove_cta')}
        deleting={viewerEntry?.state === 'removing'}
      />

      {toast ? (
        <Animated.View
          pointerEvents="none"
          entering={FadeIn.duration(POPUP_FADE_IN_MS)}
          exiting={FadeOut.duration(POPUP_FADE_OUT_MS)}
          style={[
            styles.toast,
            {
              backgroundColor: c.card,
              borderColor: toast.tone === 'error' ? c.destructive : c.primary,
              bottom: insets.bottom + 16,
            },
          ]}
        >
          <Feather
            name={toast.tone === 'error' ? 'alert-circle' : 'check-circle'}
            size={14}
            color={toast.tone === 'error' ? c.destructive : c.primary}
          />
          <Text style={[styles.toastText, { color: c.text }]} numberOfLines={2}>
            {toast.text}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerText: { flex: 1, alignItems: 'center' },
  headerTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  headerSub: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 12,
    color: '#FFFFFF',
    opacity: 0.8,
    marginTop: 2,
  },
  headerSpacer: { width: 40 },
  content: { padding: 20, gap: 14 },
  subtitle: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19 },
  list: { gap: 12 },
  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  stateCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  stateTitle: { fontFamily: 'Manrope_700Bold', fontSize: 15, textAlign: 'center' },
  stateText: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  stateBtn: { marginTop: 6, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 20 },
  stateBtnText: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  toastText: { fontFamily: 'Manrope_500Medium', fontSize: 12, flex: 1 },
});
