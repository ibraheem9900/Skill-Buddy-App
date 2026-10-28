import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import { useLanguage } from '@/context/LanguageContext';
import type { Service } from '@/types';
import { userScopedKey } from '@/lib/addressOwnership';

/**
 * Per-account storage key. The old global 'sb_bookmarks' let one account's
 * saved services (and the hearts that mark them) show up on the next account
 * after a logout — the same class of leak as the address cache. The id is part
 * of the key now, and the list is RELOADED whenever the signed-in account
 * changes.
 */
const BOOKMARKS_BASE = 'sb_bookmarks';

/**
 * Extract the numeric backend service_id from a service id. Accepts the
 * legacy local-catalog convention ('s12') and plain numeric ids ('12').
 * Local to this context since the shared local-catalog helper was removed
 * with the mock data.
 */
function numericServiceId(id: string | number): number | null {
  const n = Number(String(id).replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

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

  const storageKey = userScopedKey(BOOKMARKS_BASE, user?.id);

  // Load THIS account's list; a signed-out/other-account run starts empty. The
  // `active` flag drops a reply that arrives after the account changed again.
  useEffect(() => {
    let active = true;
    setBookmarks([]);
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!active) return;
        setBookmarks(raw ? (JSON.parse(raw) as Service[]) : []);
      })
      .catch(() => {
        if (active) setBookmarks([]);
      });
    return () => {
      active = false;
    };
  }, [storageKey]);

  const save = useCallback((items: Service[]) => {
    setBookmarks(items);
    AsyncStorage.setItem(storageKey, JSON.stringify(items)).catch(() => {});
  }, [storageKey]);

  const isBookmarked = useCallback((id: string) => bookmarks.some((b) => b.id === id), [bookmarks]);

  const toggleBookmark = useCallback((service: Service) => {
    // 1) Optimistic local toggle (existing UX — icon fills immediately).
    let nowSaved = false;
    setBookmarks((prev) => {
      const exists = prev.some((b) => b.id === service.id);
      nowSaved = !exists;
      const next = exists ? prev.filter((b) => b.id !== service.id) : [...prev, service];
      AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
      return next;
    });

    // 2) Server persistence for signed-in CLIENT users. The service_id comes
    // from the tapped service's catalog id ('s12' → 12) — never hardcoded.
    // On failure the optimistic change is REVERTED and the user is told.
    const canSync = !!user && activeRole === 'CLIENT';
    if (!canSync || !nowSaved) return; // signed-out/provider or un-save: local only (remove is a separate task)
    const serviceId = numericServiceId(service.id);
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
          AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
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
  }, [user, activeRole, t, storageKey]);

  const removeBookmark = useCallback((serviceId: string) => {
    setBookmarks((prev) => {
      if (!prev.some((b) => b.id === serviceId)) return prev;
      const next = prev.filter((b) => b.id !== serviceId);
      AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [storageKey]);

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
