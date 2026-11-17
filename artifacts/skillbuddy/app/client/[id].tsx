import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import BackButton from '@/components/BackButton';
import MediaViewer, { type MediaViewerItem } from '@/components/MediaViewer';
import RatingSummary from '@/components/RatingSummary';
import ReviewCard from '@/components/ReviewCard';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useFeedbackOptions } from '@/hooks/useFeedbackOptions';
import { useClientReviews } from '@/hooks/useClientReviews';
import { reviewContext } from '@/lib/reviews';

/**
 * A CLIENT's profile as seen by a PILOT: their rating summary plus the latest
 * pilot reviews, with "See all reviews" opening the shared reviews screen.
 *
 * WHY THERE IS NOTHING ELSE ON THIS SCREEN: the live API exposes no public
 * client-profile endpoint and a job carries only `client_id` (a USER id, which
 * this reviews endpoint answers 404 for), so no name, photo, bio or badge can be
 * shown here without inventing data or adding an undocumented lookup. Only what
 * GET /api/v1/clients/{client_id}/reviews returns is rendered.
 *
 * The route id is therefore the client PROFILE id. Today that id is known for
 * the signed-in client (GET /clients/profile) but NOT for the client of a job a
 * pilot is viewing — that entry point needs an API that exposes it (reported as
 * still waiting).
 */
export default function ClientProfileScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  const clientId = id && /^\d+$/.test(id) ? Number(id) : null;
  const { summary, reviews, loading, failure } = useClientReviews(clientId);

  const options = useFeedbackOptions(reviewContext('PROVIDER'));
  const optionLookup = useMemo(
    () => new Map(options.options.map((option) => [option.id, option.label])),
    [options.options]
  );

  const [viewer, setViewer] = useState<{ items: MediaViewerItem[]; index: number } | null>(null);
  const openMedia = useCallback((items: MediaViewerItem[], index: number) => {
    setViewer({ items, index });
  }, []);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <BackButton onPress={() => router.back()} />
      <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>
        {t('fb_rev_client_profile_title')}
      </Text>
      <View style={{ width: 40 }} />
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {header}
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <RatingSummary summary={summary} subject="client" />

        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>{t('fb_prov_title')}</Text>
          <TouchableOpacity
            onPress={() => router.push(`/client/${clientId}/reviews` as any)}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
          >
            <Text style={[styles.seeAll, { color: c.primary }]}>{t('fb_prov_see_all')}</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={{ gap: 8, marginTop: 10 }}>
            {[0, 1].map((row) => (
              <View
                key={row}
                style={[styles.skeleton, { backgroundColor: c.muted, borderColor: c.border }]}
              />
            ))}
          </View>
        ) : failure && reviews.length === 0 ? (
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
            {t('fb_prov_load_error')}
          </Text>
        ) : reviews.length === 0 ? (
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
            {t('fb_rev_client_empty_msg')}
          </Text>
        ) : (
          reviews.slice(0, 3).map((review) => (
            <View key={review.id} style={{ marginTop: 10 }}>
              <ReviewCard
                review={review}
                viewerSide="PROVIDER"
                variant="public"
                title={t('fb_rev_reviewer_pilot')}
                optionLookup={optionLookup}
                onOpenMedia={openMedia}
                compact
              />
            </View>
          ))
        )}

        {reviews.length > 0 ? (
          <TouchableOpacity
            style={[styles.openAll, { borderColor: c.border, backgroundColor: c.card }]}
            onPress={() => router.push(`/client/${clientId}/reviews` as any)}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Feather name="star" size={15} color={c.primary} />
            <Text style={[styles.openAllText, { color: c.text }]}>{t('fb_prov_see_all')}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      <MediaViewer
        visible={viewer !== null}
        items={viewer?.items ?? []}
        initialIndex={viewer?.index ?? 0}
        onClose={() => setViewer(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 17, flex: 1, textAlign: 'center' },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 22,
  },
  sectionTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  seeAll: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, flexShrink: 0 },
  skeleton: { height: 92, borderRadius: 16, borderWidth: 1, opacity: 0.5 },
  emptyText: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 18, marginTop: 10 },
  openAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    marginTop: 14,
    minHeight: 46,
  },
  openAllText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, flexShrink: 1 },
});
