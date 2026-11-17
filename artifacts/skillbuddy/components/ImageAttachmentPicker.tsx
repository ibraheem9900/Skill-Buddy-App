import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { POPUP_FADE_IN_MS, POPUP_FADE_OUT_MS } from '@/lib/motion';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { useAppAlert } from '@/context/AlertModalContext';
import MediaViewer, { type MediaViewerItem } from '@/components/MediaViewer';
import DotsLoader from '@/components/DotsLoader';
import {
  ATTACHMENT_JPEG_QUALITY,
  buildAttachmentImageName,
  imageMime,
  resizeImageDimensions,
  resolveImageFormat,
  selectNewAttachmentUris,
  type AttachmentImage,
  type AttachmentImageFormat,
  type ImageAttachmentRemoval,
  type ImageRemoveFailure,
  type ImageUploadFailure,
} from '@/lib/imageAttachments';
import type {
  AttachmentImageFile,
  ImageAttachmentUploader,
} from '@/hooks/useImageAttachmentUploader';

/**
 * Shared photo picker/uploader grid for dispute photos and review photos.
 *
 * The queue itself lives in useImageAttachmentUploader and the DELETE state
 * machine in useAttachmentRemoval — this component only picks and prepares
 * files, then renders what those report, so the exact same widget serves a
 * dispute form, a Task feedback history item, the review form and "My review".
 *
 * REMOVAL. Two different things can be removed here:
 *   • a LOCAL photo (picked, maybe still uploading): dropped from the queue
 *     instantly, no request and no confirmation;
 *   • an UPLOADED photo: only when the owner passes `removal` (screens do that
 *     for the row's own author only, so the other side stays view-only). It is
 *     confirmed in a fade-in popup, non-optimistic, and shows a per-photo loader.
 *
 * Types: the API accepts JPG/PNG/WebP only. iOS HEIC/HEIF (and anything else the
 * picker marks as "Compatible") is converted to JPEG before it ever reaches the
 * server; a format that cannot be converted is refused with a friendly message.
 * No file-size limit is documented, so none is enforced — photos are only
 * resized to 1600px and re-encoded at quality 0.8 to keep uploads quick.
 */

const UPLOAD_FAILURE_KEY: Record<ImageUploadFailure, TranslationKey> = {
  offline: 'fb_img_offline',
  unauthorized: 'fb_img_unauthorized',
  notallowed: 'fb_img_notallowed',
  'too-large': 'fb_img_too_large',
  invalid: 'fb_img_invalid',
  server: 'fb_img_server',
  unknown: 'fb_img_unknown',
};

const REMOVE_FAILURE_KEY: Record<ImageRemoveFailure, TranslationKey> = {
  offline: 'fb_remove_err_offline',
  unauthorized: 'fb_remove_err_unauthorized',
  forbidden: 'fb_remove_err_forbidden',
  gone: 'fb_remove_gone_toast',
  invalid: 'fb_remove_err_invalid',
  conflict: 'fb_remove_err_conflict',
  server: 'fb_remove_err_server',
  unknown: 'fb_remove_err_unknown',
};

const SAVE_FORMAT: Record<AttachmentImageFormat, ImageManipulator.SaveFormat> = {
  jpeg: ImageManipulator.SaveFormat.JPEG,
  png: ImageManipulator.SaveFormat.PNG,
  webp: ImageManipulator.SaveFormat.WEBP,
};

type Prepared =
  | { ok: true; file: AttachmentImageFile }
  | { ok: false; reason: 'type' | 'convert' };

