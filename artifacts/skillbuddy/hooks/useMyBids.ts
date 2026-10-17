import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { authApi } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { useBidResults, useProviderBidPolling } from '@/context/BidResultsContext';
import { applyBidResultToBids, pendingBidCount, type ProviderBidResult } from '@/lib/bidResults';
import {
  MY_BIDS_PAGE_SIZE,
  isLastMyBidsPage,
  jobIdsNeedingTitle,
  mergeMyBidsPage,
  removeMyBid,
  resetMyBids,
  type MyBidsFilter,
} from '@/lib/myBids';
import { classifyJobActionFailure } from '@/lib/jobAction';
import { subscribeMoneyRefresh } from '@/lib/moneyEvents';
import type { BidResponse } from '@/types';

/**
 * The provider's "My Bids" list — GET /api/v1/bids/mine.
 *
 * WHAT THIS HOOK OWNS
 *   - the LIST: page 0 on open, `offset += limit` on scroll, de-duplicated by
 *     bid id (lib/myBids.mergeMyBidsPage) and ended by a page shorter than the
 *     limit, because the endpoint returns a bare array with no total.
 *   - the FILTER: one of the five live BidStatus values or "all". A change CLEARS
 *     the list and re-reads page 0 — keeping the previous filter's rows would
 *     show bids the active chip says are excluded.
 *   - the TITLES: the endpoint carries no job info, so each VISIBLE card's job
 *     title is a second request made through the shared limiter (at most three
 *     in flight) and kept in the shared cache — ask once per job, never per
 *     render, and fall back to "Job #id" when the read fails. The list never
 *     blocks on a title.
 *   - STALE REPLIES: every load claims a request id and applies only its own
 *     result while it is still the newest, so a slow first page can never
 *     overwrite a filter change that happened while it was in flight.
 *   - the LIVE RESULT: `bid.accepted` / `bid.rejected` arrive through
 *     context/BidResultsContext (one global handler). This hook paints the
 *     announced status onto the matching row immediately and re-reads the list,
 *     so the row's own filter and the server's `accepted_at` / ordering settle
 *     from the refetch rather than from the event.
 *   - RE-SYNC: every socket (re)open and every return to the foreground bumps
 *     the context's `resyncSeq`, which re-reads the list (events are never
 *     stored).
 *   - the POLLING FALLBACK: registered with the context, which owns the single
 *     30 s interval. It only runs while a PENDING bid is on screen, this screen
 *     is focused, the app is in the foreground and no socket is open.
 *
 * A FAILED REFRESH IS NOT A FAILED SCREEN: once rows are on screen, a failed
 * background read keeps them and raises `inlineError`; only an empty screen shows
 * the hard error card.
 */

export type MyBidsStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'
  /** The query itself was rejected (422) — a bug in the app, not a user error. */
  | 'invalid'
  | 'unauthorized'
  /** A client-only account reached the provider endpoint. */
  | 'forbidden';

type LoadMode = 'initial' | 'refresh' | 'quiet' | 'more';

