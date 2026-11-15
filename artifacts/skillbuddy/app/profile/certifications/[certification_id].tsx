import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import MediaViewer from '@/components/MediaViewer';
import useCertifications from '@/hooks/useCertifications';
import {
  loadCertificationDetail,
  parseCertificationId,
} from '@/lib/certificationDetail';
import type { CertificationResponse } from '@/types';

/** File-extension helper — certification_url only (no name/type fields). */
function fileKind(url: string): 'image' | 'pdf' | 'file' {
  const clean = url.split('?')[0].toLowerCase();
  if (/\.(png|jpe?g|gif|webp|heic)$/.test(clean)) return 'image';
  if (/\.pdf$/.test(clean)) return 'pdf';
  return 'file';
}

/** Human filename from the URL, never the raw URL itself. */
function fileNameOf(url: string): string | null {
  const clean = url.split('?')[0];
  const last = clean.split('/').filter(Boolean).pop();
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * Certification detail (GET /api/v1/certifications/{certification_id}).
 * Cached-first load; the page shows the certificate itself, its upload date and
 * the two actions. The internal IDs and created/updated audit block are gone.
 */
export default function CertificationDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { user, isLoading: authLoading } = useAuth();
  const { activeRole } = useRole();
  const params = useLocalSearchParams<{ certification_id?: string }>();
  const certificationId = parseCertificationId(params.certification_id);
  const canLoad =
    !!user && !authLoading && activeRole === 'PROVIDER' && certificationId !== null;

  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [cert, setCert] = useState<CertificationResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<TranslationKey | null>(null);
  const [removing, setRemoving] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const { getById, certifications, remove } = useCertifications();

  const confirmRemove = () => {
    if (!cert) return;
    Alert.alert(t('cert_del_title'), t('cert_del_msg'), [
      { text: t('action_cancel'), style: 'cancel' },
      {
        text: t('cert_del_confirm'),
        style: 'destructive',
        onPress: async () => {
          setRemoving(true);
          try {
            await remove(cert.id);
            router.back();
          } finally {
            setRemoving(false);
          }
        },
      },
    ]);
  };

  const load = useCallback(async () => {
    if (!canLoad || certificationId === null) return;
    setState('loading');
    setErrorMessage(null);
    // The loader is cache-first but NEVER cache-gated: a direct/cold open with
    // no matching row always performs one server read. See
    // lib/certificationDetail for the regression this replaced.
    const result = await loadCertificationDetail(certificationId, {
      cached: certifications,
      fetchOne: getById,
    });
    if (result.status === 'ready') {
      setCert(result.cert);
      setState('ready');
      return;
    }
    setCert(null);
    if (result.status === 'notfound') {
      setState('notfound');
      return;
    }
    setErrorMessage('cert_err_network');
    setState('error');
  }, [canLoad, certificationId, certifications, getById]);

  React.useEffect(() => {
    void load();
    // `load` changes when sign-in/role resolves: a direct link must fetch once
    // the provider session is ready, not stay on the loader forever.
  }, [load]);

  // A direct open arrives before auth/role has resolved. Keep the header and
  // show the loader, not a misleading "sign in" card, while that settles.
  const waitingForSession = !user && authLoading;
  if (!canLoad && waitingForSession) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <View style={styles.header}>
          <BackButton onPress={() => router.back()} />
          <Text style={[styles.headerTitle, { color: c.text }]}>{t('certd_title')}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.stateWrap}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      </View>
    );
  }

  const openCertificate = async (url: string) => {
    if (fileKind(url) === 'image') {
      setViewerOpen(true);
      return;
    }
    try {
      const ok = await Linking.canOpenURL(url);
      if (!ok) throw new Error('cannot open');
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('certd_title'), t('cert_err_open'));
    }
  };

  const savedOn = (iso: string): string => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
  };

  if (!canLoad) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <View style={styles.stateWrap}>
          <Feather name="award" size={22} color={c.mutedForeground} />
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('cert_sign_in')}</Text>
        </View>
      </View>
    );
  }

  const kind = cert ? fileKind(cert.certification_url) : 'file';
  const title = cert ? fileNameOf(cert.certification_url) ?? t('cert_file_title') : '';
  const friendlyTitle = t('cert_file_title');

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <BackButton onPress={() => router.back()} />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('certd_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        {state === 'loading' ? (
          <View style={styles.stateWrap}>
            <ActivityIndicator size="large" color={c.primary} />
          </View>
        ) : state === 'error' ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="alert-circle" size={22} color={c.destructive} />
            <Text style={[styles.cardTitle, { color: c.destructive }]}>
              {t(errorMessage ?? 'cert_err_network')}
            </Text>
            <TouchableOpacity onPress={load} style={[styles.primaryBtn, { backgroundColor: c.primary }]}>
              <Text style={[styles.primaryBtnText, { color: c.primaryForeground }]}>
                {t('certd_retry')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : state === 'notfound' ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="search" size={22} color={c.mutedForeground} />
            <Text style={[styles.cardTitle, { color: c.mutedForeground }]}>
              {t('certd_not_found')}
            </Text>
            <TouchableOpacity onPress={load} style={[styles.primaryBtn, { backgroundColor: c.primary }]}>
              <Text style={[styles.primaryBtnText, { color: c.primaryForeground }]}>
                {t('certd_back')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {cert ? (
          <>
            <View style={[styles.previewCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => void openCertificate(cert.certification_url)}
                style={[styles.preview, { backgroundColor: c.muted }]}
                accessibilityRole="button"
                accessibilityLabel={title}
              >
                {kind === 'image' ? (
                  <Image
                    source={{ uri: cert.certification_url }}
                    style={styles.previewImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.filePreview}>
                    <View style={[styles.fileIcon, { backgroundColor: c.accent }]}>
                      <Feather
                        name={kind === 'pdf' ? 'file-text' : 'paperclip'}
                        size={34}
                        color={c.primary}
                      />
                    </View>
                    <Text style={[styles.fileName, { color: c.text }]} numberOfLines={2}>
                      {title}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              <View style={styles.body}>
                <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={1}>
                  {friendlyTitle}
                </Text>
                <Text
                  style={[styles.cardSub, { color: c.mutedForeground }]}
                  numberOfLines={1}
                  ellipsizeMode="middle"
                >
                  {title}
                </Text>
                <Text style={[styles.cardSub, { color: c.mutedForeground }]}>
                  {t('cert_saved_on', { date: savedOn(cert.created_at) })}
                </Text>
              </View>

              <View style={[styles.actions, { borderTopColor: c.border }]}>
                <TouchableOpacity
                  style={[styles.action, { borderRightColor: c.border }]}
                  onPress={() => void openCertificate(cert.certification_url)}
                  accessibilityRole="button"
                >
                  <Feather name={kind === 'image' ? 'maximize-2' : 'external-link'} size={16} color={c.primary} />
                  <Text
                    style={[styles.actionText, { color: c.primary }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    {t('cert_view')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.action}
                  onPress={confirmRemove}
                  disabled={removing}
                  accessibilityRole="button"
                >
                  {removing ? (
                    <ActivityIndicator size="small" color={c.destructive} />
                  ) : (
                    <Feather name="trash-2" size={16} color={c.destructive} />
                  )}
                  <Text
                    style={[styles.actionText, { color: c.destructive }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    {t('cert_remove_short')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>

      {cert ? (
        <MediaViewer
          visible={viewerOpen}
          items={[{ uri: cert.certification_url, title, kind: kind === 'image' ? 'image' : 'file' }]}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
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
  previewCard: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
  preview: { height: 230, width: '100%' },
  previewImage: { width: '100%', height: '100%' },
  filePreview: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  fileIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileName: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, textAlign: 'center' },
  body: { paddingHorizontal: 16, paddingVertical: 14, gap: 4 },
  cardTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
  cardSub: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  actions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingVertical: 12,
  },
  action: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 8,
  },
  actionText: { flexShrink: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  primaryBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, marginTop: 8 },
  primaryBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
