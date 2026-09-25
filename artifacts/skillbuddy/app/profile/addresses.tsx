import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
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
import { useLanguage } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import useAddresses, { parseCoordinate } from '@/hooks/useAddresses';
import type { AddressResponse } from '@/types';

/** Formats an ISO date-time for display — never renders the raw string. */
const formatDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

/** Best-effort one-line title for an address: formatted_address first, then
 * house+street assembled, then a generic label (schema fields are all
 * nullable — the endpoint can return an address with no text fields). */
const addressTitle = (a: AddressResponse) => {
  const formatted = a.formatted_address?.trim();
  if (formatted) return formatted;
  const street = [a.house_number, a.street_address].filter(Boolean).join(' ').trim();
  if (street) return street;
  return null;
};

/**
 * Address book (GET /api/v1/addresses) — the signed-in user's saved address.
 * Fetched on screen entry + pull-to-refresh. The live OpenAPI Schema tab
 * shows the 200 body is a SINGLE AddressResponse object (not an array/
 * wrapper) — the hook normalizes defensively either way. Loading, empty
 * ("no address yet"), error (retry) and signed-out states are all rendered
 * here; is_default gets a star + badge. Create/Update/Delete Address (POST/
 * PUT/DELETE siblings, separate tasks) sync through the hook's setAddress()/
 * clear(), so this screen reflects them immediately.
 */
