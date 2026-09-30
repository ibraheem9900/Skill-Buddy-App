import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobList } from '@/hooks/useJobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import {
  classifyConvertToRegularFailure,
  isValidJobId,
} from '@/lib/jobConvert';
import type { JobActionFailure } from '@/lib/jobAction';
import type { JobResponse } from '@/types';

/**
 * Converts an URGENT job to a REGULAR one
 * (POST /api/v1/jobs/{job_id}/convert-to-regular).
 *
 * Deliberately the same shape as usePublishJob/useRestartJobTimer: all three are
 * protected, body-less POSTs returning `{ message, job }`, so they share one
 * behaviour — same busy guard, same cache discipline, same error contract.
 *
 * On success the server's FULL JobResponse is handed back so the caller replaces
 * its held job with the backend's truth: `request_type`/`is_urgent`, and every
 * derived flag (is_bidding_open, can_restart_timer, can_convert_to_urgent,
 * remaining_bidding_seconds) come from the response. Nothing is patched locally.
 *
 * Both caches are invalidated on success so a mounted jobs list refetches instead of
 * still claiming the job is urgent, and a cached detail cannot outlive the conversion.
 *
 * Double taps: `converting` disables the button, and `inFlight` rejects a second
 * call outright even if two call sites race.
 */
export type ConvertToRegularOutcome =
  | { ok: true; job: JobResponse; message: string | null }
  | ({ ok: false } & JobActionFailure)
  /** A conversion is already running; the caller should not treat this as an error. */
  | { ok: false; kind: 'busy'; message: null };

export function useConvertJobToRegular() {
  const [converting, setConverting] = useState(false);
  const inFlight = useRef(false);

  const convertToRegular = useCallback(
    async (jobId: number): Promise<ConvertToRegularOutcome> => {
      if (inFlight.current) return { ok: false, kind: 'busy', message: null };
      if (!isValidJobId(jobId)) return { ok: false, kind: 'badrequest', message: null };

      inFlight.current = true;
      setConverting(true);
      try {
        const { data } = await authApi.convertJobToRegular(jobId);
        invalidateJobList();
        invalidateJobDetail(jobId);
        // `job` is required by the schema, but a malformed payload must never put a
        // bogus object into the screen's state — treat it as a retryable failure
        // instead of adopting `undefined` and wiping the screen.
        if (!data || typeof data !== 'object' || !data.job || typeof data.job.id !== 'number') {
          return { ok: false, kind: 'server', message: null };
        }
        return {
          ok: true,
          job: data.job,
          message:
            typeof data.message === 'string' && data.message.trim().length > 0
              ? data.message.trim()
              : null,
        };
      } catch (err) {
        return { ok: false, ...classifyConvertToRegularFailure(err) };
      } finally {
        inFlight.current = false;
        setConverting(false);
      }
    },
    []
  );

  return { convertToRegular, converting };
}

export default useConvertJobToRegular;
