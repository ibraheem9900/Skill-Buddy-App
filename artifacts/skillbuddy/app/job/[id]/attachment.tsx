import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useAppAlert } from '@/context/AlertModalContext';
import BackButton from '@/components/BackButton';
import BrandedLoader from '@/components/BrandedLoader';
import { useJobDetail } from '@/hooks/useJobDetail';
import { useAddJobAttachment } from '@/hooks/useAddJobAttachment';
import { classifyMediaType, hasUsableUrl } from '@/lib/serviceMedia';
import {
  attachmentFileFieldError,
  attachmentFailureMessage,
  attachmentAddedAfterResync,
  attachmentUploadName,
  canAddJobAttachment,
  classifyFileRejection,
  formatAttachmentSize,
  isAttachmentNotAllowed,
  isAttachmentUnauthorized,
  shouldResyncAfterAttachmentFailure,
  sortAttachments,
  validateAttachmentFile,
  type PickedAttachmentFile,
} from '@/lib/jobAttachment';

/**
 * Add Attachment — POST /api/v1/jobs/{job_id}/attachments (multipart/form-data, part
 * name `file`).
 *
 * REACHED from Job Details → its "Add Attachment" action, which any non-terminal job
 * offers (no role check: the contract never says whether the client or the provider may
 * attach, and the uploader's identity is derived server-side from the Bearer token).
 *
 * THE UPLOAD IS MULTIPART, NOT JSON — the picked file goes up as the `file` part exactly
 * the way this project's four other uploads do it, so React Native builds the multipart
 * header with its boundary. Nothing is JSON.stringify'd and no JSON content type is set.
 *
 * A FILE IS PICKED AND VALIDATED BEFORE ANY NETWORK CALL: type (image allow-list) and
 * size are checked locally, and a pick that fails never reaches the server. The selected
 * file is shown back to the user with its name and size, confirmed explicitly, and is
 * NEVER cleared by a failure — a retry re-uploads exactly the file that was chosen.
 *
 * WHILE UPLOADING: the button is disabled (no duplicate uploads) and the spinner is
 * joined by a real progress bar when the platform reports the total size, falling back to
 * plain "Uploading…" when it cannot. Nothing is ever appended to the attachments list
 * optimistically — the 201 IS the full job, so the whole cached job is replaced and the
 * list below re-renders from the server's own copy (with its own `position` ordering).
 *
 * WHAT THE SERVER DOES IS NOT GUESSED: the operation documents nothing beyond 201/422, so
 * no status change is assumed and no attachment shape is invented — the list renders the
 * spec's own `JobAttachmentResponse` (id, media_type, media_url|null, position,
 * created_at), which `JobResponse.attachments` already declares.
 */
