/**
 * Sorting for the client's My Jobs list and the pilot's nearby feed. Pure, so
 * the same rules run in the sheet and in the tests. Missing values always sort
 * last — a job without a deadline or coordinates must never jump to the top.
 */

export type JobSortKey = 'time' | 'amount' | 'distance' | 'hours';
export type SortDirection = 'asc' | 'desc';

export interface JobSort {
  key: JobSortKey;
  direction: SortDirection;
}

export const DEFAULT_JOB_SORT: JobSort = { key: 'time', direction: 'asc' };

export interface SortableJob {
  id?: number;
  job_id?: number;
  bidding_ends_at?: string | null;
  remaining_bidding_seconds?: number | null;
  total_amount?: string | number | null;
  amount?: string | number | null;
  distance_km?: string | number | null;
  expected_hours?: string | number | null;
  created_at?: string | null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deadlineOrNull(job: SortableJob, now: number): number | null {
  if (typeof job.bidding_ends_at === 'string' && job.bidding_ends_at.length > 0) {
    const raw = job.bidding_ends_at;
    const parsed = Date.parse(raw.includes('Z') || /[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw}Z`);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof job.remaining_bidding_seconds === 'number' && Number.isFinite(job.remaining_bidding_seconds)) {
    return now + job.remaining_bidding_seconds * 1000;
  }
  return null;
}

function amountOf(job: SortableJob): number | null {
  const direct = numberOrNull(job.total_amount ?? job.amount);
  if (direct !== null) return direct;
  // The list schema does not promise a total; if a milestone list is present,
  // summing recognised amount fields is the only available estimate.
  const milestones = (job as { milestones?: unknown }).milestones;
  if (!Array.isArray(milestones) || milestones.length === 0) return null;
  let total = 0;
  let found = false;
  for (const milestone of milestones as ReadonlyArray<Record<string, unknown>>) {
    const value = numberOrNull(milestone?.amount ?? milestone?.price);
    if (value !== null) {
      total += value;
      found = true;
    }
  }
  return found ? total : null;
}

function valueFor(job: SortableJob, key: JobSortKey, now: number): number | null {
  switch (key) {
    case 'time':
      return deadlineOrNull(job, now);
    case 'amount':
      return amountOf(job);
    case 'distance':
      return numberOrNull(job.distance_km);
    case 'hours':
      return numberOrNull(job.expected_hours);
    default:
      return null;
  }
}

/** Distance sort is only meaningful once at least one row carries coordinates. */
export function hasDistanceData(jobs: readonly SortableJob[]): boolean {
  return jobs.some((job) => numberOrNull(job.distance_km) !== null);
}

/** Amount/hours availability, used to disable unavailable choices in the sheet. */
export function hasSortData(jobs: readonly SortableJob[], key: JobSortKey): boolean {
  if (key === 'time') return true;
  return jobs.some((job) => valueFor(job, key, Date.now()) !== null);
}

export function sortJobs<T extends SortableJob>(
  jobs: readonly T[],
  sort: JobSort,
  now = Date.now()
): T[] {
  const direction = sort.direction === 'desc' ? -1 : 1;
  return [...jobs].sort((left, right) => {
    const a = valueFor(left, sort.key, now);
    const b = valueFor(right, sort.key, now);

    // Missing values last in BOTH directions.
    if (a === null && b === null) return (left.id ?? left.job_id ?? 0) - (right.id ?? right.job_id ?? 0);
    if (a === null) return 1;
    if (b === null) return -1;
    if (a !== b) return (a - b) * direction;
    return (left.id ?? left.job_id ?? 0) - (right.id ?? right.job_id ?? 0);
  });
}

export function isDefaultJobSort(sort: JobSort): boolean {
  return sort.key === DEFAULT_JOB_SORT.key && sort.direction === DEFAULT_JOB_SORT.direction;
}
