import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { CATEGORIES, SUBSERVICES } from '@/data/mockData';
import { getServiceForSubservice } from '@/lib/serviceLookup';
import BackButton from '@/components/BackButton';
import useCategories from '@/hooks/useCategories';
import type { CategoryDetailResponse } from '@/types';

export default function CategoryDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t, tCat } = useLanguage();
  const { id } = useLocalSearchParams<{ id: string }>();

  // DUAL MODE: the route id is a LOCAL slug when tapped from the curated
  // fallback tiles ('plumbing'…) or a NUMERIC server id from API-backed
  // tiles. Only numeric ids hit GET /api/v1/categories/{category_id}
  // (public). The detail cache is separate from the list cache by design:
  // detail adds REQUIRED is_active/status the list items never carry.
  const numericId = id && /^\d+$/.test(String(id)) ? Number(id) : null;
  const isServer = numericId != null;
  const { getById } = useCategories();
  const [serverCat, setServerCat] = useState<CategoryDetailResponse | null>(null);
  const [serverState, setServerState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [iconFailed, setIconFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isServer) return;
    let cancelled = false;
    setServerState('loading');
    (async () => {
      try {
        const data = await getById(numericId as number);
        if (cancelled) return;
        if (!data) {
          setServerCat(null);
          setServerState('notfound'); // 404/422 verified live
          return;
        }
        setServerCat(data);
        setServerState('ready');
      } catch {
        if (!cancelled) setServerState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isServer, numericId, getById, reloadKey]);

  const category = CATEGORIES.find((cat) => cat.id === id) ?? CATEGORIES[0];
  const subservices = SUBSERVICES.filter((ss) => ss.categoryId === id);

  /** GATING: an inactive category is never presented as browsable — the
   * subservices list/action is replaced by an availability notice. status
   * semantics are undocumented (team question) so only is_active gates. */
  const isActive = isServer ? serverCat?.is_active !== false : true;

  const handleSubservicePress = (subserviceId: string) => {
    const service = getServiceForSubservice(subserviceId);
    router.push(`/service/${service.id}` as any);
  };

  /** Server-mode header card: name + description + icon (glyph fallback
   * for missing/broken icon_url). created_at/updated_at are informational
   * only and deliberately never displayed. */
  const serverHeader = serverCat ? (
    <View style={[styles.serverCard, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={[styles.serverIcon, { backgroundColor: c.muted }]}>
        {serverCat.icon_url && !iconFailed ? (
          <Image
            source={{ uri: serverCat.icon_url }}
            style={styles.serverIconImg}
            resizeMode="contain"
            onError={() => setIconFailed(true)}
          />
        ) : (
          <MaterialCommunityIcons name="shape-plus" size={26} color={c.primary} />
        )}
      </View>
      <View style={styles.serverBody}>
        <Text style={[styles.serverName, { color: c.text }]}>{serverCat.name}</Text>
        {serverCat.description ? (
          <Text style={[styles.serverDesc, { color: c.mutedForeground }]}>{serverCat.description}</Text>
        ) : null}
      </View>
      {!isActive ? (
        <View style={[styles.inactiveChip, { backgroundColor: c.muted, borderColor: c.border }]}>
          <Feather name="slash" size={12} color={c.mutedForeground} />
        </View>
      ) : null}
    </View>
  ) : null;

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: c.headerBg }]}>
        <BackButton />
        <Text style={styles.headerTitle}>{isServer && serverCat ? serverCat.name : tCat(category.id)}</Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={isServer && !isActive ? [] : subservices}
        keyExtractor={(ss) => ss.id}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          isServer ? (
            serverState === 'loading' ? (
              <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <ActivityIndicator size="small" color={c.primary} />
              </View>
            ) : serverState === 'error' ? (
              <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.destructive }]}>
                <Feather name="wifi-off" size={18} color={c.destructive} />
                <Text style={[styles.stateText, { color: c.destructive }]}>{t('cats_error')}</Text>
                <TouchableOpacity onPress={() => setReloadKey((k) => k + 1)} hitSlop={6}>
                  <Text style={[styles.stateRetry, { color: c.primary }]}>{t('cats_retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : serverState === 'notfound' ? (
              <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <Feather name="search" size={18} color={c.mutedForeground} />
                <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('catd_not_found')}</Text>
                <TouchableOpacity onPress={() => router.back()} hitSlop={6}>
                  <Text style={[styles.stateRetry, { color: c.primary }]}>{t('addr_d_back')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              serverHeader
            )
          ) : null
        }
        ListEmptyComponent={
          isServer && !isActive ? (
            <View style={styles.emptyWrap}>
              <Feather name="slash" size={40} color={c.border} />
              <Text style={[styles.emptyText, { color: c.mutedForeground }]}>{t('catd_inactive')}</Text>
            </View>
          ) : isServer && serverState === 'ready' && isActive ? (
            <View style={styles.emptyWrap}>
              <Feather name="inbox" size={40} color={c.border} />
              <Text style={[styles.emptyText, { color: c.mutedForeground }]}>{t('catd_services_empty')}</Text>
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <Feather name="inbox" size={40} color={c.border} />
              <Text style={[styles.emptyText, { color: c.mutedForeground }]}>{t('category_no_subservices')}</Text>
            </View>
          )
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 60).duration(350)}>
            <TouchableOpacity
              style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={() => handleSubservicePress(item.id)}
              activeOpacity={0.82}
            >
              <View style={[styles.iconCircle, { backgroundColor: c.primaryLight }]}>
                <Feather name="tool" size={20} color={c.primary} />
              </View>
              <View style={styles.cardBody}>
                <Text style={[styles.cardTitle, { color: c.text }]}>{item.name}</Text>
                <Text style={[styles.cardDesc, { color: c.mutedForeground }]} numberOfLines={2}>
                  {item.description}
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={c.mutedForeground} />
            </TouchableOpacity>
          </Animated.View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  headerTitle: {
    flex: 1,
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    color: '#FFF',
    textAlign: 'center',
  },
  serverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  serverIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  serverIconImg: { width: 30, height: 30 },
  serverBody: { flex: 1, minWidth: 0 },
  serverName: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  serverDesc: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 2 },
  inactiveChip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateCard: {
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center' },
  stateRetry: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 15, marginBottom: 3 },
  cardDesc: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 18 },
  emptyWrap: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyText: { fontFamily: 'Manrope_400Regular', fontSize: 14 },
});
