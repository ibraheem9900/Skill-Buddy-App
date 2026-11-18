/**
 * ServiceWorkPreview — "Examples of this service" on the service detail screen.
 *
 * This is one of only two places allowed to touch the single-service page (the
 * other is the paginated service gallery screen): the grouped call runs first,
 * and only if it settled without a group for this service does the hook fetch
 * that service's small page from the DEDICATED
 * GET /api/v1/services/{service_id}/gallery (see useServiceWorkPreview and
 * lib/serviceGalleryFetch). Lists never do this.
 *
 * The section is hidden while there is nothing to show and on any failure, so
 * the service screen keeps behaving exactly as before. Tapping a photo opens the
 * fade-in viewer scoped to this service's loaded photos; "See all" opens the
 * paginated list.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import MediaViewer from '@/components/MediaViewer';
import ServiceWorkSection from '@/components/ServiceWorkSection';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme } from '@/context/ThemeContext';
import { useServiceWorkPreview } from '@/hooks/useServiceMediaGroups';
import { toGalleryViewerItems, type DisplayMedia } from '@/lib/mediaGallery';
import { formatTaskFeedbackTime } from '@/lib/taskFeedback';

const TILE = 104;

export default function ServiceWorkPreview({
  serviceId,
  serviceTitle,
}: {
  serviceId: number | null;
  serviceTitle?: string;
}) {
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();
  const { media } = useServiceWorkPreview(serviceId);
  const [viewer, setViewer] = useState<{ media: readonly DisplayMedia[]; index: number } | null>(
    null
  );

  if (media.length === 0) return null;

  const viewerItems = viewer
    ? toGalleryViewerItems(viewer.media, (iso) => formatTaskFeedbackTime(iso, language))
    : [];

  return (
    <View style={styles.wrap}>
      <ServiceWorkSection
        title={t('gallery_examples_of_service')}
        media={media}
        size={TILE}
        onPressPhoto={(index) => setViewer({ media, index })}
        onSeeAll={
          serviceId === null
            ? undefined
            : () =>
                router.push({
                  pathname: '/gallery/[serviceId]',
                  params: {
                    serviceId: String(serviceId),
                    title: (serviceTitle ?? '').trim(),
                  },
                } as any)
        }
        style={[styles.section, { borderTopColor: c.border }]}
      />
      <MediaViewer
        visible={viewer !== null}
        items={viewerItems}
        initialIndex={viewer?.index ?? 0}
        onClose={() => setViewer(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 24 },
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 18 },
});
