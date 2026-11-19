/**
 * EditMediaSheet — the reusable editor for ONE of the signed-in user's photos
 * (PATCH /api/v1/media-gallery/{item_id}): caption + public visibility.
 *
 * WHERE IT IS SHOWN: as the full-screen fade route `app/media/edit.tsx`, opened
 * by `openEditMedia(item)` — NOT a slide-up sheet (the app's popups are fade
 * only, lib/motion). The route keeps the surface reusable from any screen.
 *
 * WHAT IT SHOWS: the photo (contain, like the viewer), a multiline caption with
 * a SOFT character count (the API documents no maximum, so nothing is blocked
 * at an invented limit), and the visibility switch. `can_be_public` is the ONLY
 * gate for the switch — the client never decides ownership or "completed job"
 * from public data:
 *   • can_be_public === false → the switch is DISABLED and the explanation says
 *     only photos of successfully completed tasks can be made public; the
 *     caption stays editable.
 *   • turning the switch ON the first time asks a one-time fade confirmation;
 *     turning it OFF never asks.
 *
 * SAVING: only the changed fields are sent, the form is NOT optimistic (old
 * values stay until the server answers), a repeated tap is ignored, and the
 * three-dot loader is shown inside the Save button. On failure the user's input
 * stays exactly as typed, with the friendly message (or the server's own
 * readable message) above the buttons and any 422 field message under its
 * input.
 *
 * NO INTERNAL DATA: job_id, uploaded_by_side and feedback_type are never read
 * for display, so they can never leak here.
 *
 * TODO — WHERE TO WIRE THIS WHEN THE REMAINING GALLERY SURFACES ARRIVE
 *   • DONE (previous task): "My media" (`app/profile/my-media.tsx`) passes
 *     `isOwnMedia` to MediaViewer, so its header pencil opens this editor.
 *   • A grid tile long-press / overflow menu on My media: render
 *     `<EditMediaButton item={...} />` inside the tile.
 *   • Any future owned-media screen (job photos of a completed job) may call
 *     `openEditMedia(item)` ONLY when the row is provably the signed-in user's
 *     and carries a media-gallery item id. Public gallery rows do NOT (they
 *     carry no owner id), so they must never show an edit control.
 *   • DELETE /api/v1/media-gallery/{item_id} is a separate task — no delete
 *     action exists here.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import RemoteImage from '@/components/RemoteImage';
import DotsLoader from '@/components/DotsLoader';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useAppAlert } from '@/context/AlertModalContext';
import useUpdateMedia from '@/hooks/useUpdateMedia';
import {
  buildMediaUpdatePatch,
  draftFor,
  type MediaEditDraft,
  type MediaEditable,
  type MediaUpdateFailure,
} from '@/lib/mediaEdit';
import { startMediaEditSession } from '@/lib/mediaEditSession';
import { POPUP_FADE_IN_MS } from '@/lib/motion';
import type { MediaItem } from '@/types';
import type { TranslationKey } from '@/context/LanguageContext';

interface Props {
  /** The photo to edit — the owner's own row, already stripped of internals. */
  item: MediaEditable;
  /** Close without saving (the discard confirmation runs before this). */
  onClose: () => void;
  /** The PATCH 200 body: every cache has already been updated with it. */
  onSaved: (item: MediaItem) => void;
}

const FALLBACK_KEY: Record<MediaUpdateFailure, TranslationKey> = {
  unauthorized: 'media_edit_err_unauthorized',
  forbidden: 'media_edit_err_forbidden',
  not_found: 'media_edit_err_not_found',
  conflict: 'media_edit_err_conflict',
  invalid: 'media_edit_err_invalid',
  server: 'media_edit_err_server',
  offline: 'media_edit_err_offline',
  unknown: 'media_edit_err_generic',
};

/**
 * Open the editor for one photo. The item travels in a module session (a media
 * row is an object; expo-router params are strings only) and the screen is a
 * fade route, so the app's one popup rule still holds.
 *
 * `onSaved` lets the opener react to the confirmed item — e.g. My media
 * re-opens the viewer on that photo so the new caption is visible at once.
 */
export function openEditMedia(
  item: MediaEditable,
  options: { onSaved?: (item: MediaItem) => void } = {}
): void {
  startMediaEditSession({ item, onSaved: options.onSaved });
  router.push('/media/edit' as any);
}

