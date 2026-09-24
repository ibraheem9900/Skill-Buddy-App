import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLanguage } from '@/context/LanguageContext';
import { useCertifications } from '@/hooks/useCertifications';

/** Same client-side guards as the other uploads — backend is the final judge. */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp'];
const MAX_BYTES = 5 * 1024 * 1024;

export interface CertFile {
  uri: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
}

/**
 * Certification upload flow (Certifications screen, provider):
 * 1. Pick an image (launchImageLibraryAsync). PDF support is deliberately
 *    deferred — expo-document-picker is NOT installed in this project, so
 *    offering PDFs would require a new native dependency (flagged for the
 *    team; the backend itself accepts any file).
 * 2. Client-side type/size validation BEFORE any network call.
 * 3. Confirm dialog showing the chosen file (name + size).
 * 4. POST via useCertifications().upload — on 201 the returned record is
 *    appended to the shared list cache; nothing is added optimistically.
 *    422 detail[] → specific message; network failure → retry re-fires the
 *    SAME upload (spec).
 */
export function useCertificationUpload() {
  const { t } = useLanguage();
  const { upload } = useCertifications();
  const [uploading, setUploading] = useState(false);
  const busyRef = useRef(false);

  const validate = (file: CertFile): boolean => {
    const ext = (file.fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
    const mime = file.mimeType ?? '';
    return (
      (mime && ALLOWED_MIME.includes(mime)) ||
      (!mime && !!ext && ALLOWED_EXT.includes(ext)) ||
      (!mime && !ext)
    );
  };

  const performUpload = useCallback(
    async (file: CertFile) => {
      try {
        const message = await upload({
          uri: file.uri,
          name: file.fileName || 'certification.jpg',
          mimeType: file.mimeType || 'image/jpeg',
        });
        Alert.alert(t('cert_title'), message || t('cert_upload_success'));
      } catch (err: any) {
        const detail = err?.response?.data?.detail;
        if (Array.isArray(detail) && detail.length) {
          const raw = typeof detail[0]?.msg === 'string' ? detail[0].msg : '';
          if (/type|content|mime|format/i.test(raw)) Alert.alert(t('cert_upload_error_title'), t('cert_err_type'));
          else if (/size|length|large|limit/i.test(raw)) Alert.alert(t('cert_upload_error_title'), t('cert_err_size'));
          else Alert.alert(t('cert_upload_error_title'), raw || t('cert_err_upload_generic'));
        } else if (err?.response) {
          Alert.alert(t('cert_upload_error_title'), t('cert_err_upload_generic'));
        } else {
          // Network failure → retry re-fires the SAME upload (spec).
          Alert.alert(t('cert_upload_error_title'), t('cert_err_network'), [
            { text: t('action_cancel'), style: 'cancel' },
            { text: t('cert_retry'), onPress: () => void performUpload(file) },
          ]);
        }
      } finally {
        busyRef.current = false;
        setUploading(false);
      }
    },
    [t, upload],
  );

  const pickAndUpload = useCallback(async () => {
    if (busyRef.current || uploading) return;
    busyRef.current = true;
    setUploading(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('cert_upload_error_title'), t('cert_err_permission'));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      if (result.canceled || !result.assets?.length) return;
      const a = result.assets[0];
      const file: CertFile = {
        uri: a.uri,
        fileName: a.fileName ?? (a.uri.split('/').pop() || null),
        mimeType: a.mimeType ?? null,
        fileSize: a.fileSize ?? null,
      };
      if (!validate(file)) {
        Alert.alert(t('cert_upload_error_title'), t('cert_err_type'));
        return;
      }
      if (file.fileSize != null && file.fileSize > MAX_BYTES) {
        Alert.alert(t('cert_upload_error_title'), t('cert_err_size'));
        return;
      }
      // Confirm before firing (no silent uploads).
      Alert.alert(
        t('cert_upload_confirm_title'),
        t('cert_upload_confirm_msg', { name: file.fileName ?? 'certificate' }),
        [
          { text: t('action_cancel'), style: 'cancel' },
          { text: t('cert_upload_confirm_btn'), onPress: () => void performUpload(file) },
        ],
      );
    } finally {
      busyRef.current = false;
      setUploading(false);
    }
  }, [t, performUpload, uploading]);

  return { pickAndUpload, uploading };
}

export default useCertificationUpload;