export function useMyBids() {
  const { user } = useAuth();
  const { jobTitles, loadJobTitle, lastResult, resyncSeq } = useBidResults();
  const ownerId = user?.id ?? null;

  const [filter, setFilter] = useState<MyBidsFilter>(null);
  const [status, setStatus] = useState<MyBidsStatus>('idle');
  const [bids, setBids] = useState<BidResponse[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [inlineError, setInlineError] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  /** Job titles already resolved, for the rows that asked for them. */
  const [titles, setTitles] = useState<Record<number, string>>({});
  const [titlesFailed, setTitlesFailed] = useState<Record<number, true>>({});

  const bidsRef = useRef<BidResponse[]>([]);
  const filterRef = useRef<MyBidsFilter>(null);
  const requestId = useRef(0);
  const inFlight = useRef(false);
  const queued = useRef<LoadMode | null>(null);
  const focusedRef = useRef(false);
  const activeRef = useRef(AppState.currentState === 'active');
  const ownerRef = useRef(ownerId);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  /* ------------------------------------------------------------ loading */

  const applyPage = useCallback(
    (page: BidResponse[], mode: LoadMode) => {
      const limit = MY_BIDS_PAGE_SIZE;
      if (mode === 'more') {
        const merged = mergeMyBidsPage(bidsRef.current, page);
        bidsRef.current = merged;
        setBids(merged);
      } else {
        const fresh = mergeMyBidsPage(resetMyBids(), page);
        bidsRef.current = fresh;
        setBids(fresh);
      }
      setHasMore(!isLastMyBidsPage(page, limit));
      setStatus('ready');
      setInlineError(false);
      setServerMessage(null);
    },
    []
  );

  const load = useCallback(
    async (mode: LoadMode) => {
      if (inFlight.current) {
        // A pull-to-refresh or a resync asked for while a read is running is
        // replayed once it finishes, so the newest request is never dropped.
        if (mode !== 'more') queued.current = mode;
        return;
      }
      inFlight.current = true;
      const id = requestId.current + 1;
      requestId.current = id;

      if (mode === 'initial') setStatus('loading');
      if (mode === 'refresh') setRefreshing(true);
      if (mode === 'more') setLoadingMore(true);

      const limit = MY_BIDS_PAGE_SIZE;
      const offset = mode === 'more' ? bidsRef.current.length : 0;
      const query = { status: filterRef.current, limit, offset };

      try {
        const { data } = await authApi.listMyBids(query);
        if (requestId.current !== id || !mountedRef.current) return;
        const page = Array.isArray(data) ? data.filter((bid) => !!bid && typeof bid.id === 'number') : [];
        applyPage(page, mode);
      } catch (err) {
        if (requestId.current !== id || !mountedRef.current) return;
        const failure = classifyJobActionFailure(err);
        const hasRows = bidsRef.current.length > 0;
        const nextStatus: MyBidsStatus =
          failure.kind === 'unauthorized'
            ? 'unauthorized'
            : failure.kind === 'forbidden'
              ? 'forbidden'
              : failure.kind === 'invalid'
                ? 'invalid'
                : 'error';

        if (hasRows && mode !== 'initial') {
          // The rows on screen stay; a small notice says the refresh failed.
          setInlineError(true);
          setStatus('ready');
        } else {
          setStatus(nextStatus);
          setServerMessage(failure.message);
        }
      } finally {
        inFlight.current = false;
        if (requestId.current === id && mountedRef.current) {
          setRefreshing(false);
          setLoadingMore(false);
        }
        const replay = queued.current;
        queued.current = null;
        if (replay) void load(replay);
      }
    },
    [applyPage]
  );

  // The opening load, on focus, and on every return to the screen.
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      void load(bidsRef.current.length === 0 ? 'initial' : 'quiet');
      return () => {
        focusedRef.current = false;
      };
    }, [load])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      activeRef.current = next === 'active';
    });
    return () => subscription.remove();
  }, []);

  // A filter change resets the list and re-reads page 0. The ref is set FIRST so
  // the load that the state change triggers cannot read the previous filter.
  const changeFilter = useCallback(
    (next: MyBidsFilter) => {
      if (filterRef.current === next) return;
      filterRef.current = next;
      bidsRef.current = resetMyBids();
      setBids(resetMyBids());
      setHasMore(false);
      setInlineError(false);
      setFilter(next);
      void load('initial');
    },
    [load]
  );

  const refresh = useCallback(() => load('refresh'), [load]);

  // A money event on the socket can change a bid's own status (a client paid, or
  // funds were released), so the list re-reads quietly: the rows stay on screen
  // and nothing flashes while the server's own status arrives. Declared after
  // `load` because it calls it.
  useEffect(
    () =>
      subscribeMoneyRefresh('myBids', () => {
        void load('quiet');
      }),
    [load]
  );
  const retry = useCallback(() => load('initial'), [load]);
  const loadMore = useCallback(() => {
    if (!hasMore || inFlight.current) return;
    void load('more');
  }, [hasMore, load]);

  /* ------------------------------------------------------------- titles */

  const requestedTitles = useRef(new Set<number>()).current;

  const ensureTitles = useCallback(
    (jobIds: number[]) => {
      if (jobIds.length === 0) return;
      for (const jobId of jobIds) {
        requestedTitles.add(jobId);
        void loadJobTitle(jobId).then((title) => {
          if (!mountedRef.current) return;
          if (title === null) {
            setTitlesFailed((current) => (current[jobId] ? current : { ...current, [jobId]: true }));
            return;
          }
          setTitles((current) => (current[jobId] === title ? current : { ...current, [jobId]: title }));
        });
      }
    },
    [loadJobTitle, requestedTitles]
  );

  /**
   * Titles for the rows the provider can actually SEE, straight from FlatList's
   * own viewability callback: a 100-row list must not fetch 100 jobs.
   */
  const onViewableItemsChanged = useRef(
    (info: { viewableItems: Array<{ item?: BidResponse }> }) => {
      const visible = info.viewableItems
        .map((entry) => entry.item)
        .filter((bid): bid is BidResponse => !!bid && typeof bid.job_id === 'number');
      ensureTitles(jobIdsNeedingTitle(visible, jobTitles, requestedTitles));
    }
  ).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 20 }).current;

  /* --------------------------------------------------- live + resync */

  const lastSeq = useRef(0);

  useEffect(() => {
    if (!lastResult) return;
    if (lastResult.seq === lastSeq.current) return;
    lastSeq.current = lastResult.seq;
    const result: ProviderBidResult = lastResult.result;
    // Paint the announced status now; the refetch settles everything else
    // (timestamps, ordering, which filter the row belongs to).
    const next = applyBidResultToBids(bidsRef.current, result);
    if (next !== bidsRef.current) {
      bidsRef.current = next;
      setBids(next);
    }
    ensureTitles([result.jobId]);
    void load('quiet');
  }, [lastResult, ensureTitles, load]);

  useEffect(() => {
    if (resyncSeq === 0) return;
    void load(bidsRef.current.length === 0 ? 'initial' : 'quiet');
  }, [resyncSeq, load]);

  /* ---------------------------------------------------------- polling */

  useProviderBidPolling({
    pendingCount: () => pendingBidCount(bidsRef.current),
    focused: () => focusedRef.current && activeRef.current,
    refetch: () => void load('quiet'),
  });

  /* -------------------------------------------------------- lifecycle */

  // Account switch / logout: the rows, the titles and the filter all belong to
  // the account that asked for them.
  useEffect(() => {
    if (ownerRef.current === ownerId) return;
    ownerRef.current = ownerId;
    requestedTitles.clear();
    lastSeq.current = 0;
    bidsRef.current = resetMyBids();
    setBids(resetMyBids());
    setTitles({});
    setTitlesFailed({});
    setHasMore(false);
    setInlineError(false);
    setServerMessage(null);
    setStatus('idle');
    filterRef.current = null;
    setFilter(null);
    if (ownerId !== null) void load('initial');
  }, [ownerId, load, requestedTitles]);

  /** The title a card shows: the resolved one, else "Job #id" (translated). */
  const removeBidLocally = useCallback((bidId: number) => {
    const next = removeMyBid(bidsRef.current, bidId);
    bidsRef.current = next;
    setBids(next);
  }, []);

  const pendingCount = useMemo(() => pendingBidCount(bids), [bids]);

  return {
    status,
    bids,
    filter,
    setFilter: changeFilter,
    hasMore,
    loadingMore,
    refreshing,
    inlineError,
    serverMessage,
    refresh,
    retry,
    loadMore,
    titles,
    titlesFailed,
    onViewableItemsChanged,
    viewabilityConfig,
    pendingCount,
    /** True when the list is carrying no rows yet (the skeleton's condition). */
    firstLoad: status === 'loading' && bids.length === 0,
    removeBidLocally,
  };
}

export default useMyBids;
