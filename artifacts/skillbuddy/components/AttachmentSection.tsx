import React, { useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import BottomSheet from '@/components/BottomSheet';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useAppAlert } from '@/context/AlertModalContext';
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  addToAttachmentQueue,
  formatBytes,
  mimeFromName,
  remainingSlots,
  type AttachmentDraft,
  type AttachmentRejection,
} from '@/lib/jobAttachments';

/**
 * "Add attachment" — directly under the description, as asked.
 *
 *  • the source (camera or gallery) is chosen in the app's shared BottomSheet;
 *  • several images can be picked at once, and the queue is capped;
 *  • each thumbnail can be removed with its own ✕ and the count is always shown;
 *  • HEIC is converted to JPEG by the picker itself
 *    (`preferredAssetRepresentationMode: Compatible`), and `quality` re-encodes
 *    every pick, which is the on-device compression step. A true RESIZE would
 *    need expo-image-manipulator (a NEW native module, so a new binary rather
 *    than an OTA update) — the app's own guard rail is therefore the size limit
 *    below, reported with the real number.
 *
 * Nothing is uploaded here: the job must exist first, so the files are held in
 * the wizard until POST /api/v1/jobs returns its id (app/job/post.tsx).
 */
export default function AttachmentSection({
  files,
  onChange,
}: {
  files: AttachmentDraft[];
  onChange: (next: AttachmentDraft[]) => void;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const showAlert = useAppAlert();
  const [sourceOpen, setSourceOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  const explainRejections = (rejected: AttachmentRejection[]) => {
    if (rejected.length === 0) return;
    const reasons = new Set(rejected.map((item) => item.reason));
    const message =
      reasons.has('too_many')
        ? t('post_attach_too_many', { n: MAX_ATTACHMENTS })
        : reasons.has('too_large')
          ? t('post_attach_too_large', {
              name: rejected[0].name,
              size: formatBytes(MAX_ATTACHMENT_BYTES),
            })
          : t('post_attach_bad_type');
    showAlert({ title: t('post_attach_title'), message, icon: 'alert-circle' });
  };

  const addAssets = (assets: ImagePicker.ImagePickerAsset[]) => {
    const incoming: AttachmentDraft[] = assets.map((asset, index) => {
      const name =
        asset.fileName ?? `photo-${Date.now()}-${index}.${asset.mimeType === 'image/png' ? 'png' : 'jpg'}`;
      return {
        id: `${asset.assetId ?? asset.uri}-${index}`,
        uri: asset.uri,
        name,
        mimeType: asset.mimeType ?? mimeFromName(name),
        size: typeof asset.fileSize === 'number' ? asset.fileSize : null,
      };
    });
    const result = addToAttachmentQueue(files, incoming);
    onChange(result.accepted);
    explainRejections(result.rejected);
  };

  const pick = async (source: 'camera' | 'gallery') => {
    setSourceOpen(false);
    setPicking(true);
    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showAlert({
          title: t('post_attach_title'),
          message: t('post_attach_permission'),
          icon: 'lock',
        });
        return;
      }

      const options: ImagePicker.ImagePickerOptions = {
        // Same option the app's other pickers use (app/job/[id]/attachment.tsx).
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        // HEIC/HEIF → JPEG on iOS, so the server never receives a format it
        // does not document support for.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        quality: 0.55,
        exif: false,
      };

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ ...options, allowsEditing: false })
          : await ImagePicker.launchImageLibraryAsync({
              ...options,
              allowsMultipleSelection: true,
              selectionLimit: Math.max(1, remainingSlots(files.length)),
            });

      if (result.canceled) return;
      addAssets(result.assets);
    } catch {
      showAlert({
        title: t('post_attach_title'),
        message: t('post_attach_error'),
        icon: 'alert-triangle',
      });
    } finally {
      setPicking(false);
    }
  };

  const remove = (id: string) => onChange(files.filter((file) => file.id !== id));

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={[styles.label, { color: c.text }]}>{t('post_attach_label')}</Text>
        <Text style={[styles.count, { color: c.mutedForeground }]}>
          {t('post_attach_count', { n: files.length, max: MAX_ATTACHMENTS })}
        </Text>
      </View>

      {files.length > 0 ? (
        <View style={styles.thumbs}>
          {files.map((file) => (
            <View key={file.id} style={styles.thumbWrap}>
              <Image source={{ uri: file.uri }} style={styles.thumb} resizeMode="cover" />
              <TouchableOpacity
                style={[styles.remove, { backgroundColor: c.destructive }]}
                onPress={() => remove(file.id)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                accessibilityRole="button"
                accessibilityLabel={t('post_attach_remove')}
              >
                <Feather name="x" size={11} color={c.destructiveForeground} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}

      <TouchableOpacity
        style={[
          styles.addBtn,
          {
            borderColor: c.primary,
            opacity: picking || files.length >= MAX_ATTACHMENTS ? 0.5 : 1,
          },
        ]}
        onPress={() => setSourceOpen(true)}
        disabled={picking || files.length >= MAX_ATTACHMENTS}
        accessibilityRole="button"
      >
        <Feather name={picking ? 'loader' : 'image'} size={16} color={c.primary} />
        <Text style={[styles.addText, { color: c.primary }]}>{t('post_attach_add')}</Text>
      </TouchableOpacity>

      <Text style={[styles.hint, { color: c.mutedForeground }]}>
        {t('post_attach_hint', {
          n: MAX_ATTACHMENTS,
          size: formatBytes(MAX_ATTACHMENT_BYTES),
        })}
      </Text>

      <BottomSheet
        visible={sourceOpen}
        onClose={() => setSourceOpen(false)}
        title={t('post_attach_pick_source')}
        height={260}
      >
        <View style={styles.sourceList}>
          <TouchableOpacity
            style={[styles.sourceRow, { backgroundColor: c.input, borderColor: c.border }]}
            onPress={() => void pick('camera')}
            accessibilityRole="button"
          >
            <Feather name="camera" size={18} color={c.primary} />
            <Text style={[styles.sourceText, { color: c.text }]}>{t('post_attach_camera')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sourceRow, { backgroundColor: c.input, borderColor: c.border }]}
            onPress={() => void pick('gallery')}
            accessibilityRole="button"
          >
            <Feather name="image" size={18} color={c.primary} />
            <Text style={[styles.sourceText, { color: c.text }]}>{t('post_attach_gallery')}</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12, gap: 8 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  count: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumbWrap: { width: 64, height: 64 },
  thumb: { width: 64, height: 64, borderRadius: 10 },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 12,
  },
  addText: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16 },
  sourceList: { padding: 20, gap: 10 },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  sourceText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
});
