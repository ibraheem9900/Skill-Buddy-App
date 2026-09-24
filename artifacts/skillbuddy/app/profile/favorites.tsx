import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import { useLanguage } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import { useBookmarks } from '@/context/BookmarkContext';
import useClientFavorites, { joinFavoriteWithService } from '@/hooks/useClientFavorites';

/**
 * My Favorites (GET /api/v1/clients/favorites) — the client's saved services.
 * Each favorite carries only service_id + notes + created_at; display data is
 * joined client-side from the local services catalog (no per-favorite API
 * calls). Fetch on screen entry + pull-to-refresh; CLIENT role only.
 */
export default function FavoritesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { activeRole } = useRole();
  const { status, favorites, total, errorMessage, load, refresh, removeFavorite } = useClientFavorites();
  const { removeBookmark } = useBookmarks();
  const [removingId, setRemovingId] = useState<number | null>(null);
  const canLoad = !!user && activeRole === 'CLIENT';

  /** Destructive removal — explicit confirm first (no undo), DELETE fires
   * only on confirm; the row drops only after the confirmed 204. */
  const confirmRemove = (favoriteId: number) => {
    Alert.alert(t('cf_remove_title'), t('cf_remove_msg'), [
      { text: t('action_cancel'), style: 'cancel' },
      {
        text: t('cf_remove_confirm'),
        style: 'destructive',
        onPress: () => {
          setRemovingId(favoriteId);
          (async () => {
            try {
              await removeFavorite(favoriteId);
              // Sync the heart icon on service cards: the removed favorite's
              // service un-fills everywhere (catalog id 's12'-style).
              const removed = favorites.find((f) => f.id === favoriteId);
              if (removed) removeBookmark(`s${removed.service_id}`);
            } catch (err: any) {
              const detail = err?.response?.data?.detail;
              Alert.alert(
                t('cf_title'),
                Array.isArray(detail)
                  ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ')
                  : t('cfv_err_generic'),
              );
            } finally {
              setRemovingId(null);
            }
          })();
        },
      },
    ]);
  };

  useFocusEffect(
    React.useCallback(() => {
      if (canLoad) void load();
    }, [canLoad, load]),
  );

  const savedOn = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('cf_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={status === 'loading' && favorites.length > 0}
            onRefresh={refresh}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      >
        {status === 'loading' && favorites.length === 0 ? (
          [0, 1, 2].map((i) => (
            <View key={i} style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={[styles.thumb, { backgroundColor: c.muted }]} />
              <ActivityIndicator size="small" color={c.primary} />
            </View>
          ))
        ) : status === 'error' ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <MaterialCommunityIcons name="wifi-off" size={22} color={c.destructive} />
            <Text style={[styles.stateText, { color: c.destructive }]}>
              {t(errorMessage ?? 'cf_err_network')}
            </Text>
            <TouchableOpacity onPress={refresh}>
              <Text style={[styles.stateAction, { color: c.primary }]}>{t('cf_retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : !canLoad ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="star" size={22} color={c.mutedForeground} />
            <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('cf_sign_in')}</Text>
          </View>
        ) : favorites.length === 0 ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <MaterialCommunityIcons name="heart-outline" size={26} color={c.mutedForeground} />
            <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('cf_empty')}</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/services' as any)}>
              <Text style={[styles.stateAction, { color: c.primary }]}>{t('home_browse_services')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={[styles.countLabel, { color: c.mutedForeground }]}>
              {t('cf_count', { n: total })}
            </Text>
            {favorites.map((favorite, i) => {
              const { service } = joinFavoriteWithService(favorite);
              return (
                <TouchableOpacity
                  key={favorite.id ?? `fav-${i}`}
                  style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}
                  onPress={() =>
                    favorite.id != null
                      ? router.push(`/profile/favorites/${favorite.id}` as any)
                      : service && router.push(`/service/${service.id}` as any)
                  }
                  activeOpacity={0.75}
                >
                  {service ? (
                    <Image source={{ uri: service.image }} style={styles.thumb} />
                  ) : (
                    <View style={[styles.thumb, styles.thumbFallback]}>
                      <MaterialCommunityIcons name="tag-outline" size={18} color={c.mutedForeground} />
                    </View>
                  )}
                  <View style={styles.body}>
                    <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
                      {service ? service.title : t('cf_unknown_service', { id: favorite.service_id })}
                    </Text>
                    {service && (
                      <Text style={[styles.sub, { color: c.mutedForeground }]} numberOfLines={1}>
                        €{service.price} · {service.provider.name}
                      </Text>
                    )}
                    {favorite.notes ? (
                      <Text style={[styles.notes, { color: c.mutedForeground }]} numberOfLines={2}>
                        “{favorite.notes}”
                      </Text>
                    ) : null}
                    <Text style={[styles.savedOn, { color: c.mutedForeground }]}>
                      {t('cf_saved_on', { date: savedOn(favorite.created_at) })}
                    </Text>
                  </View>
                  {removingId === favorite.id ? (
                    <ActivityIndicator size="small" color={c.destructive} />
                  ) : (
                    <TouchableOpacity
                      style={styles.removeBtn}
                      onPress={() => favorite.id != null && confirmRemove(favorite.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel={t('cf_remove_title')}
                    >
                      <Feather name="trash-2" size={17} color={c.destructive} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  countLabel: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginBottom: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
  thumb: { width: 56, height: 56, borderRadius: 12 },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  title: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  sub: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 1 },
  notes: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 3, fontStyle: 'italic' },
  savedOn: { fontFamily: 'Manrope_400Regular', fontSize: 10, marginTop: 3 },
  removeBtn: { padding: 4 },
  stateWrap: { alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 16, paddingVertical: 28, paddingHorizontal: 16 },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center' },
  stateAction: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
