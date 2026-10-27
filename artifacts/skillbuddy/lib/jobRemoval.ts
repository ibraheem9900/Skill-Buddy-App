import type { JobApiStatus, JobListItem } from '@/types';

/**
 * jobRemoval.ts — the pure rules behind the client's "Remove from my list".
 *
 * WHY LOCAL-ONLY (deliberate, and clearly marked as such):
 * there is NO delete/archive/hide/dismiss endpoint for jobs. The live API client
 * (services/api.ts) exposes exactly one destructive job call — DELETE
 * /api/v1/jobs/{job_id}/attachments/{attachment_id} — and the web app has no
 * remove-job affordance either, so there is nothing to mirror. Inventing a
 * backend call would be a fabricated API, so the removal is a device-local,
 * per-user hide, persisted with the storage layer the r36 binary already ships
 * (@react-native-async-storage/async-storage, used by the language/theme/role
 * and bookmark contexts).
 *
 * CONSEQUENCE, STATED PLAINLY: hiding does NOT sync across devices, and the same
 * account on another phone still sees the job. The backend spec this needs is
 * written up in the delivery report.
 *
 * THIS FILE IS THE PURE HALF: status rules and array helpers only, no storage and
 * no React, so every rule is unit-testable in the dependency-free harness. The
 * AsyncStorage persistence that uses them lives in lib/hiddenJobs.ts.
 */

/** AsyncStorage key — per user id, so account switches never inherit a hide. */
export function hiddenJobsKey(userId: number | string | null | undefined): string {
  const id = userId === null || userId === undefined ? '' : String(userId).trim();
  return `sb_hidden_jobs_${id.length > 0 ? id : 'anon'}`;
}

/**
 * The statuses a client may remove from the list — TERMINAL ones only.
 *
 * Included (the job is finished, nothing can happen to it any more):
 *   CANCELLED, CANCELLED_BY_CLIENT, CANCELLED_BY_PROVIDER  (the three cancelled
 *   variants of the live JobStatus enum) and COMPLETED.
 *
 * Excluded, and why:
 *   DRAFT, OPEN, PAYMENT_PENDING, PROVIDER_ASSIGNED, IN_PROGRESS,
 *   DECLINED_BY_PROVIDER, DECLINED_BY_CLIENT, PAUSED_BY_CLIENT,
 *   PAUSED_BY_PROVIDER, BLOCKED
 * — every one of them can still move (a declined job can be re-opened by
 * republishing, a paused job can be resumed, a payment can still be confirmed),
 * so a client hiding it would hide live state. DECLINED_* is the least obvious
 * exclusion: the job still exists and is editable, so it stays.
 */
export const REMOVABLE_JOB_STATUSES: readonly JobApiStatus[] = [
  'CANCELLED',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_PROVIDER',
  'COMPLETED',
] as const;

/**
 * May this job be removed from the client's list?
 *
 * Two ways to qualify:
 *   1. the status is terminal (REMOVABLE_JOB_STATUSES), or
 *   2. the job is still OPEN but the API's own `is_bidding_open === false` marks
 *      the bidding window as closed — the state the list shows with the
 *      "Expired" countdown chip. That flag is the ONLY reliable signal the
 *      response carries: there is no `expired` field, and the deadline itself is
 *      not sent on every row (`bidding_ends_at`/`remaining_bidding_seconds` can
 *      both be null), so this rule never guesses from a clock.
 *
 * A job with no status at all is NOT removable: the button must never appear on
 * a row whose state the app cannot read.
 */
export function canRemoveJob(
  job: Pick<JobListItem, 'status' | 'is_bidding_open'> | null | undefined
): boolean {
  if (!job || typeof job.status !== 'string') return false;
  if ((REMOVABLE_JOB_STATUSES as readonly string[]).includes(job.status)) return true;
  return job.status === 'OPEN' && job.is_bidding_open === false;
}

/**
 * The label of the state the removal button is offered for — used by the tests
 * to prove the include/exclude split, and available to any caller that wants to
 * explain WHY a row is removable.
 */
export function removalReason(
  job: Pick<JobListItem, 'status' | 'is_bidding_open'> | null | undefined
): 'terminal' | 'bidding-closed' | null {
  if (!job || typeof job.status !== 'string') return null;
  if ((REMOVABLE_JOB_STATUSES as readonly string[]).includes(job.status)) return 'terminal';
  if (job.status === 'OPEN' && job.is_bidding_open === false) return 'bidding-closed';
  return null;
}

/** Keep only usable ids from a persisted payload: positive integers, no dupes. */
export function sanitizeHiddenIds(raw: unknown): number[] {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.trim().length === 0) return [];
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<number>();
  for (const value of parsed) {
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isInteger(n) && n > 0) seen.add(n);
  }
  return Array.from(seen);
}

/** Add one id (idempotent — a second remove of the same job changes nothing). */
export function addHiddenId(ids: readonly number[], jobId: number): number[] {
  if (!Number.isInteger(jobId) || jobId <= 0) return [...ids];
  if (ids.includes(jobId)) return [...ids];
  return [...ids, jobId];
}

/** Drop one id (the restore path when a removal fails). */
export function removeHiddenId(ids: readonly number[], jobId: number): number[] {
  if (!ids.includes(jobId)) return [...ids];
  return ids.filter((id) => id !== jobId);
}

/**
 * The rows to render: everything the list fetched minus the hidden ids.
 * A hidden id that is no longer in the fetched pages simply has no effect.
 */
export function filterHiddenJobs<T extends { id: number }>(
  jobs: readonly T[],
  hiddenIds: readonly number[]
): T[] {
  if (hiddenIds.length === 0) return [...jobs];
  const hidden = new Set(hiddenIds);
  return jobs.filter((job) => !hidden.has(job.id));
}

