import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { authApi } from '@/services/api';

/** Same client-side guards as the avatar upload — backend is the final judge. */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp'];
const MAX_BYTES = 5 * 1024 * 1024;

export interface PermitFile {
  uri: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
}

/**
 * Residence-permit upload flow (Documents screen, KYC):
 * 1. Pick front and/or back images (launchImageLibraryAsync, no crop —
 *    documents should keep their full frame).
 * 2. Client-side type/size validation per file BEFORE any network call.
 * 3. Confirm dialog with per-side previews (file names + sizes) since both
 *    sides upload in ONE multipart request.
 * 4. POST → on 200: local pending-review state updates from the response
 *    (front_url/back_url); on network failure: retry re-fires the same
 *    upload; on 422: specific message from detail[].
 */
export function useResidencePermitUpload(onSuccess: (frontUrl: string | null, backUrl: string | null) => void) {
  const { t } = useLanguage();
  const [uploading, setUploading] = useState(false);
  // One cycle at a time — double-taps and re-entry share this guard.
  const busyRef = useRef(false);

  const validate = (file: PermitFile): TranslationKey | null => {
    const ext = (file.fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
    const mime = file.mimeType ?? '';
    const typeOk =
      (mime && ALLOWED_MIME.includes(mime)) ||
      (!mime && ext && ALLOWED_EXT.includes(ext)) ||
      (!mime && !ext);
    if (!typeOk) return 'documents_rp_err_type';
    if (file.fileSize != null && file.fileSize > MAX_BYTES) return 'documents_rp_err_size';
    return null;
  };

  const pickSide = useCallback(async (): Promise<PermitFile | null> => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('documents_rp_error_title'), t('documents_rp_err_permission'));
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return null;
    const a = result.assets[0];
    return {
      uri: a.uri,
      fileName: a.fileName ?? (a.uri.split('/').pop() || null),
      mimeType: a.mimeType ?? null,
      fileSize: a.fileSize ?? null,
    };
  }, [t]);

  const performUpload = useCallback(
    async (front: PermitFile | null, back: PermitFile | null) => {
      try {
        const { data } = await authApi.uploadResidencePermits({
          front: front ? { uri: front.uri, name: front.fileName || 'permit_front.jpg', mimeType: front.mimeType || 'image/jpeg' } : undefined,
          back: back ? { uri: back.uri, name: back.fileName || 'permit_back.jpg', mimeType: back.mimeType || 'image/jpeg' } : undefined,
        });
        Alert.alert(t('documents_rp_success_title'), data?.message || t('documents_rp_success_msg'));
        onSuccess(data?.front_url ?? null, data?.back_url ?? null);
      } catch (err: any) {
        const detail = err?.response?.data?.detail;
        if (Array.isArray(detail) && detail.length) {
          const raw = typeof detail[0]?.msg === 'string' ? detail[0].msg : '';
          if (/type|content|mime|format/i.test(raw)) Alert.alert(t('documents_rp_error_title'), t('documents_rp_err_type'));
          else if (/size|length|large|limit/i.test(raw)) Alert.alert(t('documents_rp_error_title'), t('documents_rp_err_size'));
          else Alert.alert(t('documents_rp_error_title'), raw || t('documents_rp_err_generic'));
        } else if (err?.response) {
          Alert.alert(t('documents_rp_error_title'), t('documents_rp_err_generic'));
        } else {
          // Network failure → retry re-fires the SAME upload (spec).
          Alert.alert(t('documents_rp_error_title'), t('documents_rp_err_network'), [
            { text: t('action_cancel'), style: 'cancel' },
            { text: t('documents_rp_retry'), onPress: () => void performUpload(front, back) },
          ]);
        }
      } finally {
        busyRef.current = false;
        setUploading(false);
      }
    },
    [onSuccess, t],
  );

  /**
   * Entry point from the screen: pick front → pick back → validate both →
   * confirm with previews → upload. Either side can be skipped (API allows
   * it), but the user is asked to confirm a one-sided submission.
   */
  const pickAndUpload = useCallback(async () => {
    if (busyRef.current || uploading) return;
    busyRef.current = true;
    setUploading(true);
    try {
      Alert.alert(t('documents_rp_pick_title'), t('documents_rp_pick_msg'), [
        { text: t('action_cancel'), style: 'cancel', onPress: () => { busyRef.current = false; setUploading(false); } },
        {
          text: t('documents_rp_pick_start'),
          onPress: () => {
            void (async () => {
              // Front first; closing the picker without a choice aborts the flow.
              const front = await pickSide();
              if (!front) { reset(); return; }
              const back = await pickSide();
              const fileError = (front && validate(front)) || (back && validate(back)) || null;
              if (fileError) { reset(); Alert.alert(t('documents_rp_error_title'), t(fileError)); return; }
              if (!front && !back) { reset(); return; }
              if (!back) {
                // One-sided submission: API accepts it, but make it explicit.
                Alert.alert(t('documents_rp_one_side_title'), t('documents_rp_one_side_msg'), [
                  { text: t('action_cancel'), style: 'cancel', onPress: () => { reset(); } },
                  { text: t('documents_rp_upload_anyway'), onPress: () => void performUpload(front, null) },
                ]);
                return;
              }
              Alert.alert(
                t('documents_rp_confirm_title'),
                t('documents_rp_confirm_msg', { front: front?.fileName ?? '—', back: back?.fileName ?? '—' }),
                [
                  { text: t('action_cancel'), style: 'cancel', onPress: () => { reset(); } },
                  { text: t('documents_rp_confirm_upload'), onPress: () => void performUpload(front, back) },
                ],
              );
            })();
          },
        },
     ]);
    } catch {
      reset();
      Alert.alert(t('documents_rp_error_title'), t('documents_rp_err_generic'));
    }
  }, [performUpload, pickSide, t, uploading]);

  function reset() {
    busyRef.current = false;
    setUploading(false);
  }

  return { pickAndUpload, uploading };
}

export default useResidencePermitUpload;
