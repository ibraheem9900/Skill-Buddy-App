/**
 * Feedback service.
 *
 * DOCUMENTED AND WIRED: GET /api/v1/feedback/options?context=… →
 * FeedbackOption[] ({id, context, label, is_other, sort_order}).
 *
 * NOT DOCUMENTED YET — see the clearly marked TODO stubs at the bottom of this
 * file. They throw FeedbackEndpointNotAvailableError instead of guessing a
 * request body or a response shape. The screens never call them yet; when the
 * next API arrives only the body of each function has to change.
 *
 * Auth: the shared axios instance (services/api.ts) attaches the Bearer token
 * and already refreshes an expired one once before replaying the request, so a
 * 401 needs no special handling here — the caller reports it and the app's
 * session flows take over.
 */
import { api } from '@/services/api';
import {
  isFeedbackContext,
  normalizeFeedbackOptions,
  type FeedbackContext,
  type FeedbackOption,
} from '@/lib/feedback';
import { normalizeTaskFeedback, type TaskFeedback } from '@/lib/taskFeedback';
import {
  REVIEW_COMMENT_LIMIT,
  REVIEW_OPTION_LIMIT,
  PROVIDER_REVIEWS_MAX_LIMIT,
  PROVIDER_REVIEWS_PAGE_SIZE,
  normalizeJobReviews,
  normalizePendingReviews,
  normalizeProviderReviewsPage,
  normalizeReviewsPage,
  normalizeReview,
  normalizeReviewsSummary,
  type ClientReviewsPage,
  type JobReviews,
  type PendingReview,
  type ProviderReviewsPage,
  type ProviderReviewsSummary,
  type ReviewsPage,
  type ReviewsSummary,
  type Review,
  type ReviewPayload,
} from '@/lib/reviews';

export type { FeedbackContext, FeedbackOption, TaskFeedback };

/** GET /api/v1/feedback/options — one context's predefined options. */
export async function getFeedbackOptions(context: FeedbackContext): Promise<FeedbackOption[]> {
  if (!isFeedbackContext(context)) {
    throw new Error(`getFeedbackOptions: unknown context ${String(context)}`);
  }
  const { data } = await api.get<unknown>('/api/v1/feedback/options', {
    params: { context },
  });
  // 200 is documented as a bare array; sort_order ordering is applied locally so
  // the screen shows the admin's order even if the server one drifts.
  return normalizeFeedbackOptions(data);
}

/**
 * Raised by every stub below. `endpoint` names the exact documented path so the
 * UI can say plainly which API is still missing, and the screen turns it into a
 * neutral "not available yet" notice rather than an error.
 */
export class FeedbackEndpointNotAvailableError extends Error {
  readonly endpoint: string;

  constructor(endpoint: string) {
    super(`TODO: ${endpoint} is not documented yet`);
    this.name = 'FeedbackEndpointNotAvailableError';
    this.endpoint = endpoint;
  }
}

export function isFeedbackEndpointNotAvailable(
  error: unknown
): error is FeedbackEndpointNotAvailableError {
  return error instanceof FeedbackEndpointNotAvailableError;
}

/**
 * What a submission will carry once the API exists. Deliberately minimal: only
 * values the UI actually collects, and every one of them is already documented
 * somewhere in the app (context values, option ids, a rating 1–5 and free text).
 * This is a UI-shaped draft, NOT a guessed request body — the stub below sends
 * nothing.
 */
export interface FeedbackSubmissionDraft {
  context: FeedbackContext;
  jobId: number | null;
  milestoneId: number | null;
  optionId: number | null;
  rating: number | null;
  comment: string;
  otherText: string;
  /** Local image uris only — uploaded by addDisputeImage once that API exists. */
  images: string[];
}

/**
 * TODO(feedback-submit): the "submit feedback" endpoint is NOT in the docs yet.
 * No path, body or response schema is invented here. Wire it when the API is
 * published, then the screen's existing success state becomes reachable.
 */
export async function submitFeedback(_draft: FeedbackSubmissionDraft): Promise<void> {
  throw new FeedbackEndpointNotAvailableError('POST /api/v1/feedback');
}

