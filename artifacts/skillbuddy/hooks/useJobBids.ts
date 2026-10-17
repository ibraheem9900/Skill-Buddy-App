import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { authApi } from '@/services/api';
import { useRealtimeEvent, useRealtimeStatus } from '@/context/RealtimeContext';
import { debounce } from '@/lib/debounce';
import {
  BID_REFRESH_DEBOUNCE_MS,
  BIDS_SAFETY_NET_MS,
  LIVE_NOTICE_MS,
  bidEventMatchesJob,
  createRequestSequencer,
  isRealtimeStale,
} from '@/lib/jobBidsLive';
import { classifyJobActionFailure } from '@/lib/jobAction';
import { allBids, filterClientVisibleBids, totalBidCount } from '@/lib/bid';
import type { RealtimeEvent } from '@/lib/realtimeEvents';
import type { BidResponse, JobBidsResponse } from '@/types';

/**
 * ONE job's incoming offers (GET /api/v1/jobs/{job_id}/bids) for the CLIENT.
 *
 *  - idle          not started (no job id yet)
 *  - loading       first fetch in flight
 *  - ready         offers loaded (possibly zero)
 *  - notfound      404 — no such job for this user
 *  - forbidden     403 — the job exists but is not this user's
 *  - invalid       422 — the path id was rejected; serverMessage carries the text
 *  - unauthorized  401 that survived the shared client's refresh + retry
 *  - error         timeout / network / 5xx / any other rejection
 *
 * ── ONE FETCH PATH, THREE CALLERS ──────────────────────────────────────────
 * `useFocusEffect` performs the opening load and re-reads on every return to the
 * screen, the realtime subscription performs a DEBOUNCED re-read after a bid
 * event, and the safety net performs a slow re-read while the socket is down.
 * They deliberately share `load` so they can never run at once (`inFlight`) and
 * can never disagree about what a failure means.
 *
 * ── REALTIME IS THE PRIMARY TRIGGER ────────────────────────────────────────
 * With `live: true` the hook subscribes to bid.created / bid.updated /
 * bid.withdrawn. Those events are user-targeted (no watch required) and carry
 * only ids and numbers — no provider card and no recommended/other_offers split —
 * so the ONLY reaction is to re-read the list from REST, debounced by
 * BID_REFRESH_DEBOUNCE_MS because a burst of bids arrives together. Events for a
 * different job are ignored (Number(data.job_id) must equal this job's id).
 *
 * ── THE SAFETY NET, AND WHY IT REPLACES THE OLD POLL ───────────────────────
 * There is no per-role polling any more: an URGENT job and a REGULAR job behave
 * identically. Instead, while the socket is NOT open the hook re-reads every
 * `safetyNetMs` (30 s) — focused and foreground only — and the interval is torn
 * down the moment the socket reports itself open, because realtime takes over
 * again. That keeps a list without a socket roughly current and stops the extra
 * traffic entirely once the connection works.
 *
 * ── A SLOW REPLY NEVER WINS ────────────────────────────────────────────────
 * Every load claims an id from a request sequencer and applies its result only
 * while that id is still the newest; changing the job invalidates whatever was in
 * flight and clears the screen state, so an older response can neither overwrite
 * a newer one nor paint the previous job's offers onto the new one.
 *
 * ── A FAILED REFRESH IS NOT A FAILED SCREEN ────────────────────────────────
 * Once offers are on screen, a failed background refresh keeps them: the hook
 * sets `refreshFailed` (rendered as a small non-blocking notice) and the next
 * trigger retries. Only 401 (session gone) and 404 (job gone) still take the
 * screen over, because in both cases the data on screen can no longer be trusted.
 * The opening load, by contrast, reports its failure in full.
 *
 * No re-scoring happens here or anywhere downstream: the arrays arrive split and
 * ordered by the backend, and the seven score fields are never read.
 */

export type JobBidsStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'notfound'
  | 'forbidden'
  | 'invalid'
  | 'unauthorized'
  | 'error';

interface Options {
  /**
   * Realtime is active for this screen: subscribe to the bid events (and let the
   * caller watch the job). False after a provider has been accepted, or for any
   * other state where the list can no longer change.
   */
  live?: boolean;
  /** Safety-net interval while the socket is not open. Null disables it. */
  safetyNetMs?: number | null;
}

