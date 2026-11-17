import { useCallback, useEffect, useRef, useState } from 'react';
import type { AxiosError } from 'axios';
import {
  classifyReviewFailure,
  reviewErrorMessage,
  reviewFieldErrors,
  type ReviewFailureKind,
  type ReviewField,
  type ReviewPayload,
} from '@/lib/reviews';
import { submitReview, type JobReview } from '@/services/feedback';
import { invalidateJobReviews } from '@/hooks/useJobReviews';
import { invalidatePendingReviews } from '@/hooks/usePendingReviews';
import { invalidateProviderReviews } from '@/hooks/useProviderReviews';
import { invalidateClientReviews } from '@/hooks/useClientReviews';

/**
 * POST /api/v1/jobs/{job_id}/reviews — one submit at a time.
 *
 * Uses React state only: a submitted review is local to the screen that wrote
 * it, so nothing is cached between openings. The screens read the review state
 * from the job itself (still a TODO — see services/feedback.getJobReviews).
 *
 * DOUBLE SUBMIT: guarded twice. `inFlight` (a ref) rejects a second call made
 * before React has re-rendered the disabled button, and `submitting` disables
 * the button itself.
 *
 * ERRORS: never a raw body. `failure` is one kind the form turns into one
 * sentence; `fieldErrors` names the inputs a 422 referred to; `serverMessage`
 * keeps a readable `detail` string for the `rejected` case only (the server's
 * own business-rule sentence, e.g. "A job can be reviewed once it is closed.").
 */
export type ReviewSubmitFailure = ReviewFailureKind;

export function useSubmitReview(jobId: number | null) {
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<ReviewSubmitFailure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ReviewField[]>([]);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [review, setReview] = useState<JobReview | null>(null);

  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reset = useCallback(() => {
    setFailure(null);
    setFieldErrors([]);
    setServerMessage(null);
    setReview(null);
  }, []);

  const submit = useCallback(
    async (payload: ReviewPayload): Promise<JobReview | null> => {
      if (jobId === null || inFlight.current) return null;
      inFlight.current = true;
      setSubmitting(true);
      setFailure(null);
      setFieldErrors([]);
      setServerMessage(null);
      try {
        const created = await submitReview(jobId, payload);
        // The job's review state is now stale everywhere: Job Details' Reviews
        // card and the review screen's guard both read the same cached GET.
        // This replaces the earlier "TODO: refetch after submit" placeholder.
        invalidateJobReviews(jobId);
        // The reminder list and its badge read GET /reviews/pending: the item
        // must disappear everywhere after a successful submit. This replaces
        // the earlier "TODO: pending reviews refresh after submit".
        invalidatePendingReviews();
        // The reviewed pilot's public rating/summary is now stale.
        invalidateProviderReviews();
        // ...and the reviewed client's, when a pilot wrote this review.
        invalidateClientReviews();
        if (mounted.current) setReview(created);
        return created;
      } catch (error) {
        const axiosError = error as AxiosError | undefined;
        const status = axiosError?.isAxiosError ? axiosError.response?.status ?? 0 : -1;
        const body = axiosError?.isAxiosError ? axiosError.response?.data : null;
        const kind: ReviewSubmitFailure =
          status === -1 ? 'unknown' : classifyReviewFailure(status, reviewErrorMessage(body));
        if (mounted.current) {
          setFailure(kind);
          setFieldErrors(reviewFieldErrors(body));
          // The server's own sentence is only surfaced when it is a plain
          // readable detail; a nested 422 array never reaches the UI.
          setServerMessage(kind === 'rejected' ? reviewErrorMessage(body) : null);
        }
        return null;
      } finally {
        inFlight.current = false;
        if (mounted.current) setSubmitting(false);
      }
    },
    [jobId]
  );

  return {
    submitting,
    failure,
    fieldErrors,
    serverMessage,
    review,
    submitted: review !== null,
    submit,
    reset,
  };
}

export default useSubmitReview;
