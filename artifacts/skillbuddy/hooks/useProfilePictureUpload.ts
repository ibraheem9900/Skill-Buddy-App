import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { authApi } from '@/services/api';

/**
 * Client-side upload constraints (client-side guards only — the backend is
 * the source of truth for what it actually accepts):
 *  - Types: JPEG / PNG / WEBP (standard web-upload set; flagged as an
 *    assumption — the API docs don't enumerate allowed types).
 *  - Size: 5 MB. Deliberately conservative until the backend confirms its
 *    server-side limit.
 */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp'];
const MAX_BYTES = 5 * 1024 * 1024;

interface PickedAsset {
  uri: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
}

/**
 * Profile-picture upload flow (shared by the Profile tab and Edit Profile):
 * 1. launchImageLibraryAsync → client-side type/size validation → preview
 *    confirm dialog (the picker preview itself) → multipart POST.
 * 2. On 200: avatar updates instantly from the response url
 *    (setProfilePicture), then syncProfilePicture() re-confirms with the
 *    server (the GET /users/profile-picture refresh hook wired earlier).
 * 3. Loading state disables the triggering action; network failures offer a
 *    retry; 422 detail[] messages surface specifically.
 * 4. removePicture(): confirm dialog → DELETE → local clear only on success.
 *    The avatar edit button shows "Change Photo / Remove Photo / Cancel" —
 *    Remove only listed when a picture exists (hasPicture).
 */
export function useProfilePictureUpload(hasPicture: boolean) {
  const { t } = useLanguage();
  const { setProfilePicture, clearProfilePicture, syncProfilePicture } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Guard against concurrent pick-and-upload / delete cycles (double-taps).
  const busyRef = useRef(false);

  const validate = (asset: PickedAsset): TranslationKey | null => {
    const ext = (asset.fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
    const mime = asset.mimeType ?? '';
    const typeOk =
      (mime && ALLOWED_MIME.includes(mime)) ||
      (!mime && ext && ALLOWED_EXT.includes(ext)) || // Android may omit mimeType
      (!mime && !ext); // fallback: let the server be the final judge
    if (!typeOk) return 'pp_err_type';
    if (asset.fileSize != null && asset.fileSize > MAX_BYTES) return 'pp_err_size';
    return null;
  };

  const performUpload = useCallback(
    async (asset: PickedAsset) => {
      try {
        const { data } = await authApi.uploadProfilePicture({
          uri: asset.uri,
          name: asset.fileName || 'profile.jpg',
          mimeType: asset.mimeType || 'image/jpeg',
        });
        // Instant avatar update from the response url (spec) ...
        if (data?.url) setProfilePicture(data.url);
        // ... then server-confirmed refresh via GET /users/profile-picture.
        await syncProfilePicture();
        Alert.alert(t('pp_success_title'), data?.message || t('pp_success_msg'));
      } catch (err: any) {
        // 422: surface the specific validation reason (type, size, …).
        const detail = err?.response?.data?.detail;
        let msgKey: TranslationKey | null = null;
        let raw = '';
        if (Array.isArray(detail) && detail.length) {
          raw = typeof detail[0]?.msg === 'string' ? detail[0].msg : '';
          if (/type|content|mime|format/i.test(raw)) msgKey = 'pp_err_type';
          else if (/size|length|large|limit/i.test(raw)) msgKey = 'pp_err_size';
        }
        if (msgKey) {
          Alert.alert(t('pp_error_title'), `${t(msgKey)}${raw ? `\n\n(${raw})` : ''}`);
        } else if (err?.response) {
          Alert.alert(t('pp_error_title'), t('pp_err_generic'));
        } else {
          // Network failure → offer a retry with the same asset.
          Alert.alert(t('pp_error_title'), t('pp_err_network'), [
            { text: t('action_cancel'), style: 'cancel' },
            { text: t('pp_retry'), onPress: () => void performUpload(asset) },
         ]);
        }
      } finally {
        busyRef.current = false;
        setUploading(false);
      }
    },
    [setProfilePicture, syncProfilePicture, t],
  );

  const pickAndUpload = useCallback(async () => {
    if (busyRef.current || uploading) return; // no duplicate submissions
    busyRef.current = true;

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('pp_error_title'), t('pp_err_permission'));
        return;
      }
      // Consistent with job/post.tsx: Images only, square-crop editing.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) return;

      const a = result.assets[0];
      const asset: PickedAsset = {
        uri: a.uri,
        fileName: a.fileName ?? (a.uri.split('/').pop() || null),
        mimeType: a.mimeType ?? null,
        fileSize: a.fileSize ?? null,
      };

      const errKey = validate(asset);
      if (errKey) {
        Alert.alert(t('pp_error_title'), t(errKey));
        return;
      }
      await performUpload(asset);
    } catch {
      Alert.alert(t('pp_error_title'), t('pp_err_generic'));
    } finally {
      busyRef.current = false;
      setUploading(false);
    }
  }, [performUpload, t, uploading]);

  return { pickAndUpload, uploading, removePicture, deleting };

  /**
   * Delete flow: lightweight confirm → DELETE → only on confirmed success
   * clear the local avatar (never optimistically) → server re-sync via the
   * GET hook. "Remove Photo" is only offered when a picture exists
   * (hasPicture gate at the call sites), which also covers the unspecified
   * no-picture-to-delete case — it can't be triggered with nothing set.
   */
  async function removePicture() {
    if (busyRef.current || deleting || uploading) return;
    if (!hasPicture) return; // nothing to delete — never fire the endpoint
    Alert.alert(t('pp_remove_title'), t('pp_remove_msg'), [
      { text: t('action_cancel'), style: 'cancel' },
      {
        text: t('pp_remove_confirm'),
        style: 'destructive',
        onPress: () => {
          busyRef.current = true;
          setDeleting(true);
          performDelete();
        },
      },
    ]);
  }

  async function performDelete() {
    try {
      const { data } = await authApi.deleteProfilePicture();
      // Local clear ONLY after confirmed success (spec rule).
      clearProfilePicture();
      await syncProfilePicture();
      Alert.alert(t('pp_remove_title'), data?.message || t('pp_remove_success'));
    } catch (err: any) {
      if (err?.response) {
        Alert.alert(t('pp_error_title'), t('pp_err_generic'));
      } else {
        // Network failure → nothing cleared; offer a retry.
        Alert.alert(t('pp_error_title'), t('pp_err_network'), [
          { text: t('action_cancel'), style: 'cancel' },
          { text: t('pp_retry'), onPress: () => void performDelete() },
        ]);
      }
    } finally {
      busyRef.current = false;
      setDeleting(false);
    }
  }
}

export default useProfilePictureUpload;
