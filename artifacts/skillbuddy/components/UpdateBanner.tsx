import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { formatReleaseLabel } from '@/lib/appUpdate';
import useAppUpdate from '@/hooks/useAppUpdate';

/**
 * "Update available" banner (Home). Self-contained: it asks useAppUpdate for
 * the latest GitHub release, compares it with the installed APK's stamped
 * build, and renders nothing unless a newer build exists that the user has not
 * dismissed yet. The download action opens the release's APK asset in the
 * browser, which handles the sideload flow.
 */
export default function UpdateBanner() {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { visible, latest, dismiss } = useAppUpdate();

  if (!visible || latest == null) return null;

  const openDownload = () => {
    void Linking.openURL(latest.downloadUrl).catch((err) => {
      console.log('[UpdateBanner] could not open download link', err?.message ?? err);
    });
  };

  return (
    <Animated.View
      entering={FadeInDown.delay(15).duration(380)}
      style={[styles.card, { backgroundColor: c.primaryLight, borderColor: c.primary }]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.iconWrap, { backgroundColor: c.primary }]}>
          <Feather name="arrow-down-circle" size={15} color={c.primaryForeground} />
        </View>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
          {t('update_available_title')}
        </Text>
        <TouchableOpacity
          onPress={dismiss}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('update_later')}
        >
          <Feather name="x" size={16} color={c.mutedForeground} />
        </TouchableOpacity>
      </View>

      <Text style={[styles.body, { color: c.mutedForeground }]}>
        {t('update_available_body', { version: formatReleaseLabel(latest) })}
      </Text>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: c.primary }]}
        onPress={openDownload}
        accessibilityRole="button"
        accessibilityLabel={t('update_download')}
      >
        <Feather name="download" size={13} color={c.primaryForeground} />
        <Text style={[styles.buttonText, { color: c.primaryForeground }]}>{t('update_download')}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: 'Manrope_700Bold', fontSize: 14 },
  body: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 17, marginTop: 8, paddingLeft: 36 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 10,
    marginLeft: 36,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  buttonText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
});
