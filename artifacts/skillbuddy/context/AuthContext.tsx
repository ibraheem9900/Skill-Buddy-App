import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi, ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, setSessionExpiredHandler } from '@/services/api';
import type { User } from '@/types';

const ONBOARDING_KEY = 'sb_onboarding_seen';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasSeenOnboarding: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (data: SignupData) => Promise<void>;
  refreshUser: () => Promise<void>;
  setOnboardingSeen: () => Promise<void>;
}

interface SignupData {
  email: string;
  password: string;
  confirm_password: string;
  first_name: string;
  last_name: string;
  personal_code?: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(false);

  const fetchUser = useCallback(async () => {
    try {
      const { data } = await authApi.getMe();
      setUser(data);
      return true;
    } catch {
      return false;
    }
  }, []);

  // Register the api-layer session-expired callback so token invalidation
  // during silent refresh clears the user state immediately.
  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
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

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    setUser(null);
  }, []);

  const signup = useCallback(async (data: SignupData) => {
    await authApi.signup(data);
  }, []);

  const refreshUser = useCallback(async () => {
    await fetchUser();
  }, [fetchUser]);

  const setOnboardingSeen = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    setHasSeenOnboarding(true);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        hasSeenOnboarding,
        login,
        logout,
        signup,
        refreshUser,
        setOnboardingSeen,
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
