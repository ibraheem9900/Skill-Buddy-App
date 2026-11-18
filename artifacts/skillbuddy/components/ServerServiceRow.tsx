import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import RemoteImage from '@/components/RemoteImage';
import { formatServiceHourlyPrice } from '@/lib/servicePrice';
import { resolveServiceImage } from '@/lib/serviceImage';
import { htmlToFlowText } from '@/lib/htmlText';
import { useServiceGroupCover } from '@/hooks/useServiceMediaGroups';
import type { ServiceListItem } from '@/types';

/**
 * List row for a REAL service returned by GET /api/v1/services (or
 * /api/v1/categories/{id}/services). Mirrors the visual language of
 * ServiceCard's `list` variant — same 85×85 rounded thumbnail, same padding,
 * radius, elevation and typography — but only renders fields the API
 * actually provides.
 *
 * DELIBERATELY NOT A ServiceCard: the API item has no `provider`, no
 * `rating` and no single `price`, so feeding it through ServiceCard would
 * mean fabricating a provider name and a star rating for real listings.
 *
 * IMAGE: `resolveServiceImage` picks image → thumbnail → first gallery image,
 * and `RemoteImage` shows a loader while it loads and a tap-to-retry glyph when
 * it fails or the record has no picture at all (e.g. the duplicate Electrician
 * row id 15, whose thumbnail_url is null).
 *
 * TEXT: descriptions are HTML from the API, so they go through
 * `htmlToFlowText` — one flowing line, never a literal "<p>".
 *
 * PRICE: hourly, via the one shared formatter ("€25.00/h – €45.00/h").
 */
export default function ServerServiceRow({
  service,
  onPress,
}: {
  service: ServiceListItem;
  onPress?: () => void;
}) {
  const { colors: c } = useTheme();
  const { t, tCat } = useLanguage();
  const router = useRouter();

  const categoryId = (service as { category_id?: number }).category_id;
  const categoryLabel =
    typeof categoryId === 'number' ? tCat(String(categoryId)) || service.category_name : service.category_name;
  const price = formatServiceHourlyPrice(service, t('price_from_prefix'));
  const description = htmlToFlowText(service.description);
  // Cover: the record's own image/thumbnail first, then the first public work
  // photo for this service from the ONE shared grouped gallery cache. Every
  // card sharing that cache costs zero extra requests (the hook collapses all
  // of them into a single by-service call), so a service with no thumbnail can
  // still show a real picture instead of the placeholder glyph.
  const workCover = useServiceGroupCover(service.id);
  const image = resolveServiceImage(service) ?? workCover;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: c.card }]}
      activeOpacity={0.85}
      onPress={onPress ?? (() => router.push(`/service/${service.id}` as any))}
    >
      <RemoteImage
        uri={image}
        style={styles.thumbWrap}
        fallbackIcon="image"
        fallbackIconSize={22}
        accessibilityLabel={service.title}
      />

      <View style={styles.body}>
        {categoryLabel ? (
          <View style={[styles.chip, { backgroundColor: c.primaryLight }]}>
            <Text style={[styles.chipText, { color: c.primary }]} numberOfLines={1}>
              {categoryLabel}
            </Text>
          </View>
        ) : null}
        <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
          {service.title}
        </Text>
        {description ? (
          <Text style={[styles.desc, { color: c.mutedForeground }]} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
        {price ? <Text style={[styles.price, { color: c.primary }]}>{price}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: 16,
    marginBottom: 12,
    padding: 12,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  thumbWrap: { width: 85, height: 85, borderRadius: 12 },
  body: { flex: 1, paddingHorizontal: 12, gap: 3 },
  chip: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  chipText: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
  title: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  desc: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 17 },
  price: { fontFamily: 'Manrope_700Bold', fontSize: 13, marginTop: 2 },
});
