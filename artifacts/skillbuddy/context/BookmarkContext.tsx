import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import { useLanguage } from '@/context/LanguageContext';
import { catalogIdToServiceId } from '@/hooks/useClientFavorites';
import type { Service } from '@/types';

const BOOKMARKS_KEY = 'sb_bookmarks';

interface BookmarkContextType {
  bookmarks: Service[];
  isBookmarked: (id: string) => boolean;
  /** Heart tap: optimistic local toggle; for signed-in CLIENT users it also
   * persists via POST /api/v1/clients/favorites (reverted on failure). */
  toggleBookmark: (service: Service) => void;
  /** Local un-bookmark after a confirmed server-side favorite removal
   * (DELETE /clients/favorites/{id}) so hearts stay in sync everywhere. */
  removeBookmark: (serviceId: string) => void;
  /** True while a backend favorite-add is in flight. */
  savingToServer: boolean;
}

const BookmarkContext = createContext<BookmarkContextType | undefined>(undefined);

export function BookmarkProvider({ children }: { children: React.ReactNode }) {
  const [bookmarks, setBookmarks] = useState<Service[]>([]);
  const [savingToServer, setSavingToServer] = useState(false);
  const { user } = useAuth();
  const { activeRole } = useRole();
  const { t } = useLanguage();

  useEffect(() => {
    AsyncStorage.getItem(BOOKMARKS_KEY)
      .then((raw) => { if (raw) setBookmarks(JSON.parse(raw)); })
      .catch(() => {});
  }, []);

  const save = useCallback((items: Service[]) => {
    setBookmarks(items);
    AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(items)).catch(() => {});
  }, []);

  const isBookmarked = useCallback((id: string) => bookmarks.some((b) => b.id === id), [bookmarks]);

  const toggleBookmark = useCallback((service: Service) => {
    // 1) Optimistic local toggle (existing UX — icon fills immediately).
    let nowSaved = false;
    setBookmarks((prev) => {
      const exists = prev.some((b) => b.id === service.id);
      nowSaved = !exists;
      const next = exists ? prev.filter((b) => b.id !== service.id) : [...prev, service];
      AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });

    // 2) Server persistence for signed-in CLIENT users. The service_id comes
    // from the tapped service's catalog id ('s12' → 12) — never hardcoded.
    // On failure the optimistic change is REVERTED and the user is told.
    const canSync = !!user && activeRole === 'CLIENT';
    if (!canSync || !nowSaved) return; // signed-out/provider or un-save: local only (remove is a separate task)
    const serviceId = catalogIdToServiceId(service.id);
    if (serviceId == null) return; // non-numeric catalog id — nothing to send
    setSavingToServer(true);
    (async () => {
      try {
        const { authApi } = await import('@/services/api');
        await authApi.addClientFavorite(serviceId);
      } catch (err: any) {
        // Revert the optimistic add — the icon must not read "saved" when the
        // call failed (422 invalid service_id, network, 401 after refresh).
        setBookmarks((prev) => {
          const next = prev.filter((b) => b.id !== service.id);
          AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });
        const detail = err?.response?.data?.detail;
        const msg = Array.isArray(detail)
          ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ')
          : undefined;
        const { Alert } = await import('react-native');
        Alert.alert(
          t('cf_title'),
          err?.response
            ? (msg || t('cfv_err_generic'))
            : t('cfv_err_network'),
        );
      } finally {
        setSavingToServer(false);
      }
    })();
  }, [user, activeRole, t]);

  const removeBookmark = useCallback((serviceId: string) => {
    setBookmarks((prev) => {
      if (!prev.some((b) => b.id === serviceId)) return prev;
      const next = prev.filter((b) => b.id !== serviceId);
      AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return (
    <BookmarkContext.Provider value={{ bookmarks, isBookmarked, toggleBookmark, removeBookmark, savingToServer }}>
      {children}
    </BookmarkContext.Provider>
  );
}

export function useBookmarks() {
  const ctx = useContext(BookmarkContext);
  if (!ctx) throw new Error('useBookmarks must be used inside BookmarkProvider');
  return ctx;
}
