/**
 * My Media — GET /api/v1/media-gallery/mine (the signed-in user's own uploads).
 *
 * WHERE THIS LIVES: reached from the Profile tab ("My Media") for BOTH roles.
 * The endpoint is scoped by the bearer token and carries `uploaded_by_side`
 * values for either side, so a provider and a client each get their own rows
 * from the same item; there is no separate provider-only screen to hang it on.
 * (Confirmed with nobody yet — the task brief asks the team which role owns the
 * screen; both roles are shown here and this note is the flag.)
 *
 * SCOPE: this task (Media Gallery · Update Media) turned the screen into the
 * OWNED surface: opening a photo shows its "Public"/"Private" chip and a pencil
 * in the viewer header, which opens the edit screen (caption + public switch).
 * Ownership here is CERTAIN — the list comes from GET /media-gallery/mine, which
 * the server scopes to the bearer token — so this is the only place in the app
 * that passes `isOwnMedia` to MediaViewer.
 *
 * Still absent on purpose: upload, delete, and any visibility toggle outside the
 * editor. `job_id` never reaches this component.
 *
 * STATES: first-load grid skeleton → grid; an EMPTY ARRAY is a calm empty state,
 * not an error; a failed first page is an error card with Retry; a failed NEXT
 * page keeps the loaded tiles and shows a small footer retry. Pull-to-refresh
 * replaces the list (offset 0); the list also revalidates when the screen
 * regains focus and when the app returns to the foreground.
 *
 * PER-TILE FACTS (all read-only): the Public/Private chip, the raw side badge
 * from `uploaded_by_side` (no enum is guessed — an unknown value is shown
 * verbatim; the list is NOT filtered by the active role, an open product
 * question), the caption, the localised date and the category name joined from
 * the ALREADY CACHED categories (no per-item request).
 *
 * DEAD IMAGE URLS: a tile that fails to load (a signed URL may have expired)
 * asks the screen for ONE throttled list refresh, on top of RemoteImage's own
 * tap-to-retry placeholder — never a permanently broken tile.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import BackButton from '@/components/BackButton';
import DotsLoader from '@/components/DotsLoader';
import MediaGalleryGrid from '@/components/MediaGalleryGrid';
import MediaViewer from '@/components/MediaViewer';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import useMyMedia, { type MyMediaFailure } from '@/hooks/useMyMedia';
import { useCachedCategories } from '@/hooks/useCategories';
import {
  formatMyMediaDate,
  myMediaCategoryLabel,
  myMediaSideLabel,
} from '@/lib/myMedia';
import { toGalleryViewerItems, type DisplayMedia } from '@/lib/mediaGallery';
import { toEditableMedia } from '@/lib/mediaEdit';
import { openEditMedia } from '@/components/EditMediaSheet';

/**
 * The first-load skeleton: the SAME responsive column maths as the grid, so the
 * screen never jumps when the real tiles arrive. No new component or animation —
 * plain muted squares in the app's tile radius.
 */
function MyMediaSkeleton() {
  const { colors: c } = useTheme();
  const { width } = useWindowDimensions();
  const gap = 8;
  const padding = 16;
  const columns = width < 600 ? 2 : width < 900 ? 3 : 4;
  const tile = Math.max(
    72,
    Math.floor((width - padding * 2 - gap * (columns - 1)) / columns)
  );
  return (
    <View style={[styles.skeleton, { gap }]}>
      {Array.from({ length: columns * 3 }, (_, index) => (
        <View
          key={`skeleton-${index}`}
          style={{ width: tile, height: tile, borderRadius: 12, backgroundColor: c.muted }}
        />
      ))}
    </View>
  );
}

function failureMessageKey(failure: MyMediaFailure | null) {
  switch (failure) {
    case 'offline':
      return 'gallery_offline' as const;
    case 'unauthorized':
      return 'gallery_unauthorized' as const;
    case 'invalid':
      return 'gallery_invalid' as const;
    case 'server':
      return 'gallery_server' as const;
    default:
      return 'gallery_unknown' as const;
  }
}

