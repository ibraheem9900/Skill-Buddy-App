import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ACCESS_TOKEN_KEY, BASE_URL, refreshAccessToken } from '@/services/api';
import {
  buildRealtimeUrl,
  createRealtimeService,
  type RealtimeEventHandler,
  type RealtimeService,
  type RealtimeSocketLike,
  type RealtimeStatus,
} from '@/lib/realtime';
import { useAuth } from '@/context/AuthContext';

/**
 * React bindings for the shared realtime layer (see lib/realtime.ts for the
 * protocol and the state machine).
 *
 * WHAT THIS FILE OWNS: the single app-wide service instance and all the platform
 * wiring — token storage, the REST client's base URL, the app's existing
 * single-flight refresh, the app's existing logout path, React Native's built-in
 * WebSocket and AppState. The service itself stays framework-agnostic.
 *
 * The provider sits INSIDE AuthProvider (see app/_layout.tsx) so it can start on
 * login and stop on logout/account switch using the app's real session state.
 *
 * No screen renders anything for realtime: this chunk is infrastructure only.
 *
 * NOT WIRED: NetInfo/expo-network are not dependencies of this app, so the
 * "reconnect when connectivity returns" hook is deliberately absent — the
 * foreground reconnect (AppState) plus the REST refetch cover recovery.
 */

/** Set by the provider so the service can reach the app's logout path. */
let authFailureHandler: (() => void) | null = null;

/**
 * ONE socket per logged-in user for the whole app lifetime. The token is read
 * from storage at every (re)connect by the service itself — never cached here.
 */
export const realtime: RealtimeService = createRealtimeService({
  buildUrl: (accessToken) => buildRealtimeUrl(BASE_URL, accessToken),
  getToken: () => SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
  refreshToken: async () => {
    try {
      // The REST client's own single-flight refresh: a 401 on REST and a 1008
      // socket close can never refresh in parallel.
      return await refreshAccessToken();
    } catch {
      return null;
    }
  },
  onAuthFailure: () => {
    authFailureHandler?.();
  },
  // React Native's built-in WebSocket — no native dependency is added.
  socketFactory: (url) => new WebSocket(url) as unknown as RealtimeSocketLike,
  scheduleRetry: (run, delayMs) => setTimeout(run, delayMs),
  cancelRetry: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

interface RealtimeContextValue {
  service: RealtimeService;
}

const realtimeContextValue: RealtimeContextValue = { service: realtime };

const RealtimeContext = createContext<RealtimeContextValue>(realtimeContextValue);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user, clearSession } = useAuth();
  const ownerId = user?.id === undefined || user?.id === null ? null : String(user.id);
  const ownerRef = useRef<string | null>(null);

  // A dead/revoked session discovered by the socket goes through the app's own
  // local session wipe (the same one server-initiated invalidation uses).
  useEffect(() => {
    authFailureHandler = () => {
      void clearSession();
    };
    return () => {
      authFailureHandler = null;
    };
  }, [clearSession]);

  // Lifecycle: start after login when a real session exists, stop on logout and
  // on account switch (which resets the epoch and clears the desired watches).
  useEffect(() => {
    const previous = ownerRef.current;
    ownerRef.current = ownerId;

    if (ownerId === null) {
      realtime.stop(); // logged out / local session gone
      return;
    }
    if (previous !== null && previous !== ownerId) realtime.stop(); // account switch

    // A session is only real when an access token is actually stored. The gate
    // reads storage once; the service re-reads the token for every connection.
    let cancelled = false;
    void (async () => {
      const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
      if (cancelled || !token) return;
      realtime.connect();
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerId]);

  // App went to the background: close on purpose (no retry loop while asleep),
  // keep the desired watches, and reconnect immediately on the way back.
  // 'inactive' (the transient iOS state) is deliberately ignored.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') realtime.resume();
      else if (next === 'background') realtime.pause();
    });
    return () => subscription.remove();
  }, []);

  return <RealtimeContext.Provider value={realtimeContextValue}>{children}</RealtimeContext.Provider>;
}

/** The app-wide service instance (for imperative use outside React). */
export function useRealtimeService(): RealtimeService {
  return useContext(RealtimeContext).service;
}

/** Current connection status, re-rendering the caller when it changes. */
export function useRealtimeStatus(): RealtimeStatus {
  const service = useRealtimeService();
  const [status, setStatus] = useState<RealtimeStatus>(() => service.getStatus());

  useEffect(() => {
    // Re-read first: the status may have changed between render and effect.
    setStatus(service.getStatus());
    return service.subscribeStatus(setStatus);
  }, [service]);

  return status;
}

/**
 * Subscribe to one event type. The subscription is stable (it is torn down only
 * when `type` or the service changes) and always calls the LATEST handler.
 */
export function useRealtimeEvent(type: string, handler: RealtimeEventHandler): void {
  const service = useRealtimeService();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => service.on(type, (event) => handlerRef.current(event)), [service, type]);
}/**
 * Run `callback` on every (re)open — including the first — so screens can
 * refetch their REST data (events are never stored and a missed event is lost).
 */
export function useOnRealtimeReconnect(callback: () => void): void {
  const service = useRealtimeService();
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => service.onReconnected(() => callbackRef.current()), [service]);
}
