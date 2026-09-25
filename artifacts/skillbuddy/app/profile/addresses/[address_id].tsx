import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import useAddresses, { parseCoordinate } from '@/hooks/useAddresses';
import type { AddressResponse } from '@/types';

/** Formats an ISO date-time for display — never the raw string. */
const formatDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

/** Best-effort one-line title: formatted_address, then house+street, else a
 * generic label (schema fields are nullable). */
const addressTitle = (a: AddressResponse) => {
  const formatted = a.formatted_address?.trim();
  if (formatted) return formatted;
  const street = [a.house_number, a.street_address].filter(Boolean).join(' ').trim();
  if (street) return street;
  return null;
};

/**
 * Address detail (GET /api/v1/addresses/{address_id}).
 *
 * CACHE-FIRST (same discipline as the certifications detail screen): the
 * cached address from GET /api/v1/addresses has the SAME shape as this
 * endpoint's 200 ($ref AddressResponse), so a matching id renders with zero
 * network; the Bearer-protected fallback fetch only fires on deep links /
 * when no cache entry exists. 404/422 surface as a graceful "not available"
 * state (404 undocumented — web precedent), network failure shows a retry.
 * latitude/longitude are parsed via parseCoordinate (documented numeric
 * STRINGS whose example values are inflated placeholder junk — never
 * trusted as floats); rows are simply omitted when no sane value remains.
 * is_default renders a "Default" chip. No delete/edit here — sibling tasks.
 */