/**
 * GET /api/v1/jobs/{job_id}/milestones/{milestone_id}/feedback — "List
 * Milestone Feedback": every denial/dispute on one Task.
 *
 * LIVE (2026-11-15, both a client and a pilot account): 200 with `[]` for every
 * milestone in both accounts — there is no feedback row in this environment yet,
 * so the item shapes of `selected_options` and `attachments` are UNVERIFIED and
 * handled defensively in lib/taskFeedback.
 *
 * Errors measured live: 401 {"detail":"Invalid access token."}, 404
 * {"detail":"Job not found."} for a job the caller is not part of, 404
 * {"detail":"Milestone not found."}, 422 int_parsing for a non-integer id.
 * The screen maps 403/404 to its "not available" state.
 */
export async function listTaskFeedback(
  jobId: number,
  milestoneId: number
): Promise<TaskFeedback[]> {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error(`listTaskFeedback: invalid job id ${String(jobId)}`);
  }
  if (!Number.isInteger(milestoneId) || milestoneId <= 0) {
    throw new Error(`listTaskFeedback: invalid milestone id ${String(milestoneId)}`);
  }
  const { data } = await api.get<unknown>(
    `/api/v1/jobs/${jobId}/milestones/${milestoneId}/feedback`
  );
  return normalizeTaskFeedback(data);
}

/** One prepared image, ready to be sent as the multipart `file` part. */
export interface AttachmentImageFile {
  uri: string;
  name: string;
  mimeType: string;
}

/** Kept for the dispute screens/tests written before review photos existed. */
export type DisputeImageFile = AttachmentImageFile;
export type ReviewPhotoFile = AttachmentImageFile;

/**
 * POST /api/v1/milestone-feedback/{feedback_id}/attachments — "Add Dispute
 * Image": JPG/PNG/WebP only, max 5 per feedback, EXIF/GPS removed server-side.
 *
 * BODY: multipart/form-data with exactly ONE field, `file` (binary). The RN
 * file part is { uri, name, type } — the shape the app's other uploads use.
 *
 * HEADERS, deliberately: `Content-Type: multipart/form-data` WITHOUT any
 * boundary. Axios's transformRequest runs before the native layer and, because
 * the shared instance defaults to `application/json`, it would otherwise either
 * stringify this FormData or stamp `application/x-www-form-urlencoded` on it —
 * both verified locally. Declaring the bare multipart type lets React Native's
 * networking layer append the real boundary, so no boundary is ever hardcoded
 * here (same pattern as the existing profile-picture / residence-permit
 * uploads). The Bearer token comes from the shared interceptor.
 *
 * 201 returns the UPDATED feedback object (the same TaskFeedback shape as the
 * list endpoint); it is normalised defensively because nothing about
 * `attachments` items is documented.
 */
export async function uploadDisputeImage(
  feedbackId: number,
  image: DisputeImageFile,
  onProgress?: (progress: number) => void
): Promise<TaskFeedback> {
  if (!Number.isInteger(feedbackId) || feedbackId <= 0) {
    throw new Error(`uploadDisputeImage: invalid feedback id ${String(feedbackId)}`);
  }
  const formData = new FormData();
  formData.append('file', {
    uri: image.uri,
    name: image.name,
    type: image.mimeType,
  } as unknown as Blob);

  const { data } = await api.post<unknown>(
    `/api/v1/milestone-feedback/${feedbackId}/attachments`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      // Image uploads are slower than the JSON default; same 60s budget the
      // app's other uploads use.
      timeout: 60000,
      onUploadProgress: onProgress
        ? (event) => {
            const total = event.total ?? 0;
            if (total <= 0) return;
            onProgress(Math.max(0, Math.min(1, (event.loaded ?? 0) / total)));
          }
        : undefined,
    }
  );

  const [updated] = normalizeTaskFeedback(Array.isArray(data) ? data : [data]);
  if (!updated) {
    // A 2xx whose body is not the documented feedback object: keep the caller
    // honest instead of pretending the image is confirmed.
    throw new Error('uploadDisputeImage: unexpected response body');
  }
  return updated;
}

/**
 * DELETE /api/v1/milestone-feedback/{feedback_id}/attachments/{attachment_id} —
 * "Remove Dispute Image".
 *
 * CONTRACT: both path params are required integers; 204 means success with an
 * EMPTY body (nothing is read or parsed — axios resolves with `data === ''`,
 * and treating that as JSON would throw); 422 is the documented validation
 * error. The docs say nothing about 401/403/404/409, or about whether only the
 * author may delete or whether a resolved dispute is locked, so no such rule is
 * assumed here — the caller maps whatever status the backend returns to one
 * friendly sentence.
 *
 * `attachmentId` must come from the attachment ITEM of the feedback (the shape
 * of `attachments[]` is still undocumented; see lib/disputeImages
 * attachmentItems, which only trusts a numeric id next to an image url).
 */