async function prepareImage(
  asset: ImagePicker.ImagePickerAsset,
  prefix: string,
  stamp: number,
  index: number
): Promise<Prepared> {
  const info = resolveImageFormat(asset.mimeType, asset.fileName);
  if (!info) return { ok: false, reason: 'type' };

  const resize =
    asset.width && asset.height ? resizeImageDimensions(asset.width, asset.height) : null;

  let uri = asset.uri;
  if (info.convert || resize) {
    try {
      const result = await ImageManipulator.manipulateAsync(
        asset.uri,
        resize ? [{ resize }] : [],
        {
          // Re-encoding a HEIC must produce JPEG; PNG/WebP keep their own format
          // so transparency survives the resize.
          format: SAVE_FORMAT[info.format],
          compress: info.format === 'png' ? 1 : ATTACHMENT_JPEG_QUALITY,
        }
      );
      uri = result.uri;
    } catch {
      return { ok: false, reason: 'convert' };
    }
  }

  return {
    ok: true,
    file: {
      uri,
      name: buildAttachmentImageName(prefix, stamp, index, info.format),
      mimeType: imageMime(info.format),
    },
  };
}

interface Props {
  uploader: ImageAttachmentUploader;
  /** Attachments the server already holds for this row (counts toward 5). */
  existingCount: number;
  /** Direct label override (already translated). */
  label?: string;
  /** Translation key used for the label and alert titles. */
  labelKey?: TranslationKey;
  addKey?: TranslationKey;
  hintKey?: TranslationKey;
  pendingNoteKey?: TranslationKey;
  failedNoteKey?: TranslationKey;
  /** Non-translated prefix for generated file names. */
  namePrefix?: string;
  /** Helper line under the grid; hidden in compact cards. */
  showHint?: boolean;
  /**
   * Photos the server already holds. Rendering them in the SAME grid keeps the
   * counter and the remove buttons in one place; omitted where another
   * component (e.g. ReviewCard) already renders the server photos.
   */
  uploaded?: readonly AttachmentImage[];
  /**
   * Removal state + actions for UPLOADED photos. Passing it is what makes them
   * removable — screens only pass it for the row's own author, so the other side
   * stays read-only.
   */
  removal?: ImageAttachmentRemoval;
  /** Opens the full-screen viewer on an uploaded photo (owner supplies this). */
  onOpenAttachment?: (index: number) => void;
  /** Lets the owner show its toast / alert after a removal attempt. */
  onRemovalResult?: (result: 'removed' | 'gone' | 'failed', failure?: ImageRemoveFailure) => void;
  /**
   * Whether photos may be added. The other side of a row passes `false`: it sees
   * the photos but never an add tile (and never the limit notice). The review
   * success view passes `false` while local uploads still finish.
   */
  canAdd?: boolean;
  /** Confirmation copy; defaults to the dispute wording. */
  removeTitleKey?: TranslationKey;
  removeMsgKey?: TranslationKey;
}

/** Which set the full-screen viewer is paging through. */
type ViewerState = { source: 'local' | 'uploaded'; index: number };