export default function AddressDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ address_id?: string }>();
  const raw = Array.isArray(params.address_id) ? params.address_id[0] : params.address_id;
  const addressId = Number(raw);
  const canLoad = !!user && Number.isFinite(addressId) && addressId > 0;

  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [address, setAddress] = useState<AddressResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<TranslationKey | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { getById, address: cached, remove, refresh } = useAddresses();

  /** Destructive removal — confirm first (no undo); DELETE fires only on
   * confirm and we navigate back on success (the cached row is already
   * gone via the shared hook). 204 has no body — status is the only truth.
   * DEFAULT-ADDRESS EDGE: the server's default re-assignment behavior is
   * not documented and unverifiable without credentials — the 204 returns
   * no body, so after deleting a default we surface an informational
   * notice and let the refetched list reveal server truth (no client-side
   * guessing/auto-promotion). */
  const confirmRemove = () => {
    if (!address) return;
    Alert.alert(t('addr_del_title'), t('addr_del_msg'), [
      { text: t('action_cancel'), style: 'cancel' },
      {
        text: t('addr_del_confirm'),
        style: 'destructive',
        onPress: () => {
          setDeleting(true);
          (async () => {
            const wasDefault = !!address.is_default;
            try {
              await remove(address.id); // syncs the shared cache after 204
              if (wasDefault) {
                Alert.alert(t('addr_title'), t('addr_del_default_note'));
              }
              router.back();
            } catch (err: any) {
              const status = err?.response?.status;
              if (status === 422) {
                // Stale/invalid id — the row may be gone server-side.
                Alert.alert(t('addr_title'), t('addr_del_err_stale'));
                void refresh();
                router.back();
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
              setDeleting(false);
            }
          })();
        },
      },
    ]);
  };

  /** Cache-first load (no network on a tap); fallback fetch for deep links.
   * Runs on EVERY focus (not just mount): after Edit Address saves, the
   * hook cache already holds the updated server response, so returning
   * here re-renders the fresh values with zero network. */
  const load = useCallback(async () => {
    if (!canLoad) return;
    setState('loading');
    setErrorMessage(null);
    // A matching cached entry short-circuits — zero network.
    if (cached && cached.id === addressId) {
      setAddress(cached);
      setState('ready');
      return;
    }
    try {
      const data = await getById(addressId);
      if (!data) {
        setState('notfound');
        return;
      }
      setAddress(data);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [canLoad, addressId, cached, getById]);

  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load]),
  );

  if (!canLoad) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="map-pin" size={22} color={c.mutedForeground} />
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('addr_sign_in')}</Text>
        </View>
      </View>
    );
  }

  const title = address ? addressTitle(address) : null;
  const regionLine = address
    ? [address.city?.name, address.county?.name, address.country?.name].filter(Boolean).join(', ')
    : '';
  const lat = address ? parseCoordinate(address.latitude, 'lat') : null;
  const lng = address ? parseCoordinate(address.longitude, 'lng') : null;

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('addr_d_title')}</Text>
        {state === 'ready' && address ? (
          <TouchableOpacity
            style={[styles.editBtn, { backgroundColor: c.accent }]}
            onPress={() => router.push(`/profile/edit-address?address_id=${address.id}`)}
            accessibilityLabel={t('addr_e_title')}
          >
            <Feather name="edit-3" size={16} color={c.primary} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        {state === 'loading' ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <ActivityIndicator size="large" color={c.primary} />
          </View>
        ) : state === 'error' ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="alert-circle" size={22} color={c.destructive} />
            <Text style={[styles.stateText, { color: c.destructive }]}>
              {t(errorMessage ?? 'addr_err_network')}
            </Text>
            <TouchableOpacity onPress={() => void load()} style={[styles.cardBtn, { backgroundColor: c.primary }]}>
              <Text style={styles.cardBtnText}>{t('addr_retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : state === 'notfound' ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="search" size={22} color={c.mutedForeground} />
            <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('addr_d_not_found')}</Text>
            <TouchableOpacity onPress={() => router.back()} style={[styles.cardBtn, { backgroundColor: c.primary }]}>
              <Text style={styles.cardBtnText}>{t('addr_d_back')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {state === 'ready' && address ? (
          <>
            <View
              style={[
                styles.card,
                styles.centerCard,
                { backgroundColor: c.card, borderColor: address.is_default ? c.primary : c.border },
              ]}
            >
              <View style={[styles.cardIcon, { backgroundColor: c.accent }]}>
                <Feather name="map-pin" size={20} color={c.primary} />
              </View>
              <View style={styles.cardBody}>
                <Text style={[styles.cardTitle, { color: c.text }]}>{title ?? t('addr_fallback_title')}</Text>
                {regionLine ? (
                  <Text style={[styles.cardSub, { color: c.mutedForeground }]}>{regionLine}</Text>
                ) : null}
              </View>
              {address.is_default ? (
                <View style={[styles.defaultChip, { backgroundColor: c.accent }]}>
                  <Feather name="star" size={11} color={c.primary} />
                  <Text style={[styles.defaultChipText, { color: c.primary }]}>{t('addr_default')}</Text>
                </View>
              ) : null}
            </View>

            <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>{t('addr_d_details')}</Text>
            <View style={[styles.metaCard, { backgroundColor: c.card, borderColor: c.border }]}>
              {address.house_number ? (
                <View style={styles.metaRow}>
                  <Text style={[styles.metaLabel, { color: c.mutedForeground }]}>{t('addr_c_house')}</Text>
                  <Text style={[styles.metaValue, { color: c.text }]}>{address.house_number}</Text>
                </View>
              ) : null}
              {address.street_address ? (
                <View style={styles.metaRow}>
                  <Text style={[styles.metaLabel, { color: c.mutedForeground }]}>{t('addr_c_street')}</Text>
                  <Text style={[styles.metaValue, { color: c.text }]}>{address.street_address}</Text>
                </View>
              ) : null}
              {address.postal_code ? (
                <View style={styles.metaRow}>
                  <Text style={[styles.metaLabel, { color: c.mutedForeground }]}>{t('addr_c_postal')}</Text>
                  <Text style={[styles.metaValue, { color: c.text }]}>{address.postal_code}</Text>
                </View>
              ) : null}
              {address.landmark ? (
                <View style={styles.metaRow}>
                  <Text style={[styles.metaLabel, { color: c.mutedForeground }]}>{t('addr_c_landmark')}</Text>
                  <Text style={[styles.metaValue, { color: c.text }]}>{address.landmark}</Text>
                </View>
              ) : null}
              {lat != null && lng != null ? (
                <View style={styles.metaRow}>
                  <Text style={[styles.metaLabel, { color: c.mutedForeground }]}>{t('addr_d_coordinates')}</Text>
                  <Text style={[styles.metaValue, { color: c.text }]}>
                    {lat.toFixed(5)}, {lng.toFixed(5)}
                  </Text>
                </View>
              ) : null}
              <View style={styles.metaRow}>
                <Text style={[styles.metaLabel, { color: c.mutedForeground }]}>{t('addr_d_id')}</Text>
                <Text style={[styles.metaValue, { color: c.text }]}>#{address.id}</Text>
              </View>
            </View>

            <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>{t('addr_d_meta')}</Text>
            <View style={[styles.metaCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={styles.metaRow}>
                <Text style={[styles.metaLabel, { color: c.mutedForeground }]}>{t('addr_added')}</Text>
                <Text style={[styles.metaValue, { color: c.text }]}>{formatDate(address.created_at)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={[styles.metaLabel, { color: c.mutedForeground }]}>{t('addr_updated')}</Text>
                <Text style={[styles.metaValue, { color: c.text }]}>{formatDate(address.updated_at)}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.removeCard, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={confirmRemove}
              disabled={deleting}
            >
              {deleting ? (
                <ActivityIndicator size="small" color={c.destructive} />
              ) : (
                <Feather name="trash-2" size={17} color={c.destructive} />
              )}
              <Text style={[styles.removeText, { color: c.destructive }]}>{t('addr_del_action')}</Text>
            </TouchableOpacity>
          </>
        ) : null}
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
  editBtn: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  removeCard: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  removeText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  centerCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
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
  cardBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  cardBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: '#FFF' },
  sectionLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, marginTop: 16, marginBottom: 8 },
  metaCard: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 8 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  metaLabel: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  metaValue: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, textAlign: 'right' },
  stateWrap: {
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center' },
});