export async function removeDisputeImage(
  feedbackId: number,
  attachmentId: number
): Promise<void> {
  if (!Number.isInteger(feedbackId) || feedbackId <= 0) {
    throw new Error(`removeDisputeImage: invalid feedback id ${String(feedbackId)}`);
  }
  if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
    throw new Error(`removeDisputeImage: invalid attachment id ${String(attachmentId)}`);
  }
  // No response handling on purpose: 204 has no body to parse.
  await api.delete<void>(
    `/api/v1/milestone-feedback/${feedbackId}/attachments/${attachmentId}`
  );
}

/* ── Job reviews ─────────────────────────────────────────────────────────── */

/**
 * The review types live in lib/reviews (pure, unit-tested) and are re-exported
 * here so screens import them from the service, as they do for feedback.
 * `JobReview` is kept as an alias of `Review` — the review form and its hook
 * already speak that name.
 */
export type {
  JobReviews,
  PendingReview,
  ProviderReviewsPage,
  ProviderReviewsSummary,
  Review,
  ReviewAuthorSide,
  ReviewState,
  ReviewStatus,
} from '@/lib/reviews';
export type JobReview = Review;

/**
 * POST /api/v1/jobs/{job_id}/reviews — "Submit Review".
 *
 * CONTRACT (verified live on 2026-11-15): the job must be CLOSED, one review per
 * side, hidden from the other party until both reviewed or 14 days passed.
 *
 * BODY (JobReviewCreate):
 *   rating        int, REQUIRED, 1..5   (422 evidence: ge=1, le=5)
 *   option_ids    int[], optional, max 20 items
 *   comment       string|null, optional, max 2000 — ALWAYS sent (empty string
 *                 when there is nothing to say; the schema accepts a string, so
 *                 no need to omit the field)
 *   show_publicly bool, optional, default false
 *
 * 201 → JobReviewResponse. Measured errors: 422 validation (per-field `loc`),
 * 400 {"detail":"A job can be reviewed once it is closed."}, 404
 * {"detail":"Job not found."}, 401 without a token. A second review is expected
 * to be rejected too, but its code is NOT documented, so nothing is assumed —
 * the caller maps whatever arrives to one friendly sentence.
 */
export async function submitReview(
  jobId: number,
  payload: ReviewPayload
): Promise<JobReview> {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error(`submitReview: invalid job id ${String(jobId)}`);
  }
  if (!Number.isInteger(payload.rating) || payload.rating < 1 || payload.rating > 5) {
    throw new Error(`submitReview: invalid rating ${String(payload.rating)}`);
  }
  const body: ReviewPayload = {
    rating: payload.rating,
    option_ids: [...new Set(payload.option_ids)].slice(0, REVIEW_OPTION_LIMIT),
    comment: payload.comment.slice(0, REVIEW_COMMENT_LIMIT),
    show_publicly: payload.show_publicly === true,
  };
  const { data } = await api.post<unknown>(`/api/v1/jobs/${jobId}/reviews`, body);
  const review = normalizeReview(data);
  if (!review || review.id === null) {
    // A 2xx whose body is not the documented review object: refuse to pretend
    // the review exists.
    throw new Error('submitReview: unexpected response body');
  }
  return review;
}

/**
 * GET /api/v1/jobs/{job_id}/reviews — "Get Job Reviews": one job's reviews for
 * the logged-in user, both sides.
 *
 * MEASURED LIVE (2026-11-15): the body is always the SAME single object with
 * every key present — for a job that is not closed it answers
 * `{job_id, can_review:false, review_deadline:null, my_review:null,
 * their_review:null}`. Errors: 404 {"detail":"Job not found."} for a job the
 * caller is not part of, 422 int_parsing for a non-integer id, 401 without a
 * token. There is no CLOSED job in this environment, so a populated body (and a
 * real review_deadline) could not be observed — the normaliser treats a
 * missing/null/{} review as "no review" so both cases are safe.
 */
