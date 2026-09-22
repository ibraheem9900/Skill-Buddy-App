import { useCallback, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { authApi } from '@/services/api';

/**
 * Client-side video constraints — ASSUMPTIONS pending backend confirmation
 * (nothing about format/size/duration is documented in Swagger):
 *  - Max duration 15s (liveness clips are short; expo camera hard-caps at 15)
 *  - Max size 50 MB
 *  - video/* MIME (capture produces mp4/mov — both left acceptable)
 */
const MAX_DURATION_S = 15;
const MAX_BYTES = 50 * 1024 * 1024;

interface VideoAsset {
  uri: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  duration: number | null;
}

/**
 * Face-auth video flow (Documents screen, KYC): LIVE front-camera capture
 * only — no gallery option, per liveness-verification standard (flagged for
 * the team; easy to add launchImageLibraryAsync later if they disagree).
 * 1. camera permission → front-camera recording capped at MAX_DURATION_S
 * 2. client-side validation (duration/size/type) BEFORE any network call
 * 3. confirm dialog showing the clip's size/duration
 * 4. multipart POST → 200: local pending-review + url captured; network
 *    failure: retry re-fires the SAME upload; 422: specific message.
 */
export function useFaceVideoUpload(onSuccess: (url: string | null) => void) {
  const { t } = useLanguage();
  const [uploading, setUploading] = useState(false);
  const busyRef = useRef(false);

  const validate = (v: VideoAsset): TranslationKey | null => {
    const mime = v.mimeType ?? '';
    if (mime && !mime.startsWith('video/')) return 'documents_fv_err_format';
    // expo reports duration in SECONDS on iOS/Android (ms on web).
    const dur = v.duration != null ? (Platform.OS === 'web' ? v.duration / 1000 : v.duration) : null;
    if (dur != null && dur > MAX_DURATION_S + 1) return 'documents_fv_err_length';
    if (v.fileSize != null && v.fileSize > MAX_BYTES) return 'documents_fv_err_size';
    return null;
  };

  const performUpload = useCallback(
    async (video: VideoAsset) => {
      try {
        const { data } = await authApi.uploadFaceVideo({
          uri: video.uri,
          name: video.fileName || 'face_auth.mp4',
          mimeType: video.mimeType || 'video/mp4',
        });
        Alert.alert(t('documents_fv_success_title'), data?.message || t('documents_fv_success_msg'));
        onSuccess(data?.url ?? null);
      } catch (err: any) {
        const detail = err?.response?.data?.detail;
        if (Array.isArray(detail) && detail.length) {
          const raw = typeof detail[0]?.msg === 'string' ? detail[0].msg : '';
          if (/format|type|content|mime|codec/i.test(raw)) Alert.alert(t('documents_fv_error_title'), t('documents_fv_err_format'));
          else if (/size|length|large|long|limit|duration/i.test(raw)) Alert.alert(t('documents_fv_error_title'), t('documents_fv_err_size'));
          else Alert.alert(t('documents_fv_error_title'), raw || t('documents_fv_err_generic'));
        } else if (err?.response) {
          Alert.alert(t('documents_fv_error_title'), t('documents_fv_err_generic'));
        } else {
          // Videos are heavy — network failure always offers a retry of the SAME clip.
          Alert.alert(t('documents_fv_error_title'), t('documents_fv_err_network'), [
            { text: t('action_cancel'), style: 'cancel' },
            { text: t('documents_fv_retry'), onPress: () => void performUpload(video) },
          ]);
        }
      } finally {
        busyRef.current = false;
        setUploading(false);
      }
    },
    [onSuccess, t],
  );

  const recordAndUpload = useCallback(async () => {
    if (busyRef.current || uploading) return; // no duplicate submissions
    busyRef.current = true;
    setUploading(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('documents_fv_error_title'), t('documents_fv_err_permission'));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        cameraType: ImagePicker.CameraType.front,
        videoMaxDuration: MAX_DURATION_S,
        quality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      });
      if (result.canceled || !result.assets?.length) return;

      const a = result.assets[0];
      const video: VideoAsset = {
        uri: a.uri,
        fileName: a.fileName ?? (a.uri.split('/').pop() || null),
        mimeType: a.mimeType ?? null,
        fileSize: a.fileSize ?? null,
        duration: a.duration ?? null,
      };
      const errKey = validate(video);
      if (errKey) {
        Alert.alert(t('documents_fv_error_title'), t(errKey));
        return;
      }
      // Playback preview happened in the camera UI; confirm submission.
      Alert.alert(
        t('documents_fv_confirm_title'),
        t('documents_fv_confirm_msg'),
        [
          { text: t('action_cancel'), style: 'cancel' },
          { text: t('documents_fv_confirm_upload'), onPress: () => void performUpload(video) },
        ],
      );
    } catch {
      Alert.alert(t('documents_fv_error_title'), t('documents_fv_err_generic'));
    } finally {
      busyRef.current = false;
      setUploading(false);
    }
  }, [performUpload, t, uploading]);

  return { recordAndUpload, uploading };
}

export default useFaceVideoUpload;
