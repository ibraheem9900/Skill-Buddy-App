/** POST /api/v1/providers/status response — the new current status entry.
 * Also the item shape of GET /providers/status-history (which additionally
 * LACKS id and timestamp fields — see getProviderStatusHistory).
 */
export interface ProviderStatusResponse {
  status: string;
  reason?: string | null;
  is_current?: boolean;
}

/** GET /api/v1/clients/profile response — the client's activity stats
 * ("My Activity" set, mirroring the web app's mapping). `total_amount_spent`
 * is a decimal STRING per schema — parse before display.
 */
export interface ClientProfileResponse {
  id: number;
  user_id: number;
  preferred_language: string;
  total_bookings: number;
  total_completed_jobs: number;
  total_cancelled_jobs: number;
  total_active_jobs: number;
  total_reviews: number;
  star_rating: number;
  /** Decimal STRING per schema — Number() it for display, never render raw. */
  total_amount_spent: string;
}

/** One item of GET /api/v1/certifications — an uploaded provider
 * certification. `certification_url` points to the uploaded file (image or
 * PDF) — rendered as an external link/viewer on mobile.
 */
export interface CertificationResponse {
  id: number;
  provider_id: number;
  certification_url: string;
  created_at: string;
  updated_at?: string | null;
  created_by?: number | null;
  updated_by?: number | null;
}

/** POST /api/v1/certifications success body (201) — the created record as
 * a full CertificationResponse (source of truth for the list cache).
 */
export interface CertificationUploadResponse {
  message: string;
  certification: CertificationResponse;
}

/** GET /api/v1/certifications response — WRAPPED list (not a bare array).
 * No pagination/filter parameters exist (live OpenAPI: parameters: []) — the
 * endpoint scopes to the authenticated provider via the token; `total` is
 * the full count.
 */
export interface CertificationListResponse {
  certifications: CertificationResponse[];
  total: number;
}

/** Nested country of GET /api/v1/addresses (CountryResponse per the live
 * OpenAPI). iso3/phone_code are optional per the schema (anyOf null).
 */
export interface AddressCountryResponse {
  id: number;
  name: string;
  iso2: string;
  iso3?: string | null;
  phone_code?: string | null;
}

/** Nested county/city of GET /api/v1/addresses (CountyResponse /
 * CityResponse per the live OpenAPI — identical { id, name } shape).
 */
export interface AddressRegionResponse {
  id: number;
  name: string;
}

/** GET /api/v1/addresses response — a SINGLE AddressResponse object (live
 * OpenAPI Schema tab: $ref AddressResponse, "type": "object" — NOT an array
 * and no list wrapper, despite the endpoint's plural name). Text fields are
 * nullable (required but anyOf null); latitude/longitude are numeric STRINGS
 * — never Number() them for display. is_default is always present.
 */
export interface AddressResponse {
  id: number;
  user_id?: number | null;
  /** Numeric STRING per the schema (e.g. "24.7453674") — never render raw. */
  latitude?: string | null;
  /** Numeric STRING per the schema — never render raw. */
  longitude?: string | null;
  house_number?: string | null;
  street_address?: string | null;
  postal_code?: string | null;
  landmark?: string | null;
  formatted_address?: string | null;
  is_default: boolean;
  country?: AddressCountryResponse | null;
  county?: AddressRegionResponse | null;
  city?: AddressRegionResponse | null;
  created_at: string;
  updated_at: string;
}

/** POST /api/v1/addresses request body (AddressCreate per the live OpenAPI).
 * EVERY field is optional server-side (schema has NO "required" array;
 * latitude/longitude accept number | numeric-string | null; is_default
 * defaults to false) — client-side validation decides what to insist on.
 * country_id/county_id/city_id are numeric ids sourced from the live
 * GET /api/v1/countries(/counties/cities) endpoints — never hardcoded.
 */
export interface AddressCreatePayload {
  latitude?: number | string | null;
  longitude?: number | string | null;
  country_id?: number | null;
  county_id?: number | null;
  city_id?: number | null;
  house_number?: string | null;
  street_address?: string | null;
  postal_code?: string | null;
  landmark?: string | null;
  formatted_address?: string | null;
  is_default?: boolean | null;
}

