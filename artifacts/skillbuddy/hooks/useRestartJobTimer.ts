import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobList } from '@/hooks/useJobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import {
  classifyRestartTimerFailure,
  isValidJobId,
  type RestartTimerFailure,
} from '@/lib/jobRestartTimer';
import type { JobResponse } from '@/types';

/**
 * Restarts a job's bidding timer (POST /api/v1/jobs/{job_id}/restart-timer).
 *
 * Mirrors usePublishJob deliberately: the two actions are the same shape — a
 * protected, body-less POST that returns `{ message, job }` — so they get the
 * same behaviour, the same busy guard and the same cache discipline.
 *
 * On success the server's FULL JobResponse is handed back so the caller replaces
 * its held job with the backend's truth (the new bidding_ends_at,
 * remaining_bidding_seconds, timer_restart_count and re-evaluated
 * can_restart_timer). Nothing about the new window is computed locally.
 *
 * Both caches are invalidated on success so a mounted jobs list refetches instead
 * of showing the stale countdown, and a cached detail cannot outlive the restart.
 *
 * Double taps: `restarting` disables the button, and `inFlight` rejects a second
 * call outright even if two call sites race.
 */
export type RestartTimerOutcome =
  | { ok: true; job: JobResponse; message: string | null }
  | ({ ok: false } & RestartTimerFailure)
  /** A restart is already running; the caller should not treat this as an error. */
  | { ok: false; kind: 'busy'; message: null };

export function useRestartJobTimer() {
  const [restarting, setRestarting] = useState(false);
  const inFlight = useRef(false);

  const restartTimer = useCallback(async (jobId: number): Promise<RestartTimerOutcome> => {
    if (inFlight.current) return { ok: false, kind: 'busy', message: null };
    if (!isValidJobId(jobId)) return { ok: false, kind: 'badrequest', message: null };

    inFlight.current = true;
    setRestarting(true);
    try {
      const { data } = await authApi.restartJobTimer(jobId);
      invalidateJobList();
      invalidateJobDetail(jobId);
      // `job` is required by the schema, but a malformed payload must not put a
      // bogus object into the screen's state — treat it as a failure the caller
      // can retry instead of adopting `undefined`.
      if (!data || typeof data !== 'object' || !data.job || typeof data.job.id !== 'number') {
        return { ok: false, kind: 'server', message: null };
      }
      return {
        ok: true,
        job: data.job,
        message: typeof data.message === 'string' && data.message.trim().length > 0
          ? data.message.trim()
          : null,
      };
    } catch (err) {
      return { ok: false, ...classifyRestartTimerFailure(err) };
    } finally {
      inFlight.current = false;
      setRestarting(false);
    }
  }, []);

  return { restartTimer, restarting };
}

export default useRestartJobTimer;
