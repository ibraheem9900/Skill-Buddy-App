import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { buildCancelRequest } from '@/lib/jobCancel';
import { firstErrorMessage } from '@/lib/jobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import { invalidateJobList } from '@/hooks/useJobList';
import { isDraftJob } from '@/lib/jobPublish';
import { buildRepostJobRequest, type RepostBlockReason, type RepostChanges } from '@/lib/repostJob';
import type { JobResponse } from '@/types';

/**
 * ONE repost implementation, shared by Edit Job and Edit Job Address.
 *
 * ORDER IS THE SAFETY RULE: the new job is created and published FIRST; the old
 * job is cancelled only after the new one can accept bids. A failure at any
 * earlier stage leaves the old job untouched. If the cancel itself fails, the
 * new job stays live and the caller offers the old job so the user can cancel
 * it manually.
 *
 * `stage` tells the caller which copy to show:
 *   create  — nothing changed; the old job is still live;
 *   publish — a draft exists but is not live; the old job is still live;
 *   cancel  — the new job is live; the old job still needs cancelling;
 *   invalid — no address or no schedule to copy (no request was made).
 */
export type RepostOutcome =
  | { ok: true; job: JobResponse; feeCharged: boolean }
  | { ok: false; stage: 'busy' }
  | { ok: false; stage: 'invalid'; reason: RepostBlockReason }
  | { ok: false; stage: 'create'; message: string | null }
  | { ok: false; stage: 'publish'; draft: JobResponse; message: string | null }
  | { ok: false; stage: 'cancel'; job: JobResponse; message: string | null };

export function useRepostJob() {
  const [reposting, setReposting] = useState(false);
  const inFlight = useRef(false);

  const repost = useCallback(
    async (job: JobResponse, changes: RepostChanges, reason: string): Promise<RepostOutcome> => {
      // Double taps must never create two jobs.
      if (inFlight.current) return { ok: false, stage: 'busy' };

      const built = buildRepostJobRequest(job, changes);
      if (!built.ok) return { ok: false, stage: 'invalid', reason: built.reason };

      inFlight.current = true;
      setReposting(true);
      try {
        let created: JobResponse;
        try {
          created = (await authApi.createJob(built.body)).data;
        } catch (err: any) {
          return {
            ok: false,
            stage: 'create',
            message: firstErrorMessage(err?.response?.data),
          };
        }

        // A create may answer DRAFT. Publish it before touching the old job; a
        // create that already answered a live status is used as-is.
        let live = created;
        if (isDraftJob(created)) {
          try {
            live = (await authApi.publishJob(created.id)).data;
          } catch (err: any) {
            invalidateJobList();
            return {
              ok: false,
              stage: 'publish',
              draft: created,
              message: firstErrorMessage(err?.response?.data),
            };
          }
        }

        invalidateJobList();

        let cancelled: JobResponse | null = null;
        try {
          cancelled = (await authApi.cancelJob(job.id, buildCancelRequest(reason))).data;
        } catch (err: any) {
          invalidateJobList();
          invalidateJobDetail(job.id);
          return {
            ok: false,
            stage: 'cancel',
            job: live,
            message: firstErrorMessage(err?.response?.data),
          };
        }

        invalidateJobList();
        invalidateJobDetail(job.id);
        return {
          ok: true,
          job: live,
          feeCharged: cancelled?.cancellation_fee_charged === true,
        };
      } finally {
        inFlight.current = false;
        setReposting(false);
      }
    },
    []
  );

  return { repost, reposting };
}

export default useRepostJob;
