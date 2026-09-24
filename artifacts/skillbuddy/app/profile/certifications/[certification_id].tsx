import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import useCertifications from '@/hooks/useCertifications';
import type { CertificationResponse } from '@/types';

/** File-extension helper — certification_url only (no name/type fields). */
function fileKind(url: string): 'image' | 'pdf' | 'file' {
  const clean = url.split('?')[0].toLowerCase();
  if (/\.(png|jpe?g|gif|webp|heic)$/.test(clean)) return 'image';
  if (/\.pdf$/.test(clean)) return 'pdf';
  return 'file';
}

/**
 * Certification detail (GET /api/v1/certifications/{certification_id}).
 * Same shape as a list item (live OpenAPI: $ref CertificationResponse), so a
 * cached list entry already carries every field — taps use the cached object,
 * the network call only fires as a fallback when no cache entry exists.
 * Loading → ready/notfound/error states; retry on network failure.
 */
export default function CertificationDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { activeRole } = useRole();
  const params = useLocalSearchParams<{ certification_id?: string }>();
  const raw = Array.isArray(params.certification_id) ? params.certification_id[0] : params.certification_id;
  const certificationId = Number(raw);
  const canLoad = !!user && activeRole === 'PROVIDER' && Number.isFinite(certificationId) && certificationId > 0;

  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [cert, setCert] = useState<CertificationResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<TranslationKey | null>(null);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const { getById, certifications, remove } = useCertifications();

  /** Destructive removal — confirm first (no undo); DELETE fires only on
   * confirm and we navigate back on success (the list row is already gone
   * via the shared cache). 422/404 surface via the hook/web precedent. */
  const confirmRemove = () => {
    if (!cert) return;
    Alert.alert(t('cert_del_title'), t('cert_del_msg'), [
      { text: t('action_cancel'), style: 'cancel' },
      {
        text: t('cert_del_confirm'),
        style: 'destructive',
        onPress: () => {
          setRemoving(true);
          (async () => {
            try {
              await remove(cert.id); // syncs the shared list cache
              router.back();
            } catch (err: any) {
              const detail = err?.response?.data?.detail;
              Alert.alert(
                t('cert_upload_error_title'),
                Array.isArray(detail)
                  ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ')
                  : t('cert_del_err_generic'),
              );
            } finally {
              setRemoving(false);
            }
          })();
        },
      },
    ]);
  };

  /** Cached-first load (no network on a tap); fallback fetch only for deep links. */
  const load = useCallback(async () => {
    if (!canLoad) return;
    setState('loading');
    setErrorMessage(null);
    const cached = certifications.find((c) => c.id === certificationId);
    if (cached) {
      setCert(cached);
      setState('ready');
      return;
    }
    try {
      const data = await getById(certificationId);
      if (!data) { setState('notfound'); return; }
      setCert(data);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [canLoad, certificationId, certifications, getById]);

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCertificate = async (url: string) => {
    setOpeningId(certificationId);
    try {
      const ok = await Linking.canOpenURL(url);
      if (!ok) throw new Error('cannot open');
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('cert_title'), t('cert_err_open'));
    } finally {
      setOpeningId(null);
    }
  };

  const savedOn = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
  };

  if (!canLoad) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="award" size={22} color={c.mutedForeground} />
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('cert_sign_in')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton onPress={() => router.back()} />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('certd_title')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        {state === 'loading' ? (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <ActivityIndicator size="large" color={c.primary} />
          </View>
        ) : state === 'error' ? (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="alert-circle" size={22} color={c.destructive} />              <Text style={[styles.cardTitle, { color: c.destructive }]}>{t(errorMessage ?? 'cert_err_network')}</Text>
              <TouchableOpacity onPress={load} style={[styles.cardBtn, { backgroundColor: c.primary }]}>
                <Text style={[styles.cardBtnText, { color: '#FFF' }]}>{t('certd_retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : state === 'notfound' ? (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="search" size={22} color={c.mutedForeground} />
            <Text style={[styles.cardTitle, { color: c.mutedForeground }]}>{t('certd_not_found')}</Text>
            <TouchableOpacity onPress={load} style={[styles.cardBtn, { backgroundColor: c.primary }]}>
              <Text style={[styles.cardBtnText, { color: '#FFF' }]}>{t('certd_back')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {cert ? (
          <>
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={[styles.cardIcon, { backgroundColor: c.accent }]}>
                <Feather
                  name={fileKind(cert.certification_url) === 'pdf' ? 'file-text' : 'image'}
                  size={20}
                  color={c.primary}
                />
              </View>
              <View style={styles.cardBody}>
                <Text style={[styles.cardTitle, { color: c.text }]}>{t('certd_title')} #{cert.id}</Text>
                <Text style={[styles.cardSub, { color: c.mutedForeground }]}>
                  {t('cert_saved_on', { date: savedOn(cert.created_at) })}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.cardAction}
                onPress={() => void openCertificate(cert.certification_url)}
                disabled={openingId === cert.id}
              >
                {openingId === cert.id ? (
                  <ActivityIndicator size="small" color={c.primary} />
                ) : (
                  <Text style={[styles.cardActionText, { color: c.primary }]}>{t('cert_view')}</Text>
                )}
              </TouchableOpacity>
            </View>

            <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>{t('certd_details')}</Text>
            <View style={[styles.metaCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={styles.metaRow}>
                <View style={[styles.metaIcon, { backgroundColor: c.accent }]}>
                  <Text style={[styles.metaIconText, { color: c.primary }]}>ID</Text>
                </View>
                <Text style={[styles.metaValue, { color: c.text }]}>{cert.id}</Text>
              </View>
              <View style={styles.metaRow}>
                <View style={[styles.metaIcon, { backgroundColor: c.accent }]}>
                  <Text style={[styles.metaIconText, { color: c.primary }]}>Provider</Text>
                </View>
                <Text style={[styles.metaValue, { color: c.text }]}>#{cert.provider_id}</Text>
              </View>
              <View style={styles.metaRow}>
                <View style={[styles.metaIcon, { backgroundColor: c.accent }]}>
                  <Text style={[styles.metaIconText, { color: c.primary }]}>Created</Text>
                </View>
                <Text style={[styles.metaValue, { color: c.text }]}>{savedOn(cert.created_at)}</Text>
              </View>
              <View style={styles.metaRow}>
                <View style={[styles.metaIcon, { backgroundColor: c.accent }]}>
                  <Text style={[styles.metaIconText, { color: c.primary }]}>Updated</Text>
                </View>
                <Text style={[styles.metaValue, { color: c.text }]}>{savedOn(cert.updated_at)}</Text>
              </View>
              {cert.created_by != null && (
                <View style={styles.metaRow}>
                  <View style={[styles.metaIcon, { backgroundColor: c.accent }]}>
                    <Text style={[styles.metaIconText, { color: c.primary }]}>Created by</Text>
                  </View>
                  <Text style={[styles.metaValue, { color: c.text }]}>User #{cert.created_by}</Text>
                </View>
              )}
              {cert.updated_by != null && (
                <View style={styles.metaRow}>
                  <View style={[styles.metaIcon, { backgroundColor: c.accent }]}>
                    <Text style={[styles.metaIconText, { color: c.primary }]}>Updated by</Text>
                  </View>
                  <Text style={[styles.metaValue, { color: c.text }]}>User #{cert.updated_by}</Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[styles.removeCard, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={confirmRemove}
              disabled={removing}
            >
              {removing ? (
                <ActivityIndicator size="small" color={c.destructive} />
              ) : (
                <MaterialCommunityIcons name="trash-can-outline" size={18} color={c.destructive} />
              )}
              <Text style={[styles.removeText, { color: c.destructive }]}>{t('cert_del_action')}</Text>
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
  stateWrap: {
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center' },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 1 },
  cardAction: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  cardActionText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  cardBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, marginTop: 8 },
  cardBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  sectionLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, marginTop: 16, marginBottom: 8 },
  metaCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 8,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  metaIconText: { fontFamily: 'Manrope_600SemiBold', fontSize: 8 },
  metaValue: { fontFamily: 'Manrope_400Regular', fontSize: 13 },
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
});
