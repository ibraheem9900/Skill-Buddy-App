/**
 * repostJob.ts — the pure payload builder behind "edit = repost".
 *
 * THE LIVE API HAS NO REPOST AND NO MILESTONE UPDATE (OpenAPI, 2026-11-06):
 *   • PATCH /api/v1/jobs/{job_id} (JobUpdate) accepts ONLY title, description,
 *     scheduled_at and expected_hours — there is no milestones array and no
 *     milestone endpoint anywhere in the spec;
 *   • JobMilestoneCreate accepts ONLY scheduled_at and expected_hours — no task
 *     title, no notes, no end time and no list of time-slot options;
 *   • nothing on the job endpoints clears bids or creates a fresh bidding
 *     window, so a PATCH would keep the old bids and the old window.
 *
 * A repost is therefore CLIENT-COMPOSED: create a NEW job from the old one with
 * the edited fields (POST /jobs accepts the full milestone list and the
 * address), publish it, and only then cancel the old job. This module builds
 * that POST body; hooks/useRepostJob performs the three requests.
 *
 * Nothing that the API cannot store is invented here: the new milestones carry
 * exactly `scheduled_at` + `expected_hours`, copied from the old job or replaced
 * with the edited single-day values. Task titles, notes, slot options and
 * attachments have no field in JobCreate and are deliberately absent.
 */

import type {
  CreateJobRequest,
  JobAddressCreate,
  JobMilestoneCreate,
  JobResponse,
  UpdateJobRequest,
} from '@/types';

/** The edited fields a repost may carry. `address` is the Edit Job Address case. */
export type RepostChanges = UpdateJobRequest & {
  address?: JobAddressCreate | null;
};

/** Why a repost cannot be built — the caller shows the matching copy. */
export type RepostBlockReason = 'address' | 'schedule';

/** A numeric wire value (expected_hours is a string on reads) as a number. */
function hoursOf(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A coordinate from the response's numeric-string convention, or null. */
function coordinate(value: string | number | null | undefined, limit: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) return null;
  return parsed;
}

/**
 * The old job's address as a JobAddressCreate body.
 *
 * The response nests country/county/city as objects, while the create schema
 * wants their ids — the ids are read from those objects, never guessed. A job
 * without an address returns null, because JobCreate REQUIRES one; the caller
 * then tells the user instead of creating an address-less job.
 */
export function addressCreateFromJob(
  job: Pick<JobResponse, 'address'>
): JobAddressCreate | null {
  const address = job.address;
  if (!address) return null;
  return {
    latitude: coordinate(address.latitude, 90),
    longitude: coordinate(address.longitude, 180),
    country_id: address.country?.id ?? null,
    county_id: address.county?.id ?? null,
    city_id: address.city?.id ?? null,
    house_number: address.house_number ?? null,
    street_address: address.street_address ?? null,
    postal_code: address.postal_code ?? null,
    landmark: address.landmark ?? null,
    formatted_address: address.formatted_address ?? null,
  };
}

/**
 * The milestone list of the NEW job, sorted the way the server returned it.
 * A single-day job takes the edited start/hours; a multi-day job is copied
 * unchanged (the Edit Job form exposes no per-task edit for it).
 */
export function repostMilestones(
  job: Pick<JobResponse, 'milestones' | 'scheduled_at' | 'expected_hours'>,
  changes: RepostChanges
): JobMilestoneCreate[] | null {
  const stored = [...(job.milestones ?? [])]
    .sort((a, b) => a.sequence - b.sequence || a.id - b.id)
    .map((milestone) => ({
      scheduled_at: milestone.scheduled_at,
      expected_hours: hoursOf(milestone.expected_hours),
    }));

  // A job whose milestone list is missing still has the job-level schedule; it
  // is enough to recreate one task rather than refusing the repost.
  const list =
    stored.length > 0
      ? stored
      : job.scheduled_at
        ? [{ scheduled_at: job.scheduled_at, expected_hours: hoursOf(job.expected_hours) }]
        : [];

  if (list.length === 0) return null;

  if (list.length === 1 && (changes.scheduled_at != null || changes.expected_hours != null)) {
    return [
      {
        scheduled_at: changes.scheduled_at ?? list[0].scheduled_at,
        expected_hours: changes.expected_hours ?? list[0].expected_hours,
      },
    ];
  }

  return list;
}

/**
 * The POST /api/v1/jobs body for a repost, or the reason it cannot be built.
 *
 * `is_draft` is false: the hook publishes the returned job immediately after
 * the create (when the server still answers DRAFT), so the new job opens a
 * fresh bidding window before the old one is cancelled.
 */
export function buildRepostJobRequest(
  job: JobResponse,
  changes: RepostChanges
): { ok: true; body: CreateJobRequest } | { ok: false; reason: RepostBlockReason } {
  const milestones = repostMilestones(job, changes);
  if (!milestones) return { ok: false, reason: 'schedule' };

  const address = changes.address ?? addressCreateFromJob(job);
  if (!address) return { ok: false, reason: 'address' };

  return {
    ok: true,
    body: {
      service_id: job.service_id,
      category_id: job.category_id ?? null,
      title: (changes.title ?? job.title).trim(),
      description:
        changes.description !== undefined ? changes.description : (job.description ?? null),
      // The backend rejects MULTI_DAY + URGENT, so the new job keeps the only
      // combination the contract allows.
      request_type: job.booking_type === 'MULTI_DAY' ? 'REGULAR' : job.request_type,
      booking_type: job.booking_type,
      milestones,
      address,
      is_draft: false,
    },
  };
}
