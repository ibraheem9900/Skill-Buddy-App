import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  useRealtimeEvent,
  useRealtimeService,
  useRealtimeStatus,
} from '@/context/RealtimeContext';
import {
  BiddingClosedTracker,
  LIVE_NOTICE_MS,
  extendedBiddingEndsAt,
  isRealtimeStale,
  realtimeEventMatchesJob,
} from '@/lib/jobBidsLive';
import { isNewerBiddingDeadline } from '@/lib/jobBiddingOptions';

/**
 * The Bids screen's own realtime concerns — the job-level half of the live
 * screen, kept out of the render tree so the rules are readable in one place.
 *
 * WHAT THIS HOOK OWNS
 *   - the WATCH: the job is watched only while this screen is on top and the
 *     bidding can still change (`enabled`). Leaving the screen (blur) or
 *     accepting a provider releases it — watches belong to one socket and are
 *     reference-counted by the service, so another screen watching the same job
 *     is not disturbed.
 *   - job.bidding_extended: the countdown follows the NEW bidding_ends_at from
 *     the event itself, and the notice says so. The local deadline is only a
 *     bridge: as soon as the re-read job carries that deadline (or a newer one)
 *     it is dropped and the server's own field is used again.
 *   - job.bidding_closed: the job is re-read ONCE per closed window. The server
 *     repeats this event about every 25 s while the job is OPEN with an expired
 *     window, so an unguarded handler would refetch forever — see
 *     BiddingClosedTracker in lib/jobBidsLive.
 *   - the socket status the screen renders its non-blocking "reconnecting"
 *     notice from.
 *
 * It never fetches anything itself: the caller passes the refetch so the job and
 * its offers keep being read through the one path the screen already uses.
 */

interface Options {
  jobId: number | null;
  /** Watch and react. False once the job can no longer receive offers. */
  enabled: boolean;
  /** The job's own bidding_ends_at, as the API returned it. */
  biddingEndsAt: string | null | undefined;
  /** Does the API say the window is open right now? */
  biddingOpen: boolean;
  /** Re-read the JOB (not the bids). */
  refetchJob: () => void | Promise<unknown>;
}

export function useJobBiddingRealtime({
  jobId,
  enabled,
  biddingEndsAt,
  biddingOpen,
  refetchJob,
}: Options) {
  const service = useRealtimeService();
  const socketStatus = useRealtimeStatus();
  /** A deadline that came from an extension and the job has not confirmed yet. */
  const [endsAtOverride, setEndsAtOverride] = useState<number | null>(null);
  const [extendedNotice, setExtendedNotice] = useState(false);
  const closedWindows = useRef(new BiddingClosedTracker());

  // Watch while the screen is focused; release it on blur, unmount or `enabled`
  // going false. The service reference-counts, so nothing else is disturbed.
  useFocusEffect(
    useCallback(() => {
      if (jobId === null || !enabled) return;
      service.watchJob(jobId);
      return () => service.unwatchJob(jobId);
    }, [service, jobId, enabled])
  );

  // Another job (or a fresh mount): forget which windows were already handled.
  useEffect(() => {
    closedWindows.current.clear();
    setEndsAtOverride(null);
    setExtendedNotice(false);
  }, [jobId]);

  // A job that reports an OPEN window starts a new window, so a later close is
  // handled again. While the window is closed this changes nothing.
  useEffect(() => {
    if (jobId === null) return;
    if (biddingOpen) closedWindows.current.noteWindowOpen(jobId);
  }, [jobId, biddingOpen]);

  // The server's own deadline wins over the local bridge the moment the re-read
  // job carries it (equal or newer) — including the case where the extended
  // window has since expired.
  useEffect(() => {
    if (endsAtOverride === null) return;
    const jobMs = typeof biddingEndsAt === 'string' ? Date.parse(biddingEndsAt) : Number.NaN;
    if (Number.isFinite(jobMs) && jobMs >= endsAtOverride) setEndsAtOverride(null);
  }, [endsAtOverride, biddingEndsAt]);

  useRealtimeEvent('job.bidding_extended', (event) => {
    if (!enabled || jobId === null) return;
    if (!realtimeEventMatchesJob(event, jobId, 'job.bidding_extended')) return;
    const deadline = extendedBiddingEndsAt(event, jobId, Date.now());
    if (deadline === null) return;
    // IDEMPOTENT: an event announcing the deadline the job ALREADY carries (a
    // replayed frame, or the echo of this screen's own restart/convert response)
    // moved nothing — no second "timer extended" notice, no override, no refetch.
    if (!isNewerBiddingDeadline(deadline, biddingEndsAt)) return;
    setEndsAtOverride(deadline);
    // A new window starts here: a later close must be handled again.
    closedWindows.current.noteWindowOpen(jobId);
    setExtendedNotice(true);
    void refetchJob();
  });

  useRealtimeEvent('job.bidding_closed', (event) => {
    if (!enabled || jobId === null) return;
    if (!realtimeEventMatchesJob(event, jobId, 'job.bidding_closed')) return;
    // Repeats every ~25 s while the job is OPEN with an expired window: the job
    // is re-read once per closed window, never once per event.
    if (!closedWindows.current.shouldRefetchOnClosed(jobId)) return;
    void refetchJob();
  });

  // The notice hides itself; a second extension restarts the timer.
  useEffect(() => {
    if (!extendedNotice) return;
    const timer = setTimeout(() => setExtendedNotice(false), LIVE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [extendedNotice]);

  return {
    /**
     * The socket's status, for screens that want it directly. The notice the
     * Bids screen renders is driven by `stale`, so both stay in one place.
     */
    socketStatus,
    /** Realtime is NOT carrying this screen: show the reconnecting notice. */
    stale: isRealtimeStale(socketStatus),
    /** Use this deadline for the countdown while the job has not confirmed it. */
    endsAtOverride,
    /** Show the translated "timer extended" notice. */
    extendedNotice,
  };
}

export default useJobBiddingRealtime;
