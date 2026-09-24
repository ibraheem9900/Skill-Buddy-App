import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import { useLanguage } from '@/context/LanguageContext';
import BackButton from '@/components/BackButton';
import useCertifications from '@/hooks/useCertifications';
import { useRouter } from 'expo-router';
import useCertificationUpload from '@/hooks/useCertificationUpload';
import type { CertificationResponse } from '@/types';

/** File-extension helpers for icon/label choice (certification_url only —
 * the API carries no name/type fields). */
function fileKind(url: string): 'image' | 'pdf' | 'file' {
  const clean = url.split('?')[0].toLowerCase();
  if (/\.(png|jpe?g|gif|webp|heic)$/.test(clean)) return 'image';
  if (/\.pdf$/.test(clean)) return 'pdf';
  return 'file';
}

/**
 * Certifications (GET /api/v1/certifications) — the authenticated provider's
 * uploaded certificates. Wrapped list { certifications, total }; fetched on
 * screen entry + pull-to-refresh. certification_url opens via the platform
 * viewer/browser (Agreed approach: external link — no inline preview until
 * the backend confirms file types). Upload = POST sibling, a separate task.
 */
export default function CertificationsScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { activeRole } = useRole();
  const { status, certifications, total, errorMessage, load, refresh, remove } = useCertifications();
  const router = useRouter();
  const { pickAndUpload, uploading } = useCertificationUpload();
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const canLoad = !!user && activeRole === 'PROVIDER';

  /** Destructive removal — confirm first (no undo); DELETE fires only on
   * confirm and the row drops only after confirmed success. */
  const confirmRemove = (cert: { id: number }) => {
    Alert.alert(t('cert_del_title'), t('cert_del_msg'), [
      { text: t('action_cancel'), style: 'cancel' },
      {
        text: t('cert_del_confirm'),
        style: 'destructive',
        onPress: () => {
          setRemovingId(cert.id);
          (async () => {
            try {
              await remove(cert.id); // syncs the shared list cache
              Alert.alert(t('cert_title'), t('cert_del_success'));
            } catch (err: any) {
              const detail = err?.response?.data?.detail;
              Alert.alert(
                t('cert_upload_error_title'),
                Array.isArray(detail)
                  ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ')
                  : t('cert_del_err_generic'),
              );
              // Stale-id safety net: re-sync the list from the server.
              void refresh();
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

  const openCertificate = async (cert: CertificationResponse) => {
    setOpeningId(cert.id);
    try {
      const ok = await Linking.canOpenURL(cert.certification_url);
      if (!ok) throw new Error('cannot open');
      await Linking.openURL(cert.certification_url);
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

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('cert_title')}</Text>
        {canLoad ? (
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: uploading ? c.border : c.primary }]}
            onPress={() => void pickAndUpload()}
            disabled={uploading}
            accessibilityLabel={t('cert_add')}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Feather name="plus" size={17} color="#FFF" />
            )}
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
            refreshing={status === 'loading' && certifications.length > 0}
            onRefresh={refresh}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      >
        {status === 'loading' && certifications.length === 0 ? (
          [0, 1].map((i) => (
            <View key={i} style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={[styles.rowIcon, { backgroundColor: c.accent }]}>
                <Feather name="award" size={18} color={c.primary} />
              </View>
              <ActivityIndicator size="small" color={c.primary} />
            </View>
          ))
        ) : status === 'error' ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <MaterialCommunityIcons name="wifi-off" size={22} color={c.destructive} />
            <Text style={[styles.stateText, { color: c.destructive }]}>
              {t(errorMessage ?? 'cert_err_network')}
            </Text>
            <TouchableOpacity onPress={refresh}>
              <Text style={[styles.stateAction, { color: c.primary }]}>{t('cert_retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : !canLoad ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="award" size={22} color={c.mutedForeground} />
            <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('cert_sign_in')}</Text>
          </View>
        ) : certifications.length === 0 ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="award" size={26} color={c.mutedForeground} />
            <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('cert_empty')}</Text>
            <Text style={[styles.emptyHint, { color: c.mutedForeground }]}>{t('cert_empty_hint')}</Text>
            <TouchableOpacity
              style={[styles.emptyUploadBtn, { backgroundColor: c.primary, opacity: uploading ? 0.6 : 1 }]}
              onPress={() => void pickAndUpload()}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={styles.emptyUploadText}>{t('cert_add')}</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={[styles.countLabel, { color: c.mutedForeground }]}>
              {t('cert_count', { n: total })}
            </Text>
            {certifications.map((cert, i) => {
              const kind = fileKind(cert.certification_url);
              return (
                <View
                  key={cert.id ?? `cert-${i}`}
                  style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}
                >
                  <View style={[styles.rowIcon, { backgroundColor: c.accent }]}>
                    <Feather
                      name={kind === 'pdf' ? 'file-text' : kind === 'image' ? 'image' : 'file'}
                      size={18}
                      color={c.primary}
                    />
                  </View>
                  <View style={styles.body}>
                    <Text style={[styles.rowTitle, { color: c.text }]} numberOfLines={1}>
                      {t(kind === 'pdf' ? 'cert_kind_pdf' : kind === 'image' ? 'cert_kind_image' : 'cert_kind_file', { n: i + 1 })}
                    </Text>
                    <Text style={[styles.rowSub, { color: c.mutedForeground }]} numberOfLines={1}>
                      {t('cert_saved_on', { date: savedOn(cert.created_at) })}
                    </Text>
                  </View>
                  {removingId === cert.id ? (
                    <ActivityIndicator size="small" color={c.destructive} />
                  ) : (
                    <View style={styles.rowActions}>
                      <TouchableOpacity
                        style={[styles.viewBtn, { borderColor: c.border }]}
                        onPress={() => void router.push(`/profile/certifications/${cert.id}`)}
                      >
                        <Text style={[styles.viewBtnText, { color: c.primary }]}>{t('cert_view')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.delBtn, { borderColor: c.border }]}
                        onPress={() => confirmRemove(cert)}
                        accessibilityLabel={t('cert_del_confirm')}
                      >
                        <Feather name="trash-2" size={15} color={c.destructive} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
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
  addBtn: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  countLabel: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginBottom: 10 },
  emptyUploadBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, marginTop: 4 },
  emptyUploadText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: '#FFF' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  rowSub: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 1 },
  viewBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  viewBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  delBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  stateWrap: { alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 16, paddingVertical: 28, paddingHorizontal: 16 },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center' },
  emptyHint: { fontFamily: 'Manrope_400Regular', fontSize: 11, textAlign: 'center' },
  stateAction: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
