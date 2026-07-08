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

        const { data } = await axios.post(`${BASE_URL}/api/v1/users/refresh`, {
          refresh_token: refreshToken,
        });

        await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.access_token);
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refresh_token);

        processQueue(null, data.access_token);
        if (originalRequest.headers) originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
        return api(originalRequest);
      } catch (refreshErr) {
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

// ---- Auth API ----
export const authApi = {
  login: (email: string, password: string) => {
    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('username', email);
    params.append('password', password);
    return api.post('/api/v1/users/login', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  },
  signup: (data: {
    email: string;
    password: string;
    confirm_password: string;
    first_name: string;
    last_name: string;
    personal_code?: string;
  }) => api.post('/api/v1/users/signup', data),
  getMe: () => api.get('/api/v1/users/me'),
  updateUser: (data: Record<string, unknown>) => api.patch('/api/v1/users/update-user', data),
  logout: () => api.post('/api/v1/users/logout'),
  forgotPassword: (email: string) => api.post('/api/v1/users/forgot-password', { email }),
};

export default api;