export default function AddressesScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { status, address, errorMessage, load, refresh, remove } = useAddresses();
  const [removing, setRemoving] = useState(false);

  /** Destructive removal from the list — confirm first (no undo); the row
   * drops ONLY after the confirmed 204 (no optimistic removal). 422 →
   * stale-id notice + refetch; other errors keep the row with a generic
   * message. Default-address edge: server behavior undocumented — surfaced
   * per the hook's contract, never guessed client-side. */
  const confirmRemove = () => {
    if (!address) return;
    Alert.alert(t('addr_del_title'), t('addr_del_msg'), [
      { text: t('action_cancel'), style: 'cancel' },
      {
        text: t('addr_del_confirm'),
        style: 'destructive',
        onPress: () => {
          setRemoving(true);
          (async () => {
            const wasDefault = !!address.is_default;
            try {
              await remove(address.id);
              if (wasDefault) {
                Alert.alert(t('addr_title'), t('addr_del_default_note'));
              }
            } catch (err: any) {
              const status = err?.response?.status;
              if (status === 422) {
                Alert.alert(t('addr_title'), t('addr_del_err_stale'));
                void refresh();
              } else {
                const detail = err?.response?.data?.detail;
                Alert.alert(
                  t('addr_title'),
                  Array.isArray(detail)
                    ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ')
                    : t('addr_del_err_generic'),
                );
              }
            } finally {
              setRemoving(false);
            }
          })();
        },
      },
    ]);
  };
  const router = useRouter();
  const canLoad = !!user;

  useFocusEffect(
    React.useCallback(() => {
      if (canLoad) void load();
    }, [canLoad, load]),
  );

  const title = address ? addressTitle(address) : null;
  const regionLine = address
    ? [address.city?.name, address.county?.name, address.country?.name].filter(Boolean).join(', ')
    : '';

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('addr_title')}</Text>
        {canLoad ? (
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: c.primary }]}
            onPress={() => router.push('/profile/add-address')}
            accessibilityLabel={t('addr_c_title')}
          >
            <Feather name="plus" size={17} color="#FFF" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={status === 'loading' && !!address}
            onRefresh={refresh}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      >
        {status === 'loading' && !address ? (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={[styles.rowIcon, { backgroundColor: c.accent }]}>
              <Feather name="map-pin" size={18} color={c.primary} />
            </View>
            <ActivityIndicator size="small" color={c.primary} />
          </View>
        ) : status === 'error' ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <MaterialCommunityIcons name="wifi-off" size={22} color={c.destructive} />
            <Text style={[styles.stateText, { color: c.destructive }]}>
              {t(errorMessage ?? 'addr_err_network')}
            </Text>
            <TouchableOpacity onPress={refresh}>
              <Text style={[styles.stateAction, { color: c.primary }]}>{t('addr_retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : !canLoad ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="map-pin" size={22} color={c.mutedForeground} />
            <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('addr_sign_in')}</Text>
          </View>
        ) : !address ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="map-pin" size={26} color={c.mutedForeground} />
            <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('addr_empty')}</Text>
            <Text style={[styles.emptyHint, { color: c.mutedForeground }]}>{t('addr_empty_hint')}</Text>
            <TouchableOpacity
              style={[styles.emptyAddBtn, { backgroundColor: c.primary }]}
              onPress={() => router.push('/profile/add-address')}
            >
              <Text style={styles.emptyAddText}>{t('addr_c_title')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.push(`/profile/addresses/${address.id}`)}
            accessibilityLabel={t('addr_d_title')}
          >
          <View style={[styles.card, { backgroundColor: c.card, borderColor: address.is_default ? c.primary : c.border }]}>
            <View style={styles.cardHead}>
              <View style={[styles.rowIcon, { backgroundColor: c.accent }]}>
                <Feather name="map-pin" size={18} color={c.primary} />
              </View>
              <View style={styles.body}>
                <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={2}>
                  {title ?? t('addr_fallback_title')}
                </Text>
                {regionLine ? (
                  <Text style={[styles.cardSub, { color: c.mutedForeground }]} numberOfLines={1}>
                    {regionLine}
                  </Text>
                ) : null}
              </View>
              {address.is_default ? (
                <View style={[styles.defaultChip, { backgroundColor: c.accent }]}>
                  <Feather name="star" size={11} color={c.primary} />
                  <Text style={[styles.defaultChipText, { color: c.primary }]}>{t('addr_default')}</Text>
                </View>
              ) : null}
              {removing ? (
                <ActivityIndicator size="small" color={c.destructive} />
              ) : (
                /* Nested Pressable takes precedence over the outer card tap
                 * (RN gesture system) — the trash never navigates. */
                <Pressable hitSlop={8} onPress={confirmRemove} accessibilityLabel={t('addr_del_confirm')}>
                  <Feather name="trash-2" size={16} color={c.destructive} />
                </Pressable>
              )}
            </View>

            {address.postal_code ? (
              <Text style={[styles.detailLine, { color: c.mutedForeground }]}>
                {t('addr_postal', { code: address.postal_code })}
              </Text>
            ) : null}
            {address.landmark ? (
              <Text style={[styles.detailLine, { color: c.mutedForeground }]}>
                {t('addr_landmark', { name: address.landmark })}
              </Text>
            ) : null}
            {/* Coordinates parsed safely (schema strings are junk-prone) —
              * row omitted entirely when no sane value survives. */}
            {(() => {
              const lat = parseCoordinate(address.latitude, 'lat');
              const lng = parseCoordinate(address.longitude, 'lng');
              return lat != null && lng != null ? (
                <Text style={[styles.detailLine, { color: c.mutedForeground }]} numberOfLines={1}>
                  {lat.toFixed(5)}, {lng.toFixed(5)}
                </Text>
              ) : null;
            })()}

            <View style={[styles.metaRow, { borderTopColor: c.border }]}>
              {address.created_at ? (
                <Text style={[styles.metaText, { color: c.mutedForeground }]}>
                  {t('addr_added', { date: formatDate(address.created_at) })}
                </Text>
              ) : null}
              {address.updated_at ? (
                <Text style={[styles.metaText, { color: c.mutedForeground }]}>
                  {t('addr_updated', { date: formatDate(address.updated_at) })}
                </Text>
              ) : null}
            </View>
          </View>
          </TouchableOpacity>
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
  addBtn: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  emptyAddBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, marginTop: 4 },
  emptyAddText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: '#FFF' },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  cardTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  cardSub: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 1 },
  defaultChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  defaultChipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 10 },
  detailLine: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, borderTopWidth: 1, paddingTop: 10 },
  metaText: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  stateWrap: { alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 16, paddingVertical: 28, paddingHorizontal: 16 },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center' },
  emptyHint: { fontFamily: 'Manrope_400Regular', fontSize: 11, textAlign: 'center' },
  stateAction: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
