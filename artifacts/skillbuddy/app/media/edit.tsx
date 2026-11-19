/**
 * /media/edit — the route that hosts EditMediaSheet.
 *
 * A full-screen FADE route (the app's one popup rule: opacity only, no slide),
 * opened exclusively through `openEditMedia(item)`, which stores the item in the
 * edit session first. If the screen is ever reached without a session (deep link
 * / reload) it shows a calm fallback instead of crashing on an undefined photo.
 *
 * After a confirmed save the opener's optional `onSaved` runs (My media uses it
 * to re-open the viewer on that photo, whose caption now comes from the patched
 * cache) and the app's short confirmation appears.
 */
import React, { useCallback, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import EditMediaSheet from '@/components/EditMediaSheet';
import BackButton from '@/components/BackButton';
import { useAppAlert } from '@/context/AlertModalContext';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { readMediaEditSession } from '@/lib/mediaEditSession';
import type { MediaItem } from '@/types';

export default function EditMediaScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const router = useRouter();
  const showAlert = useAppAlert();
  /** Read once: the session is the photo this screen was opened for. */
  const session = useRef(readMediaEditSession()).current;

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/profile/my-media' as any);
  }, [router]);

  const handleSaved = useCallback(
    (item: MediaItem) => {
      try {
        session?.onSaved?.(item);
      } catch (err) {
        console.log('[media/edit] onSaved handler failed', err);
      }
      goBack();
      // The app's short confirmation; the button copy stays translated.
      showAlert({
        title: t('media_edit_toast_saved'),
        icon: 'check',
        buttons: [{ text: t('media_edit_ok') }],
      });
    },
    [goBack, session, showAlert, t]
  );

  if (!session) {
    return (
      <View style={[styles.fallback, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <View style={[styles.fallbackHeader, { borderBottomColor: c.border, backgroundColor: c.surface }]}>
          <BackButton />
          <Text style={[styles.fallbackTitle, { color: c.text }]} numberOfLines={1}>
            {t('media_edit_title')}
          </Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.fallbackBody}>
          <Feather name="image" size={30} color={c.mutedForeground} />
          <Text style={[styles.fallbackText, { color: c.mutedForeground }]}>
            {t('media_edit_unavailable')}
          </Text>
        </View>
      </View>
    );
  }

  return <EditMediaSheet item={session.item} onClose={goBack} onSaved={handleSaved} />;
}

const styles = StyleSheet.create({
  fallback: { flex: 1 },
  fallbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  fallbackTitle: { flex: 1, fontFamily: 'Manrope_700Bold', fontSize: 18, textAlign: 'center' },
  fallbackBody: { alignItems: 'center', paddingTop: 64, gap: 12, paddingHorizontal: 32 },
  fallbackText: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
});