export async function getJobReviews(jobId: number): Promise<JobReviews> {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error(`getJobReviews: invalid job id ${String(jobId)}`);
  }
  const { data } = await api.get<unknown>(`/api/v1/jobs/${jobId}/reviews`);
  return normalizeJobReviews(data, jobId);
}

/**
 * GET /api/v1/reviews/pending — "List Pending Reviews": the closed jobs the
 * logged-in user can still review. No parameters.
 *
 * MEASURED LIVE (2026-11-15): both a client and a pilot account get
 * `200 []` — there is no CLOSED job in this environment, so the populated item
 * shape (and whether the list mixes CLIENT and PROVIDER jobs) could not be
 * observed. The docs enumerate exactly `{job_id, title, closed_at,
 * review_deadline}`; there is NO role and NO other-party field, so the UI never
 * expects one. Errors are not documented; 401 {"detail":"Not authenticated"}
 * was measured without a token, and 403/404/422/network are handled
 * generically by the caller.
 *
 * The normaliser always returns an array (null/garbage body → []), drops items
 * whose deadline has passed and sorts soonest-first.
 */
export async function listPendingReviews(): Promise<PendingReview[]> {
  const { data } = await api.get<unknown>('/api/v1/reviews/pending');
  return normalizePendingReviews(data);
}

/**
 * GET /api/v1/providers/{provider_id}/reviews — "List Provider Reviews": the
 * PUBLISHED client reviews of a pilot, plus the rating summary.
 *
 * MEASURED LIVE (2026-11-15, client and provider accounts):
 *   • the path expects the provider PROFILE id — `/providers/3/reviews` → 200,
 *     while `/providers/2/reviews` (the same pilot's USER id) → 404
 *     {"detail":"Provider not found."}. ProviderProfile.id is that value.
 *   • an empty profile answers 200
 *     {"summary":{"star_rating":4,"review_average":null,"review_count":0},
 *      "reviews":[]} — review_average is NULL (not 0) when nothing is published,
 *     and star_rating is the profile's stored value, which is why it is never
 *     shown as a rating when review_count is 0.
 *   • limit=101 → 422 le:100, offset=-1 → 422 ge:0, unknown provider → 404,
 *     no token → 401 {"detail":"Not authenticated"}.
 * Ordering, attachments and selected_options items could NOT be observed: no
 * review exists in this environment, so the client keeps the SERVER order (no
 * cross-page sorting) and renders both arrays defensively.
 */
export async function listProviderReviews(
  providerId: number,
  params?: { limit?: number; offset?: number }
): Promise<ProviderReviewsPage> {
  if (!Number.isInteger(providerId) || providerId <= 0) {
    throw new Error(`listProviderReviews: invalid provider id ${String(providerId)}`);
  }
  const limit = Math.min(
    PROVIDER_REVIEWS_MAX_LIMIT,
    Math.max(1, Math.trunc(params?.limit ?? PROVIDER_REVIEWS_PAGE_SIZE))
  );
  const offset = Math.max(0, Math.trunc(params?.offset ?? 0));
  const { data } = await api.get<unknown>(`/api/v1/providers/${providerId}/reviews`, {
    params: { limit, offset },
  });
  return normalizeProviderReviewsPage(data);
}

/**
 * GET /api/v1/clients/{client_id}/reviews — "List Client Reviews": the
 * PUBLISHED provider (pilot) reviews of a client, plus the rating summary.
 *
 * MEASURED LIVE (2026-11-15, client and provider accounts):
 *   • the path expects the client PROFILE id — `/clients/4/reviews` → 200, while
 *     the same user's USER id (`/clients/5/reviews`) → 404
 *     {"detail":"Client not found."}. ClientProfileResponse.id is that value.
 *   • an empty profile answers 200
 *     {"summary":{"star_rating":4,"review_average":null,"review_count":0},
 *      "reviews":[]} — `review_average` is NULL until something is published and
 *     `star_rating` is the stored profile value (the client profile also reports
 *     `star_rating: 4, total_reviews: 0`).
 *   • limit=101 → 422 le:100, offset=-1 → 422 ge:0, unknown client → 404,
 *     no token → 401 {"detail":"Not authenticated"}.
 * The real `author_side` value could not be observed (no review exists in this
 * environment); the client neither filters nor rewrites it.
 */
