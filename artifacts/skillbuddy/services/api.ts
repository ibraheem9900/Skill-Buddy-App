import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { buildListJobsQuery } from '@/lib/jobList';
import { isValidJobId } from '@/lib/jobPublish';
import type { ProviderProfile, ProviderDashboardSummary, ProviderStatusResponse, AddressResponse, AddressCreatePayload, AddressUpdatePayload, AddressCountryResponse, AddressRegionResponse, CategoryResponse, CategoryDetailResponse, ServiceListItem, ServiceDetailResponse, ServiceMediaItem, ServiceInclusionOption, CreateJobRequest, UpdateJobRequest, JobAddressCreate, JobAddressUpdate, JobAddressResponse, JobActionResponse, JobAssignProviderRequest, JobCancelRequest, JobDetailsRequest, JobResponse, JobListItem, ListJobsParams, ClientProfileResponse, ClientDashboardSummary, ClientBookingsResponse, FavoriteListResponse, FavoriteResponse, FavoriteItemResponse, CertificationListResponse, CertificationUploadResponse, CertificationResponse, CreditWalletDetailResponse, ProviderWalletDetailResponse } from '@/types';

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
   * GET /api/v1/clients/profile — the signed-in client's activity stats
   * (bookings / completed / in-progress / cancelled / star rating / reviews
   * given / total spent). `total_amount_spent` is a decimal STRING per the
   * live schema — parse before display (see useClientProfile). Protected
   * endpoint, Bearer auto-attached by the interceptor.
   */
  getClientProfile: () => api.get<ClientProfileResponse>('/api/v1/clients/profile'),
  /**
   * PATCH /api/v1/clients/profile — updates the client profile's
   * `preferred_language` (the ONLY editable field per the request schema,
   * string 2–20 chars or null; no server-side enum). The 200 response is the
   * full ClientProfileResponse — stats fields are read-only convenience data,
   * sent back for caching, never editable. JSON, Bearer auto-attached.
   */
  updateClientProfile: (data: { preferred_language: string | null }) =>
    api.patch<ClientProfileResponse>('/api/v1/clients/profile', data),
  /**
   * GET /api/v1/clients/dashboard — the client's lightweight activity
   * summary (bookings / completed / in-progress / total spent). READ-ONLY:
   * fetch fresh on dashboard entry and pull-to-refresh — these stats change
   * frequently and must not be aggressively cached. `total_amount_spent` is
   * a decimal STRING. Protected endpoint, Bearer auto-attached.
   */
  getClientDashboard: () => api.get<ClientDashboardSummary>('/api/v1/clients/dashboard'),
  /**
   * GET /api/v1/clients/bookings — the signed-in client's bookings list.
   * NO query params exist (live OpenAPI: parameters: []) — the response's
   * `total` is the full count, no pagination. Booking items are OPAQUE per
   * the schema (no named fields) — consume via lib/bookingFields.ts helpers
   * (mirrors the web app's defensive extraction; no guessed field names).
   * Protected endpoint, Bearer auto-attached.
   */
  getClientBookings: () => api.get<ClientBookingsResponse>('/api/v1/clients/bookings'),
  /**
   * GET /api/v1/clients/favorites — the signed-in client's saved services
   * (bookmarks). Items carry ONLY { id, service_id, notes?, created_at } —
   * service display data (title/price/image) is joined client-side from the
   * local services catalog (no per-favorite detail calls). NO query params
   * exist (live OpenAPI: parameters: []) — `total` is the full count.
   * Protected endpoint, Bearer auto-attached.
   */
  getClientFavorites: () => api.get<FavoriteListResponse>('/api/v1/clients/favorites'),
  /**
   * GET /api/v1/certifications — the authenticated provider's uploaded
   * certifications (token-scoped; no query params per the live schema —
   * `parameters: []`, `total` is the full count). Response is a WRAPPED
   * object { certifications: [...], total } — never a bare array. Protected
   * endpoint, Bearer auto-attached.
   */
  getCertifications: () => api.get<CertificationListResponse>('/api/v1/certifications'),
  /**
   * GET /api/v1/wallet/credits — the signed-in CLIENT's credit wallet:
   * { wallet: { id, client_id, balance }, transactions: [...] }. `balance`
   * and each transaction's `points`/`balance_after` are INTEGER point counts
   * (live schema). Only 200 is documented; a signed-in user without a credit
   * wallet yet is NOT specified — callers handle a missing/empty shape as
   * zeros rather than guessing. Protected endpoint, Bearer auto-attached.
   */
  getWalletCredits: () => api.get<CreditWalletDetailResponse>('/api/v1/wallet/credits'),
  /**
   * GET /api/v1/wallet/provider — the signed-in PROVIDER's money wallet:
   * { wallet: { id, provider_id, balance }, transactions: [...] }.
   * `balance`, `amount` and `balance_after` are decimal STRINGS on the wire
   * (live schema) — parse/format before display. `transaction_type` is
   * ESCROW_RELEASE | ADJUSTMENT. Only 200 is documented. Protected endpoint,
   * Bearer auto-attached.
   */
  getProviderWallet: () => api.get<ProviderWalletDetailResponse>('/api/v1/wallet/provider'),
  /**
   * GET /api/v1/categories — the full categories list (no parameters, no
   * pagination per the live OpenAPI). VERIFIED LIVE: PUBLIC (no auth header
   * needed — the docs' lock icon does not match the API; requests without
   * any Authorization return 200) and currently returns an EMPTY array —
   * the backend has no seeded categories yet. 200 items are
   * CategoryResponse { id, name, description?, icon_url? } with only
   * id+name required (icon rendering must tolerate missing/broken
   * icon_url). Cache-friendly: fetched once per session via useCountries-
   * style module cache; refresh() for pull-to-refresh. The categories
   * screen falls back to the curated local list while the API is empty —
   * server data replaces it as soon as the backend seeds categories.
   */
  getCategories: () => api.get<CategoryResponse[]>('/api/v1/categories'),
  /**
   * GET /api/v1/services — the GLOBAL services catalog (the Services tab's
   * "browse all" list). VERIFIED LIVE (public — no auth header needed
   * despite the docs' lock icon): 200 currently returns an EMPTY array
   * because the backend has no seeded services yet, so the Services tab
   * falls back to the curated local catalog until it is populated.
   *
   * PARAMETERS: NONE. Verified against the live OpenAPI — the operation
   * object has no `parameters` key at all (the docs UI agrees: "No
   * parameters"), so there is no search / category_id / page / limit / sort
   * to send. All UI filtering happens client-side (see the Services tab).
   *
   * RESPONSES: only 200 is documented — no 422 (impossible: no inputs) and
   * no 404. 200 = a BARE ARRAY of ServiceListItem (same shared
   * `ServiceListResponse` schema as the category-services endpoint);
   * price_from/price_to are nullable numeric STRINGS — format via
   * lib/servicePrice.ts, never render raw. thumbnail_url is nullable.
   * Cache once per session via useServices; do not call per render.
   */
  getServices: () => api.get<ServiceListItem[]>('/api/v1/services'),
  /**
   * GET /api/v1/services/{service_id} — ONE service's FULL detail (integer
   * path param per the live schema). VERIFIED LIVE (public — no auth header
   * needed despite the docs' lock icon): non-integer id → 422 int_parsing
   * with detail[].loc ["path","service_id"]; a nonexistent id → 404
   * {"detail":"Service not found."} (plain-string detail — happens live even
   * though the docs document only 200/422, so it is handled as its own
   * state, not lumped into generic network errors). 200 = ServiceDetailResponse
   * — a RICHER schema than the list item (what_to_expect, is_active,
   * status, timestamps and the media / inclusion_options arrays, all absent
   * from the list), so a cached list entry can never satisfy a detail view;
   * the hook caches full detail records separately. price_from/price_to are
   * nullable numeric STRINGS — format via lib/servicePrice.ts, never render
   * raw. description/what_to_expect may contain rich text — render through
   * lib/sanitizeRichText.ts. Cache per id in useServiceDetail; do not call
   * per render.
   */
  getServiceById: (serviceId: number) =>
    api.get<ServiceDetailResponse>(`/api/v1/services/${serviceId}`),
  /**
   * GET /api/v1/services/{service_id}/media — ONE service's media items
   * (integer path param). VERIFIED LIVE (public — no auth header needed
   * despite the docs' lock icon): non-integer id → 422 int_parsing with
   * detail[].loc ["path","service_id"]; a nonexistent id → 404
   * {"detail":"Service not found."} (plain-string detail — undocumented but
   * real).
   *
   * 200 = a BARE ARRAY of ServiceMediaResponse: the SAME object shape as
   * `ServiceResponse.media` on Get Service by ID. That duplication is real,
   * so this endpoint is NOT called alongside the detail fetch — it exists so
   * a gallery can re-fetch / lazy-load media WITHOUT pulling the whole
   * service (useServiceMedia caches per id).
   *
   * `position` orders the gallery (ascending); `is_thumbnail` marks the
   * cover — if several entries are flagged, the LOWEST position wins, which
   * is an assumption (see lib/serviceMedia.ts). `media_type` is an
   * UNCONSTRAINED string in the live schema — the spec defines no enum for
   * it anywhere, so its exact values CANNOT be confirmed from the docs; the
   * UI treats any value containing "video" as a video and everything else as
   * an image, logging unrecognised values. `media_url` is NULLABLE — filter
   * before rendering (never feed a video URL to an image component).
   */
  getServiceMedia: (serviceId: number) =>
    api.get<ServiceMediaItem[]>(`/api/v1/services/${serviceId}/media`),
  /**
   * GET /api/v1/services/{service_id}/inclusion-options — ONE service's
   * "what's included" list (integer path param). VERIFIED LIVE (public — no
   * auth header needed despite the docs' lock icon): non-integer id → 422
   * int_parsing with detail[].loc ["path","service_id"]; a nonexistent id →
   * 404 {"detail":"Service not found."} (plain-string detail — undocumented
   * but real).
   *
   * 200 = a BARE ARRAY of InclusionOptionResponse ({id, name}, both
   * required): the SAME schema that `ServiceResponse.inclusion_options`
   * `$ref`s on Get Service by ID. That duplication is real, so this endpoint
   * is NOT called alongside the detail fetch — the Service Detail screen
   * renders the detail response's array (zero extra requests) and this
   * function backs a standalone list / lazy-load path instead.
   * useServiceInclusionOptions caches per id.
   */
  getServiceInclusionOptions: (serviceId: number) =>
    api.get<ServiceInclusionOption[]>(
      `/api/v1/services/${serviceId}/inclusion-options`
    ),
  /* ── Jobs (client job creation) ─────────────────────────────────────────── */

  /**
   * POST /api/v1/jobs — creates a job for the AUTHENTICATED client.
   *
   * AUTH: the operation is PROTECTED (live OpenAPI security:
   * [{OAuth2PasswordBearer: []}]). The shared axios instance attaches the
   * stored access token as `Authorization: Bearer <token>` on every request,
   * and its response interceptor already handles an expired token: it calls
   * POST /api/v1/auth/refresh (rotating BOTH tokens), replays this request
   * exactly once via the `_retry` guard, queues concurrent callers, and on a
   * failed refresh clears the session through AuthContext's session-expired
   * handler — so no bespoke 401/retry logic belongs here.
   *
   * VERIFIED LIVE: POST /api/v1/jobs with no token (and no body) returns
   * HTTP 401 {"detail":"Not authenticated"} — auth is checked BEFORE body
   * validation, so a 422 cannot be produced without a valid token.
   *
   * BODY (live OpenAPI schema JobCreate): REQUIRED service_id, title
   * (3..150 chars), milestones (>= 1 item), address. `category_id` and
   * `description` are nullable; `request_type` (default REGULAR),
   * `booking_type` (default ONE_TIME) and `is_draft` (default false) are
   * optional. `service_id`/`category_id`/`country_id`/`county_id`/`city_id`
   * are real server ids — never invented client-side.
   *
   * DOC CONTRADICTION (flagged, not guessed): JobMilestoneCreate is described
   * as "One selected day/time for a MULTI_DAY booking. Ignored for ONE_TIME
   * bookings, which use the job's own scheduled_at / expected_hours instead."
   * But JobCreate exposes NO top-level scheduled_at or expected_hours, so
   * milestones[] is the ONLY channel for a ONE_TIME job's schedule and at
   * least one entry must be sent. `expected_hours` accepts number | numeric
   * string | null; this app always sends a number.
   *
   * 201 → JobResponse (callers persist id / status / bidding_ends_at).
   * 422 → {"detail":[{"loc":["body","<field>",...],"msg":...}]}; map it with
   * lib/jobValidation.mapValidationErrors so each message lands under its
   * input.
   */
  createJob: (payload: CreateJobRequest) =>
    api.post<JobResponse>('/api/v1/jobs', payload),

  /**
   * POST /api/v1/jobs/{job_id}/publish — publishes a DRAFT job so bidding
   * opens.
   *
   * CONTRACT (verified against the live OpenAPI): ONE required integer path
   * parameter and NO requestBody, so nothing is sent as a body — axios adds
   * no payload to a post() with no second argument. `jobId` is re-checked at
   * runtime because a non-integer would silently build a malformed path
   * (/api/v1/jobs/NaN/publish); callers should never get that far.
   *
   * PROTECTED: same shared-client auth/refresh-once rules as createJob. A 401
   * that survives the refresh + single replay is reported to the caller, which
   * sends the user to login.
   *
   * 200 → the FULL JobResponse (same schema as createJob), so the caller reads
   * status / is_bidding_open / bidding_ends_at / remaining_bidding_seconds
   * from the REAL response and never assumes a published job's status.
   * 422 → {"detail":[{"loc":[...],"msg":...}]} | {"detail":"..."}. The docs
   * say nothing about 400/401/403/404/409 — those are handled generically by
   * lib/jobPublish.classifyPublishFailure with no assumed meaning.
   */
  publishJob: (jobId: number) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`publishJob: invalid job id ${String(jobId)}`));
    }
    return api.post<JobResponse>(`/api/v1/jobs/${jobId}/publish`);
  },

  /**
   * GET /api/v1/jobs — lists the AUTHENTICATED user's jobs.
   *
   * AUTH: PROTECTED (live OpenAPI security: [{OAuth2PasswordBearer: []}]). The
   * shared axios instance attaches the Bearer token and already refreshes an
   * expired one once before replaying the request, so nothing extra is needed
   * here. VERIFIED LIVE: with no token the endpoint answers
   * HTTP 401 {"detail":"Not authenticated"}.
   *
   * QUERY (all optional, verified against the live OpenAPI):
   *   status                 JobStatus enum (14 values) | null
   *   request_type           URGENT | REGULAR | null
   *   category_id            integer | null
   *   service_id             integer | null
   *   only_actively_bidding  boolean, default false
   *   limit                  integer 1..100, default 20
   *   offset                 integer >= 0, default 0
   * Unset parameters are OMITTED (never null/empty) by
   * lib/jobList.buildListJobsQuery, which also clamps limit/offset.
   *
   * 200 = a BARE ARRAY of JobListResponse with NO wrapper and NO total count,
   * so "is there another page" can only be inferred from the page length
   * (see lib/jobList.mergeJobsPage). The list item is SLIGHTER than the
   * JobResponse returned by create/get — no description, address, attachments,
   * status_history or can_* flags — which is why it has its own JobListItem
   * type and why list cards must not read those fields.
   *
   * Documented responses: 200 and 422 (422 carries {detail:[{loc,msg,...}]};
   * read it with lib/jobList.firstErrorMessage).
   */
  listJobs: (params?: ListJobsParams) =>
    api.get<JobListItem[]>('/api/v1/jobs', {
      params: buildListJobsQuery(params),
    }),

  /**
   * POST /api/v1/jobs/{job_id}/address — creates the job's address.
   *
   * CONTRACT (verified against the live OpenAPI): one required integer path
   * parameter and a JobAddressCreate body with NO required properties. The
   * geo ids must be real ids from the public country → county → city cascade,
   * and latitude/longitude are omitted by the caller because this app has no
   * map picker (the schema allows their absence).
   *
   * PROTECTED: same shared-client auth/refresh-once rules as the rest of the
   * jobs group. 201 → JobAddressResponse (the source of truth — never the
   * locally entered values). The docs list 422 only; 400/401/403/404/409 are
   * handled generically from the backend's own `detail`.
   *
   * CREATE-ONLY: the caller must be sure the job has no address yet, otherwise
   * the backend may reject it. Changing an existing address is
   * PATCH /jobs/{job_id}/address — a different task.
   */
  createJobAddress: (jobId: number, payload: JobAddressCreate) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`createJobAddress: invalid job id ${String(jobId)}`));
    }
    return api.post<JobAddressResponse>(`/api/v1/jobs/${jobId}/address`, payload);
  },

  /**
   * POST /api/v1/jobs/{job_id}/restart-timer — reopens bidding for a fresh window.
   *
   * CONTRACT (verified against the live OpenAPI spec, NOT just the Swagger UI): the
   * operation has ONE required integer path parameter and **NO `requestBody` key at
   * all** — so nothing is sent as a body. axios adds no payload to a post() with no
   * second argument, which is exactly right; sending `{}` would be harmless but
   * unnecessary. Its only documented responses are 200 (schema JobActionResponse =
   * { message, job }) and 422 (HTTPValidationError).
   *
   * VERIFIED LIVE (no token): POST /api/v1/jobs/1/restart-timer → HTTP 401
   * {"detail":"Not authenticated"}, while GET/PUT on the same path → 405, so POST is
   * the registered method and auth is enforced before anything else.
   *
   * PROTECTED: the shared axios instance attaches the stored access token and its
   * response interceptor refreshes it once (rotating both tokens) before replaying
   * this request, then queues concurrent callers — so no bespoke 401/retry logic
   * belongs here. A 401 that survives that refresh is reported to the caller.
   *
   * The 200 `job` is the SAME full JobResponse as GET /jobs/{job_id} and is the
   * source of truth: it already reflects the new bidding_ends_at,
   * remaining_bidding_seconds, timer_restart_count and updated can_restart_timer, so
   * callers replace their held job with it rather than incrementing anything locally.
   *
   * The restart LIMIT is not documented anywhere in the spec (no code, no value); the
   * backend owns it through `can_restart_timer`. See lib/jobRestartTimer for how an
   * undocumented rejection is surfaced without inventing a status code.
   */
  restartJobTimer: (jobId: number) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`restartJobTimer: invalid job id ${String(jobId)}`));
    }
    return api.post<JobActionResponse>(`/api/v1/jobs/${jobId}/restart-timer`);
  },

  /**
   * POST /api/v1/jobs/{job_id}/convert-to-regular — turns an URGENT job back into
   * a REGULAR one.
   *
   * CONTRACT (verified against the live OpenAPI spec, not just the Swagger UI): the
   * operation declares `security: [{OAuth2PasswordBearer: []}]`, ONE required integer
   * path parameter, and **NO `requestBody` key at all** — so no body is sent. Its only
   * documented responses are 200 (schema JobActionResponse = { message, job }) and 422
   * (HTTPValidationError).
   *
   * VERIFIED LIVE (no token): POST → HTTP 401 {"detail":"Not authenticated"}, while
   * GET/PUT on the same path → 405, so POST is the registered method.
   *
   * PROTECTED: through the shared axios instance, so the Bearer token is attached and
   * an expired one is refreshed once before this is replayed — no bespoke 401 logic.
   * A 401 that survives the refresh is reported to the caller, which sends the user to
   * login.
   *
   * The 200 `job` is the WHOLE job (the same JobResponse as GET /jobs/{job_id}, with
   * its address embedded — so no extra address call is needed) and is the source of
   * truth: callers replace their cached job with it instead of patching is_urgent or
   * request_type locally.
   *
   * The reverse action is convertJobToUrgent below — a separate endpoint with its
   * own flag; neither is used in place of the other.
   */
  convertJobToRegular: (jobId: number) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`convertJobToRegular: invalid job id ${String(jobId)}`));
    }
    return api.post<JobActionResponse>(`/api/v1/jobs/${jobId}/convert-to-regular`);
  },

  /**
   * POST /api/v1/jobs/{job_id}/convert-to-urgent — turns a REGULAR job into an
   * URGENT one (the exact reverse of convertJobToRegular).
   *
   * CONTRACT (verified against the live OpenAPI spec): `security:
   * [{OAuth2PasswordBearer: []}]`, ONE required integer path parameter, and **NO
   * `requestBody` key at all** — no body is sent. Its only documented responses are
   * 200 (schema JobActionResponse = { message, job }) and 422 (HTTPValidationError).
   *
   * VERIFIED LIVE (no token): POST → HTTP 401 {"detail":"Not authenticated"}, while
   * GET/PUT on the same path → 405, so POST is the registered method.
   *
   * PROTECTED: through the shared axios instance, so the Bearer token is attached and
   * an expired one is refreshed once before this is replayed — no bespoke 401 logic.
   * A 401 that survives the refresh is reported to the caller, which sends the user to
   * login.
   *
   * The 200 `job` is the WHOLE job (the same JobResponse as GET /jobs/{job_id}, with
   * its address embedded — no extra address call) and is the source of truth: callers
   * replace their cached job with it rather than patching is_urgent / request_type.
   */
  convertJobToUrgent: (jobId: number) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`convertJobToUrgent: invalid job id ${String(jobId)}`));
    }
    return api.post<JobActionResponse>(`/api/v1/jobs/${jobId}/convert-to-urgent`);
  },

  /**
   * POST /api/v1/jobs/{job_id}/assign-provider — assigns a provider to the job.
   *
   * CONTRACT (verified against the live OpenAPI spec): `security:
   * [{OAuth2PasswordBearer: []}]`, ONE required integer path parameter, and a
   * **REQUIRED `application/json` body** (schema JobAssignProviderRequest) whose
   * single property `provider_id` (integer) is itself required — unlike the other
   * job actions, which take no body at all.
   *
   * RESPONSE SHAPE DIFFERS: 200 is the **JobResponse DIRECTLY**, with no
   * `{ message, job }` envelope, so callers adopt `data` itself as the job. The only
   * other documented response is 422 (HTTPValidationError).
   *
   * VERIFIED LIVE (no token): POST → HTTP 401 {"detail":"Not authenticated"} with
   * and without a body (FastAPI resolves auth before body validation), while
   * GET/PUT/PATCH on the same path → 405 — so POST is the registered method.
   *
   * PROTECTED: through the shared axios instance, so the Bearer token is attached and
   * an expired one is refreshed once before this is replayed — no bespoke 401 logic.
   * A 401 that survives the refresh is reported to the caller, which sends the client
   * to login.
   *
   * `provider_id` must come from a REAL source — GET /api/v1/jobs/{job_id}/bids
   * (BidResponse.provider.id) — never invented client-side. The caller gates on the
   * job still being open for assignment (see lib/jobAssign).
   */
  assignJobProvider: (jobId: number, payload: JobAssignProviderRequest) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`assignJobProvider: invalid job id ${String(jobId)}`));
    }
    return api.post<JobResponse>(`/api/v1/jobs/${jobId}/assign-provider`, payload);
  },

  /**
   * POST /api/v1/jobs/{job_id}/confirm-payment — confirms the client's payment for
   * the job.
   *
   * CONTRACT (verified against the live OpenAPI spec): `security:
   * [{OAuth2PasswordBearer: []}]`, ONE required integer path parameter, and **NO
   * `requestBody` key at all** — so nothing is sent as a body. There is no amount,
   * no payment method and no other field to send; axios adds no payload to a post()
   * with no second argument, which is exactly right. The docs' only responses are 200
   * (schema **JobResponse directly** — no `{ message, job }` envelope) and 422
   * (HTTPValidationError).
   *
   * VERIFIED LIVE (no token): POST → HTTP 401 {"detail":"Not authenticated"}, while
   * GET/PUT on the same path → 405, so POST is the registered method.
   *
   * PROTECTED: through the shared axios instance, so the Bearer token is attached and
   * an expired one is refreshed once before this is replayed — no bespoke 401 logic.
   * A 401 that survives the refresh is reported to the caller, which sends the client
   * to login.
   *
   * The 200 `job` IS the whole job (with its address embedded — no extra address
   * call), and it is the source of truth for what payment confirmation changed:
   * status, is_bidding_open, is_editable, the can_* flags and the bidding window
   * (bidding_started_at / bidding_ends_at / remaining_bidding_seconds). Callers adopt
   * it wholesale instead of flipping a local "paid" flag, and must not assume which
   * status follows — the response says.
   *
   * The actual money movement (gateway, wallet, installment plan) is NOT part of this
   * endpoint and is not implemented here: GET /jobs/{job_id}/payment-options,
   * GET /jobs/{job_id}/payments, POST /jobs/{job_id}/installments/pay and
   * GET /jobs/{job_id}/invoice are separate endpoints. The caller only fires this once
   * the job is in a payable state and the client has confirmed (see lib/jobPayment).
   */
  /**
   * POST /api/v1/jobs/{job_id}/start — the PROVIDER starts work on the job.
   *
   * CONTRACT (from the live OpenAPI spec, not the Swagger UI):
   *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
   *   - exactly ONE parameter: the required integer path `job_id`
   *   - **NO `requestBody` key at all** — no body is sent, and nothing (started_at,
   *     location, …) is invented
   *   - only 200 (**the JobResponse DIRECTLY** — no `{ message, job }` envelope) and
   *     422 (HTTPValidationError) are documented
   *
   * PROTECTED + the shared 401 refresh/replay, like every other job action. On
   * success the 200 body is the authoritative job, so the caller replaces its cached
   * job with it (status, is_editable, the can_* flags, status_history, milestones and
   * — when the response closes bidding — the countdown all follow the response). The
   * caller must gate the action: it is the provider's action, and only offered on a
   * job that is still in the startable state (see lib/jobStart).
   */
  startJob: (jobId: number) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`startJob: invalid job id ${String(jobId)}`));
    }
    return api.post<JobResponse>(`/api/v1/jobs/${jobId}/start`);
  },

  /**
   * POST /api/v1/jobs/{job_id}/complete — the PROVIDER marks the job's work done.
   *
   * CONTRACT (from the live OpenAPI spec, not the Swagger UI):
   *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
   *   - exactly ONE parameter: the required integer path `job_id`
   *   - **NO `requestBody` key at all** — no body is sent, and nothing (a `completed_at`,
   *     a rating or a review, …) is invented
   *   - only 200 (**the JobResponse DIRECTLY** — no `{ message, job }` envelope) and
   *     422 (HTTPValidationError) are documented
   *
   * PROTECTED + the shared 401 refresh/replay, like every other job action. On success
   * the 200 body is the authoritative job, so the caller replaces its cached job with
   * it (status, completed_at, the can_* flags, status_history, milestones). The caller
   * must gate the action: it is the provider's action, and only offered on a job that
   * is still in progress (see lib/jobComplete). The rating/review and any payment
   * release that follow are separate tasks and are not triggered from here.
   */
  completeJob: (jobId: number) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`completeJob: invalid job id ${String(jobId)}`));
    }
    return api.post<JobResponse>(`/api/v1/jobs/${jobId}/complete`);
  },

  /**
   * POST /api/v1/jobs/{job_id}/cancel — cancels a job, with a reason.
   *
   * CONTRACT (from the live OpenAPI spec, not the Swagger UI):
   *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
   *   - exactly ONE parameter: the required integer path `job_id`
   *   - a **REQUIRED `application/json` request body** (schema JobCancelRequest):
   *     `reason` required, a string of 3–255 characters (NO enum — free text), and
   *     `notes` optional and nullable. Unlike start/complete this action is NOT
   *     body-less, and the two field names are exactly these.
   *   - only 200 (**the JobResponse DIRECTLY** — no `{ message, job }` envelope) and
   *     422 (HTTPValidationError) are documented
   *   - VERIFIED LIVE (no token): POST → 401 {"detail":"Not authenticated"}; GET/PUT
   *     → 405, so POST is the registered method
   *
   * PROTECTED + the shared 401 refresh/replay. The caller gates on the backend's own
   * `is_cancellable` flag and validates the reason against the same 3–255 rule BEFORE
   * sending, so an empty or too-short reason can never reach the API. On success the
   * 200 body is the authoritative job (cancellation_reason, cancellation_notes,
   * cancellation_fee_charged, cancelled_at and every derived flag), so the caller
   * replaces its cached job with it rather than mutating anything locally.
   */
  cancelJob: (jobId: number, payload: JobCancelRequest) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`cancelJob: invalid job id ${String(jobId)}`));
    }
    return api.post<JobResponse>(`/api/v1/jobs/${jobId}/cancel`, payload);
  },

  /**
   * POST /api/v1/jobs/{job_id}/provider-cancel — the PROVIDER withdraws from a job
   * they were already accepted/assigned to (Swagger: "Provider Cancel After
   * Acceptance").
   *
   * CONTRACT (from the live OpenAPI spec):
   *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
   *   - exactly ONE parameter: the required integer path `job_id`
   *   - **NO `requestBody`** — unlike the client's `/cancel`, nothing is sent (no
   *     reason/notes), so no body is invented here
   *   - its 200 is the WRAPPED `JobActionResponse` `{ message, job }` — the same
   *     envelope as convert-to-regular / restart-timer, and NOT the direct job the
   *     client's `/cancel` returns; 422 is HTTPValidationError
   *
   * PROTECTED + the shared 401 refresh/replay. The caller gates on the active
   * PROVIDER role and on the job still being assigned (assigned_provider_id set) and
   * not yet finished; the backend authorises the real party (403 gets its own copy and
   * a re-sync). On success the caller adopts `data.job` WHOLESALE — status,
   * assigned_provider_id, is_bidding_open, the can_* flags, cancelled_at and
   * cancellation_fee_charged all come from it — and uses `data.message` for the toast.
   */
  providerCancelJob: (jobId: number) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`providerCancelJob: invalid job id ${String(jobId)}`));
    }
    return api.post<JobActionResponse>(`/api/v1/jobs/${jobId}/provider-cancel`);
  },

  /**
   * POST /api/v1/jobs/{job_id}/decline-by-provider — the PROVIDER declines a job they
   * were assigned but had not started (Swagger: "Decline By Provider").
   *
   * CONTRACT (from the live OpenAPI spec):
   *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
   *   - exactly ONE parameter: the required integer path `job_id`
   *   - a **REQUIRED `application/json` request body** (schema JobDetailsRequest)
   *     whose only property, `details` (required, `minLength: 3`, `maxLength: 1000`,
   *     NO enum), is a free-text explanation — NOT `reason`/`notes`
   *   - its 200 is the JobResponse DIRECTLY (no `{ message, job }` envelope here, and
   *     no `message` field at all, so the caller writes the success toast itself);
   *     422 is HTTPValidationError
   *
   * PROTECTED + the shared 401 refresh/replay. The caller gates on the active PROVIDER
   * role and on the job sitting in PROVIDER_ASSIGNED (assigned, work not begun — the
   * window the sibling provider-cancel endpoint does NOT own); the backend authorises
   * the real party. On success the caller replaces its cached job with the 200 body —
   * status, assigned_provider_id, is_bidding_open, the can_* flags and
   * cancellation_fee_charged all come from it, never from local guesses.
   */
  declineJobByProvider: (jobId: number, payload: JobDetailsRequest) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`declineJobByProvider: invalid job id ${String(jobId)}`));
    }
    return api.post<JobResponse>(`/api/v1/jobs/${jobId}/decline-by-provider`, payload);
  },

  /**
   * POST /api/v1/jobs/{job_id}/pause-by-client — the CLIENT temporarily halts a job
   * that is already under way (Swagger: "Pause By Client").
   *
   * CONTRACT (from the live OpenAPI spec):
   *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
   *   - exactly ONE parameter: the required integer path `job_id`
   *   - a **REQUIRED `application/json` request body** (schema JobDetailsRequest)
   *     whose only property, `details` (required, `minLength: 3`, `maxLength: 1000`,
   *     NO enum), is a free-text explanation — NOT `reason`/`notes`
   *   - its 200 is the JobResponse DIRECTLY (no `{ message, job }` envelope and no
   *     `message` field, so the caller writes the success toast); 422 is
   *     HTTPValidationError
   *
   * PROTECTED + the shared 401 refresh/replay. The caller gates on the CLIENT side and
   * on the job sitting in IN_PROGRESS with a real assigned provider, not cancelled /
   * completed / already paused; the backend authorises the real client. On success the
   * caller replaces its cached job with the 200 body — status, is_editable,
   * is_cancellable, the can_* flags, status_history and milestones all come from it,
   * never from local guesses. No resume endpoint is connected, so the screen shows the
   * paused state plainly rather than leaving a dead end.
   */
  pauseJobByClient: (jobId: number, payload: JobDetailsRequest) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`pauseJobByClient: invalid job id ${String(jobId)}`));
    }
    return api.post<JobResponse>(`/api/v1/jobs/${jobId}/pause-by-client`, payload);
  },

  /**
   * POST /api/v1/jobs/{job_id}/pause-by-provider — the PROVIDER puts a job they are
   * working on temporarily on hold (Swagger: "Pause By Provider").
   *
   * CONTRACT (from the live OpenAPI spec):
   *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
   *   - exactly ONE parameter: the required integer path `job_id`
   *   - a **REQUIRED `application/json` request body** (schema JobDetailsRequest)
   *     whose only property, `details` (required, `minLength: 3`, `maxLength: 1000`,
   *     NO enum), is a free-text explanation — NOT `reason`/`notes`. The operation
   *     carries no description, so the field is honoured exactly as the shared schema
   *     documents it.
   *   - its 200 is the JobResponse DIRECTLY (no `{ message, job }` envelope and no
   *     `message` field, unlike Restart Timer, so the caller writes the success toast);
   *     422 is HTTPValidationError
   *
   * PROTECTED + the shared 401 refresh/replay. The caller gates on the active PROVIDER
   * role and on the job sitting in IN_PROGRESS with a real assigned provider, not
   * cancelled / completed / already paused; the backend authorises the real assigned
   * provider (a wrong provider or a client is refused with its own copy and a re-sync).
   * On success the caller replaces its cached job with the 200 body — status, the
   * can_* flags, is_bidding_open, status_history and milestones all come from it, so a
   * paused job shows the status the backend set and the bidding countdown disappears by
   * itself (biddingDeadline returns null unless is_bidding_open is true).
   */
  pauseJobByProvider: (jobId: number, payload: JobDetailsRequest) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`pauseJobByProvider: invalid job id ${String(jobId)}`));
    }
    return api.post<JobResponse>(`/api/v1/jobs/${jobId}/pause-by-provider`, payload);
  },

  /**
   * POST /api/v1/jobs/{job_id}/blocker — reports what is stopping a job from proceeding
   * (Swagger: "Report Blocker"). Either party to an active job may report.
   *
   * CONTRACT (from the live OpenAPI spec):
   *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
   *   - exactly ONE parameter: the required integer path `job_id`
   *   - a **REQUIRED `application/json` request body** (schema JobDetailsRequest)
   *     whose only property, `details` (required, `minLength: 3`, `maxLength: 1000`,
   *     NO enum), is a free-text explanation — NOT `reason`/`notes`. That schema's own
   *     description names "reporting a blocker" among its IN_PROGRESS actions.
   *   - its 200 is the JobResponse DIRECTLY (no `{ message, job }` envelope and no
   *     `message` field, so the caller writes the confirmation); 422 is
   *     HTTPValidationError
   *   - the operation carries no description and no property is documented, so nothing
   *     about the server-side effect is assumed — the caller adopts the returned job
   *     wholesale and renders whatever it changed (status, status_history, flags)
   *   - there is NO blockers collection endpoint anywhere in the API, so the app cannot
   *     list reported blockers; the UI only confirms the report was sent
   *
   * PROTECTED + the shared 401 refresh/replay. The caller gates on the job sitting in an
   * active window (PROVIDER_ASSIGNED / IN_PROGRESS) with a real assigned provider and
   * not cancelled/completed — deliberately with NO role check, since `/blocker` is the
   * one job action the API does not split per role.
   */
  reportJobBlocker: (jobId: number, payload: JobDetailsRequest) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`reportJobBlocker: invalid job id ${String(jobId)}`));
    }
    return api.post<JobResponse>(`/api/v1/jobs/${jobId}/blocker`, payload);
  },

  /**
   * POST /api/v1/jobs/{job_id}/attachments — adds ONE file to a job (Swagger:
   * "Add Attachment").
   *
   * CONTRACT (from the live OpenAPI spec):
   *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory and IS
   *     auto-attached by the shared interceptor; the uploader's identity
   *     (`uploaded_by`-style ownership) is derived server-side from that token, so it is
   *     never sent in the body
   *   - exactly ONE parameter: the required integer path `job_id`
   *   - a **REQUIRED `multipart/form-data` body** (schema
   *     Body_add_attachment_api_v1_jobs__job_id__attachments_post) with exactly ONE
   *     property, `file` (required, `contentMediaType: application/octet-stream`) — this
   *     is NOT a JSON endpoint and the body must never be JSON.stringify'd
   *   - its **201** is the JobResponse DIRECTLY (no `{ message, job }` envelope and no
   *     `message` field), so the caller replaces its whole cached job with it; 422 is
   *     HTTPValidationError
   *   - the 201 example shows `attachments: []`, which is FastAPI's generic array
   *     placeholder, NOT evidence that the upload was ignored: the real entry shape is
   *     the spec's own `JobAttachmentResponse` (id, media_type, media_url|null,
   *     position, created_at) — the shape `JobResponse.attachments` already declares
   *   - the sibling DELETE on this path is "Remove Attachment" — a DIFFERENT action and
   *     deliberately not reachable from here
   *
   * MULTIPART handling follows this project's four existing uploads exactly
   * (profile-picture, residence-permits, face-video, certifications): the instance's
   * application/json default is overridden per-request and React Native's networking
   * layer builds the multipart header INCLUDING the boundary. Timeout raised to 120s — a
   * photo on a poor connection takes far longer than the 15s JSON default.
   *
   * `onProgress` receives the 0..1 upload fraction when the platform reports a total size
   * and `null` when it cannot, so the screen can show a real bar with an honest
   * indeterminate fallback.
   */
  addJobAttachment: (
    jobId: number,
    file: { uri: string; name: string; mimeType: string },
    onProgress?: (fraction: number | null) => void
  ) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`addJobAttachment: invalid job id ${String(jobId)}`));
    }
    const formData = new FormData();
    // React Native file part: { uri, name, type } (uri points at the local file).
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType,
    } as unknown as Blob);
    return api.post<JobResponse>(`/api/v1/jobs/${jobId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
      onUploadProgress: (event: { loaded?: number; total?: number }) => {
        if (!onProgress) return;
        const total = typeof event?.total === 'number' ? event.total : 0;
        const loaded = typeof event?.loaded === 'number' ? event.loaded : 0;
        // No usable total (chunked/unknown length) → an indeterminate progress signal.
        onProgress(total > 0 ? Math.min(1, Math.max(0, loaded / total)) : null);
      },
    });
  },

  /**
   * DELETE /api/v1/jobs/{job_id}/attachments/{attachment_id} — removes ONE attachment
   * from a job (Swagger: "Remove Attachment").
   *
   * CONTRACT (from the live OpenAPI spec):
   *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory and IS
   *     auto-attached by the shared interceptor
   *   - TWO required integer path parameters: `job_id` and `attachment_id` — the latter is
   *     each entry's own `id` from `JobAttachmentResponse` (NOT the job id, NOT an array
   *     index); both are guarded here so a nonsense id never reaches the wire
   *   - NO request body at all
   *   - its **204 is NO CONTENT**: there is no body to read, so this resolves with
   *     `void` and the caller must NOT treat any response data as a job. Because nothing
   *     comes back, the caller patches its own cached job by filtering the attachment out
   *     BY ID after the 2xx, and invalidates the job caches
   *   - 422 is the only other documented response; 403/404 are undocumented (a 404 is
   *     treated by the caller as "already removed")
   *
   * VERIFIED LIVE (no token): DELETE → 401 {"detail":"Not authenticated"}, so the path
   * is registered and protected. The sibling POST on the parent path is "Add Attachment"
   * — a different action, deliberately not reachable from here.
   */
  removeJobAttachment: (jobId: number, attachmentId: number) => {
    if (!isValidJobId(jobId) || !isValidJobId(attachmentId)) {
      return Promise.reject(
        new Error(
          `removeJobAttachment: invalid job id ${String(jobId)} / attachment id ${String(attachmentId)}`
        )
      );
    }
    // 204 No Content — resolves with an empty body; nothing is parsed from it.
    return api.delete<void>(`/api/v1/jobs/${jobId}/attachments/${attachmentId}`);
  },

  confirmJobPayment: (jobId: number) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`confirmJobPayment: invalid job id ${String(jobId)}`));
    }
    return api.post<JobResponse>(`/api/v1/jobs/${jobId}/confirm-payment`);
  },

  /**
   * PATCH /api/v1/jobs/{job_id}/address — updates an EXISTING job address.
   *
   * CONTRACT (this task): FULL BODY only (partial bodies NOT confirmed, so the
   * full-body rule applies). All fields are sent explicitly: latitude/longitude as
   * NUMBERS, country_id/county_id/city_id as integers from the public geo cascade,
   * and the text fields (nullable where empty). This is edit-only — the job must
   * already have an address (otherwise use POST /jobs/{job_id}/address).
   *
   * PROTECTED: the shared axios instance attaches the Bearer token and refreshes
   * once before replaying, the same as the rest of the jobs group. On success the
   * 200 body is the authoritative address (source of truth — replace the cached job
   * address with it, never merge locally-guessed values). 422 detail[] maps loc to
   * fields for inline form errors; 404 (if returned) is treated as a graceful
   * "address not found" so the caller can switch to add-address flow. The caller
   * must gate on the job still being editable and still permitting edits.
   *
   * latitude/longitude type mismatch: sent as numbers, returned as strings — callers
   * must parseCoordinate / parseFloat before sending, and must treat the response
   * strings as the truth.
   */
  updateJobAddress: (jobId: number, payload: JobAddressUpdate) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`updateJobAddress: invalid job id ${String(jobId)}`));
    }
    return api.patch<JobAddressResponse>(`/api/v1/jobs/${jobId}/address`, payload);
  },

  /**
   * PATCH /api/v1/jobs/{job_id} — updates ONLY title, description,
   * scheduled_at and expected_hours (schema JobUpdate).
   *
   * CONTRACT (verified against the live OpenAPI): one required integer path
   * parameter; the body schema has NO required fields, and it exposes exactly
   * those four properties — so the address, status, request_type, booking_type,
   * category_id and service_id cannot be changed here, by construction.
   *
   * PROTECTED: same shared-client auth/refresh-once rules as the rest of the
   * jobs group. Documented responses are 200 (the FULL JobResponse, which is
   * the source of truth for recalculated fields such as is_editable, status and
   * remaining_bidding_seconds) and 422. The docs say nothing about 400/401/403/
   * 404/409, so those are handled generically from the backend's own `detail`.
   *
   * The call is only ever made when the job's `is_editable` flag is true — the
   * edit screen hides the whole form otherwise (see lib/jobUpdate).
   */
  updateJob: (jobId: number, payload: UpdateJobRequest) => {
    if (!isValidJobId(jobId)) {
      return Promise.reject(new Error(`updateJob: invalid job id ${String(jobId)}`));
    }
    return api.patch<JobResponse>(`/api/v1/jobs/${jobId}`, payload);
  },

  /**
   * GET /api/v1/jobs/{job_id} — ONE job, in FULL.
   *
   * This is the source for the details screen, NOT the list response: the list
   * item omits description, address, attachments, status_history and every
   * is_editable / is_cancellable / can_* flag, all of which JobResponse has.
   *
   * AUTH: PROTECTED — the shared axios instance attaches the Bearer token and
   * refreshes it once before replaying, same as the rest of the jobs group.
   *
   * Verified against the live OpenAPI: the only path parameter is the required
   * integer `job_id`; the documented responses are 200 (JobResponse) and 422
   * ({"detail":[{"loc":["path","job_id"],...}]}).
   *
   * VERIFIED LIVE (no token): HTTP 401 {"detail":"Not authenticated"} for every
   * id, including a non-integer one — FastAPI resolves auth BEFORE it validates
   * the path, so 422/404 cannot be observed unauthenticated. The hook therefore
   * keys 401 off the status alone and treats 404 as its own 'notfound' state on
   * the same plain-string-detail convention the services group uses, rather
   * than assuming an undocumented body shape.
   */
  getJob: (jobId: number) => api.get<JobResponse>(`/api/v1/jobs/${jobId}`),
  /**
   * GET /api/v1/categories/{category_id} — ONE category with detail fields
   * (integer path param per the live schema). VERIFIED LIVE (public — no
   * auth header needed despite the docs' lock icon): a nonexistent id →
   * 404 {"detail":"Category not found."} (plain-string detail);
   * non-integer id → 422 int_parsing with detail[].loc
   * ["path","category_id"]. 200 = CategoryDetailResponse — a RICHER schema
   * than list items (is_active/status/timestamps REQUIRED here, absent in
   * the list response), so a cached list entry can never satisfy a detail
   * view; the hook caches full detail records separately. UI gates
   * browsability on is_active (status semantics undocumented — never
   * guessed); created_at/updated_at are informational only.
   */
  getCategory: (categoryId: number) =>
    api.get<CategoryDetailResponse>(`/api/v1/categories/${categoryId}`),
  /**
   * GET /api/v1/categories/{category_id}/services — the services inside ONE
   * category (integer path param per the live schema). VERIFIED LIVE
   * (public — no auth header needed despite the docs' lock icon): a
   * nonexistent category → 404 {"detail":"Category not found."}
   * (plain-string detail); a non-integer id → 422 int_parsing with
   * detail[].loc ["path","category_id"]. 200 = a BARE ARRAY of
   * ServiceListItem (no wrapper, no pagination). price_from/price_to
   * are nullable numeric STRINGS — format via lib/servicePrice.ts helpers,
   * never rendered raw. thumbnail_url is nullable. Cache per category id in
   * useCategoryServices; do not call per render.
   */
  getCategoryServices: (categoryId: number) =>
    api.get<ServiceListItem[]>(`/api/v1/categories/${categoryId}/services`),
  /**
   * GET /api/v1/addresses — the signed-in user's saved address. COUNTER-
   * INTUITIVE: the live OpenAPI Schema tab shows the 200 schema is $ref
   * AddressResponse — a SINGLE object ("type": "object"), NOT an array and
   * NOT a { addresses: [...] } wrapper, despite the plural endpoint name
   * (the Example Value panel also renders one object, consistent with this).
   * Fields match that object exactly: id, user_id, latitude/longitude as
   * numeric STRINGS, house_number/street_address/postal_code/landmark/
   * formatted_address (nullable strings), is_default (bool), nested country
   * {id,name,iso2,iso3,phone_code} / county {id,name} / city {id,name}, and
   * created_at/updated_at date-times. No parameters (parameters: []) —
   * token-scoped. The runtime shape may still evolve (Create/Get-single/
   * Update/Delete siblings + web precedent suggest one-per-user data), so
   * the hook defensively normalizes a bare-array/wrapper body to its first
   * element. 401 when unauthenticated; no 422 (no params). Protected
   * endpoint, Bearer auto-attached by the shared instance.
   */
  getAddresses: () => api.get<AddressResponse>('/api/v1/addresses'),
  /**
   * GET /api/v1/addresses/{address_id} — fetches ONE address by its own id
   * (integer path param per the live schema; responses 200 + 422 only, 404
   * undocumented → treated as a graceful "not found", web precedent). 200
   * returns a bare AddressResponse — the SAME shape GET /api/v1/addresses
   * returns, so a cached single entry already carries every field and the
   * network call only fires when no cached record exists (deep-link /
   * booking-summary resolution). Protected endpoint, Bearer auto-attached.
   */
  getAddress: (addressId: number) =>
    api.get<AddressResponse>(`/api/v1/addresses/${addressId}`),
  /**
   * PUT /api/v1/addresses/{address_id} — updates an existing address
   * (integer path param per the live schema; request body REQUIRED). Body
   * schema is AddressUpdate — DISTINCT from AddressCreate but with the same
   * optional-field shape (no required[]; lat/lng number|numeric-string|null;
   * is_default boolean|null). Per PUT full-replace semantics the caller
   * sends the COMPLETE object (every field explicit, null where unknown) —
   * never a partial diff — so unspecified fields cannot be reset server-
   * side. 200 returns the full AddressResponse (server truth — replaces the
   * cached entry); 422 detail[] maps loc → field for inline form errors;
   * 404 undocumented → web precedent. Protected endpoint, Bearer
   * auto-attached by the shared instance (silent refresh on 401).
   */
  updateAddress: (addressId: number, payload: AddressUpdatePayload) =>
    api.put<AddressResponse>(`/api/v1/addresses/${addressId}`, payload),
  /**
   * DELETE /api/v1/addresses/{address_id} — removes the address (integer
   * path param per the live schema). UNUSUAL: the success response is 204
   * NO CONTENT (live OpenAPI: no response schema at all) — typed `void` and
   * NEVER parsed as JSON; callers branch on success/failure only. Responses:
   * 204 + 422 only; 404 undocumented → treated as already-removed (web
   * precedent, mirrors certifications). Deleting the user's default address
   * returns no body, so any server-side default re-assignment is only
   * observable via the next GET refetch — callers must not guess. Protected
   * endpoint, Bearer auto-attached by the shared instance.
   */
  deleteAddress: (addressId: number) =>
    api.delete<void>(`/api/v1/addresses/${addressId}`),
  /**
   * POST /api/v1/addresses — creates the authenticated user's address.
   * JSON body per AddressCreate (live OpenAPI): every field OPTIONAL (no
   * required[] in the schema — latitude/longitude accept number | numeric
   * string | null; is_default defaults false). country_id/county_id/city_id
   * are numeric ids from the PUBLIC geo endpoints (GET /api/v1/countries/,
   * /countries/{id}/counties, /counties/{id}/cities — verified live: Estonia
   * id=1 → Harju id=1 → Tallinn id=1) — never hardcoded. 201 returns the
   * full AddressResponse (server truth — the caller seeds it into the
   * addresses cache). 422 detail[] maps loc-last-element → field for inline
   * form errors. Protected endpoint, Bearer auto-attached by the shared
   * instance (silent refresh on 401).
   */
  createAddress: (payload: AddressCreatePayload) =>
    api.post<AddressResponse>('/api/v1/addresses', payload),
  /**
   * GET /api/v1/countries/ — PUBLIC (no auth per live OpenAPI security:
   * None) list of { id, name, iso2, iso3?, phone_code? }. Verified live:
   * [{ id: 1, name: 'Estonia', iso2: 'EE', ... }]. Source for the Add
   * Address country picker's numeric ids.
   */
  getCountries: () => api.get<AddressCountryResponse[]>('/api/v1/countries/'),
  /**
   * GET /api/v1/countries/{country_id} — fetches ONE country by id
   * (integer path param per the live schema; responses 200 + 422 in the
   * OpenAPI). PUBLIC — no Authorization header. VERIFIED LIVE (public, so
   * real responses were probed): 200 returns a bare CountryResponse
   * { id, name, iso2, iso3?, phone_code? }; a nonexistent id → 404
   * {"detail":"Country not found."} (plain-string detail — undocumented in
   * the schema but real); a non-integer id → 422 int_parsing with
   * detail[].loc ["path","country_id"]. Cache-first discipline: the
   * useCountries hook checks its cached list/single-item map BEFORE calling
   * this, and "Get Address by ID" responses already nest the full country
   * object — this endpoint is only for a bare country_id with no other
   * source. Treated as graceful not-found by callers (null), web precedent.
   */
  getCountry: (countryId: number) =>
    api.get<AddressCountryResponse>(`/api/v1/countries/${countryId}`),
  /**
   * GET /api/v1/countries/{country_id}/counties — counties for a country,
   * [{ id, name }]. VERIFIED LIVE (public — no auth header needed despite
   * the docs' lock icon): 200 returns [{ id: 1, name: 'Harju' }] for
   * Estonia; a nonexistent country → 404 {"detail":"Country not found."}
   * (plain-string detail, undocumented in the schema); a non-integer id →
   * 422 int_parsing with detail[].loc ["path","country_id"]. CASCADE
   * DISCIPLINE: only called once a country_id is selected (picker open or
   * prefill); consumers reset county+city selections on country change and
   * surface empty-array/loading/retry states.
   */
  getCounties: (countryId: number) =>
    api.get<AddressRegionResponse[]>(`/api/v1/countries/${countryId}/counties`),
  /**
   * GET /api/v1/counties/{county_id}/cities — cities for a county,
   * [{ id, name }]. VERIFIED LIVE (public — no auth header needed despite
   * the docs' lock icon): 200 returns [{ id: 1, name: 'Tallinn' }] for
   * Harju; a nonexistent county → 404 {"detail":"County not found."}
   * (plain-string detail, undocumented in the schema); a non-integer id →
   * 422 int_parsing with detail[].loc ["path","county_id"]. CASCADE
   * DISCIPLINE: only called once a county_id is selected (picker open or
   * prefill); consumers reset the city selection on county AND country
   * change and surface empty-array/loading/retry states.
   */
  getCities: (countyId: number) =>
    api.get<AddressRegionResponse[]>(`/api/v1/counties/${countyId}/cities`),
  /**
   * GET /api/v1/cities/{city_id} — fetches ONE city by id (integer path
   * param per the live schema; responses 200 + 422 in the OpenAPI).
   * VERIFIED LIVE (public — no auth header needed despite the docs' lock
   * icon): 200 returns a bare CityResponse { id, name } (Tallinn for id 1);
   * a nonexistent id → 404 {"detail":"City not found."} (plain-string
   * detail, undocumented in the schema); a non-integer id → 422 int_parsing
   * with detail[].loc ["path","city_id"]. Cache-first discipline: the
   * useCities hook checks its caches BEFORE calling this. NOTE — the
   * current app has NO consumer (every city_id already carries its name
   * from List Cities rows or the nested AddressResponse.city object); this
   * is the prepared-for-future helper for a bare-id-only scenario. Cities
   * are the FINAL level of the location hierarchy (no area/locality
   * sub-level exists in the live OpenAPI).
   */
  getCity: (cityId: number) =>
    api.get<AddressRegionResponse>(`/api/v1/cities/${cityId}`),
  /**
   * GET /api/v1/counties/{county_id} — fetches ONE county by id (integer
   * path param per the live schema; responses 200 + 422 in the OpenAPI).
   * VERIFIED LIVE (public — no auth header needed despite the docs' lock
   * icon): 200 returns a bare CountyResponse { id, name } (Harju for id 1);
   * a nonexistent id → 404 {"detail":"County not found."} (plain-string
   * detail, undocumented in the schema); a non-integer id → 422 int_parsing
   * with detail[].loc ["path","county_id"]. Cache-first discipline: the
   * useCounties hook checks its caches BEFORE calling this. NOTE — the
   * current app has NO consumer (every county_id already carries its name
   * from List Counties rows or the nested AddressResponse.county object);
   * this is the prepared-for-future helper for a bare-id-only scenario
   * (e.g. a deep-linked saved profile storing only county_id).
   */
  getCounty: (countyId: number) =>
    api.get<AddressRegionResponse>(`/api/v1/counties/${countyId}`),
  /**
   * GET /api/v1/certifications/{certification_id} — fetches ONE certification
   * by its own id (integer path param per the live schema). 200 returns a
   * bare CertificationResponse — the SAME shape as a list item (live OpenAPI:
   * $ref CertificationResponse), so a cached list entry already carries every
   * field and the network call is only needed as a fallback/deep-link fetch
   * when no cached record exists. Responses: 200 + 422 only; 404 is NOT
   * documented — treated as a graceful "not found" state (web precedent).
   * Protected endpoint, Bearer auto-attached.
   */
  getCertification: (certificationId: number) =>
    api.get<CertificationResponse>(`/api/v1/certifications/${certificationId}`),
  /**
   * DELETE /api/v1/certifications/{certification_id} — removes an uploaded
   * certification (integer path param per the live schema; responses 200 +
   * 422 ONLY, 404 undocumented → treated as already-removed, web precedent).
   * UNUSUAL: the 200 body is a bare string (live OpenAPI schema {}), NOT an
   * object with a "message" field — typed as `string`, never read as an
   * object. Ownership of another provider's id is undocumented — errors
   * surface generically. Protected endpoint, Bearer auto-attached.
   */
  deleteCertification: (certificationId: number) =>
    api.delete<string>(`/api/v1/certifications/${certificationId}`),
  /**
   * POST /api/v1/certifications — uploads a certification file as
   * multipart/form-data (NOT JSON), field `file` (required per the live
   * schema). provider_id/created_by are derived server-side from the Bearer
   * token — never sent. Returns { message, certification } (201) — the full
   * CertificationResponse the caller seeds into the list cache. Same
   * multipart pattern as the other uploads (boundary set by RN's networking
   * layer; 60s timeout). Protected endpoint, Bearer auto-attached.
   */
  uploadCertification: (file: { uri: string; name: string; mimeType: string }) => {
    const formData = new FormData();
    formData.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    return api.post<CertificationUploadResponse>('/api/v1/certifications', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },
  /**
   * POST /api/v1/clients/favorites — saves a service as a favorite for the
   * signed-in client. Body is ONLY { service_id } (integer, required per the
   * live schema) — notes are NOT settable at creation (they come later via
   * PATCH /clients/favorites/{id}, a separate task). The 200 response is
   * { message, service_id } — NOTE: no favorite id is returned, so the new
   * entry's id is only learned from the next list fetch. JSON, Bearer
   * auto-attached.
   */
  addClientFavorite: (serviceId: number) =>
    api.post<FavoriteResponse>('/api/v1/clients/favorites', { service_id: serviceId }),
  /**
   * GET /api/v1/clients/favorites/{favorite_id} — fetches ONE favorite record
   * by its own id (NOT the service_id). 200 returns FavoriteItemResponse
   * ({ id, service_id, notes?, created_at }) — service display data must be
   * joined client-side. 422 documented for invalid path values; 404 is NOT
   * documented — treated as a graceful "not found" state (web precedent).
   * Bearer auto-attached.
   */
  getClientFavorite: (favoriteId: number) =>
    api.get<FavoriteItemResponse>(`/api/v1/clients/favorites/${favoriteId}`),
  /**
   * PATCH /api/v1/clients/favorites/{favorite_id} — updates a favorite's
   * notes (the ONLY editable field per the live schema: string ≤500 chars or
   * null; service_id is not editable). 200 returns the full
   * FavoriteItemResponse — the source of truth that replaces the cached
   * record (never a local merge). 422 documented for validation; 404
   * undocumented (web precedent: graceful not-found). Bearer auto-attached.
   */
  updateClientFavorite: (favoriteId: number, notes: string | null) =>
    api.patch<FavoriteItemResponse>(`/api/v1/clients/favorites/${favoriteId}`, { notes }),
  /**
   * DELETE /api/v1/clients/favorites/{favorite_id} — removes a saved
   * favorite. Success is 204 NO CONTENT — there is no response body and no
   * JSON must be parsed (axios returns empty data; only the status matters).
   * 422 documented for validation; 404 undocumented — treated as
   * already-removed (web precedent) so stale rows still clear. Bearer
   * auto-attached.
   */
  deleteClientFavorite: (favoriteId: number) =>
    api.delete<void>(`/api/v1/clients/favorites/${favoriteId}`),
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
