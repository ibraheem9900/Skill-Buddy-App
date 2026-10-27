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
import { markNearbyStale } from '@/lib/nearbyStale';
import { addressLocationStatus } from '@/lib/providerAddress';
import { formatAddressLine, formatAddressRegion } from '@/lib/addressFormat';
import type { AddressResponse } from '@/types';

/** Formats an ISO date-time for display — never renders the raw string. */
const formatDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

/** The card's one-line title, composed from the CURRENT fields by the shared
 * formatter (see lib/addressFormat) — never from the legacy `formatted_address`,
 * which the server does not recompute and which therefore goes stale. */
const addressTitle = (a: AddressResponse) => {
  const line = formatAddressLine(a);
  return line.length > 0 ? line : null;
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
 *
 * PROVIDER VISIBILITY: the card carries a "Location saved" / "Location missing"
 * status derived from the REAL latitude/longitude (lib/providerAddress, the same
 * parseCoordinate the rest of the app uses) — never from whether a text field
 * was filled in. A provider without coordinates is invisible to the nearby feed
 * (verified live: GET /providers/me/nearby-jobs → 400 "You are not visible for
 * nearby jobs..."), which is why deleting the only address gets the stronger,
 * provider-specific confirmation below, and why the nearby feed is marked stale
 * after a confirmed delete.
 */
export default function AddressesScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { status, address, errorMessage, load, refresh, remove } = useAddresses();
  const [removing, setRemoving] = useState(false);
  /** Providers lose their nearby feed when the last address goes — say so. */
  const isProvider = Array.isArray(user?.roles) && user.roles.includes('PROVIDER');
  /** Derived from real coordinates, not from the saved text fields. */
  const locationSaved = addressLocationStatus(address) === 'saved';

  /** Destructive removal from the list — confirm first (no undo); the row
   * drops ONLY after the confirmed 204 (no optimistic removal). 422 →
   * stale-id notice + refetch; other errors keep the row with a generic
   * message. Default-address edge: server behavior undocumented — surfaced
   * per the hook's contract, never guessed client-side. */
  const confirmRemove = () => {
    if (!address) return;
    // The provider-specific sentence is the VERIFIED live consequence of having
    // no address with coordinates; everyone else gets the plain confirmation.
    const message = isProvider
      ? `${t('provider_addr_delete_warning')}\n\n${t('addr_del_msg')}`
      : t('addr_del_msg');
    Alert.alert(t('addr_del_title'), message, [
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
              // The provider's visibility inputs changed: the nearby feed must
              // re-read (it will show its onboarding card once it does).
              markNearbyStale();
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
  const regionLine = address ? formatAddressRegion(address) : '';

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
            <Feather name="plus" size={17} color={c.primaryForeground} />
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
              <Text style={[styles.emptyAddText, { color: c.primaryForeground }]}>{t('addr_c_title')}</Text>
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
              <View
                style={[
                  styles.rowIcon,
                  { backgroundColor: locationSaved ? c.successLight : c.accent },
                ]}
              >
                <Feather
                  name="map-pin"
                  size={18}
                  color={locationSaved ? c.success : c.mutedForeground}
                />
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

            {/* Real-coordinate status: "saved" only when BOTH parsed values exist. */}
            <View
              style={[
                styles.locRow,
                {
                  backgroundColor: locationSaved ? c.successLight : c.accent,
                  borderColor: locationSaved ? c.success : c.border,
                },
              ]}
            >
              <Feather
                name={locationSaved ? 'check-circle' : 'alert-circle'}
                size={14}
                color={locationSaved ? c.success : c.mutedForeground}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.locTitle,
                    { color: locationSaved ? c.success : c.mutedForeground },
                  ]}
                >
                  {locationSaved
                    ? t('provider_addr_location_saved')
                    : t('provider_addr_location_missing')}
                </Text>
                <Text style={[styles.locSub, { color: c.mutedForeground }]}>
                  {locationSaved
                    ? t('provider_addr_location_saved_sub')
                    : t('provider_addr_location_missing_sub')}
                </Text>
              </View>
            </View>

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
  emptyAddText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
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
  locRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginTop: 12,
  },
  locTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  locSub: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 2, lineHeight: 15 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, borderTopWidth: 1, paddingTop: 10 },
  metaText: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  stateWrap: { alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 16, paddingVertical: 28, paddingHorizontal: 16 },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center' },
  emptyHint: { fontFamily: 'Manrope_400Regular', fontSize: 11, textAlign: 'center' },
  stateAction: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
