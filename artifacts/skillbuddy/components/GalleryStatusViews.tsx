/**
 * GalleryStatusViews — the loading / empty / error pieces shared by BOTH
 * grouped gallery views ("By service" and "By category").
 *
 * Extracted so the two views cannot drift apart: the same three-dot loader
 * (never the rotating brand logo), the same skeleton sections, the same
 * friendly failure sentences (translated from a GalleryFailure code — a status
 * code or raw payload is never shown) and the same empty state.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import DotsLoader from '@/components/DotsLoader';
import EmptyState from '@/components/EmptyState';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import type { GalleryFailure } from '@/hooks/useGalleryGroupStore';

/** Failure code → the sentence a user can act on. */
export function galleryFailureKey(failure: GalleryFailure | null): TranslationKey {
  switch (failure) {
    case 'offline':
      return 'gallery_offline';
    case 'unauthorized':
      return 'gallery_unauthorized';
    case 'invalid':
      return 'gallery_invalid';
    case 'server':
      return 'gallery_server';
    default:
      return 'gallery_unknown';
  }
}

/** Two or three section placeholders while the first grouped call runs. */
export function GallerySkeletonSections({
  count = 3,
  tile = 116,
  showLoader = true,
}: {
  count?: number;
  tile?: number;
  showLoader?: boolean;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  return (
    <View style={{ padding: 16, gap: 22 }}>
      {Array.from({ length: count }, (_, section) => (
        <View key={section} style={{ gap: 10 }}>
          <View style={[styles.skeletonTitle, { backgroundColor: c.skeletonBase }]} />
          <View style={styles.skeletonRow}>
            {[0, 1, 2].map((cell) => (
              <View
                key={cell}
                style={[
                  styles.skeletonTile,
                  {
                    width: tile,
                    height: tile,
                    backgroundColor: c.skeletonBase,
                    borderColor: c.border,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      ))}
      {showLoader ? (
        <View style={styles.loadingRow}>
          <DotsLoader color={c.mutedForeground} size={6} gap={5} />
          <Text style={[styles.loadingText, { color: c.mutedForeground }]}>
            {t('gallery_loading')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Dedicated-screen failure: message + Try Again (three-dot loader while busy). */
export function GalleryErrorState({
  failure,
  onRetry,
  retrying,
}: {
  failure: GalleryFailure | null;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  return (
    <View style={styles.stateWrap}>
      <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Feather
          name={failure === 'offline' ? 'wifi-off' : 'alert-circle'}
          size={30}
          color={c.destructive}
        />
        <Text style={[styles.stateTitle, { color: c.text }]}>{t('gallery_error_title')}</Text>
        <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
          {t(galleryFailureKey(failure))}
        </Text>
        <TouchableOpacity
          style={[styles.stateBtn, { backgroundColor: c.primary }]}
          onPress={onRetry}
          disabled={retrying}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          {retrying ? (
            <DotsLoader color="#FFFFFF" size={5} gap={4} />
          ) : (
            <Feather name="refresh-cw" size={15} color="#FFFFFF" />
          )}
          <Text style={styles.stateBtnText}>{t('try_again')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Honest empty gallery (nothing public yet) — with a retry. */
export function GalleryEmptyState({ onRetry }: { onRetry: () => void }) {
  const { t } = useLanguage();
  return (
    <EmptyState
      icon="image"
      title={t('gallery_empty_title')}
      subtitle={t('gallery_empty_sub')}
      actionLabel={t('try_again')}
      onAction={onRetry}
    />
  );
}

const styles = StyleSheet.create({
  skeletonTitle: { width: 150, height: 16, borderRadius: 6 },
  skeletonRow: { flexDirection: 'row', gap: 8 },
  skeletonTile: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 4,
  },
  loadingText: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  stateWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  stateCard: {
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 26,
  },
  stateTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, textAlign: 'center' },
  stateSub: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  stateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 24,
    minHeight: 44,
  },
  stateBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, color: '#FFFFFF' },
});
