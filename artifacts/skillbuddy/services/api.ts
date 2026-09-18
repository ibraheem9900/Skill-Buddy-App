import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';

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
  // PATCH /api/v1/users/profile — legacy /users/update-user now 404s.
  updateUser: (data: Record<string, unknown>) => api.patch('/api/v1/users/profile', data),
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
