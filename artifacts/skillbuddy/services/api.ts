import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import type { ProviderProfile, ProviderDashboardSummary, ProviderStatusResponse } from '@/types';

export const BASE_URL = 'https://api.skillbuddy.zeyshan.com';

export const ACCESS_TOKEN_KEY = 'sb_access_token';
export const REFRESH_TOKEN_KEY = 'sb_refresh_token';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Request: attach Bearer token
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (err) => Promise.reject(err)
);

let isRefreshing = false;
type FailedQueue = { resolve: (v: string) => void; reject: (e: unknown) => void }[];
let failedQueue: FailedQueue = [];

const processQueue = (error: unknown, token: string | null) => {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)));
  failedQueue = [];
};

// Response: handle 401 with silent token refresh
api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          if (originalRequest.headers) originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
        if (!refreshToken) throw new Error('No refresh token');

        // POST /api/v1/auth/refresh — refresh_token in the JSON body is the
        // credential (no Authorization header). Uses bare axios so this call
        // bypasses the interceptors entirely (no refresh-loop risk).
        // ROTATION: the response carries a NEW refresh_token; the old one is
        // invalid immediately, so BOTH tokens must be stored.
        const { data } = await axios.post(`${BASE_URL}/api/v1/auth/refresh`, {
          refresh_token: refreshToken,
        });

        await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.access_token);
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refresh_token);

        processQueue(null, data.access_token);
        if (data.user) onUserRefreshed?.(data.user);
        if (originalRequest.headers) originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
        return api(originalRequest);
      } catch (refreshErr) {
        // Refresh failed (401 invalid/expired/revoked, 422, network) → the
        // session is definitively over: hard logout, no retry loop.
        processQueue(refreshErr, null);
        await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
        await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
        onSessionExpired?.();
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// ---- Session expiry callback (set by AuthContext) ----
let onSessionExpired: (() => void) | null = null;
export const setSessionExpiredHandler = (handler: () => void) => {
  onSessionExpired = handler;
};

// ---- User-refresh callback (set by AuthContext) ----
// POST /auth/refresh returns a fresh user object alongside the rotated
// tokens; AuthContext uses this to keep its cached user in sync.
let onUserRefreshed: ((user: unknown) => void) | null = null;
export const setUserRefreshedHandler = (handler: (user: unknown) => void) => {
  onUserRefreshed = handler;
};

// ---- Auth API ----
export const authApi = {
  login: (email: string, password: string) => {
    // POST /api/v1/auth/login — OAuth2 password-flow style form body. The
    // identifier accepts either email or personal code (backend resolves it).
    // Legacy /users/login now 404s. Response: access_token, refresh_token,
    // token_type, user.
    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('username', email);
    params.append('password', password);
    return api.post('/api/v1/auth/login', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  },
  /**
   * POST /api/v1/auth/signup — creates the account and starts email
   * verification. Returns 201 { message, user }. No tokens are returned or
   * stored here; the user logs in only after verifying their email.
   */
  signup: (data: {
    email: string;
    personal_code: string;
    first_name: string;
    last_name: string;
    password: string;
    confirm_password: string;
  }) => api.post('/api/v1/auth/signup', data),
  getMe: () => api.get('/api/v1/users/me'),
  /**
   * GET /api/v1/users/profile-picture — returns { url: string | null } for the
   * authenticated user. Sibling read of POST/DELETE /users/profile-picture.
   * NOT for general avatar display: screens render user.profile_picture from
   * the cached GET /users/me response (AuthContext) — calling this per-screen
   * would duplicate data already in context. Intended uses: confirming the
   * server state right after an upload or delete succeeds (see
   * AuthContext.syncProfilePicture), or any future spot that needs only the
   * URL before the full profile is loaded. "No picture set" arrives as a 200
   * with url: null (schema), not a 404 — callers must null-check.
   * Protected endpoint, Bearer auto-attached by the interceptor.
   */
  getProfilePicture: () => api.get<{ url: string | null }>('/api/v1/users/profile-picture'),
  /**
   * POST /api/v1/users/profile-picture — multipart/form-data upload (NOT JSON).
   * The instance default Content-Type (application/json) MUST be overridden
   * per-request; axios in React Native then lets the native networking layer
   * set the full multipart header incl. boundary. Timeout raised to 60s —
   * image uploads can be slow on poor connections vs the 15s JSON default.
   * Returns { message, url } — callers should update the avatar from `url`
   * immediately (AuthContext.setProfilePicture) without a re-fetch.
   * Protected endpoint, Bearer auto-attached by the interceptor.
   */
  uploadProfilePicture: (asset: { uri: string; name: string; mimeType: string }) => {
    const formData = new FormData();
    // React Native file part: { uri, name, type } (uri points at the local file).
    formData.append('file', { uri: asset.uri, name: asset.name, type: asset.mimeType } as unknown as Blob);
    return api.post<{ message: string; url: string }>('/api/v1/users/profile-picture', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },
  /**
   * DELETE /api/v1/users/profile-picture — removes the current profile
   * picture; only { message } comes back (MessageResponse). Only 200 is
   * documented — the no-picture-set case is not specified, so callers gate
   * on a picture existing before offering/invoking this (the avatar menu
   * only shows "Remove Photo" when user.profile_picture is set).
   * Protected endpoint, Bearer auto-attached by the interceptor.
   */
  deleteProfilePicture: () => api.delete<{ message: string }>('/api/v1/users/profile-picture'),
  /**
   * POST /api/v1/users/residence-permits — KYC document upload as
   * multipart/form-data (NOT JSON). front_file / back_file are both optional
   * in the API schema, but the app enforces AT LEAST ONE side client-side
   * (a one-sided permit is meaningless for verification); the UI encourages
   * both. Instance-default Content-Type overridden per-request so RN's
   * networking layer sets the multipart boundary. Timeout raised to 60s for
   * two-image uploads on poor connections.
   * Returns { message, front_url, back_url } (urls nullable per schema).
   * Protected endpoint, Bearer auto-attached by the interceptor.
   */
  uploadResidencePermits: (files: { front?: { uri: string; name: string; mimeType: string }; back?: { uri: string; name: string; mimeType: string } }) => {
    const formData = new FormData();
    if (files.front) formData.append('front_file', { uri: files.front.uri, name: files.front.name, type: files.front.mimeType } as unknown as Blob);
    if (files.back) formData.append('back_file', { uri: files.back.uri, name: files.back.name, type: files.back.mimeType } as unknown as Blob);
    return api.post<{ message: string; front_url: string | null; back_url: string | null }>('/api/v1/users/residence-permits', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },
  /**
   * POST /api/v1/users/face-video — liveness/face-auth video upload as
   * multipart/form-data (NOT JSON), field name `file` (required per schema).
   * Video is captured LIVE in-app via the front camera (liveness standard —
   * gallery upload is deliberately NOT offered; flagged for team review).
   * Client-side limits enforced before upload: ≤15s, ≤50 MB, video/* MIME.
   * Instance-default Content-Type overridden per-request so RN's networking
   * layer sets the multipart boundary. 120s timeout — videos are large and
   * slow on poor connections. Returns { message, url }.
   * Protected endpoint, Bearer auto-attached by the interceptor.
   */
  uploadFaceVideo: (video: { uri: string; name: string; mimeType: string }) => {
    const formData = new FormData();
    formData.append('file', { uri: video.uri, name: video.name, type: video.mimeType } as unknown as Blob);
    return api.post<{ message: string; url: string }>('/api/v1/users/face-video', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    });
  },
  /**
   * GET /api/v1/providers/profile — the authenticated user's provider
   * profile (stats, rating, availability, current_status). Only 200 is
   * documented; the "user has no provider profile yet" case is NOT specified
   * — callers treat 404-style errors as "no profile" (see
   * useProviderProfile). Call on dashboard entry, after profile create/
   * update, or manual refresh — never per-screen-render (cache in the hook).
   * Protected endpoint, Bearer auto-attached by the interceptor.
   */
  getProviderProfile: () => api.get<ProviderProfile>('/api/v1/providers/profile'),
  /**
   * POST /api/v1/providers/profile — creates the authenticated user's
   * provider profile. ONE-TIME creation call (201) — editing an existing
   * profile is PATCH (separate task); the UI only reaches this from the
   * "no provider profile yet" state. hourly_rate is sent as a NUMBER per
   * the request schema (≥0) — the 201 response returns it back as a STRING
   * (ProviderProfile), which formatHourlyRate handles. service_radius is
   * 1–100 integer (schema bounds). JSON body, Bearer auto-attached.
   */
  createProviderProfile: (data: { bio: string; hourly_rate: number; provider_type: string; service_radius: number }) =>
    api.post<ProviderProfile>('/api/v1/providers/profile', data),
  /**
   * PATCH /api/v1/providers/profile — updates an EXISTING provider profile
   * (creation is POST, above). Full body per spec: bio, hourly_rate,
   * provider_type, is_available, is_active, service_radius — hourly_rate as
   * a NUMBER on the wire, string back in the 200 response. 200 returns the
   * complete ProviderProfile — the source of truth that replaces the cached
   * object (never merge guessed values). JSON, Bearer auto-attached.
   */
  updateProviderProfile: (data: { bio: string; hourly_rate: number; provider_type: string; is_available: boolean; is_active: boolean; service_radius: number }) =>
    api.patch<ProviderProfile>('/api/v1/providers/profile', data),
  /**
   * GET /api/v1/providers/dashboard — lightweight READ-ONLY summary (jobs
   * completed / in-progress, is_available, is_active). NOT the profile —
   * deliberately lacks bio/rate/type/radius and must never pre-fill the edit
   * form or overwrite the ProviderProfile cache (kept separate in
   * useProviderDashboard). Fetch on dashboard entry / manual refresh only.
   * Protected endpoint, Bearer auto-attached by the interceptor.
   */
  getProviderDashboard: () => api.get<ProviderDashboardSummary>('/api/v1/providers/dashboard'),
  /**
   * POST /api/v1/providers/status — sets the provider's current status entry
   * (status history head). `status` is a free string per the live schema
   * (1–30 chars, NO server-side enum) — the app uses the same value set the
   * web app already ships against this endpoint: active / on_leave /
   * unavailable (lowercase snake_case convention, flagged for team review).
   * `reason` is OPTIONAL/nullable per schema (≤500) — omitted when empty.
   * 200 returns { status, reason, is_current } — the server-confirmed new
   * current status; callers seed it into the cached profile's current_status.
   * JSON, protected endpoint, Bearer auto-attached by the interceptor.
   */
  updateProviderStatus: (status: string, reason?: string) =>
    api.post<ProviderStatusResponse>('/api/v1/providers/status', { status, reason: reason || undefined }),
  /**
   * GET /api/v1/providers/status-current — the provider's current status
   * history head ({ status, reason, is_current }). Only 200 is documented;
   * the "no status set yet" case is NOT specified — callers treat 404-style
   * errors as "not set" (see useProviderProfile.currentStatus sync) and
   * fall back to the profile's current_status/is_available. Same value
   * vocabulary as POST /providers/status (no server enum). Call on dashboard
   * entry only — POST success seeds the cache directly (no re-fetch needed).
   * Protected endpoint, Bearer auto-attached by the interceptor.
   */
  getCurrentProviderStatus: () => api.get<ProviderStatusResponse>('/api/v1/providers/status-current'),
  /**
   * GET /api/v1/providers/status-history — the provider's status change log
   * as an ARRAY of ProviderStatusResponse. Live-spec verified: NO pagination
   * parameters exist (parameters: []), and items carry NO id and NO
   * timestamp — consumers key by array index and cannot show when a change
   * happened (flagged to the team). Only 200 documented; 401/5xx handled
   * generically by callers. Call on dashboard entry / manual refresh only.
   * Protected endpoint, Bearer auto-attached by the interceptor.
   */
  getProviderStatusHistory: () => api.get<ProviderStatusResponse[]>('/api/v1/providers/status-history'),
  /**
   * DELETE /api/v1/users/me — deactivates the logged-in user's account
   * (deactivate, not erase: the record persists with deactivated=true).
   * Requires a JSON body { reason } — axios carries a body on DELETE via the
   * `data` config key. Protected endpoint, Bearer auto-attached.
   */
  deactivateAccount: (reason: string) => api.delete('/api/v1/users/me', { data: { reason } }),
  // PATCH /api/v1/users/profile — legacy /users/update-user now 404s.
  /**
   * PATCH /api/v1/users/profile — partial profile update. All four fields
   * are optional in the schema (names/username ≤100 chars, phone ≤20); only
   * fields present (not undefined) are sent — a true partial update. Email,
   * personal_code, roles, is_verified etc. are NOT accepted by this endpoint.
   * Protected: Bearer auto-attached by the interceptor.
   */
  updateUser: (data: { first_name?: string; last_name?: string; username?: string; phone_number?: string }) =>
    api.patch('/api/v1/users/profile', Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))),
  /**
   * POST /api/v1/auth/logout — revokes the session tied to the caller's
   * access token (signs out the CURRENT device only). Protected endpoint,
   * Bearer auto-attached. This replaced the legacy /users/logout, which now
   * 404s — callers intentionally still log the user out locally even if this
   * call fails (401/network), per the routine-logout fallback spec.
   */
  logout: () => api.post('/api/v1/auth/logout'),
  /**
   * POST /api/v1/auth/forgot-password — sends password reset instructions if
   * the account exists and is verified. Always answers 200 with a generic
   * message (it never reveals whether the email is registered).
   */
  forgotPassword: (email: string) => api.post('/api/v1/auth/forgot-password', { email }),
  /**
   * POST /api/v1/auth/reset-password — sets a new password using the reset
   * token emailed to the user. Public endpoint: the token in the body is the
   * authorization; no auth header is attached. Invalid/expired tokens come
   * back as 401 { detail: "Invalid token." } (undocumented), 422 otherwise.
   */
  resetPassword: (data: { token: string; password: string; confirm_password: string }) =>
    api.post('/api/v1/auth/reset-password', data),
  /**
   * POST /api/v1/auth/change-password — changes the logged-in user's password.
   * Protected endpoint: the shared axios instance auto-attaches the Bearer
   * token from SecureStore (with silent refresh on expiry). Per the API docs
   * the backend invalidates existing sessions on success, so callers must
   * force a re-login afterwards.
   */
  changePassword: (data: { current_password: string; new_password: string }) =>
    api.post('/api/v1/auth/change-password', data),
  /**
   * GET /api/v1/auth/sessions — lists the logged-in user's active login
   * sessions/devices (sid, device info, ip, timestamps, is_current).
   * Protected endpoint: Bearer token auto-attached by the shared instance.
   */
  getSessions: () => api.get('/api/v1/auth/sessions'),
  /**
   * DELETE /api/v1/auth/sessions — revokes every active session except the
   * caller's current one ("log out all other devices"). Protected endpoint,
   * Bearer auto-attached. NOT the same as DELETE /sessions/{sid} (single
   * session) or DELETE /auth/logout-all (logs out the current device too).
   */
  revokeOtherSessions: () => api.delete('/api/v1/auth/sessions'),
  /**
   * DELETE /api/v1/auth/sessions/{sid} — revokes a single session/device,
   * leaving all other sessions (including the caller's) intact. The sid MUST
   * come from GET /sessions (never constructed). Revoking the current
   * session invalidates this device's tokens → callers must force re-login
   * in that case. Protected endpoint, Bearer auto-attached.
   */
  revokeSession: (sid: string) => api.delete(`/api/v1/auth/sessions/${encodeURIComponent(sid)}`),
  /**
   * DELETE /api/v1/auth/logout-all — signs the user out of EVERY device and
   * session, including the caller's current one. The most destructive of the
   * session endpoints: after a confirmed 200 the local tokens are dead too,
   * so callers must clear local session state and go to Login. Protected
   * endpoint, Bearer auto-attached.
   */
  logoutAll: () => api.delete('/api/v1/auth/logout-all'),
  /**
   * NOTE — DEAD ENDPOINT: legacy /users/social-login now returns 404 and has
   * NO replacement in the current API. Kept only because AuthContext still
   * references it; no screen calls it yet (Google/Apple buttons are
   * placeholders). Remove or rewire when social OAuth is actually built.
   */
  socialLogin: (provider: 'google' | 'apple', idToken: string) =>
    api.post('/api/v1/users/social-login', { provider, id_token: idToken }),
};

export default api;
