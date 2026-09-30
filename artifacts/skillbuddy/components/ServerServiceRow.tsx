import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { formatServicePrice } from '@/lib/servicePrice';
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
 * TAPS: navigating to /service/{id} (the server-backed detail screen fed by
 * GET /api/v1/services/{service_id}); an optional onPress overrides it.
 *
 * IMAGE: thumbnail_url is nullable, so a missing/404ing image falls back to
 * a glyph — the row never shows a broken image or an empty box.
 */
export default function ServerServiceRow({
  service,
  onPress,
}: {
  service: ServiceListItem;
  onPress?: () => void;
}) {
  const { colors: c } = useTheme();
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  const price = formatServicePrice(service);
  const showImage = !!service.thumbnail_url && !failed;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: c.card }]}
      activeOpacity={0.85}
      onPress={onPress ?? (() => router.push(`/service/${service.id}` as any))}
    >
      <View style={[styles.thumbWrap, { backgroundColor: c.muted }]}>
        {showImage ? (
          <Image
            source={{ uri: service.thumbnail_url as string }}
            style={styles.thumb}
            // Fixed box + cover fit: fills the square with no distortion and
            // no letterboxing (same treatment as ServiceCard's list image).
            contentFit="cover"
            transition={150}
            onError={() => setFailed(true)}
          />
        ) : (
          <Feather name="image" size={22} color={c.mutedForeground} />
        )}
      </View>

      <View style={styles.body}>
        {service.category_name ? (
          <View style={[styles.chip, { backgroundColor: c.primaryLight }]}>
            <Text style={[styles.chipText, { color: c.primary }]} numberOfLines={1}>
              {service.category_name}
            </Text>
          </View>
        ) : null}
        <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
          {service.title}
        </Text>
        {service.description ? (
          <Text style={[styles.desc, { color: c.mutedForeground }]} numberOfLines={2}>
            {service.description}
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
  thumbWrap: {
    width: 85,
    height: 85,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { width: '100%', height: '100%' },
  body: { flex: 1, paddingHorizontal: 12, gap: 3 },
  chip: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  chipText: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
  title: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  desc: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 17 },
  price: { fontFamily: 'Manrope_700Bold', fontSize: 13, marginTop: 2 },
});
