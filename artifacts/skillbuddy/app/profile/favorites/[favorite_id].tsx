import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import { useLanguage } from '@/context/LanguageContext';
import { useBookmarks } from '@/context/BookmarkContext';
import BackButton from '@/components/BackButton';
import { authApi } from '@/services/api';
import { joinFavoriteWithService, useClientFavorites } from '@/hooks/useClientFavorites';
import type { FavoriteItemResponse } from '@/types';

type DetailState = 'loading' | 'ready' | 'notfound' | 'error';

/**
 * Favorite detail (GET /api/v1/clients/favorites/{favorite_id}) — shows the
 * favorite record's own fields (id, service_id, notes, created_at) joined
 * with the local catalog's service display data when available. favorite_id
 * comes from the favorites list row (the RECORD id — not the service id).
 */
export default function FavoriteDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { activeRole } = useRole();
  const params = useLocalSearchParams<{ favorite_id?: string }>();
  const favoriteId = Number(Array.isArray(params.favorite_id) ? params.favorite_id[0] : params.favorite_id);

  const [state, setState] = useState<DetailState>('loading');
  const [favorite, setFavorite] = useState<FavoriteItemResponse | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  // Edit-notes state — pre-filled from the loaded favorite, edited via the
  // PATCH /clients/favorites/{favorite_id} endpoint (notes only, ≤500).
  const [editing, setEditing] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const { removeFavorite } = useClientFavorites();
  const { removeBookmark } = useBookmarks();
  const NOTES_MAX = 500; // live schema: notes maxLength 500 (nullable)

  /** Destructive removal from the detail screen — confirm first (no undo);
   * DELETE fires only on confirm and we navigate back on success. */
  const confirmRemove = () => {
    if (!favorite) return;
    Alert.alert(t('cf_remove_title'), t('cf_remove_msg'), [
      { text: t('action_cancel'), style: 'cancel' },
      {
        text: t('cf_remove_confirm'),
        style: 'destructive',
        onPress: () => {
          setRemoving(true);
          (async () => {
            try {
              await removeFavorite(favorite.id); // syncs the shared list cache
              // Un-fill the heart on the underlying service card.
              removeBookmark(`s${favorite.service_id}`);
              router.back();
            } catch (err: any) {
              const detail = err?.response?.data?.detail;
              Alert.alert(
                t('cf_title'),
                Array.isArray(detail)
                  ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ')
                  : t('cfv_err_generic'),
              );
            } finally {
              setRemoving(false);
            }
          })();
        },
      },
    ]);
  };

  const canLoad = !!user && activeRole === 'CLIENT' && Number.isFinite(favoriteId) && favoriteId > 0;

  const load = useCallback(async () => {
    if (!canLoad) return;
    setState('loading');
    setErrorDetail(null);
    try {
      const { data } = await authApi.getClientFavorite(favoriteId);
      setFavorite(data);
      setState('ready');
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404) {
        setState('notfound');
      } else if (status === 422) {
        const detail = err?.response?.data?.detail;
        const msg = Array.isArray(detail)
          ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ')
          : null;
        setErrorDetail(msg ?? null);
        setState('error');
      } else {
        setState('error');
      }
    }
  }, [canLoad, favoriteId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  /** Save flow: client-side ≤500 validation → PATCH { notes } → the FULL 200
   * response replaces the local record (server truth, never a local merge);
   * useClientFavorites' updateFavoriteNotes also syncs the list cache. No
   * optimistic update — on failure the editor stays open with the error. */
  const saveNotes = async () => {
    if (saving || !favorite) return;
    const trimmed = notesDraft.trim();
    if (trimmed.length > NOTES_MAX) {
      setNotesError(t('cfd_err_too_long', { max: NOTES_MAX }));
      return;
    }
    setSaving(true);
    setNotesError(null);
    try {
      const updated = (await authApi.updateClientFavorite(favorite.id, trimmed || null)).data;
      setFavorite(updated); // response = source of truth for this screen
      setEditing(false);
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      if (status === 422 && Array.isArray(detail)) {
        console.warn('favorites/{id} PATCH 422:', JSON.stringify(detail));
        setNotesError(detail.map((d: any) => d?.msg).filter(Boolean).join('; ') || t('cfd_err_generic'));
      } else if (err?.response) {
        setNotesError(t('cfd_err_generic'));
      } else {
        setNotesError(t('cfd_err_network'));
      }
    } finally {
      setSaving(false);
    }
  };

  const joined = favorite ? joinFavoriteWithService(favorite) : null;
  const service = joined?.service ?? null;
  const savedOn = favorite?.created_at
    ? (() => {
        const d = new Date(favorite.created_at);
        return Number.isNaN(d.getTime()) ? favorite.created_at : d.toLocaleDateString();
      })()
    : '';

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('cfd_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        {state === 'loading' ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <ActivityIndicator size="large" color={c.primary} />
          </View>
        ) : state === 'notfound' ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <MaterialCommunityIcons name="bookmark-off-outline" size={26} color={c.mutedForeground} />
            <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('cfd_not_found')}</Text>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={[styles.stateAction, { color: c.primary }]}>{t('cfd_back')}</Text>
            </TouchableOpacity>
          </View>
        ) : state === 'error' ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <MaterialCommunityIcons name="wifi-off" size={22} color={c.destructive} />
            <Text style={[styles.stateText, { color: c.destructive }]}>
              {errorDetail ?? t('cfd_err_network')}
            </Text>
            <TouchableOpacity onPress={() => void load()}>
              <Text style={[styles.stateAction, { color: c.primary }]}>{t('cfd_retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : !canLoad ? (
          <View style={[styles.stateWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="star" size={22} color={c.mutedForeground} />
            <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('cf_sign_in')}</Text>
          </View>
        ) : favorite ? (
          <>
            {/* Joined service preview — display data from the local catalog
                (the API response carries only the favorite record fields). */}
            <TouchableOpacity
              style={[styles.serviceCard, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={() => service && router.push(`/service/${service.id}` as any)}
              activeOpacity={service ? 0.75 : 1}
            >
              {service ? (
                <Image source={{ uri: service.image }} style={styles.serviceImage} />
              ) : (
                <View style={[styles.serviceImage, styles.serviceImageFallback]}>
                  <MaterialCommunityIcons name="tag-outline" size={22} color={c.mutedForeground} />
                </View>
              )}
              <View style={styles.serviceBody}>
                <Text style={[styles.serviceTitle, { color: c.text }]} numberOfLines={1}>
                  {service ? service.title : t('cf_unknown_service', { id: favorite.service_id })}
                </Text>
                {service && (
                  <Text style={[styles.serviceSub, { color: c.mutedForeground }]} numberOfLines={1}>
                    €{service.price} · {service.provider.name}
                  </Text>
                )}
                <Text style={[styles.serviceIdLine, { color: c.mutedForeground }]}>
                  {t('cfd_service_id', { id: favorite.service_id })}
                </Text>
              </View>
              {service && <Feather name="chevron-right" size={18} color={c.border} />}
            </TouchableOpacity>

            {/* The favorite record's own fields — notes are EDITABLE here via
                PATCH /clients/favorites/{favorite_id}; saved-on is read-only. */}
            <View style={[styles.detailCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={styles.detailRow}>
                <View style={styles.notesHeader}>
                  <Text style={[styles.detailLabel, { color: c.mutedForeground }]}>{t('cfd_notes')}</Text>
                  {!editing && (
                    <TouchableOpacity
                      onPress={() => {
                        setNotesDraft(favorite.notes ?? ''); // pre-fill from cached data
                        setNotesError(null);
                        setEditing(true);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[styles.editLink, { color: c.primary }]}>{t('cfd_edit')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {editing ? (
                  <>
                    <TextInput
                      style={[styles.notesInput, { color: c.text, borderColor: notesError ? c.destructive : c.border }]}
                      value={notesDraft}
                      onChangeText={setNotesDraft}
                      multiline
                      maxLength={NOTES_MAX + 50} // allow slight overflow so the inline error can show
                      placeholder={t('cfd_notes_placeholder')}
                      placeholderTextColor={c.mutedForeground}
                    />
                    <Text style={[styles.charCount, { color: c.mutedForeground }]}>
                      {notesDraft.trim().length}/{NOTES_MAX}
                    </Text>
                    {!!notesError && <Text style={[styles.notesErrorText, { color: c.destructive }]}>{notesError}</Text>}
                    <View style={styles.editActions}>
                      <TouchableOpacity
                        onPress={() => {
                          setEditing(false);
                          setNotesError(null);
                        }}
                        disabled={saving}
                      >
                        <Text style={[styles.cancelBtn, { color: c.mutedForeground }]}>{t('action_cancel')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.saveBtn, { backgroundColor: c.primary, opacity: saving ? 0.6 : 1 }]}
                        onPress={() => void saveNotes()}
                        disabled={saving}
                      >
                        {saving ? (
                          <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                          <Text style={styles.saveBtnText}>{t('cfd_save')}</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <Text style={[styles.detailValue, { color: c.text }]}>
                    {favorite.notes ? favorite.notes : t('cfd_no_notes')}
                  </Text>
                )}
              </View>
              <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.detailLabel, { color: c.mutedForeground }]}>{t('cfd_saved_on')}</Text>
                <Text style={[styles.detailValue, { color: c.text }]}>{savedOn}</Text>
              </View>
            </View>

            <Text style={[styles.recordLine, { color: c.mutedForeground }]}>
              {t('cfd_record_id', { id: favorite.id })}
            </Text>

            <TouchableOpacity
              style={[styles.removeCard, { backgroundColor: c.card, borderColor: c.destructive }]}
              onPress={confirmRemove}
              disabled={removing}
            >
              {removing ? (
                <ActivityIndicator size="small" color={c.destructive} />
              ) : (
                <>
                  <Feather name="trash-2" size={16} color={c.destructive} />
                  <Text style={[styles.removeText, { color: c.destructive }]}>{t('cf_remove_title')}</Text>
                </>
              )}
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
  serviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  serviceImage: { width: 64, height: 64, borderRadius: 12 },
  serviceImageFallback: { alignItems: 'center', justifyContent: 'center' },
  serviceBody: { flex: 1, minWidth: 0 },
  serviceTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  serviceSub: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 1 },
  serviceIdLine: { fontFamily: 'Manrope_400Regular', fontSize: 10, marginTop: 3 },
  detailCard: { borderWidth: 1, borderRadius: 16, overflow: 'hidden', marginBottom: 10 },
  detailRow: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, gap: 3 },
  detailLabel: { fontFamily: 'Manrope_400Regular', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  detailValue: { fontFamily: 'Manrope_500Medium', fontSize: 14 },
  notesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editLink: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  notesInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    minHeight: 70,
    textAlignVertical: 'top',
    marginTop: 6,
  },
  charCount: { fontFamily: 'Manrope_400Regular', fontSize: 10, marginTop: 4, textAlign: 'right' },
  notesErrorText: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 4 },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 14, marginTop: 8 },
  cancelBtn: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, minWidth: 70, alignItems: 'center' },
  saveBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: '#FFF' },
  removeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
  },
  removeText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  recordLine: { fontFamily: 'Manrope_400Regular', fontSize: 10, textAlign: 'center' },
  stateWrap: { alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 16, paddingVertical: 28, paddingHorizontal: 16 },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center' },
  stateAction: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