/** PUT /api/v1/addresses/{address_id} request body (AddressUpdate per the
 * live OpenAPI — a DISTINCT schema from AddressCreate with the same
 * optional-field shape: no required[], latitude/longitude accept number |
 * numeric-string | null, is_default anyOf boolean|null). The mobile client
 * still sends the FULL body per PUT full-replace semantics (task spec):
 * every field explicit, null where no usable value exists.
 */
export interface AddressUpdatePayload {
  latitude?: number | string | null;
  longitude?: number | string | null;
  country_id?: number | null;
  county_id?: number | null;
  city_id?: number | null;
  house_number?: string | null;
  street_address?: string | null;
  postal_code?: string | null;
  landmark?: string | null;
  formatted_address?: string | null;
  is_default?: boolean | null;
}

/** One item of GET /api/v1/clients/favorites — a saved-service bookmark.
 * Only stores service_id (NOT the service's title/price/image) — the screen
 * joins with the local services catalog for display.
 */
export interface FavoriteItemResponse {
  id: number;
  service_id: number;
  notes?: string | null;
  created_at: string;
}

/** POST /api/v1/clients/favorites success body — NOTE: no favorite id is
 * returned, only the echoed service_id (same shape the web app documents).
 * The new entry's real favorite id is learned from the next list fetch.
 */
export interface FavoriteResponse {
  message: string;
  service_id: number;
}

/** GET /api/v1/clients/favorites response. No pagination/filter parameters
 * exist (live OpenAPI: parameters: []) — `total` is the full count.
 */
export interface FavoriteListResponse {
  favorites?: FavoriteItemResponse[];
  total: number;
}

/** One item of GET /api/v1/clients/bookings' `bookings` array. The OpenAPI
 * schema is OPAQUE (additionalProperties: true, no named fields) — per the
 * task spec the real shape must NOT be guessed. The web app already ships
 * against this endpoint with defensive field-extraction helpers trying
 * candidate key names (see lib/bookingFields.ts) — mobile mirrors that.
 */
export interface ClientBooking {
  /** Present per the web app's ClientBooking type — also the list key. */
  id?: string | number;
  [key: string]: unknown;
}

/** GET /api/v1/clients/bookings response. No pagination/filter parameters
 * exist (live OpenAPI: parameters: []) — `total` is the full count.
 */
export interface ClientBookingsResponse {
  bookings?: ClientBooking[];
  total: number;
}

/** GET /api/v1/clients/dashboard response — the client's lightweight activity
 * summary (client counterpart of ProviderDashboardSummary). READ-ONLY display
 * data — refresh on dashboard entry / pull-to-refresh; never the profile and
 * never cached aggressively (stats change frequently). `total_amount_spent`
 * is a decimal STRING — parse before display.
 */
export interface ClientDashboardSummary {
  user_id: number;
  total_bookings: number;
  total_completed_jobs: number;
  total_active_jobs: number;
  /** Decimal STRING per schema (default "0.00") — format via formatAmountSpent. */
  total_amount_spent?: string;
}

/** GET /api/v1/providers/dashboard response — lightweight, READ-ONLY summary
 * (job counts + status flags only). Deliberately NOT the full profile and
 * never used to pre-fill/overwrite the editable provider-profile cache —
 * that is GET /providers/profile (ProviderProfile above).
 */
export interface ProviderDashboardSummary {
  user_id: number;
  total_jobs_completed: number;
  total_jobs_inprogress: number;
  is_available: boolean;
  is_active: boolean;
}

/** GET /api/v1/providers/profile response (raw API shape). */
export interface ProviderProfile {
  id: number;
  user_id: number;
  bio?: string | null;
  /** Decimal STRING per schema (can be huge) — parse before display. */
  hourly_rate?: string | null;
  provider_type: string;
  is_available: boolean;
  is_active: boolean;
  total_jobs_completed: number;
  total_jobs_cancelled_by_provider: number;
  total_jobs_cancelled_by_client: number;
  total_jobs_inprogress: number;
  total_reviews: number;
  star_rating: number;
  badge_count: number;
  credibility_score: number;
  acceptance_rate: number;
  response_time_avg: number;
  service_radius: number;
  current_status?: { status: string; reason?: string | null; is_current?: boolean } | null;
}

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  username?: string;
  phone?: string;
  profile_picture?: string;
  /** Raw API field (GET /users/me) — normalized into profile_picture by AuthContext. */
  profile_picture_url?: string;
  /** Raw API field — normalized into phone by AuthContext. */
  phone_number?: string;
  personal_code?: string;
  role?: 'CLIENT' | 'PROVIDER';
  active_role?: 'CLIENT' | 'PROVIDER';
  /** Roles from GET /users/me (e.g. ["CLIENT"]). Available for future role-driven UI. */
  roles?: string[];
  address?: Address;
  is_verified?: boolean;
  is_active?: boolean;
  deactivated?: boolean;
  created_at?: string;
  credit_points?: number;
  jobs_done?: number;
  active_jobs?: number;
  rating?: number;
}

