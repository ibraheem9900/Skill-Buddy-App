/**
 * The paginated "See all" list for ONE service — the dedicated
 * GET /api/v1/services/{service_id}/gallery source (see
 * hooks/usePublicMediaPage; the body is the shared GalleryPagedList).
 *
 * This route only resolves the heading, in the brief's order: the app's own
 * localized service name from cached data, then the title passed in from the
 * group the user tapped, then the cached group's service_title, then a generic
 * "Gallery". No services request is made just to label the screen.
 */
import React, { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import GalleryPagedList from '@/components/GalleryPagedList';
import { useLanguage } from '@/context/LanguageContext';
import { useCachedServiceTitle } from '@/hooks/useServices';
import { peekGroupForService } from '@/hooks/useServiceMediaGroups';

export default function ServiceGalleryScreen() {
  const { t } = useLanguage();
  const params = useLocalSearchParams<{ serviceId: string; title?: string }>();

  const numericId =
    params.serviceId && /^\d+$/.test(String(params.serviceId))
      ? Number(params.serviceId)
      : null;

  const cachedServiceTitle = useCachedServiceTitle(numericId);

  const heading = useMemo(() => {
    // Cached, app-localized name first (the brief's preference), then the title
    // carried over from the grouped data the user tapped, then the group itself.
    if (cachedServiceTitle) return cachedServiceTitle;
    const fromRoute = (params.title ?? '').trim();
    if (fromRoute.length > 0) return fromRoute;
    const fromGroup = peekGroupForService(numericId)?.serviceTitle?.trim();
    if (fromGroup && fromGroup.length > 0) return fromGroup;
    return t('gallery_service_title');
  }, [cachedServiceTitle, numericId, params.title, t]);

  return (
    <GalleryPagedList
      serviceId={numericId}
      title={heading}
      invalidTitle={t('gallery_service_title')}
    />
  );
}