export default function EditMediaSheet({ item, onClose, onSaved }: Props) {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const showAlert = useAppAlert();
  const { saving, failure, serverMessage, fieldErrors, mutate, reset } = useUpdateMedia();

  const [draft, setDraft] = useState<MediaEditDraft>(() => draftFor(item));
  /** The one-time "Make this photo public?" confirmation, per editor session. */
  const publicConfirmedRef = useRef(false);

  useEffect(() => {
    setDraft(draftFor(item));
    publicConfirmedRef.current = false;
    reset();
    // `item` is the row the screen was opened with; a new id is a new form.
  }, [item, reset]);

  const patch = buildMediaUpdatePatch(draft, item);
  const dirty = patch !== null;

  const requestClose = useCallback(() => {
    if (saving) return;
    if (!dirty) {
      onClose();
      return;
    }
    showAlert({
      title: t('media_edit_discard_title'),
      message: t('media_edit_discard_msg'),
      icon: 'alert-circle',
      buttons: [
        { text: t('media_edit_keep_editing'), style: 'cancel' },
        { text: t('media_edit_discard_ok'), style: 'destructive', onPress: onClose },
      ],
    });
  }, [dirty, onClose, saving, showAlert, t]);

  /**
   * Android's hardware back is the same dismissal as the header "x": it must
   * run the discard confirmation too (the screen disables the iOS swipe).
   */
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (saving) return true;
      requestClose();
      return true;
    });
    return () => subscription.remove();
  }, [requestClose, saving]);

  const setCaption = (text: string) => {
    setDraft((current) => ({ ...current, caption: text }));
    // A new keystroke invalidates the previous 422/server message.
    if (failure) reset();
  };

  const setPublic = (next: boolean) => {
    if (!item.canBePublic || saving) return;
    if (!next) {
      setDraft((current) => ({ ...current, isPublic: false }));
      return;
    }
    if (publicConfirmedRef.current) {
      setDraft((current) => ({ ...current, isPublic: true }));
      return;
    }
    showAlert({
      title: t('media_edit_public_confirm'),
      message: t('media_edit_public_confirm_msg'),
      icon: 'globe',
      buttons: [
        { text: t('media_edit_public_cancel'), style: 'cancel' },
        {
          text: t('media_edit_public_ok'),
          onPress: () => {
            publicConfirmedRef.current = true;
            setDraft((current) => ({ ...current, isPublic: true }));
          },
        },
      ],
    });
  };

  const save = async () => {
    if (!patch || saving) return;
    const result = await mutate(item.id, patch);
    if (result.status === 'saved') {
      Keyboard.dismiss();
      onSaved(result.item);
      return;
    }
    if (result.status !== 'failed') return;
    if (result.failure === 'not_found') {
      // The row is gone: caches are already cleaned, so leave the form.
      showAlert({
        title: t('media_edit_err_not_found'),
        message: t('media_edit_gone_msg'),
        icon: 'trash-2',
        buttons: [{ text: t('media_edit_ok'), onPress: onClose }],
      });
      return;
    }
    // A refused visibility change must not leave the switch showing a state the
    // server did not accept: revert it to the item's real value (the caption
    // the user typed is kept so a retry does not lose work).
    if (
      patch.is_public !== undefined &&
      (result.failure === 'forbidden' || result.failure === 'conflict' || result.failure === 'invalid')
    ) {
      publicConfirmedRef.current = false;
      setDraft((current) => ({ ...current, isPublic: item.isPublic }));
    }
  };

  /** Friendly copy first; the server's own message where it is more precise. */
  const errorText = failure
    ? failure === 'conflict' || failure === 'invalid' || failure === 'server'
      ? serverMessage ?? t(FALLBACK_KEY[failure])
      : t(FALLBACK_KEY[failure])
    : null;

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <TouchableOpacity
          onPress={requestClose}
          style={[styles.iconBtn, { backgroundColor: c.muted }]}
          accessibilityRole="button"
          accessibilityLabel={t('media_edit_close')}
          disabled={saving}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="x" size={20} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
          {t('media_edit_title')}
        </Text>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAwareScrollViewCompat
        bottomOffset={20}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}
      >
        {/* Tapping anywhere outside the inputs dismisses the keyboard. */}
        <Pressable onPress={Keyboard.dismiss} style={styles.form}>
        <Animated.View entering={FadeIn.duration(POPUP_FADE_IN_MS)} style={styles.previewWrap}>
          <RemoteImage
            uri={item.url}
            style={[styles.preview, { backgroundColor: c.muted, borderColor: c.border }]}
            contentFit="contain"
            fallbackIcon={item.kind === 'video' ? 'video' : 'image'}
            fallbackIconSize={30}
            accessibilityLabel={item.caption ?? t('gallery_photo')}
          />
          {item.kind === 'video' ? (
            <View style={styles.playBadge} pointerEvents="none">
              <Feather name="play" size={16} color="#FFFFFF" />
            </View>
          ) : null}
        </Animated.View>

        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: c.text }]}>{t('media_edit_caption_label')}</Text>
          <Text style={[styles.counter, { color: c.mutedForeground }]}>
            {t('media_edit_caption_counter', { n: draft.caption.length })}
          </Text>
        </View>
        <TextInput
          value={draft.caption}
          onChangeText={setCaption}
          placeholder={t('media_edit_caption_placeholder')}
          placeholderTextColor={c.mutedForeground}
          multiline
          editable={!saving}
          textAlignVertical="top"
          style={[
            styles.input,
            {
              backgroundColor: c.input,
              borderColor: fieldErrors.caption ? c.destructive : c.border,
              color: c.text,
            },
          ]}
          accessibilityLabel={t('media_edit_caption_label')}
        />
        {fieldErrors.caption ? (
          <Text style={[styles.fieldError, { color: c.destructive }]}>{fieldErrors.caption}</Text>
        ) : null}

        <View style={[styles.visibilityCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.visibilityBody}>
            <Text style={[styles.visibilityLabel, { color: c.text }]}>
              {t('media_edit_public_label')}
            </Text>
            <Text
              style={[
                styles.helper,
                { color: item.canBePublic ? c.mutedForeground : c.destructive },
              ]}
            >
              {item.canBePublic ? t('media_edit_public_helper') : t('media_edit_public_locked')}
            </Text>
          </View>
          <Switch
            value={draft.isPublic}
            onValueChange={setPublic}
            disabled={!item.canBePublic || saving}
            trackColor={{ false: c.border, true: c.primary }}
            thumbColor={c.card}
            ios_backgroundColor={c.border}
            accessibilityLabel={t('media_edit_public_label')}
          />
        </View>
        {fieldErrors.is_public ? (
          <Text style={[styles.fieldError, { color: c.destructive }]}>
            {fieldErrors.is_public}
          </Text>
        ) : null}

        {errorText ? (
          <View style={[styles.errorBox, { borderColor: c.destructive, backgroundColor: c.card }]}>
            <Feather name="alert-circle" size={15} color={c.destructive} />
            <Text style={[styles.errorText, { color: c.destructive }]}>{errorText}</Text>
          </View>
        ) : null}

        {!item.canBePublic ? null : (
          <Text style={[styles.hint, { color: c.mutedForeground }]}>{t('media_edit_public_hint')}</Text>
        )}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.cancel, { borderColor: c.border }]}
            onPress={requestClose}
            disabled={saving}
            accessibilityRole="button"
            accessibilityState={{ disabled: saving }}
            activeOpacity={0.85}
          >
            <Text style={[styles.cancelText, { color: c.text }]} numberOfLines={1}>
              {t('media_edit_cancel')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.button,
              styles.save,
              { backgroundColor: c.primary, opacity: dirty && !saving ? 1 : 0.5 },
            ]}
            onPress={() => void save()}
            disabled={!dirty || saving}
            accessibilityRole="button"
            accessibilityState={{ disabled: !dirty || saving, busy: saving }}
            activeOpacity={0.85}
          >
            {saving ? (
              <DotsLoader color={c.primaryForeground} size={5} gap={4} />
            ) : (
              <Text style={[styles.saveText, { color: c.primaryForeground }]} numberOfLines={1}>
                {t('media_edit_save')}
              </Text>
            )}
          </TouchableOpacity>
                </View>
        </Pressable>
      </KeyboardAwareScrollViewCompat>
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
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontFamily: 'Manrope_700Bold', fontSize: 17, textAlign: 'center' },
  body: { paddingHorizontal: 20, paddingTop: 20, flexGrow: 1 },
  form: { gap: 10, flexGrow: 1 },
  previewWrap: { alignItems: 'center' },
  preview: { width: '100%', height: 220, borderRadius: 16, borderWidth: 1 },
  playBadge: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 8,
  },
  label: { flexShrink: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  counter: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  input: {
    minHeight: 108,
    maxHeight: 220,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    lineHeight: 20,
  },
  fieldError: { fontFamily: 'Manrope_500Medium', fontSize: 11, lineHeight: 15 },
  visibilityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 8,
  },
  visibilityBody: { flex: 1, gap: 3 },
  visibilityLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  helper: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 11, lineHeight: 16 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: { flexShrink: 1, fontFamily: 'Manrope_500Medium', fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  button: {
    flex: 1,
    minHeight: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  cancel: { borderWidth: 1.5 },
  cancelText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  save: {},
  saveText: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
});
