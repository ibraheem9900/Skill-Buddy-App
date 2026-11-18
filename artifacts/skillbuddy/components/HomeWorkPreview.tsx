/**
 * HomeWorkPreview — the compact "Our work" strip on the home screen.
 *
 * It reads the ONE grouped gallery call (per_service = 4) through
 * useServiceMediaGroups, so it adds at most one request for the whole screen and
 * never one per service. Up to four services are shown, each with a cover and
 * up to three thumbnails; tapping a photo opens the fade-in viewer scoped to
 * that service's loaded photos, and the title row opens the paginated list.
 *
 * The section is hidden ENTIRELY when there is nothing to show and on any
 * failure — the home screen must never gain an error card because of the
 * gallery. It renders nothing while loading too, so there is no layout jump.
 */
import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import RemoteImage from '@/components/RemoteImage';
import MediaViewer from '@/components/MediaViewer';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useCachedServiceTitle } from '@/hooks/useServices';
import useServiceMediaGroups from '@/hooks/useServiceMediaGroups';
import {
  DEFAULT_PER_SERVICE,
  toGalleryViewerItems,
  type DisplayMedia,
  type ServiceGalleryGroupView,
} from '@/lib/mediaGallery';
import { formatTaskFeedbackTime } from '@/lib/taskFeedback';

/**
 * Same per_service as every other surface ON PURPOSE: the cache is keyed by
 * per_service, so using 4 here would make the home screen hold two buckets and
 * fire a second by-service request. One size app-wide = one request.
 */
const PREVIEW_PER_SERVICE = DEFAULT_PER_SERVICE;
const MAX_SERVICES = 4;

function WorkCard({
  group,
  onOpenPhoto,
  onOpenService,
}: {
  group: ServiceGalleryGroupView;
  onOpenPhoto: (index: number) => void;
  onOpenService: () => void;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const cachedTitle = useCachedServiceTitle(group.serviceId);
  const title = (cachedTitle ?? group.serviceTitle).trim();
  const cover = group.media[0];
  const extras = group.media.slice(1, 4);

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => onOpenPhoto(0)}
        accessibilityRole="button"
        accessibilityLabel={cover?.caption ?? t('gallery_photo')}
      >
        <RemoteImage
          uri={cover?.url}
          style={styles.cover}
          fallbackIcon={cover?.kind === 'video' ? 'video' : 'image'}
          fallbackIconSize={22}
          accessibilityLabel={cover?.caption ?? title}
        />
        {cover?.kind === 'video' ? (
          <View style={styles.playBadge} pointerEvents="none">
            <Feather name="play" size={12} color="#FFFFFF" />
          </View>
        ) : null}
      </TouchableOpacity>

      {extras.length > 0 ? (
        <View style={styles.extrasRow}>
          {extras.map((media, index) => (
            <TouchableOpacity
              key={`${media.id}-${index}`}
              activeOpacity={0.85}
              onPress={() => onOpenPhoto(index + 1)}
              accessibilityRole="button"
              accessibilityLabel={media.caption ?? t('gallery_photo')}
            >
              <RemoteImage
                uri={media.url}
                style={styles.extra}
                fallbackIcon={media.kind === 'video' ? 'video' : 'image'}
                fallbackIconSize={14}
              />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <TouchableOpacity
        style={styles.titleRow}
        activeOpacity={0.7}
        onPress={onOpenService}
        accessibilityRole="button"
        accessibilityLabel={title || t('gallery_view_service')}
      >
        <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
          {title || t('gallery_service_title')}
        </Text>
        <Feather name="chevron-right" size={16} color={c.mutedForeground} />
      </TouchableOpacity>
    </View>
  );
}

export default function HomeWorkPreview() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();
  const { groups } = useServiceMediaGroups({ perService: PREVIEW_PER_SERVICE });

  const [viewer, setViewer] = useState<{ media: readonly DisplayMedia[]; index: number } | null>(
    null
  );

  const shown = groups.slice(0, MAX_SERVICES);
  if (shown.length === 0) return null;

  const viewerItems = viewer
    ? toGalleryViewerItems(viewer.media, (iso) => formatTaskFeedbackTime(iso, language))
    : [];

  return (
    <>
      <View style={styles.section}>
        <View style={styles.header}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>{t('gallery_home_title')}</Text>
          <TouchableOpacity
            onPress={() => router.push('/gallery' as any)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
          >
            <Text style={[styles.seeAll, { color: c.primary }]}>{t('see_all')}</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          data={shown}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(group) => `home-work-${group.serviceId}`}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          initialNumToRender={3}
          windowSize={3}
          removeClippedSubviews
          renderItem={({ item }) => (
            <WorkCard
              group={item}
              onOpenPhoto={(index) => setViewer({ media: item.media, index })}
              onOpenService={() =>
                router.push({
                  pathname: '/gallery/[serviceId]',
                  params: {
                    serviceId: String(item.serviceId),
                    title: (item.serviceTitle ?? '').trim(),
                  },
                } as any)
              }
            />
          )}
        />
      </View>

      <MediaViewer
        visible={viewer !== null}
        items={viewerItems}
        initialIndex={viewer?.index ?? 0}
        onClose={() => setViewer(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 26 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  seeAll: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
  card: {
    width: 172,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingBottom: 8,
  },
  cover: { width: 172, height: 104 },
  playBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  extrasRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingTop: 6 },
  extra: { width: 48, height: 48, borderRadius: 8 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  title: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 13, lineHeight: 18 },
});
