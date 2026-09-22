import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  authApi,
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  setSessionExpiredHandler,
  setUserRefreshedHandler,
} from '@/services/api';
import type { User } from '@/types';

const ONBOARDING_KEY = 'sb_onboarding_seen';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasSeenOnboarding: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Local-only session wipe (no API call) — for flows where the server has
   * already invalidated the session (e.g. DELETE /auth/logout-all). */
  clearSession: () => Promise<void>;
  signup: (data: SignupData) => Promise<void>;
  refreshUser: () => Promise<void>;
  /**
   * Confirm/refresh the avatar from GET /users/profile-picture after an
   * upload or delete succeeds — the ONLY sanctioned use of that endpoint
   * (general display reads the cached /users/me profile_picture). Merges the
   * server's url (null when no picture is set) into the cached user so the
   * avatar updates app-wide without a full profile refetch.
   */
  syncProfilePicture: () => Promise<void>;
  /**
   * Update the avatar instantly from a successful upload's response url —
   * merges into the cached user so every screen re-renders without a refetch.
   * Pairs with syncProfilePicture() (server-confirmed refresh).
   */
  setProfilePicture: (url: string) => void;
  /**
   * Clear the avatar locally — call ONLY after DELETE /users/profile-picture
   * confirms success (never optimistically). Reverts every screen to the
   * default initial-letter avatar instantly.
   */
  clearProfilePicture: () => void;
  setOnboardingSeen: () => Promise<void>;
  /** Exchange a social OAuth token (Google/Apple) with our backend. */
  socialLogin: (provider: 'google' | 'apple', idToken: string) => Promise<void>;
  /**
   * TEMPORARY: signs the user straight in locally with whatever they typed,
   * no backend call and no validation. This exists only because signup-form
   * validation is intentionally disabled for now. Remove this and switch the
   * signup screen back to the real `signup` above once validation (and the
   * real signup → verify → login flow) is turned back on.
   */
  mockSignIn: (data: { first_name: string; last_name: string; email: string; profile_picture?: string }) => Promise<void>;
}

interface SignupData {
  email: string;
  personal_code: string;
  password: string;
  confirm_password: string;
  first_name: string;
  last_name: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Normalize a raw GET /users/me (or POST /auth/refresh) user object into the
 * app's User shape: profile_picture_url → profile_picture, phone_number →
 * phone. Done once here so every screen consumer keeps reading the same
 * fields regardless of which endpoint produced the object.
 */
function normalizeUser(raw: any): User {
  return {
    ...raw,
    profile_picture: raw?.profile_picture || raw?.profile_picture_url || undefined,
    phone: raw?.phone || raw?.phone_number || undefined,
  } as User;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(false);

  const fetchUser = useCallback(async () => {
    try {
      // GET /api/v1/users/me — Bearer auto-attached by the shared instance;
      // a 401 here flows through the silent-refresh interceptor before this
      // catch ever sees it. Stored once in context — screens read the cache.
      const { data } = await authApi.getMe();
      setUser(normalizeUser(data));
      return true;
    } catch {
      return false;
    }
  }, []);

  // Register the api-layer session-expired callback so token invalidation
  // during silent refresh clears the user state immediately.
  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
    // POST /auth/refresh returns a fresh user alongside the rotated tokens —
    // keep the cached user in sync so profile data never goes stale.
    setUserRefreshedHandler((incoming) => {
      if (incoming && typeof incoming === 'object' && 'id' in (incoming as object)) {
        setUser(normalizeUser(incoming));
      }
    });
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const [onboarding, token] = await Promise.all([
          AsyncStorage.getItem(ONBOARDING_KEY),
          SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
        ]);
        setHasSeenOnboarding(onboarding === 'true');
        if (token) await fetchUser();
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, [fetchUser]);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await authApi.login(email, password);
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.access_token);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refresh_token);
    const ok = await fetchUser();
    if (!ok) {
      // Tokens stored but /me failed — clean up so the app is not left in a
      // half-authenticated state.
      await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
      throw new Error('Unable to load user profile after login. Please try again.');
    }
  }, [fetchUser]);

  // Local-only wipe — shared by logout() and by server-initiated invalidation
  // flows (logout-all, session expiry) where no further API call makes sense.
  const clearSession = useCallback(async () => {
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    setUser(null);
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    await clearSession();
  }, [clearSession]);

  const signup = useCallback(async (data: SignupData) => {
    await authApi.signup(data);
  }, []);

  // TEMPORARY (see AuthContextType.mockSignIn above): no backend call, no
  // validation — just take whatever the user typed and sign them in with it.
  const mockSignIn = useCallback(async (data: { first_name: string; last_name: string; email: string; profile_picture?: string }) => {
    const localUser: User = {
      id: `local-${Date.now()}`,
      email: data.email,
      first_name: data.first_name,
      last_name: data.last_name,
      profile_picture: data.profile_picture,
    };
    setUser(localUser);
  }, []);

  const socialLogin = useCallback(async (provider: 'google' | 'apple', idToken: string) => {
    const { data } = await authApi.socialLogin(provider, idToken);
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.access_token);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refresh_token);
    const ok = await fetchUser();
    if (!ok) {
      await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
      throw new Error('Unable to load user profile after social login.');
    }
  }, [fetchUser]);

  const refreshUser = useCallback(async () => {
    await fetchUser();
  }, [fetchUser]);

  /**
   * Post-upload/delete avatar confirmation: GET /users/profile-picture →
   * merge { url } into the cached user. Display code keeps reading
   * user.profile_picture from context — no extra network traffic anywhere.
   * url can legitimately be null ("no picture set") — that clears the avatar
   * to the fallback rather than erroring. A network failure here is non-
   * fatal: the upload/delete already succeeded, and refreshUser() can resync.
   */
  const syncProfilePicture = useCallback(async () => {
    try {
      const { data } = await authApi.getProfilePicture();
      setUser((prev) => (prev ? { ...prev, profile_picture: data?.url ?? undefined } : prev));
    } catch {
      // Non-fatal by design — see doc comment.
    }
  }, []);

  const setOnboardingSeen = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    setHasSeenOnboarding(true);
  }, []);

  /** Instant avatar update from POST /users/profile-picture's response url. */
  const setProfilePicture = useCallback((url: string) => {
    setUser((prev) => (prev ? { ...prev, profile_picture: url } : prev));
  }, []);

  /** Local avatar clear — post-DELETE success only (see interface doc). */
  const clearProfilePicture = useCallback(() => {
    setUser((prev) => (prev ? { ...prev, profile_picture: undefined } : prev));
  }, []);

  return (
    <AuthContext.Provider        value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        hasSeenOnboarding,
        login,
        logout,
        clearSession,
        signup,
        refreshUser,
        syncProfilePicture,
        setProfilePicture,
        clearProfilePicture,
        setOnboardingSeen,
        socialLogin,
        mockSignIn,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
