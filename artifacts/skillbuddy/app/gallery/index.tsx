/**
 * "Our work" — the grouped public gallery, with a "By service | By category"
 * toggle. Default is "By service" (unchanged behaviour).
 *
 * The two views use DIFFERENT endpoints that return different slices of data
 * (newest N per service vs newest N per category), so exactly ONE of them is
 * mounted at a time: opening this screen fires only the active source's single
 * grouped request, and switching the toggle later re-uses the session cache
 * (both stores live in hooks/useGalleryGroupStore) instead of refetching.
 *
 * Chips come from already-cached categories only — no category request is made
 * by either view. In "By service" a chip filters the cached groups; in "By
 * category" it scrolls to that section.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BackButton from '@/components/BackButton';
import GalleryCategoryGroupsView from '@/components/GalleryCategoryGroupsView';
import GalleryServiceGroupsView from '@/components/GalleryServiceGroupsView';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';

type GalleryMode = 'service' | 'category';

const MODES: GalleryMode[] = ['service', 'category'];

export default function GalleryScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  // Default stays "By service", per the brief.
  const [mode, setMode] = useState<GalleryMode>('service');

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      {/* Green header, same style as the Services/Jobs tabs. */}
      <View style={[styles.header, { backgroundColor: c.headerBg }]}>
        <BackButton />
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {t('gallery_title')}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {t('gallery_subtitle')}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* Segmented toggle — the app's chip/tab styling: primary fill + white
          label for the active segment, card surface for the other. */}
      <View style={[styles.segment, { backgroundColor: c.card, borderColor: c.border }]}>
        {MODES.map((key) => {
          const active = mode === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.segmentBtn, active && { backgroundColor: c.primary }]}
              onPress={() => setMode(key)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[styles.segmentText, { color: active ? '#FFFFFF' : c.mutedForeground }]}
                numberOfLines={1}
              >
                {key === 'service' ? t('gallery_by_service') : t('gallery_by_category')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {mode === 'service' ? (
        <GalleryServiceGroupsView bottomInset={insets.bottom} />
      ) : (
        <GalleryCategoryGroupsView bottomInset={insets.bottom} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  headerTitles: { flex: 1, alignItems: 'center' },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18, color: '#FFFFFF' },
  headerSubtitle: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  headerSpacer: { width: 40 },
  segment: {
    flexDirection: 'row',
    alignSelf: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 2,
    padding: 3,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 19,
    minHeight: 36,
    minWidth: 104,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
