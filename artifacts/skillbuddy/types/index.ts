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
