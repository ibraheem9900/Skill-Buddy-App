import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Service } from '@/types';

const BOOKMARKS_KEY = 'sb_bookmarks';

interface BookmarkContextType {
  bookmarks: Service[];
  isBookmarked: (id: string) => boolean;
  toggleBookmark: (service: Service) => void;
}

const BookmarkContext = createContext<BookmarkContextType | undefined>(undefined);

export function BookmarkProvider({ children }: { children: React.ReactNode }) {
  const [bookmarks, setBookmarks] = useState<Service[]>([]);

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
    setBookmarks((prev) => {
      const exists = prev.some((b) => b.id === service.id);
      const next = exists ? prev.filter((b) => b.id !== service.id) : [...prev, service];
      AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return (
    <BookmarkContext.Provider value={{ bookmarks, isBookmarked, toggleBookmark }}>
      {children}
    </BookmarkContext.Provider>
  );
}

export function useBookmarks() {
  const ctx = useContext(BookmarkContext);
  if (!ctx) throw new Error('useBookmarks must be used inside BookmarkProvider');
  return ctx;
}