export default function MyMediaScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t, tCat, language } = useLanguage();
  const { user } = useAuth();

  const userId = user?.id ?? null;
  const { items, status, failure, loadingMore, loadMoreFailed, load, refresh, loadMore } =
    useMyMedia({ userId });

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  /**
   * Returning to the app is a natural refresh point (photos may have been added
   * or made private elsewhere). Silent: rows already on screen never flash.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh({ silent: true });
    });
    return () => subscription.remove();
  }, [refresh]);

  /** Category names come from the CACHED categories — never one call per tile. */
  const cachedCategories = useCachedCategories();
  const categoryNameById = useMemo(() => {
    const map = new Map<number, string>();
    (cachedCategories ?? []).forEach((category) => {
      const name = typeof category.name === 'string' ? category.name.trim() : '';
      if (name) map.set(category.id, name);
    });
    return map;
  }, [cachedCategories]);

  /** The row behind a tile, keyed by the id the grid already carries. */
  const entryById = useMemo(
    () => new Map(items.map((entry) => [entry.id, entry])),
    [items]
  );

  // `MediaUploaderSide` is confirmed as CLIENT | PROVIDER, so those two use the
  // app's own existing wording; anything unexpected is shown verbatim.
  const sideFor = useCallback(
    (item: DisplayMedia) =>
      myMediaSideLabel(entryById.get(item.id)?.uploadedBySide, {
        client: t('profile_client'),
        provider: t('profile_pilot'),
      }),
    [entryById, t]
  );

  /** date · category — whichever exist; never the word "null". */
  const metaFor = useCallback(
    (item: DisplayMedia) => {
      const entry = entryById.get(item.id);
      if (!entry) return null;
      const date = entry.createdAt ? formatMyMediaDate(entry.createdAt, language) : '';
      const category =
        entry.categoryId === null
          ? null
          : myMediaCategoryLabel(
              entry.categoryId,
              categoryNameById.get(entry.categoryId) ?? null,
              tCat(String(entry.categoryId))
            );
      const line = [date, category].filter((part) => !!part).join(' · ');
      return line.length > 0 ? line : null;
    },
    [categoryNameById, entryById, language, tCat]
  );

  /**
   * A tile that cannot load may be a signed URL that expired. Ask for ONE fresh
   * list, at most every 30 s, instead of leaving dead tiles behind.
   */
  const lastImageRecoveryRef = useRef(0);
  const onImageError = useCallback(() => {
    const now = Date.now();
    if (now - lastImageRecoveryRef.current < 30_000) return;
    lastImageRecoveryRef.current = now;
    void refresh({ silent: true });
  }, [refresh]);

  /** Read-only visibility label per tile — never a toggle. */
  const publicIds = useMemo(
    () => new Set(items.filter((entry) => entry.isPublic).map((entry) => entry.id)),
    [items]
  );
  const formatDate = useCallback(
    (iso: string) => formatMyMediaDate(iso, language),
    [language]
  );

  const viewerItems = useMemo(() => {
    if (viewerIndex === null) return [];
    // The viewer reads the SAME patched cache as the grid, so a caption or
    // visibility change made in the editor is visible the moment it reopens.
    return toGalleryViewerItems(items as unknown as DisplayMedia[], formatDate).map(
      (viewerItem, index) => ({
        ...viewerItem,
        badge: items[index]?.isPublic ? t('my_media_public') : t('my_media_private'),
      })
    );
  }, [items, viewerIndex, formatDate, t]);

  /**
   * Open the editor for the photo on screen. The viewer modal is closed first
   * (two stacked native modals are not reliable), and the opener asks for it
   * back on the same photo once the server confirms — so the updated caption is
   * on screen immediately.
   *
   * TODO (entry points): this viewer pencil is the only editor entry wired
   * today. A future grid-tile menu can reuse <EditMediaButton item={...} />
   * from the same owned list; public gallery rows must never get one (they
   * carry no owner id).
   */
  const openEditor = useCallback(
    (index: number) => {
      const entry = items[index];
      if (!entry) return;
      setViewerIndex(null);
      openEditMedia(toEditableMedia(entry), {
        onSaved: () => setViewerIndex(index),
      });
    },
    [items]
  );

  const firstLoad = status === 'loading' && items.length === 0;
  const failedWithNothing = status === 'error' && items.length === 0;

  const emptyComponent = !userId ? (
    <View style={styles.stateWrap}>
      <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Feather name="lock" size={28} color={c.mutedForeground} />
        <Text style={[styles.stateTitle, { color: c.text }]}>{t('my_media_sign_in_title')}</Text>
        <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
          {t('my_media_sign_in_sub')}
        </Text>
      </View>
    </View>
  ) : failedWithNothing ? (
    <View style={styles.stateWrap}>
      <View style={[styles.stateCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Feather
          name={failure === 'offline' ? 'wifi-off' : 'alert-circle'}
          size={30}
          color={c.destructive}
        />
        <Text style={[styles.stateTitle, { color: c.text }]}>{t('my_media_error_title')}</Text>
        <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
          {t(failureMessageKey(failure))}
        </Text>
        <TouchableOpacity
          style={[styles.stateBtn, { backgroundColor: c.primary }]}
          onPress={() => refresh()}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <Feather name="refresh-cw" size={15} color="#FFFFFF" />
          <Text style={styles.stateBtnText}>{t('try_again')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  ) : firstLoad ? (
    <MyMediaSkeleton />
  ) : status === 'ready' ? (
    <View style={styles.emptyWrap}>
      <View style={[styles.emptyIcon, { backgroundColor: c.primaryLight }]}>
        <Feather name="image" size={30} color={c.primary} />
      </View>
      <Text style={[styles.stateTitle, { color: c.text }]}>{t('my_media_empty_title')}</Text>
      <Text style={[styles.stateSub, { color: c.mutedForeground }]}>
        {t('my_media_empty_sub')}
      </Text>
    </View>
  ) : null;

  const footer = loadingMore ? (
    <View style={styles.footer}>
      <DotsLoader color={c.mutedForeground} size={6} gap={5} />
    </View>
  ) : loadMoreFailed && items.length > 0 ? (
    <TouchableOpacity
      style={styles.footerRetry}
      onPress={() => loadMore()}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      <Feather name="refresh-cw" size={14} color={c.primary} />
      <Text style={[styles.footerRetryText, { color: c.primary }]}>
        {t('my_media_load_more_failed')}
      </Text>
    </TouchableOpacity>
  ) : null;

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('my_media_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <MediaGalleryGrid
        media={items as unknown as DisplayMedia[]}
        onPressPhoto={userId ? (index) => setViewerIndex(index) : undefined}
        chipFor={
          userId ? (item) => (publicIds.has(item.id) ? t('my_media_public') : t('my_media_private')) : undefined
        }
        secondaryChipFor={userId ? sideFor : undefined}
        metaFor={userId ? metaFor : undefined}
        onImageError={userId ? onImageError : undefined}
        ListEmptyComponent={emptyComponent}
        ListFooterComponent={footer}
        onEndReached={() => loadMore()}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 28 }}
        refreshControl={
          <RefreshControl
            refreshing={status === 'loading' && items.length > 0}
            onRefresh={() => refresh()}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      />

      <MediaViewer
        visible={viewerIndex !== null}
        items={viewerItems}
        initialIndex={viewerIndex ?? 0}
        onClose={() => setViewerIndex(null)}
        onEndReached={() => loadMore()}
        isOwnMedia={!!userId}
        onEditMedia={userId ? openEditor : undefined}
      />
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
  center: { alignItems: 'center', paddingTop: 64 },
  stateWrap: { paddingTop: 48, paddingHorizontal: 8 },
  stateCard: {
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 26,
  },
  stateTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, textAlign: 'center' },
  stateSub: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 12,
  },
  stateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 24,
    minHeight: 44,
  },
  stateBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, color: '#FFFFFF' },
  emptyWrap: { alignItems: 'center', paddingTop: 56, gap: 10, paddingHorizontal: 12 },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { alignItems: 'center', paddingVertical: 18 },
  footerRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  footerRetryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  skeleton: { flexDirection: 'row', flexWrap: 'wrap', paddingTop: 16 },
});