export async function listClientReviews(
  clientId: number,
  params?: { limit?: number; offset?: number }
): Promise<ClientReviewsPage> {
  if (!Number.isInteger(clientId) || clientId <= 0) {
    throw new Error(`listClientReviews: invalid client id ${String(clientId)}`);
  }
  const limit = Math.min(
    PROVIDER_REVIEWS_MAX_LIMIT,
    Math.max(1, Math.trunc(params?.limit ?? PROVIDER_REVIEWS_PAGE_SIZE))
  );
  const offset = Math.max(0, Math.trunc(params?.offset ?? 0));
  const { data } = await api.get<unknown>(`/api/v1/clients/${clientId}/reviews`, {
    params: { limit, offset },
  });
  return normalizeReviewsPage(data);
}

/**
 * POST /api/v1/reviews/{review_id}/attachments — "Add Review Photo".
 *
 * DOCUMENTED (live OpenAPI, 2026-11-16):
 *   • path params: review_id (integer), attachment_id for DELETE only
 *   • body: multipart/form-data with exactly ONE field, `file` (binary)
 *   • accepts JPG/PNG/WebP, max 5 photos per review, location data removed
 *     server-side
 *   • 201 → JobReviewResponse (the UPDATED review, whose `attachments` items are
 *     `MediaItemResponse`: {id, url, url may be null, media_type, …})
 *   • 422 → validation error
 *
 * 401/403/404/413 are NOT documented; the caller maps whatever status arrives
 * to one friendly sentence (lib/reviewPhotos). There is also NO documented time
 * window for adding photos after the review is submitted — the UI allows it from
 * "My review" and lets the server decide, so nothing is invented here.
 *
 * HEADERS: the shared axios instance defaults to `application/json`, which would
 * make axios stringify the FormData before React Native sees it. Clearing the
 * header with `null` lets RN's networking layer set the real multipart boundary
 * (no boundary is ever hardcoded). Same reasoning as uploadDisputeImage, but with
 * the JSON default explicitly removed.
 */
export async function uploadReviewPhoto(
  reviewId: number,
  image: AttachmentImageFile,
  onProgress?: (progress: number) => void
): Promise<JobReview> {
  if (!Number.isInteger(reviewId) || reviewId <= 0) {
    throw new Error(`uploadReviewPhoto: invalid review id ${String(reviewId)}`);
  }
  const formData = new FormData();
  formData.append('file', {
    uri: image.uri,
    name: image.name,
    type: image.mimeType,
  } as unknown as Blob);

  const { data } = await api.post<unknown>(
    `/api/v1/reviews/${reviewId}/attachments`,
    formData,
    {
      headers: { 'Content-Type': null },
      timeout: 60000,
      onUploadProgress: onProgress
        ? (event) => {
            const total = event.total ?? 0;
            if (total <= 0) return;
            onProgress(Math.max(0, Math.min(1, (event.loaded ?? 0) / total)));
          }
        : undefined,
    }
  );

  const review = normalizeReview(data);
  if (!review || review.id === null) {
    // A 2xx whose body is not the documented review object: keeping the queue
    // honest is better than pretending the photo is confirmed.
    throw new Error('uploadReviewPhoto: unexpected response body');
  }
  return review;
}

/**
 * Remove a photo from a review.
 *
 * Path: DELETE /api/v1/reviews/{review_id}/attachments/{attachment_id}
 * 204: success, empty body — the caller refreshes the review cache.
 * 401: like the rest of the app (session expired, handled by api layer).
 * 403: friendly "You can't remove this photo".
 * 404: treat as already removed (refresh silently, short notice).
 * 409/422/network: friendly message with Retry.
 * NOT optimistic: the photo stays visible until the server confirms.
 * Local (not-yet-uploaded) photos keep being removed instantly with no API call.
 */
export async function removeReviewPhoto(
  reviewId: number,
  attachmentId: number
): Promise<void> {
  if (!Number.isInteger(reviewId) || reviewId <= 0) {
    throw new Error(`removeReviewPhoto: invalid review id ${String(reviewId)}`);
  }
  if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
    throw new Error(`removeReviewPhoto: invalid attachment id ${String(attachmentId)}`);
  }
  await api.delete<void>(`/api/v1/reviews/${reviewId}/attachments/${attachmentId}`);
}
