import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { authApi } from '@/services/api';
import { classifyJobActionFailure } from '@/lib/jobAction';
import { allBids, filterClientVisibleBids, totalBidCount } from '@/lib/bid';
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
 * ── ONE FETCH PATH, TWO CALLERS ────────────────────────────────────────────
 * `useFocusEffect` performs the opening load and re-reads on every return to
 * the screen; the poll interval (when the caller asks for one) performs
 * background refreshes. They deliberately share `load` so the two can never run
 * at once (`inFlight`) and can never disagree about what a failure means.
 *
 * ── AUTO-REFRESH IS NARROW BY DESIGN ───────────────────────────────────────
 * The caller passes `pollMs` (the screen uses 8 s for an URGENT job and null for
 * a REGULAR one, which is loaded on open plus pull-to-refresh). Even then a tick
 * only fires when the screen is FOCUSED and the app is in the FOREGROUND, and
 * the interval is torn down the moment the caller passes null — so a closed
 * bidding window stops the requests by itself, with no extra bookkeeping.
 *
 * ── A FAILED REFRESH IS NOT A FAILED SCREEN ────────────────────────────────
 * Once offers are on screen, a failed background refresh keeps them: the hook
 * sets `refreshFailed` (rendered as a small non-blocking notice) and the next
 * tick retries. Only 401 (session gone) and 404 (job gone) still take the screen
 * over, because in both cases the data on screen can no longer be trusted. The
 * opening load, by contrast, reports its failure in full — there is nothing to
 * fall back to.
 *
 * No re-scoring happens here or anywhere downstream: the arrays arrive split and
 * ordered by the backend, and the seven score fields are never read.
 */

/** How often an URGENT job's offers are re-read while the screen is live. */
export const BIDS_POLL_MS = 8000;

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
   * Interval for background refreshes, or null to never poll. Change it to null
   * when bidding closes — the interval is cleared and no request is made again
   * until it changes back.
   */
  pollMs?: number | null;
}

export function useJobBids(jobId: number | null, { pollMs = null }: Options = {}) {
  const [status, setStatus] = useState<JobBidsStatus>(jobId === null ? 'idle' : 'loading');
  const [response, setResponse] = useState<JobBidsResponse | null>(null);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [newBidIds, setNewBidIds] = useState<number[]>([]);

  const inFlight = useRef(false);
  const hasData = useRef(false);
  const focused = useRef(false);
  const appActive = useRef(AppState.currentState === 'active');
  /** Bid ids seen on the previous load — the diff drives the card animation. */
  const knownIds = useRef<Set<number> | null>(null);

  const applyResponse = useCallback((next: JobBidsResponse) => {
    const ids = allBids(next).map((bid) => bid.id);
    const previous = knownIds.current;
    // The FIRST load animates nothing: every card would be "new", which reads
    // as a glitch rather than as an arrival.
    setNewBidIds(previous ? ids.filter((id) => !previous.has(id)) : []);
    knownIds.current = new Set(ids);
    hasData.current = true;
    setResponse(next);
    setServerMessage(null);
    setRefreshFailed(false);
    setStatus('ready');
  }, []);

  const load = useCallback(
    async (mode: 'open' | 'refresh') => {
      if (jobId === null || inFlight.current) return;
      inFlight.current = true;
      if (mode === 'refresh') setRefreshing(true);
      else if (!hasData.current) setStatus('loading');
      try {
        const { data } = await authApi.listJobBids(jobId);
        applyResponse(data);
      } catch (err) {
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
        inFlight.current = false;
        if (mode === 'refresh') setRefreshing(false);
      }
    },
    [jobId, applyResponse]
  );

  // Opening load + re-read on every return to this screen. A screen that is
  // merely re-rendered never refetches (the callback only changes with `load`).
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void load(hasData.current ? 'refresh' : 'open');
      return () => {
        focused.current = false;
      };
    }, [load])
  );

  // Background refreshes: only while focused, only while the app is foreground,
  // and only when the caller asked for polling at all.
  useEffect(() => {
    if (jobId === null || pollMs === null) return;
    const tick = () => {
      if (!focused.current || !appActive.current) return;
      void load('refresh');
    };
    const interval = setInterval(tick, pollMs);
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
  }, [jobId, pollMs, load]);

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
    /** Pull-to-refresh / retry. Never blanks the screen. */
    refresh: useCallback(() => load('refresh'), [load]),
    /** Retry from an error/notfound state — behaves like the opening load. */
    reload: useCallback(() => {
      hasData.current = false;
      return load('open');
    }, [load]),
  };
}

export default useJobBids;