export function useJobBids(
  jobId: number | null,
  { live = false, safetyNetMs = BIDS_SAFETY_NET_MS }: Options = {}
) {
  const [status, setStatus] = useState<JobBidsStatus>(jobId === null ? 'idle' : 'loading');
  const [response, setResponse] = useState<JobBidsResponse | null>(null);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [newBidIds, setNewBidIds] = useState<number[]>([]);
  /**
   * The most recent bid.created event FOR THIS JOB, held for the in-screen toast.
   * The raw event data is kept (not rendered copy): the screen formats the price
   * in the app's locale and translates the ETA with its own keys.
   */
  const [createdEvent, setCreatedEvent] = useState<{ data: unknown; at: number } | null>(null);

  const inFlight = useRef(false);
  const hasData = useRef(false);
  const focused = useRef(false);
  const appActive = useRef(AppState.currentState === 'active');
  /** Bid ids seen on the previous load — the diff drives the card animation. */
  const knownIds = useRef<Set<number> | null>(null);
  /** Stale-response protection: only the newest load may apply its result. */
  const requests = useRef(createRequestSequencer());

  const socketStatus = useRealtimeStatus();
  const socketStale = isRealtimeStale(socketStatus);

  const applyResponse = useCallback((next: JobBidsResponse) => {
    const ids = allBids(next).map((bid) => bid.id);
    const previous = knownIds.current;
    // The FIRST load animates nothing: every card would be "new", which reads
    // as a glitch rather than as an arrival. A repeated event for a bid we
    // already show is not "new" either, so no card animates twice.
    setNewBidIds(previous ? ids.filter((id) => !previous.has(id)) : []);
    knownIds.current = new Set(ids);
    hasData.current = true;
    setResponse(next);
    setServerMessage(null);
    setRefreshFailed(false);
    setStatus('ready');
  }, []);

  /**
   * Drop ONE bid from the current view, immediately.
   *
   * This is the local half of the client's Decline: the caller passes the id of
   * the bid the SERVER returned from the reject (status REJECTED, rejected_at set)
   * so the card leaves the list in the same frame instead of waiting for the next
   * round-trip. Only the named id is touched — nothing is re-sorted, re-scored or
   * re-split, and `is_recommended` is never recomputed here: the caller follows
   * this with refresh(), and the backend's own recommended/other_offers split is
   * what promotes the next-best bid into the Recommended block.
   *
   * `total_bids` is decremented by one when the rejected bid was still counted,
   * because the server's number includes it until the re-read arrives; the refresh
   * that follows replaces the response with the server's own number.
   */
  const dropBid = useCallback((bidId: number) => {
    setResponse((prev) => {
      if (!prev) return prev;
      const recommended = (prev.recommended ?? []).filter((bid) => bid.id !== bidId);
      const otherOffers = (prev.other_offers ?? []).filter((bid) => bid.id !== bidId);
      const removed =
        recommended.length !== (prev.recommended ?? []).length ||
        otherOffers.length !== (prev.other_offers ?? []).length;
      if (!removed) return prev;
      return {
        ...prev,
        recommended,
        otherOffers,
        total_bids: Math.max(
          0,
          (typeof prev.total_bids === 'number' ? prev.total_bids : 0) - 1
        ),
      };
    });
  }, []);

  const load = useCallback(
    async (mode: 'open' | 'refresh') => {
      if (jobId === null || inFlight.current) return;
      const requestId = requests.current.next();
      inFlight.current = true;
      if (mode === 'refresh') setRefreshing(true);
      else if (!hasData.current) setStatus('loading');
      try {
        const { data } = await authApi.listJobBids(jobId);
        // A newer load (or a job change) happened while this one was in flight:
        // its answer is older than what is on screen, so it is dropped.
        if (!requests.current.isCurrent(requestId)) return;
        applyResponse(data);
      } catch (err) {
        if (!requests.current.isCurrent(requestId)) return;
        const failure = classifyJobActionFailure(err);
        if (mode === 'refresh' && hasData.current) {
          if (failure.kind === 'unauthorized') {
            setStatus('unauthorized');
          } else if (failure.kind === 'notfound') {
            // The job is gone: holding its offers on screen would be a lie.
            hasData.current = false;
            knownIds.current = null;
            setResponse(null);
            setServerMessage(failure.message);
            setStatus('notfound');
          } else {
            // Everything else keeps what the user can already see.
            setRefreshFailed(true);
          }
        } else {
          setServerMessage(failure.message);
          switch (failure.kind) {
            case 'notfound':
              setStatus('notfound');
              break;
            case 'forbidden':
              setStatus('forbidden');
              break;
            case 'invalid':
              setStatus('invalid');
              break;
            case 'unauthorized':
              setStatus('unauthorized');
              break;
            default:
              setStatus('error');
          }
        }
      } finally {
        if (requests.current.isCurrent(requestId)) inFlight.current = false;
      }
    },
    [jobId, applyResponse]
  );

  /** The latest load, so the debounced/interval callbacks are never stale. */
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  /* ─────────────────────────────────────────── one job at a time, in order ── */

  // Changing job (or opening the screen for the first time) invalidates whatever
  // was in flight and clears the previous job's state: no old reply can land on
  // the new screen and no stale list can be shown for the new job.
  useEffect(() => {
    requests.current.invalidate();
    // A load for the PREVIOUS job may still be in flight; its result can no
    // longer claim the latch (its id is stale), so the latch is released here —
    // otherwise the new job's first load would be blocked forever.
    inFlight.current = false;
    knownIds.current = null;
    hasData.current = false;
    setResponse(null);
    setServerMessage(null);
    setRefreshFailed(false);
    setNewBidIds([]);
    setCreatedEvent(null);
    setStatus(jobId === null ? 'idle' : 'loading');
  }, [jobId]);

  /* ─────────────────────────────────────────────────────── realtime events ── */

  /**
   * A burst of bid events collapses into ONE refetch, 400 ms after the last one.
   * Timers are real here (the screen is the device); lib/debounce keeps the
   * trailing/cancel semantics identical to the tested helper.
   */
  const debouncedRefresh = useMemo(
    () =>
      debounce(
        () => {
          void loadRef.current('refresh');
        },
        BID_REFRESH_DEBOUNCE_MS,
        {
          schedule: (run, delayMs) => setTimeout(run, delayMs),
          cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        }
      ),
    []
  );

  // Leaving the screen drops a pending refetch instead of firing it against a
  // hook that is going away.
  useEffect(() => () => debouncedRefresh.cancel(), [debouncedRefresh]);

  const onBidEvent = useCallback(
    (event: RealtimeEvent) => {
      if (!live) return;
      // Another job's bid is not this screen's business.
      if (!bidEventMatchesJob(event, jobId)) return;
      if (event.type === 'bid.created') setCreatedEvent({ data: event.data, at: Date.now() });
      debouncedRefresh();
    },
    [live, jobId, debouncedRefresh]
  );

  useRealtimeEvent('bid.created', onBidEvent);
  useRealtimeEvent('bid.updated', onBidEvent);
  useRealtimeEvent('bid.withdrawn', onBidEvent);

  // The "new offer" toast lives for a few seconds and always reflects the LAST
  // arrival; a second bid resets the timer rather than stacking two notices.
  useEffect(() => {
    if (!createdEvent) return;
    const timer = setTimeout(() => setCreatedEvent(null), LIVE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [createdEvent]);

  /* ──────────────────────────────────────────────── focus + safety net ── */

  // Opening load + re-read on every return to this screen. A screen that is
  // merely re-rendered never refetches (the callback only changes with `load`).
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void load(hasData.current ? 'refresh' : 'open');
      return () => {
        focused.current = false;
        debouncedRefresh.cancel();
      };
    }, [load, debouncedRefresh])
  );

  // Safety net: only while the caller wants a live list, only while the socket is
  // NOT open, only while focused, and only while the app is foregrounded. The
  // interval disappears the moment the socket opens.
  useEffect(() => {
    if (jobId === null || !live || safetyNetMs === null || !socketStale) return;
    const tick = () => {
      if (!focused.current || !appActive.current) return;
      void loadRef.current('refresh');
    };
    const interval = setInterval(tick, safetyNetMs);
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const wasActive = appActive.current;
      appActive.current = next === 'active';
      // Coming back to a foregrounded app: catch up immediately instead of
      // waiting for the next tick.
      if (!wasActive && appActive.current) tick();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [jobId, live, safetyNetMs, socketStale]);

  /* ───────────────────────────────────────────────────────── the offer list ── */

  // WITHDRAWN / REJECTED / EXPIRED are filtered out; the rest keep API order.
  const recommended = useMemo(
    () => filterClientVisibleBids(response?.recommended ?? []),
    [response]
  );
  const otherOffers = useMemo(
    () => filterClientVisibleBids(response?.other_offers ?? []),
    [response]
  );
  const all = useMemo(() => filterClientVisibleBids(allBids(response)), [response]);
  const total = useMemo(() => totalBidCount(response), [response]);

  return {
    status,
    /** The backend's own readable text when it sent one (422 detail, 404 text…). */
    serverMessage,
    recommended,
    otherOffers,
    all,
    total,
    refreshing,
    /** A background refresh failed; the data on screen is the previous good one. */
    refreshFailed,
    /** Bid ids that arrived with the last refresh, for the arrival animation. */
    newBidIds,
    /**
     * The latest bid.created for THIS job, while the toast should be visible.
     * The screen formats/translates it; the hook only holds it long enough.
     */
    createdEvent,
    /** True while realtime is NOT carrying this list (socket not open). */
    socketStale,
    /** Pull-to-refresh / retry / post-reconnect refetch. Never blanks the screen. */
    refresh: useCallback(() => load('refresh'), [load]),
    /**
     * Remove one bid from the current view at once (the client just declined it).
     * Always followed by refresh() so the server's ordering and split win.
     */
    dropBid,
    /** Retry from an error/notfound state — behaves like the opening load. */
    reload: useCallback(() => {
      hasData.current = false;
      return load('open');
    }, [load]),
  };
}

export default useJobBids;