export default function ImageAttachmentPicker({
  uploader,
  existingCount,
  label,
  labelKey = 'fb_images_label',
  addKey = 'fb_images_add',
  hintKey = 'fb_images_hint',
  pendingNoteKey = 'fb_img_pending_note',
  failedNoteKey = 'fb_img_failed_note',
  namePrefix = 'image',
  showHint = true,
  uploaded,
  removal,
  onOpenAttachment,
  onRemovalResult,
  canAdd = true,
  removeTitleKey = 'fb_remove_title',
  removeMsgKey = 'fb_remove_msg',
}: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const showAlert = useAppAlert();
  const [picking, setPicking] = useState(false);
  const [viewer, setViewer] = useState<ViewerState | null>(null);

  const labelText = label ?? t(labelKey);
  const serverCount = uploaded ? uploaded.length : existingCount;
  const total = serverCount + uploader.images.length;

  const localViewerItems = useMemo<MediaViewerItem[]>(
    () => uploader.images.map((image) => ({ uri: image.uri, title: '', kind: 'image' as const })),
    [uploader.images]
  );
  const uploadedViewerItems = useMemo<MediaViewerItem[]>(
    () => (uploaded ?? []).map((item) => ({ uri: item.url, title: '', kind: 'image' as const })),
    [uploaded]
  );
  const uploadedIds = useMemo<Array<number | null>>(
    () => (uploaded ?? []).map((item) => item.id),
    [uploaded]
  );

  const viewerItems = viewer?.source === 'uploaded' ? uploadedViewerItems : localViewerItems;
  const viewerCount = viewerItems.length;

  /**
   * Keep the viewer honest while the list shrinks underneath it: after removing
   * the photo on screen, page to the next one, and close when none are left.
   */
  useEffect(() => {
    if (!viewer) return;
    if (viewerCount === 0) {
      setViewer(null);
      return;
    }
    if (viewer.index > viewerCount - 1) {
      setViewer({ source: viewer.source, index: viewerCount - 1 });
    }
  }, [viewer, viewerCount]);

  const runRemoval = useCallback(
    async (attachmentId: number) => {
      if (!removal) return;
      const result = await removal.remove(attachmentId);
      if (result.status === 'ok') onRemovalResult?.('removed');
      else if (result.status === 'gone') onRemovalResult?.('gone');
      else if (result.status === 'failed') onRemovalResult?.('failed', result.failure);
    },
    [onRemovalResult, removal]
  );

  const confirmRemoval = useCallback(
    (attachmentId: number) => {
      if (!removal) return;
      showAlert({
        title: t(removeTitleKey),
        message: t(removeMsgKey),
        icon: 'trash-2',
        buttons: [
          {
            text: t('fb_remove_cta'),
            style: 'destructive',
            onPress: () => void runRemoval(attachmentId),
          },
          { text: t('action_cancel'), style: 'cancel' },
        ],
      });
    },
    [removeMsgKey, removeTitleKey, removal, runRemoval, showAlert, t]
  );

  const removeFailure = (uploaded ?? []).reduce<ImageRemoveFailure | null>((found, item) => {
    if (found || item.id == null || !removal) return found;
    const entry = removal.stateOf(item.id);
    return entry?.state === 'failed' ? entry.failure : found;
  }, null);

  const openSettings = useCallback(() => {
    void Linking.openSettings().catch(() => {});
  }, []);

  const askPermission = useCallback(
    async (kind: 'camera' | 'library') => {
      const permission =
        kind === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.granted) return true;
      showAlert({
        title: t('fb_img_permission_title'),
        message: t(kind === 'camera' ? 'fb_img_camera_denied' : 'fb_img_library_denied'),
        icon: 'lock',
        buttons: permission.canAskAgain
          ? [{ text: t('fb_img_ok') }]
          : [
              { text: t('fb_img_open_settings'), onPress: openSettings },
              { text: t('action_cancel'), style: 'cancel' },
            ],
      });
      return false;
    },
    [openSettings, showAlert, t]
  );

  const prepareAll = useCallback(
    async (assets: readonly ImagePicker.ImagePickerAsset[]) => {
      const stamp = Date.now();
      const prepared: AttachmentImageFile[] = [];
      let typeErrors = 0;
      let convertErrors = 0;
      for (let index = 0; index < assets.length; index += 1) {
        const result = await prepareImage(assets[index], namePrefix, stamp, index);
        if (result.ok) prepared.push(result.file);
        else if (result.reason === 'type') typeErrors += 1;
        else convertErrors += 1;
      }
      if (typeErrors > 0) {
        showAlert({
          title: labelText,
          message: t('fb_img_type_error'),
          icon: 'alert-triangle',
        });
      }
      if (convertErrors > 0) {
        showAlert({
          title: labelText,
          message: t('fb_img_convert_error'),
          icon: 'alert-triangle',
        });
      }
      if (prepared.length > 0) uploader.addImages(prepared);
    },
    [labelText, namePrefix, showAlert, t, uploader]
  );

  const accept = useCallback(
    async (picked: readonly ImagePicker.ImagePickerAsset[]) => {
      const slots = uploader.remaining;
      const { accepted, overflow, duplicates } = selectNewAttachmentUris(
        uploader.images.map((image) => image.uri),
        picked.map((asset) => asset.uri),
        slots
      );
      if (overflow > 0) {
        showAlert({
          title: labelText,
          message: t('fb_img_overflow', { n: slots }),
          icon: 'info',
        });
      } else if (duplicates > 0) {
        showAlert({
          title: labelText,
          message: t('fb_img_duplicate'),
          icon: 'info',
        });
      }
      if (accepted.length === 0) return;
      const byUri = new Map(picked.map((asset) => [asset.uri, asset]));
      const chosen = accepted
        .map((uri) => byUri.get(uri))
        .filter((asset): asset is ImagePicker.ImagePickerAsset => !!asset);
      await prepareAll(chosen);
    },
    [labelText, prepareAll, showAlert, t, uploader.images, uploader.remaining]
  );

  const launch = useCallback(
    async (source: 'camera' | 'gallery') => {
      if (picking) return;
      if (uploader.remaining <= 0) return;
      setPicking(true);
      try {
        const allowed = await askPermission(source === 'camera' ? 'camera' : 'library');
        if (!allowed) return;

        // `quality: 1` keeps the picker from double-compressing: preparation
        // does the one resample/encode pass itself.
        const base: ImagePicker.ImagePickerOptions = {
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          // iOS: hand us a JPEG rather than an unconvertible HEIC when possible.
          preferredAssetRepresentationMode:
            ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
          quality: 1,
          exif: false,
        };

        const result =
          source === 'camera'
            ? await ImagePicker.launchCameraAsync({ ...base, allowsEditing: false })
            : await ImagePicker.launchImageLibraryAsync({
                ...base,
                allowsMultipleSelection: true,
                selectionLimit: Math.max(1, uploader.remaining),
              });

        if (result.canceled || result.assets.length === 0) return;
        await accept(result.assets);
      } catch {
        showAlert({
          title: labelText,
          message: t('fb_images_error'),
          icon: 'alert-triangle',
        });
      } finally {
        setPicking(false);
      }
    },
    [accept, askPermission, labelText, picking, showAlert, t, uploader.remaining]
  );

  const openSourceSheet = useCallback(() => {
    if (uploader.atLimit) return;
    showAlert({
      title: labelText,
      message: t('fb_img_source_msg'),
      icon: 'image',
      buttons: [
        { text: t('fb_img_take'), onPress: () => void launch('camera') },
        { text: t('fb_img_gallery'), onPress: () => void launch('gallery') },
        { text: t('action_cancel'), style: 'cancel' },
      ],
    });
  }, [labelText, launch, showAlert, t, uploader.atLimit]);

  /* Full-screen viewer: the author's own uploaded photo gets a trash action. */
  const viewerUploaded = viewer?.source === 'uploaded';
  const viewerAttachmentId =
    viewerUploaded && viewer ? uploadedIds[viewer.index] ?? null : null;
  const viewerDeleting =
    viewerAttachmentId != null && removal
      ? removal.stateOf(viewerAttachmentId)?.state === 'removing'
      : false;

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={[styles.label, { color: c.text }]} numberOfLines={1}>
          {labelText}
        </Text>
        <Text style={[styles.count, { color: c.mutedForeground }]}>
          {t('fb_images_count', { n: total, max: uploader.limit })}
        </Text>
      </View>

      <View style={styles.grid}>
        {/* Photos already on the server: same tiles, with the owner's trash
            action. Nothing is optimistic — the tile stays until a 204. */}
        {(uploaded ?? []).map((attachment, index) => {
          const entry = attachment.id != null ? removal?.stateOf(attachment.id) : undefined;
          const removing = entry?.state === 'removing';
          const failed = entry?.state === 'failed';
          return (
            <Animated.View
              key={`uploaded-${attachment.id ?? attachment.url}`}
              entering={FadeIn.duration(POPUP_FADE_IN_MS)}
              exiting={FadeOut.duration(POPUP_FADE_OUT_MS)}
              style={styles.tile}
            >
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                  if (onOpenAttachment) onOpenAttachment(index);
                  else setViewer({ source: 'uploaded', index });
                }}
                accessibilityRole="imagebutton"
                accessibilityLabel={labelText}
              >
                <Image source={{ uri: attachment.url }} style={styles.thumb} resizeMode="cover" />
              </TouchableOpacity>

              {removing ? (
                <View style={[styles.overlay, { backgroundColor: c.overlay }]}>
                  <DotsLoader color="#FFFFFF" size={6} gap={4} />
                </View>
              ) : null}

              {failed ? (
                <View style={[styles.overlay, { backgroundColor: c.overlay }]}>
                  <Feather name="alert-circle" size={18} color={c.destructive} />
                  <TouchableOpacity
                    style={[styles.retryBtn, { borderColor: '#FFFFFF' }]}
                    onPress={() => void runRemoval(attachment.id!)}
                    activeOpacity={0.85}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Feather name="refresh-cw" size={11} color="#FFFFFF" />
                    <Text style={styles.retryText}>{t('fb_img_retry')}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {removal && attachment.id != null && !removing ? (
                <TouchableOpacity
                  style={[styles.removeBtn, { backgroundColor: c.destructive }]}
                  onPress={() => confirmRemoval(attachment.id!)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('fb_remove_cta')}
                >
                  <Feather name="trash-2" size={11} color={c.destructiveForeground} />
                </TouchableOpacity>
              ) : null}
            </Animated.View>
          );
        })}

        {/* Local queue: progress, failures, and an instant remove (no request,
            no confirmation — the photo never reached the server). */}
        {uploader.images.map((image, index) => {
          const failed = image.status === 'failed';
          const uploading = image.status === 'uploading';
          return (
            <Animated.View
              key={image.key}
              entering={FadeIn.duration(POPUP_FADE_IN_MS)}
              exiting={FadeOut.duration(POPUP_FADE_OUT_MS)}
              style={styles.tile}
            >
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setViewer({ source: 'local', index })}
                accessibilityRole="imagebutton"
                accessibilityLabel={t(addKey)}
              >
                <Image source={{ uri: image.uri }} style={styles.thumb} resizeMode="cover" />
              </TouchableOpacity>

              {uploading ? (
                <View style={[styles.overlay, { backgroundColor: c.overlay }]}>
                  <Text style={styles.overlayText}>
                    {t('fb_img_progress', { n: Math.round(image.progress * 100) })}
                  </Text>
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { backgroundColor: c.primary, width: `${Math.max(4, image.progress * 100)}%` },
                      ]}
                    />
                  </View>
                </View>
              ) : null}

              {image.status === 'uploaded' ? (
                <View style={[styles.overlay, styles.uploadedOverlay]}>
                  <Feather name="check" size={20} color="#FFFFFF" />
                </View>
              ) : null}

              {failed ? (
                <View style={[styles.overlay, { backgroundColor: c.overlay }]}>
                  <Feather name="alert-circle" size={20} color={c.destructive} />
                  <TouchableOpacity
                    style={[styles.retryBtn, { borderColor: '#FFFFFF' }]}
                    onPress={() => uploader.retry(image.key)}
                    activeOpacity={0.85}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Feather name="refresh-cw" size={11} color="#FFFFFF" />
                    <Text style={styles.retryText}>{t('fb_img_retry')}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {!uploading ? (
                <TouchableOpacity
                  style={[styles.removeBtn, { backgroundColor: c.destructive }]}
                  onPress={() => uploader.remove(image.key)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('fb_remove_cta')}
                >
                  <Feather name="x" size={11} color={c.destructiveForeground} />
                </TouchableOpacity>
              ) : null}
            </Animated.View>
          );
        })}

        {canAdd && !uploader.atLimit ? (
          <TouchableOpacity
            style={[styles.addTile, { borderColor: c.border, backgroundColor: c.card }]}
            onPress={openSourceSheet}
            disabled={picking}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t(addKey)}
          >
            <Feather name="camera" size={18} color={c.primary} />
            <Text style={[styles.addText, { color: c.mutedForeground }]} numberOfLines={2}>
              {t(addKey)}
            </Text>
          </TouchableOpacity>
        ) : canAdd ? (
          <View style={[styles.maxTile, { borderColor: c.border, backgroundColor: c.muted }]}>
            <Feather name="lock" size={16} color={c.mutedForeground} />
            <Text style={[styles.addText, { color: c.mutedForeground }]} numberOfLines={3}>
              {t('fb_img_max', { n: uploader.limit })}
            </Text>
          </View>
        ) : null}
      </View>

      {showHint ? (
        <Text style={[styles.hint, { color: c.mutedForeground }]}>{t(hintKey)}</Text>
      ) : null}

      {/* The row may not exist yet: photos then stay local until it does. */}
      {uploader.images.length > 0 && !uploader.uploading && uploader.failedCount === 0 ? (
        <Text style={[styles.hint, { color: c.mutedForeground }]}>{t(pendingNoteKey)}</Text>
      ) : null}

      {removeFailure ? (
        <Text style={[styles.hint, { color: c.destructive }]}>
          {t(REMOVE_FAILURE_KEY[removeFailure])}
        </Text>
      ) : null}

      {uploader.failedCount > 0 ? (
        <View style={[styles.errorNote, { borderColor: c.destructive }]}>
          <Feather name="alert-circle" size={14} color={c.destructive} />
          <View style={styles.errorBody}>
            <Text style={[styles.errorText, { color: c.destructive }]}>{t(failedNoteKey)}</Text>
            <Text style={[styles.errorText, { color: c.destructive }]}>
              {t(
                UPLOAD_FAILURE_KEY[
                  uploader.images.find((image) => image.status === 'failed')?.failure ?? 'unknown'
                ]
              )}
            </Text>
            {uploader.failedCount > 1 ? (
              <TouchableOpacity
                onPress={uploader.retryAll}
                activeOpacity={0.8}
                style={styles.retryAllBtn}
              >
                <Feather name="refresh-cw" size={12} color={c.destructive} />
                <Text style={[styles.retryAllText, { color: c.destructive }]}>
                  {t('fb_img_retry_all')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      <MediaViewer
        visible={viewer !== null}
        items={viewerItems}
        initialIndex={viewer?.index ?? 0}
        onClose={() => setViewer(null)}
        onDelete={
          viewerUploaded && removal && viewerAttachmentId != null
            ? () => confirmRemoval(viewerAttachmentId)
            : undefined
        }
        deleteLabel={t('fb_remove_cta')}
        deleting={viewerDeleting}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  label: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  count: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '31%', aspectRatio: 1 },
  thumb: { width: '100%', height: '100%', borderRadius: 12 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 6,
  },
  uploadedOverlay: { backgroundColor: 'rgba(39, 174, 96, 0.55)' },
  overlayText: { fontFamily: 'Manrope_700Bold', fontSize: 12, color: '#FFFFFF' },
  progressTrack: {
    width: '80%',
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    overflow: 'hidden',
  },
  progressFill: { height: 4, borderRadius: 2 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  retryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 10, color: '#FFFFFF' },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 8,
  },
  maxTile: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 8,
  },
  addText: { fontFamily: 'Manrope_500Medium', fontSize: 11, textAlign: 'center' },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16 },
  errorNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  errorBody: { flex: 1, gap: 6 },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 12, lineHeight: 17 },
  retryAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  retryAllText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
});