export interface Address {
  street?: string;
  city?: string;
  county?: string;
  postal_code?: string;
  country?: string;
  house_number?: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface Category {
  id: string;
  name: string;
  iconLib: 'MaterialCommunityIcons' | 'Ionicons' | 'Feather';
  iconName: string;
  color: string;
}

/** One item of GET /api/v1/categories (CategoryListResponse per the live
 * OpenAPI). id+name are REQUIRED; description/icon_url are OPTIONAL (schema
 * required: ['id','name']) — icon rendering must tolerate a missing or
 * broken icon_url. VERIFIED LIVE: public endpoint (no auth — the docs'
 * lock icon does not match), 200 currently returns an EMPTY array while
 * the backend has no seeded categories.
 */
export interface CategoryResponse {
  id: number;
  name: string;
  description?: string | null;
  icon_url?: string | null;
}

/** GET /api/v1/categories/{category_id} (CategoryResponse per the live
 * OpenAPI — a RICHER schema than the list item: is_active, status and the
 * timestamps are REQUIRED here but absent from list items, which is why a
 * cached list entry can never satisfy a detail view). description/icon_url
 * remain optional. VERIFIED LIVE (public): nonexistent id → 404
 * {"detail":"Category not found."}; non-integer id → 422 int_parsing.
 */
export interface CategoryDetailResponse {
  id: number;
  name: string;
  description?: string | null;
  icon_url?: string | null;
  /** Gating flag: false → the category must NOT be presented as browsable
   * (no services list / view action). Treated as active when missing. */
  is_active: boolean;
  /** Semantics NOT documented (possible values unknown) — captured for the
   * team; the UI gates on is_active only, never guesses this field. */
  status: string;
  /** Informational only — never displayed to end users. */
  created_at: string;
  updated_at: string;
}

/** One service as the server lists it — the shared `ServiceListResponse`
 * schema behind BOTH list endpoints:
 *   - GET /api/v1/services                        (global catalog)
 *   - GET /api/v1/categories/{category_id}/services
 * Both return a bare ARRAY of this shape (no wrapper, no pagination).
 * id/category_id/title are REQUIRED; category_name, description, price_from,
 * price_to, price_range and thumbnail_url are all NULLABLE.
 * IMPORTANT: price_from/price_to are numeric STRINGS on the wire (declared
 * pattern `^(?!^[-+.]*$)[+-]?0*\d*\.?\d*$`) — never numbers and often null.
 * The docs' Example Value shows astronomically long values; that is the
 * unconstrained example generator, not real data (see lib/servicePrice.ts
 * for the defensive parse/format used by every consumer).
 * VERIFIED LIVE: GET /api/v1/services → 200 [] (backend unseeded);
 * GET /api/v1/categories/1/services → 404 {"detail":"Category not found."};
 * GET /api/v1/categories/abc/services → 422 int_parsing with detail[].loc
 * ["path","category_id"].
 */
export interface ServiceListItem {
  id: number;
  category_id: number;
  title: string;
  /** Server's own category label — informational; the screen already has
   * the category name from GET /categories/{id}. */
  category_name?: string | null;
  description?: string | null;
  /** Nullable numeric STRING (not a number) — parse before display. */
  price_from?: string | null;
  /** Nullable numeric STRING (not a number) — parse before display. */
  price_to?: string | null;
  /** Server-rendered range label (nullable) — display fallback ONLY when
   * the numeric from/to pair is absent. */
  price_range?: string | null;
  /** Cover-fit thumbnail URL (nullable) — must tolerate missing/broken. */
  thumbnail_url?: string | null;
}

/** One entry of `ServiceResponse.media` (live OpenAPI schema
 * ServiceMediaResponse): id/media_type/position/is_thumbnail REQUIRED,
 * media_url nullable. Rendered in the detail screen's gallery. */
export interface ServiceMediaItem {
  id: number;
  /** Server string, e.g. "image"/"video" — semantics undocumented; the UI
   * only uses entries that carry a usable media_url. */
  media_type: string;
  media_url?: string | null;
  position: number;
  is_thumbnail: boolean;
}

/** One entry of `ServiceResponse.inclusion_options` (live OpenAPI schema
 * InclusionOptionResponse): just { id, name }, both required. */
export interface ServiceInclusionOption {
  id: number;
  name: string;
}

/** GET /api/v1/services/{service_id} — the FULL service detail schema
 * (`ServiceResponse`), richer than ServiceListItem: adds what_to_expect,
 * is_active, status, created_at/updated_at (all four REQUIRED) and the
 * media / inclusion_options arrays (default []). price_from/price_to are
 * nullable numeric STRINGS exactly as in the list schema — parse via
 * lib/servicePrice.ts, never render raw. description/what_to_expect may
 * contain rich text/HTML — render through lib/sanitizeRichText.ts.
 * VERIFIED LIVE (public — no auth header needed): non-integer id → 422
 * int_parsing with detail[].loc ["path","service_id"]; a nonexistent id →
 * 404 {"detail":"Service not found."} (plain-string detail — happens even
 * though the docs document only 200/422). */
export interface ServiceDetailResponse {
  id: number;
  category_id: number;
  title: string;
  category_name?: string | null;
  description?: string | null;
  /** Nullable numeric STRING (not a number) — parse before display. */
  price_from?: string | null;
  /** Nullable numeric STRING (not a number) — parse before display. */
  price_to?: string | null;
  /** Server-rendered range label — fallback ONLY when from/to are absent. */
  price_range?: string | null;
  what_to_expect?: string | null;
  is_active: boolean;
  /** Server workflow state (semantics undocumented) — displayed only via
   * is_active; the raw value is never guessed into UI labels. */
  status: string;
  /** Informational only — never displayed to end users. */
  created_at: string;
  updated_at: string;
  media?: ServiceMediaItem[];
  inclusion_options?: ServiceInclusionOption[];
}

export interface Provider {
  id: string;
  name: string;
  avatar?: string;
  rating?: number;
  reviewCount?: number;
  jobsDone?: number;
  badge?: number;
  credibility?: number;
  specialty?: string;
  location?: string;
  isOnline?: boolean;
}

export interface Service {
  id: string;
  title: string;
  category: string;
  categoryId: string;
  provider: Provider;
  price: number;
  rating: number;
  reviewCount: number;
  image: string;
  images?: string[];
  location: string;
  description?: string;
  isBookmarked?: boolean;
  avgPriceMin?: number;
  avgPriceMax?: number;
}

export type BookingStatus =
  | 'draft'
  | 'open'
  | 'shortlisted'
  | 'assigned'
  | 'arrived'
  | 'in_progress'
  | 'revision_requested'
  | 'completed'
  | 'approved'
  | 'closed'
  | 'cancelled'
  | 'disputed'
  | 'expired'
  | 'paused';

export interface Booking {
  id: string;
  service: Service;
  provider: Provider;
  status: BookingStatus;
  date: string;
  time: string;
  price: number;
  address?: string;
  description?: string;
  isUrgent?: boolean;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'booking' | 'offer' | 'review' | 'payment' | 'system';
  time: string;
  isRead: boolean;
}

export interface ChatMessage {
  id: string;
  text?: string;
  image?: string;
  voice?: string;
  voiceDuration?: number;
  sender: 'me' | 'other';
  timestamp: string;
  senderName?: string;
  senderAvatar?: string;
}

export interface ChatThread {
  id: string;
  participant: Provider;
  lastMessage: string;
  lastTime: string;
  unreadCount: number;
  jobTitle?: string;
}

export interface Offer {
  id: string;
  title: string;
  subtitle: string;
  discount: number;
  description?: string;
  bg: string;
  bgImage?: string;
}

export interface Review {
  id: string;
  reviewer: {
    name: string;
    avatar?: string;
  };
  rating: number;
  comment: string;
  date: string;
}

// ─── Ticketing (Module 10) ─────────────────────────────────────────────────
export type TicketCategory =
  | 'Payment Issue'
  | 'Job Dispute'
  | 'Cancellation Issue'
  | 'No-show'
  | 'Misconduct'
  | 'Technical Issue'
  | 'Account Verification'
  | 'Other';

export type TicketStatus = 'Open' | 'In Review' | 'Waiting' | 'Resolved' | 'Closed';

export interface Ticket {
  id: string; // SB-TKT-YYYY-NNNNNN
  createdAt: number;
  status: TicketStatus;
  category: TicketCategory;
  description: string;
  attachments: string[];
  userId: string;
  userName: string;
  userRole: 'CLIENT' | 'PROVIDER';
  jobId?: string;
  jobCategory?: string;
  jobDate?: string;
  assignedProviderName?: string;
  amount?: number;
  paymentStatus?: string;
  transactionId?: string;
  autoGenerated?: boolean;
}

// ─── Jobs & Bidding (Phase 2) ──────────────────────────────────────────────────
export type JobUrgency = 'urgent' | 'regular';
export type JobStatus =
  | 'draft'
  | 'bidding'
  | 'short_listed'
  | 'task_assigned'
  | 'pending_payment'
  | 'arrived'
  | 'in_progress'
  | 'revision_requested'
  | 'completed'
  | 'approved'
  | 'closed'
  | 'cancelled'
  | 'expired'
  | 'disputed'
  | 'paused';

export interface Job {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  description: string;
  categoryId: string;
  category: string;
  date: string;
  time: string;
  expectedHours: number;
  hourlyRate: number;
  expectedPrice: number;
  photos: string[];
  urgency: JobUrgency;
  status: JobStatus;
  biddingEndsAt: number;
  biddingDurationMs: number;
  location: string;
  assignedProviderId?: string;
  assignedPrice?: number; // final agreed price once a bid is accepted
  paymentDeadline?: number; // epoch ms — 10-minute payment window
  paymentMethod?: PaymentMethod;
  arrivedAt?: number;
  denialCount?: number; // client can deny up to 2 times
  revisionRequest?: RevisionRequest;
  cancellation?: CancellationInfo;
  disputeReason?: string;
  clientReview?: JobReview;
  providerReview?: JobReview;
}

export type PaymentMethod = 'card' | 'apple_pay' | 'google_pay' | 'bank_transfer' | 'credit_points';

export interface RevisionRequest {
  proposedBy: 'client' | 'provider';
  extraHours: number;
  newPrice: number;
  status: 'pending' | 'approved' | 'denied';
}

export interface CancellationInfo {
  by: 'client' | 'provider';
  reason: string;
  feeCharged?: number;
}

export interface JobReview {
  rating: number;
  comment?: string;
}

export interface OrderBreakdown {
  bidPrice: number;
  beforeVat: number;
  vat: number;
  platformFee: number;
  total: number;
}

export interface PayoutBreakdown {
  bidPrice: number;
  beforeVat: number;
  vat: number;
  platformFee: number;
  commission: number;
  payout: number;
}

export interface BidProvider extends Provider {
  distanceKm: number;
  responseTimeMin: number;
}

export interface Bid {
  id: string;
  jobId: string;
  provider: BidProvider;
  price: number;
  eta: string;
  createdAt: number;
  score: number;
}

/* ────────────────────────────────────────────────────────────────────────────
 * JOBS API — server contract (POST /api/v1/jobs + /jobs/{id}/publish).
 *
 * These mirror the LIVE OpenAPI schemas exactly: JobCreate,
 * JobMilestoneCreate, JobAddressCreate, JobResponse, JobAddressResponse,
 * JobMilestoneResponse, JobAttachmentResponse, JobStatusHistoryResponse.
 *
 * They are deliberately NOT the local mock `Job` interface above: that one
 * models the app's demo jobs (string ids, hourlyRate, photos, urgency) which
 * the server contract does not have. Naming the 201 body `JobResponse` keeps
 * every existing mock-driven job screen compiling untouched.
 * ──────────────────────────────────────────────────────────────────────────── */

/** JobRequestType enum — exactly ["URGENT","REGULAR"]. */
export type JobRequestType = 'URGENT' | 'REGULAR';

/** BookingType enum — exactly ["ONE_TIME","MULTI_DAY"]. */
export type JobBookingType = 'ONE_TIME' | 'MULTI_DAY';

/** Server JobStatus enum — DISTINCT from the local mock `JobStatus` above. */
export type JobApiStatus =
  | 'DRAFT'
  | 'OPEN'
  | 'PAYMENT_PENDING'
  | 'PROVIDER_ASSIGNED'
  | 'IN_PROGRESS'
  | 'DECLINED_BY_PROVIDER'
  | 'DECLINED_BY_CLIENT'
  | 'PAUSED_BY_CLIENT'
  | 'PAUSED_BY_PROVIDER'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'CANCELLED_BY_CLIENT'
  | 'CANCELLED_BY_PROVIDER';

/**
 * One milestone row of the create payload (schema JobMilestoneCreate).
 * Only `scheduled_at` is required. The schema notes milestones are intended
 * for MULTI_DAY bookings, but JobCreate exposes NO top-level scheduled_at /
 * expected_hours, so this array is the only channel for a ONE_TIME job's
 * schedule either — see the doc comment on createJob.
 */
export interface JobMilestoneCreate {
  /** ISO 8601 UTC, e.g. "2026-09-28T10:35:52.816Z". */
  scheduled_at: string;
  /** number | numeric string | null on the wire; this app always sends a number. */
  expected_hours?: number | string | null;
}

/**
 * Address block of the create payload (schema JobAddressCreate). Every field
 * is optional/nullable on the server. `country_id`/`county_id`/`city_id` are
 * numeric ids from the PUBLIC geo endpoints — never invented client-side.
 * `latitude`/`longitude` are accepted but the app has no map picker, so they
 * are OMITTED rather than zero-filled (same rule the address screens use).
 */
export interface JobAddressCreate {
  latitude?: number | string | null;
  longitude?: number | string | null;
  country_id?: number | null;
  county_id?: number | null;
  city_id?: number | null;
  house_number?: string | null;
  street_address?: string | null;
  postal_code?: string | null;
  landmark?: string | null;
  formatted_address?: string | null;
}

/**
 * POST /api/v1/jobs request body (schema JobCreate).
 * Server-REQUIRED: service_id, title (3..150 chars), milestones (>= 1 item),
 * address. category_id/description are nullable; request_type/booking_type/
 * is_draft carry server defaults.
 */
export interface CreateJobRequest {
  service_id: number;
  category_id?: number | null;
  title: string;
  description?: string | null;
  request_type?: JobRequestType;
  booking_type?: JobBookingType;
  milestones: JobMilestoneCreate[];
  address: JobAddressCreate;
  is_draft?: boolean;
}

/** Nested geo objects returned inside JobAddressResponse. */
export interface JobAddressGeo {
  id: number;
  name: string;
}

/** JobAddressResponse — the job's own address (NOT AddressResponse). */
export interface JobAddressResponse {
  id: number;
  job_id: number;
  /**
   * Decimal STRING|null per the live schema (same convention as
   * AddressResponse.latitude). Parse with parseCoordinate before any math.
   */
  latitude: string | number | null;
  longitude: string | number | null;
  house_number: string | null;
  street_address: string | null;
  postal_code: string | null;
  landmark: string | null;
  formatted_address: string | null;
  country?: (JobAddressGeo & { iso2?: string; iso3?: string | null; phone_code?: string | null }) | null;
  county?: JobAddressGeo | null;
  city?: JobAddressGeo | null;
  created_at: string;
  updated_at: string;
}

/**
 * Server MilestoneStatus enum — schema MilestoneStatus (12 values, spec order).
 * DISTINCT from JobApiStatus; a milestone has its own lifecycle.
 */
export type MilestoneStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'ON_HOLD'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'CANCELLED_BY_CLIENT'
  | 'CANCELLED_BY_PROVIDER'
  | 'DISPUTED_BY_CLIENT'
  | 'DISPUTED_BY_PROVIDER'
  | 'PROVIDER_NO_SHOW'
  | 'CLIENT_NO_SHOW';

/** JobMilestoneResponse — a persisted milestone. */
export interface JobMilestoneResponse {
  id: number;
  sequence: number;
  /** REQUIRED (non-null) per the live schema, unlike the job's own schedule. */
  scheduled_at: string;
  /** Numeric STRING on the wire (same convention as service prices). */
  expected_hours?: string | null;
  status: MilestoneStatus;
  started_at?: string | null;
  completed_at?: string | null;
  note?: string | null;
  created_at: string;
  updated_at: string;
}

/** JobAttachmentResponse — note media_type is an unconstrained string. */
export interface JobAttachmentResponse {
  id: number;
  media_type: string;
  media_url?: string | null;
  position: number;
  created_at: string;
}

/** JobStatusHistoryResponse — one workflow transition. */
export interface JobStatusHistoryResponse {
  id: number;
  status: JobApiStatus;
  note?: string | null;
  changed_by?: number | null;
  created_at: string;
}

/**
 * PATCH /api/v1/jobs/{job_id} body (schema JobUpdate).
 *
 * Verified against the live OpenAPI: the schema has NO required fields, so a
 * PATCH may carry any subset. It exposes EXACTLY these four properties and
 * nothing else — address changes belong to the Job Address endpoints, and
 * status / request_type / booking_type / category_id / service_id are not
 * editable here at all.
 *
 * `title` is bounded 3..150 by the server. `expected_hours` is sent as a
 * NUMBER (the same field comes back as a numeric STRING on JobResponse).
 */
export interface UpdateJobRequest {
  title?: string | null;
  description?: string | null;
  /** ISO 8601 UTC string. */
  scheduled_at?: string | null;
  expected_hours?: number | null;
}

/**
 * PATCH /api/v1/jobs/{job_id}/address request body (schema JobAddressUpdate).
 *
 * Contract for this task: FULL BODY only (partial bodies NOT confirmed, so
 * follow the full-body rule). All fields below are sent explicitly; the geo ids
 * are integers from the public country → county → city cascade; latitude and
 * longitude are sent as NUMBERS (the API returns them as numeric strings on the
 * 200 response). The caller must be sure the job already has an address — this is
 * edit-only, never the first address (that is POST /api/v1/jobs/{job_id}/address).
 */
export interface JobAddressUpdate {
  latitude: number;
  longitude: number;
  country_id: number;
  county_id: number;
  city_id: number;
  house_number?: string | null;
  street_address?: string | null;
  postal_code?: string | null;
  landmark?: string | null;
  formatted_address?: string | null;
}

/**
 * POST /api/v1/jobs 201 body (schema JobResponse).
 * The app stores `id`, `status` and `bidding_ends_at` after creation.
 */
export interface JobResponse {
  id: number;
  client_id: number;
  category_id: number;
  service_id: number;
  title: string;
  description?: string | null;
  request_type: JobRequestType;
  booking_type: JobBookingType;
  status: JobApiStatus;
  scheduled_at?: string | null;
  /** Numeric STRING on the wire. */
  expected_hours?: string | null;
  bidding_started_at?: string | null;
  bidding_ends_at?: string | null;
  timer_restart_count: number;
  is_urgent: boolean;
  is_bidding_open: boolean;
  is_editable: boolean;
  is_cancellable: boolean;
  can_restart_timer: boolean;
  can_convert_to_regular: boolean;
  can_convert_to_urgent: boolean;
  remaining_bidding_seconds?: number | null;
  assigned_provider_id?: number | null;
  assigned_at?: string | null;
  completed_at?: string | null;
  cancellation_reason?: string | null;
  cancellation_notes?: string | null;
  cancellation_fee_charged: boolean;
  cancelled_at?: string | null;
  address?: JobAddressResponse | null;
  attachments?: JobAttachmentResponse[];
  status_history?: JobStatusHistoryResponse[];
  milestones?: JobMilestoneResponse[];
  created_at: string;
  updated_at: string;
}

/** One entry of a FastAPI 422 body. `loc` is ["body", ...path]. */
/**
 * 200 body of the job ACTION endpoints (schema JobActionResponse).
 *
 * "Generic envelope for job actions (restart timer, convert to regular, cancel, ...)
 * that returns a short message alongside the updated job." — the schema's own words.
 * Both members are REQUIRED, and `job` is the SAME full JobResponse that GET
 * /api/v1/jobs/{job_id} returns, so callers must adopt it wholesale: it already
 * carries the recalculated bidding window, permission flags and counters.
 *
 * Verified against the live OpenAPI spec: the restart-timer operation declares only
 * its 200 (this schema) and 422 (HTTPValidationError) responses, and declares NO
 * requestBody at all.
 */
export interface JobActionResponse {
  message: string;
  job: JobResponse;
}

/**
 * POST /api/v1/jobs/{job_id}/assign-provider request body
 * (schema JobAssignProviderRequest).
 *
 * The body is REQUIRED and its single property is REQUIRED — `provider_id` is an
 * integer, and it must be a real provider id: the ones the client can choose from
 * come from GET /api/v1/jobs/{job_id}/bids (each BidResponse carries
 * `provider.id`, schema BidProviderSummary) — the "Recommended SkillBuddies" /
 * "View All Offers" list. It must never be invented client-side.
 *
 * NOTE the response shape differs from the other job actions: this endpoint returns
 * the JobResponse DIRECTLY (no `{ message, job }` envelope).
 */
export interface JobAssignProviderRequest {
  provider_id: number;
}

/**
 * POST /api/v1/jobs/{job_id}/cancel request body (schema JobCancelRequest).
 *
 * The body is REQUIRED and `reason` is REQUIRED — a plain string with
 * `minLength: 3, maxLength: 255` and **no enum**, i.e. the contract itself confirms
 * FREE TEXT rather than a fixed list, so no reason value is ever invented client-side.
 * `notes` is OPTIONAL and nullable.
 *
 * NOTE the response shape differs from the other job actions: this endpoint returns
 * the JobResponse DIRECTLY (no `{ message, job }` envelope).
 */
export interface JobCancelRequest {
  reason: string;
  notes?: string | null;
}

/**
 * Body of the job "explanation" actions (schema JobDetailsRequest) — used by
 * POST /jobs/{job_id}/decline-by-provider AND its siblings decline-by-client,
 * pause-by-client, pause-by-provider and blocker. The schema's own description:
 * "Body for IN_PROGRESS actions that require an explanation: decline, pause, or
 * reporting a blocker."
 *
 * The single field is `details` (singular, PLURAL-looking but one string) — NOT
 * `reason`/`notes`. It is REQUIRED, `minLength: 3`, `maxLength: 1000`, and has **no
 * enum**, so the contract itself confirms FREE TEXT rather than a fixed list of
 * reasons; no reason value is ever invented client-side.
 *
 * NOTE the response shape of these endpoints differs from the other job actions: they
 * return the JobResponse DIRECTLY (no `{ message, job }` envelope).
 */
export interface JobDetailsRequest {
  details: string;
}

export interface ValidationErrorDetail {
  loc: (string | number)[];
  msg: string;
  type: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
}

/** FastAPI 422 response body shared by the jobs endpoints. */
export interface ApiValidationError {
  detail: ValidationErrorDetail[];
}

/**
 * One entry of GET /api/v1/jobs (schema JobListResponse).
 *
 * DELIBERATELY LIGHTER than JobResponse: the list carries NO description, NO
 * address, NO attachments, NO status_history, NO is_editable / is_cancellable
 * / can_* flags and NO assigned_provider fields. Those exist only on
 * GET /api/v1/jobs/{job_id}, so list cards must not reference them.
 *
 * `expected_hours` is a numeric STRING on the wire (same convention as service
 * prices). Status reuses the 14-value JobApiStatus union; request/booking
 * types reuse the enums added for Create Job — no duplicate types.
 */
export interface JobListItem {
  id: number;
  client_id: number;
  category_id: number;
  service_id: number;
  title: string;
  request_type: JobRequestType;
  booking_type: JobBookingType;
  status: JobApiStatus;
  scheduled_at?: string | null;
  /** Numeric STRING on the wire — parse before display. */
  expected_hours?: string | null;
  is_urgent: boolean;
  is_bidding_open: boolean;
  bidding_ends_at?: string | null;
  remaining_bidding_seconds?: number | null;
  created_at: string;
  updated_at: string;
  milestones?: JobMilestoneResponse[];
}

/**
 * Query parameters for GET /api/v1/jobs — every one is optional and nullable
 * EXCEPT the paging pair, which the server defaults to limit 20 / offset 0
 * (limit 1..100, offset >= 0). Unset params must be OMITTED from the query
 * string, never sent as null/undefined/empty.
 */
export interface ListJobsParams {
  status?: JobApiStatus | null;
  request_type?: JobRequestType | null;
  category_id?: number | null;
  service_id?: number | null;
  only_actively_bidding?: boolean;
  limit?: number;
  offset?: number;
}