export default function AddAttachmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const showAlert = useAppAlert();

  const numericId = /^\d+$/.test(id ?? '') ? Number(id) : null;

  const { status: jobStatus, job, serverMessage, retry, refetch, applyJob } =
    useJobDetail(numericId);
  const { addAttachment, uploading, progress } = useAddJobAttachment();

  const [file, setFile] = useState<PickedAttachmentFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);

  /* ------------------------------------------------------------------- picker */

  const pickFile = useCallback(async () => {
    if (uploading) return;
    setFormError(null);
    setRetryable(false);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setFileError(t('jobd_attach_err_permission'));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const picked: PickedAttachmentFile = {
        uri: asset.uri,
        fileName: asset.fileName ?? (asset.uri.split('/').pop() || null),
        mimeType: asset.mimeType ?? null,
        fileSize: asset.fileSize ?? null,
      };
      // Local guard first — an obviously unsupported or oversized pick never leaves the
      // device. The backend stays the final judge and its 422 is shown verbatim.
      const invalid = validateAttachmentFile(picked);
      if (invalid) {
        setFileError(t(invalid));
        return;
      }
      setFile(picked);
      setFileError(null);
    } catch {
      // The picker itself failed (permission prompt crash, gallery unavailable) — say so
      // instead of blaming the file type or silently doing nothing.
      setFileError(t('jobd_attach_err_pick'));
    }
  }, [uploading, t]);

  /* ------------------------------------------------------------------- upload */

  const doUpload = useCallback(async () => {
    if (numericId === null || !file) return;
    setFormError(null);
    setRetryable(false);

    const outcome = await addAttachment(numericId, file);

    if (outcome.ok) {
      // The whole job comes from the 201 — including the NEW attachments list with the
      // server's own ordering. Nothing is appended locally and no status change is
      // assumed.
      applyJob(outcome.job);
      showAlert({
        title: t('jobd_attach_success_title'),
        message: t('jobd_attach_success_msg'),
        icon: 'check-circle',
      });
      router.back();
      return;
    }

    if (outcome.kind === 'busy') return;
    if (isAttachmentUnauthorized(outcome.kind)) {
      router.replace('/(auth)/login' as any);
      return;
    }

    // A lost response is NOT a blind retry: adding an attachment is COUNTABLE, so re-read
    // the job and compare the list. If it now holds more entries than before, the file
    // landed — say so instead of asking the user to upload it twice.
    if (outcome.kind === 'network') {
      const refetched = await refetch();
      if (attachmentAddedAfterResync(job, refetched)) {
        if (refetched) applyJob(refetched);
        showAlert({
          title: t('jobd_attach_moved_title'),
          message: t('jobd_attach_moved_msg'),
          icon: 'info',
        });
        router.back();
        return;
      }
      setFormError(attachmentFailureMessage(outcome, t));
      setRetryable(true);
      return;
    }

    // A refusal means the state this screen gated on is stale — re-read.
    if (shouldResyncAfterAttachmentFailure(outcome.kind)) {
      void refetch();
    }

    // 422 about the FILE → point at the right local guard (type vs size) when the
    // server's message names one, otherwise show its own words against the file.
    if (outcome.kind === 'invalid') {
      const fieldMessage = attachmentFileFieldError(outcome.detail);
      if (fieldMessage) {
        const kind = classifyFileRejection(fieldMessage);
        setFileError(
          kind === 'type'
            ? t('jobd_attach_err_type')
            : kind === 'size'
              ? t('jobd_attach_err_size')
              : fieldMessage
        );
        setRetryable(true);
        return;
      }
    }

    if (isAttachmentNotAllowed(outcome.kind)) {
      setFormError(attachmentFailureMessage(outcome, t));
      setRetryable(false);
      return;
    }

    // 403 / 404 / 422 / 5xx — the backend's own message wins when it sent one.
    setFormError(attachmentFailureMessage(outcome, t));
    setRetryable(true);
  }, [numericId, file, job, addAttachment, applyJob, refetch, showAlert, t, router]);

  const submit = useCallback(() => {
    if (uploading) return;
    const invalid = validateAttachmentFile(file);
    if (invalid) {
      setFileError(t(invalid));
      return;
    }
    setFileError(null);
    setFormError(null);
    setRetryable(false);
    showAlert({
      title: t('jobd_attach_confirm_title'),
      message: t('jobd_attach_confirm_msg', { name: attachmentUploadName(file as PickedAttachmentFile) }),
      icon: 'upload-cloud',
      buttons: [
        { text: t('jobd_attach_confirm_cta'), onPress: () => void doUpload() },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [uploading, file, showAlert, t, doUpload]);

  /* ------------------------------------------------------------------ states */

  const header = (title: string) => (
    <View style={styles.header}>
      <BackButton />
      <Text style={[styles.headerTitle, { color: c.text }]}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );

  if (numericId === null || jobStatus === 'idle' || jobStatus === 'loading') {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <BrandedLoader size={44} />
      </View>
    );
  }

  if (jobStatus !== 'ready' || !job) {
    const unavailable = jobStatus === 'notfound' || jobStatus === 'forbidden';
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        {header(t('jobd_attach_screen_title'))}
        <View style={styles.stateWrap}>
          <Feather name={unavailable ? 'slash' : 'alert-circle'} size={28} color={c.destructive} />
          <Text style={[styles.stateTitle, { color: c.text }]}>
            {unavailable ? t('jobd_unavailable_title') : t('jobd_load_error')}
          </Text>
          <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
            {unavailable ? serverMessage ?? t('jobd_unavailable_msg') : t('jobd_load_error_sub')}
          </Text>
          <TouchableOpacity style={[styles.stateBtn, { backgroundColor: c.primary }]} onPress={retry}>
            <Text style={[styles.stateBtnText, { color: c.primaryForeground }]}>{t('jobs_retry')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // A cancelled or completed job takes no new attachments client-side (the contract never
  // says which statuses accept one, so only the terminal states are ruled out here and
  // everything else is left to the backend to accept or refuse).
  if (!canAddJobAttachment(job)) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        {header(t('jobd_attach_screen_title'))}
        <View style={styles.stateWrap}>
          <Feather name="lock" size={28} color={c.destructive} />
          <Text style={[styles.stateTitle, { color: c.text }]}>{t('jobd_attach_blocked_title')}</Text>
          <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
            {t('jobd_attach_blocked_msg')}
          </Text>
          <TouchableOpacity
            style={[styles.stateBtn, { backgroundColor: c.primary }]}
            onPress={() => router.back()}
          >
            <Text style={[styles.stateBtnText, { color: c.primaryForeground }]}>
              {t('jobd_back_to_jobs')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  /* -------------------------------------------------------------------- form */

  const existing = sortAttachments(job.attachments);
  const selectedSize = formatAttachmentSize(file?.fileSize ?? null);
  const showProgressBar = uploading && progress !== null;

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      {header(t('jobd_attach_screen_title'))}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={24}
      >
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <View style={[styles.warnCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="upload-cloud" size={16} color={c.primary} />
            <Text style={[styles.warnText, { color: c.mutedForeground }]}>
              {t('jobd_attach_warning')}
            </Text>
          </View>

          {/* What is already on the job — read straight from the server's own list, in
              the same position order the Job Details screen uses. */}
          <Text style={[styles.label, { color: c.text }]}>{t('jobd_attach_existing')}</Text>
          {existing.length === 0 ? (
            <Text style={[styles.hint, { color: c.mutedForeground }]}>{t('jobd_attach_none_yet')}</Text>
          ) : (
            existing.map((a) => (
              <View
                key={a.id}
                style={[styles.existingRow, { backgroundColor: c.card, borderColor: c.border }]}
              >
                {hasUsableUrl(a.media_url) && classifyMediaType(a.media_type) === 'image' ? (
                  <Image
                    source={{ uri: a.media_url as string }}
                    style={styles.existingThumb}
                    contentFit="cover"
                    transition={150}
                  />
                ) : (
                  <View style={[styles.existingThumb, styles.existingThumbFallback, { borderColor: c.border }]}>
                    <Feather name="paperclip" size={14} color={c.mutedForeground} />
                  </View>
                )}
                <Text style={[styles.bodyLine, { color: c.text, flex: 1 }]} numberOfLines={1}>
                  {a.media_url ?? a.media_type}
                </Text>
              </View>
            ))
          )}

          {/* The picker. Nothing is uploaded by picking — the file is shown and confirmed
              first, and the picked file is never cleared by a failed upload. */}
          <TouchableOpacity
            style={[styles.pickBtn, { borderColor: c.primary }]}
            onPress={() => void pickFile()}
            disabled={uploading}
            activeOpacity={0.85}
          >
            <Feather name={file ? 'refresh-cw' : 'image'} size={15} color={c.primary} />
            <Text style={[styles.pickText, { color: c.primary }]}>
              {file ? t('jobd_attach_repick') : t('jobd_attach_pick')}
            </Text>
          </TouchableOpacity>

          {file ? (
            <View style={[styles.selectedCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Feather name="file" size={15} color={c.text} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.bodyLine, { color: c.text }]} numberOfLines={1}>
                  {attachmentUploadName(file)}
                </Text>
                {selectedSize ? (
                  <Text style={[styles.hint, { color: c.mutedForeground }]}>{selectedSize}</Text>
                ) : null}
              </View>
            </View>
          ) : null}

          <Text style={[styles.hint, { color: fileError ? c.destructive : c.mutedForeground }]}>
            {fileError ?? t('jobd_attach_hint')}
          </Text>

          {formError ? (
            <View style={[styles.errorBox, { borderColor: c.destructive }]}>
              <Feather name="alert-circle" size={16} color={c.destructive} />
              <Text style={[styles.errorText, { color: c.destructive }]}>{formError}</Text>
            </View>
          ) : null}

          {showProgressBar ? (
            <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: c.primary, width: `${Math.round((progress ?? 0) * 100)}%` },
                ]}
              />
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.submit, { backgroundColor: c.primary }, uploading && styles.submitBusy]}
            onPress={submit}
            disabled={uploading}
            activeOpacity={0.85}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={c.primaryForeground} />
            ) : (
              <Feather name="upload-cloud" size={15} color={c.primaryForeground} />
            )}
            <Text style={[styles.submitText, { color: c.primaryForeground }]}>
              {uploading
                ? progress !== null
                  ? t('jobd_attach_progress', { percent: Math.round(progress * 100) })
                  : t('jobd_attach_busy')
                : t('jobd_attach_submit')}
            </Text>
          </TouchableOpacity>

          {retryable && !uploading && file ? (
            <TouchableOpacity
              style={[styles.retry, { borderColor: c.border }]}
              onPress={() => void doUpload()}
              activeOpacity={0.85}
            >
              <Feather name="refresh-cw" size={15} color={c.text} />
              <Text style={[styles.retryText, { color: c.text }]}>{t('jobs_retry')}</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 17, flex: 1, textAlign: 'center' },
  form: { padding: 16, paddingBottom: 40, gap: 4 },
  warnCard: {
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  warnText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19 },
  label: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginTop: 12, marginBottom: 8 },
  bodyLine: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 4 },
  existingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
    marginBottom: 6,
  },
  existingThumb: { width: 36, height: 36, borderRadius: 8 },
  existingThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: 14,
  },
  pickText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  errorBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 16,
  },
  errorText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 20,
  },
  progressFill: { height: 6, borderRadius: 3 },
  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 20,
  },
  submitBusy: { opacity: 0.7 },
  submitText: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: 12,
  },
  retryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  stateTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16, textAlign: 'center' },
  stateSub: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  stateBtn: { marginTop: 8, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22 },
  stateBtnText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
});
