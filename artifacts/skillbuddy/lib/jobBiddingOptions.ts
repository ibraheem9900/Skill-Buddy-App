/**
 * jobBiddingOptions.ts
 *
 * Pure model behind the client Bids screen's "Bidding options" card
 * (Restart timer / Convert to Regular / Convert to Urgent). No React, no
 * axios — every rule below is unit-testable.
 *
 * WHAT THE LIVE BACKEND WAS OBSERVED TO DO (throwaway jobs 3 and 4,
 * 2026-10-14; raw records in .freebuff/livetest/chunk4-live.json and
 * chunk4-limit.json):
 *   - REGULAR jobs bid for 180 minutes (remaining_bidding_seconds: 10799 right
 *     after a restart/convert), URGENT jobs for 30 minutes (1799). A restart
 *     always re-opens a FRESH window of the current type, even while the
 *     previous window is still running.
 *   - Convert-to-urgent / convert-to-regular each re-open a fresh window of the
 *     new type AND RESET timer_restart_count to 0.
 *   - can_restart_timer flips to false once timer_restart_count reaches 3, and
 *     a restart forced past that answers HTTP 400
 *     "The bidding timer can only be restarted for open jobs, up to 3 times."
 *   - The can_convert_* flags are the backend's own; this app never re-derives
 *     them (a MULTI_DAY job was observed with can_convert_to_urgent: true — the
 *     button follows the flag, whatever the backend decides about booking type).
 *
 * Everything here therefore READS the backend's flags and only supplies the
 * verified window arithmetic the confirmation dialogs state as fact.
 */

import { canRestartJobTimer } from '@/lib/jobRestartTimer';
import { canConvertJobToRegular, canConvertJobToUrgent, isUrgentJob } from '@/lib/jobConvert';
import { parseApiIsoUtc } from '@/lib/jobDetail';
import type { JobResponse } from '@/types';

/**
 * Fresh bidding window per request type, in minutes — VERIFIED LIVE from
 * remaining_bidding_seconds right after restart/convert (10799 ≈ 180 min,
 * 1799 ≈ 30 min) and matching the Integration Guide. The confirmation dialogs
 * state exactly these numbers, nothing else.
 */
export const BIDDING_WINDOW_MINUTES: { urgent: number; regular: number } = {
  urgent: 30,
  regular: 180,
};

/**
 * Restart cap — VERIFIED LIVE: the flag flips false at count 3 and a forced
 * fourth attempt in a stretch answers 400 "...up to 3 times". Displayed as the
 * counter's denominator; button VISIBILITY stays the backend's flag.
 */
export const MAX_TIMER_RESTARTS = 3;

/** The three actions the card can offer, by their identity in the screen. */
export type BiddingOptionAction = 'restart' | 'to_regular' | 'to_urgent';

/** The job fields the card reads (all present on JobResponse). */
export type BiddingOptionsJob = Pick<
  JobResponse,
  | 'status'
  | 'request_type'
  | 'is_urgent'
  | 'timer_restart_count'
  | 'can_restart_timer'
  | 'can_convert_to_regular'
  | 'can_convert_to_urgent'
  | 'is_bidding_open'
  | 'bidding_ends_at'
>;

export interface BiddingOptionsModel {
  /** Owner-only, client mode, OPEN job, at least one action allowed. */
  visible: boolean;
  restart: boolean;
  toRegular: boolean;
  toUrgent: boolean;
  /** timer_restart_count, clamped to a sane non-negative integer. */
  restartsUsed: number;
  restartsMax: number;
  /** The window is over: is_bidding_open false, or the deadline has passed. */
  windowEnded: boolean;
  /** Minutes a fresh window of the CURRENT type lasts (for the dialogs). */
  windowMinutes: number;
  isUrgent: boolean;
}

/**
 * What the card shows for one job. `isClient` is the active role (the card is
 * client-mode only); `nowMs` is supplied so the window-ended decision is
 * testable and re-derived on every render rather than cached.
 */
export function biddingOptionsModel(
  job: BiddingOptionsJob | null | undefined,
  options: { isClient: boolean; nowMs: number }
): BiddingOptionsModel {
  const isUrgent = isUrgentJob(job ?? null);
  const empty: BiddingOptionsModel = {
    visible: false,
    restart: false,
    toRegular: false,
    toUrgent: false,
    restartsUsed: 0,
    restartsMax: MAX_TIMER_RESTARTS,
    windowEnded: true,
    windowMinutes: isUrgent ? BIDDING_WINDOW_MINUTES.urgent : BIDDING_WINDOW_MINUTES.regular,
    isUrgent,
  };
  if (!job) return empty;

  const restart = canRestartJobTimer(job);
  const toRegular = canConvertJobToRegular(job);
  const toUrgent = canConvertJobToUrgent(job);

  // The deadline is read with the API-aware parser: GET sends bidding_ends_at
  // WITHOUT a timezone marker (live-verified), so a naive reading would call
  // the window "ended" hours early or late.
  const endsAt = parseApiIsoUtc(job.bidding_ends_at);
  const windowEnded =
    job.is_bidding_open !== true || (endsAt !== null && endsAt.getTime() <= options.nowMs);

  const rawCount = job.timer_restart_count;
  const restartsUsed =
    typeof rawCount === 'number' && Number.isFinite(rawCount) && rawCount > 0
      ? Math.floor(rawCount)
      : 0;

  return {
    visible: options.isClient && job.status === 'OPEN' && (restart || toRegular || toUrgent),
    restart,
    toRegular,
    toUrgent,
    restartsUsed,
    restartsMax: MAX_TIMER_RESTARTS,
    windowEnded,
    windowMinutes: isUrgent ? BIDDING_WINDOW_MINUTES.urgent : BIDDING_WINDOW_MINUTES.regular,
    isUrgent,
  };
}

/**
 * The idempotence rule for `job.bidding_extended`: is the announced deadline
 * genuinely NEWER than the deadline the job already carries?
 *
 * The backend (or a replayed frame) can announce a deadline the screen already
 * has — e.g. right after this screen's own restart/convert response was applied
 * with applyJob. Such an event must produce NO second "timer extended" notice,
 * no local override and no refetch: it moved nothing. A null event deadline is
 * never "newer"; a job with no readable deadline accepts any event deadline.
 */
export function isNewerBiddingDeadline(
  eventDeadlineMs: number | null,
  jobEndsAt: string | null | undefined
): boolean {
  if (eventDeadlineMs === null || !Number.isFinite(eventDeadlineMs)) return false;
  const current = parseApiIsoUtc(jobEndsAt);
  if (current === null) return true;
  return eventDeadlineMs > current.getTime();
}
