import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobList } from '@/hooks/useJobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import {
  buildAssignProviderRequest,
  classifyAssignProviderFailure,
  isValidJobId,
  isValidProviderId,
} from '@/lib/jobAssign';
import type { JobActionFailure } from '@/lib/jobAction';
import type { JobResponse } from '@/types';

/**
 * Assigns a provider to the client's job
 * (POST /api/v1/jobs/{job_id}/assign-provider).
 *
 * Same shape of behaviour as usePublishJob/useRestartJobTimer/the convert hooks —
 * protected POST, busy guard, both caches invalidated, the server's job adopted
 * whole — with TWO deliberate differences that come from this endpoint's contract:
 *
 *  1. it takes a REQUIRED `{ provider_id }` body (the others are body-less), and the
 *     id is validated before anything is sent, so a mock/catalogue id or a stray
 *     value can never be posted;
 *  2. the 200 body IS the job (no `{ message, job }` envelope), so there is no
 *     server message to show and `job` is adopted straight from `data`.
 *
 * On success the caller replaces its held job with the returned JobResponse:
 * assigned_provider_id / assigned_at, and the flags that change with them
 * (is_bidding_open, is_editable, is_cancellable, status) all come from the backend.
 * Nothing is set locally.
 *
 * Double taps: `assigning` disables the button, and `inFlight` rejects a second call
 * outright even if two call sites race.
 */
export type AssignProviderOutcome =
  | { ok: true; job: JobResponse; providerId: number }
  | ({ ok: false } & JobActionFailure)
  /** An assignment is already running; the caller should not treat this as an error. */
  | { ok: false; kind: 'busy'; message: null };

export function useAssignProvider() {
  const [assigning, setAssigning] = useState(false);
  const inFlight = useRef(false);

  const assignProvider = useCallback(
    async (jobId: number, providerId: number): Promise<AssignProviderOutcome> => {
      if (inFlight.current) return { ok: false, kind: 'busy', message: null };
      if (!isValidJobId(jobId)) return { ok: false, kind: 'badrequest', message: null };
      // A provider id that is not a real server id is a client bug, not an API
      // error: refuse it here so the endpoint is never called with junk.
      if (!isValidProviderId(providerId)) {
        return { ok: false, kind: 'badrequest', message: null };
      }

      inFlight.current = true;
      setAssigning(true);
      try {
        const { data } = await authApi.assignJobProvider(
          jobId,
          buildAssignProviderRequest(providerId)
        );
        invalidateJobList();
        invalidateJobDetail(jobId);
        // The 200 IS the job here (no envelope). A malformed payload must never put a
        // bogus object into the screen's state — treat it as a retryable failure
        // instead of adopting `undefined` and wiping the screen.
        if (!data || typeof data !== 'object' || typeof data.id !== 'number') {
          return { ok: false, kind: 'server', message: null };
        }
        return { ok: true, job: data, providerId };
      } catch (err) {
        return { ok: false, ...classifyAssignProviderFailure(err) };
      } finally {
        inFlight.current = false;
        setAssigning(false);
      }
    },
    []
  );

  return { assignProvider, assigning };
}

export default useAssignProvider;
