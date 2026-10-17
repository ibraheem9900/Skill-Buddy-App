import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { authApi } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import {
  useOnRealtimeReconnect,
  useRealtimeEvent,
  useRealtimeStatus,
} from '@/context/RealtimeContext';
import {
  BID_RESULT_BANNER_MS,
  PROVIDER_BID_POLL_MS,
  bidResultBannerContent,
  createBidResultDeduper,
  providerBidResult,
  shouldPollProviderBids,
  type BidResultBannerContent,
  type ProviderBidResult,
} from '@/lib/bidResults';
import {
  createJobTitleCache,
  createRequestLimiter,
  MY_BIDS_TITLE_CONCURRENCY,
  type JobTitleCache,
} from '@/lib/myBids';
import { broadcastProviderBidResult, broadcastProviderBidResync } from '@/hooks/useMyBid';

/**
 * The provider's live bid results — ONE handler for the whole app.
 *
 * WHAT IT OWNS
 *   - the two user-targeted events that decide a bid: `bid.accepted` (you won
 *     the job) and `bid.rejected` (not selected, with the backend's reason or
 *     none). They need no `watch_job`, so the subscription is mounted once here,
 *     inside the realtime provider, and never inside a screen.
 *   - the BANNER: a translated, dismissible announcement with a View action.
 *     Nothing navigates on its own — the provider may be typing a bid on another
 *     job, and a forced route change would throw that away.
 *   - the caches under the banner: the result is published as `lastResult`, which
 *     the My Bids list applies to its own rows, and it is pushed straight into
 *     the one-job lookup the provider's job/bid screen reads
 *     (hooks/useMyBid.broadcastProviderBidResult), so a provider already on that
 *     job's screen updates in place.
 *   - the job title the banner names: the same bounded cache the My Bids list
 *     fills, and ONE quick job read through a limiter of at most
 *     MY_BIDS_TITLE_CONCURRENCY requests when the title is unknown.
 *   - the re-sync: every socket (re)open and every return to the foreground
 *     bumps `resyncSeq` and broadcasts a resync, because events are never stored
 *     — a result announced while the app was closed is gone for good.
 *   - the 30 s POLLING FALLBACK, through useProviderBidPolling: only while no
 *     socket is open, the provider has a PENDING bid, and the screen showing it
 *     is focused in the foreground.
 *
 * IDEMPOTENCE: every result is de-duplicated by (event type, bid_id) before it
 * can produce a banner or touch a cache, so a re-delivered frame (or the same
 * frame delivered after a reconnect) is not news twice.
 *
 * PROVIDER MODE ONLY. The handler is mounted for the app's whole lifetime —
 * mounting it per role would re-subscribe on every switch and could drop a frame
 * in the gap — but it acts only while the active role is PROVIDER, and it clears
 * the banner the moment the role switches. `is_active` is never read or written
 * anywhere in this file.
 */

export interface ProviderBidPollSource {
  /** How many of this screen's bids are still PENDING. */
  pendingCount: () => number;
  /** Is the screen showing them on screen? */
  focused: () => boolean;
  /** Re-read that screen's data now. */
  refetch: () => void;
}

export interface BidResultBannerState {
  /** Stable key so React re-animates for a NEW result, not for a re-render. */
  key: string;
  result: ProviderBidResult;
  content: BidResultBannerContent;
  /** The job the banner's View action opens. */
  jobId: number;
}

interface BidResultsContextValue {
  /** The last announced result, with a sequence the consumers watch. */
  lastResult: { seq: number; result: ProviderBidResult } | null;
  /** Bumped on every reconnect / app resume: consumers re-read their data. */
  resyncSeq: number;
  /** The shared job-title cache: filled by the list, read by the banner. */
  jobTitles: JobTitleCache;
  /** Read ONE job title through the shared limiter (≤3 requests in flight). */
  loadJobTitle: (jobId: number) => Promise<string | null>;
  /** Register a polling source for the 30 s fallback. Returns its deregister. */
  registerPollSource: (source: ProviderBidPollSource) => () => void;
  banner: BidResultBannerState | null;
  dismissBanner: () => void;
}

/**
 * The shared title cache and limiter are MODULE level, not per-provider-instance,
 * because a React re-mount must not throw away titles the list already paid for.
 * They are cleared on logout and on account switch (see the provider below), so
 * one account's job titles can never be shown to another.
 */
const jobTitles = createJobTitleCache();
const titleLimiter = createRequestLimiter(MY_BIDS_TITLE_CONCURRENCY);

const noop = () => {};

const BidResultsContext = createContext<BidResultsContextValue>({
  lastResult: null,
  resyncSeq: 0,
  jobTitles,
  loadJobTitle: async () => null,
  registerPollSource: () => noop,
  banner: null,
  dismissBanner: noop,
});

export function BidResultsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { activeRole } = useRole();
  const socketStatus = useRealtimeStatus();

  const providerMode = activeRole === 'PROVIDER';
  const ownerId = user?.id === undefined || user?.id === null ? null : String(user.id);

  const [lastResult, setLastResult] = useState<{ seq: number; result: ProviderBidResult } | null>(null);
  const [resyncSeq, setResyncSeq] = useState(0);
  const [banner, setBanner] = useState<BidResultBannerState | null>(null);

  const deduper = useRef(createBidResultDeduper()).current;
  const seqRef = useRef(0);
  const providerModeRef = useRef(providerMode);
  const ownerRef = useRef<string | null>(ownerId);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** One title read per job at a time, so two frames cannot fetch it twice. */
  const titleFetches = useRef(new Map<number, Promise<string | null>>()).current;

  useEffect(() => {
    providerModeRef.current = providerMode;
  }, [providerMode]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismissBanner = useCallback(() => {
    clearTimer();
    setBanner(null);
  }, [clearTimer]);

  /**
   * Read one job title, at most once at a time per job and never more than
   * MY_BIDS_TITLE_CONCURRENCY in flight. A failed read returns null — the banner
   * then names the job with the "Job #id" fallback instead of staying blank or
   * blocking.
   */
  const loadJobTitle = useCallback(
    (jobId: number): Promise<string | null> => {
      const cached = jobTitles.get(jobId);
      if (cached !== null) return Promise.resolve(cached);
      const inFlight = titleFetches.get(jobId);
      if (inFlight) return inFlight;

      const task = titleLimiter
        .run(async () => {
          const { data } = await authApi.getJob(jobId);
          const title = typeof data?.title === 'string' ? data.title.trim() : '';
          if (title.length > 0) jobTitles.set(jobId, title);
          return title.length > 0 ? title : null;
        })
        .catch(() => null)
        .finally(() => {
          titleFetches.delete(jobId);
        });

      titleFetches.set(jobId, task);
      return task;
    },
    [titleFetches]
  );

  /* --------------------------------------------------------- the handler */

  const announce = useCallback(
    (result: ProviderBidResult) => {
      // (type, bid_id) — a repeat of the same news is dropped here, before it can
      // stack a second banner or re-touch a cache.
      if (deduper.seen(result)) return;

      seqRef.current += 1;
      setLastResult({ seq: seqRef.current, result });

      // The job screen follows in place when it is showing THIS bid, without
      // waiting for its own refetch.
      broadcastProviderBidResult(result);

      const title = jobTitles.get(result.jobId);
      const content = bidResultBannerContent(result, title);
      const key = `${result.type}:${result.bidId}:${seqRef.current}`;

      clearTimer();
      setBanner({ key, result, content, jobId: result.jobId });
      timerRef.current = setTimeout(() => setBanner(null), BID_RESULT_BANNER_MS);

      // No title yet: name the job as soon as the quick read answers, but only
      // while THIS banner is still the one on screen.
      if (title === null) {
        void loadJobTitle(result.jobId).then((fetched) => {
          if (fetched === null) return;
          setBanner((current) =>
            current && current.key === key
              ? { ...current, content: bidResultBannerContent(result, fetched) }
              : current
          );
        });
      }
    },
    [clearTimer, deduper, jobTitles, loadJobTitle]
  );

  // Mounted ONCE for the app's lifetime; it acts only in provider mode.
  useRealtimeEvent('bid.accepted', (event) => {
    if (!providerModeRef.current) return;
    const result = providerBidResult(event);
    if (!result) return;
    announce(result);
  });

  useRealtimeEvent('bid.rejected', (event) => {
    if (!providerModeRef.current) return;
    const result = providerBidResult(event);
    if (!result) return;
    announce(result);
  });

  /* ------------------------------------------------------------- resync */

  const resync = useCallback(() => {
    setResyncSeq((seq) => seq + 1);
    broadcastProviderBidResync();
  }, []);

  // Every (re)open of the socket — including the first: events are never stored.
  useOnRealtimeReconnect(() => {
    if (!providerModeRef.current) return;
    resync();
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active' || !providerModeRef.current) return;
      resync();
    });
    return () => subscription.remove();
  }, [resync]);

  /* ------------------------------------------------- polling fallback */

  const sources = useRef(new Set<ProviderBidPollSource>()).current;
  const registerPollSource = useCallback(
    (source: ProviderBidPollSource) => {
      sources.add(source);
      return () => {
        sources.delete(source);
      };
    },
    [sources]
  );

  /**
   * ONE interval for every registered screen. A tick re-reads only the sources
   * that are PENDING and focused right now, so a screen that stops qualifying
   * (blur, all bids decided) costs nothing.
   */
  useEffect(() => {
    if (!providerMode) return;
    if (socketStatus === 'open') return;

    const timer = setInterval(() => {
      for (const source of Array.from(sources)) {
        if (!shouldPollProviderBids({
          socketStatus,
          pendingCount: source.pendingCount(),
          focused: source.focused(),
          foreground: true,
        })) {
          continue;
        }
        source.refetch();
      }
    }, PROVIDER_BID_POLL_MS);

    return () => clearInterval(timer);
  }, [providerMode, socketStatus, sources]);

  /* ---------------------------------------------------------- lifecycle */

  // Account switch / logout: every cached title and every announced result
  // belongs to the account that produced it.
  useEffect(() => {
    if (ownerRef.current === ownerId) return;
    ownerRef.current = ownerId;
    jobTitles.clear();
    titleFetches.clear();
    deduper.clear();
    seqRef.current = 0;
    setLastResult(null);
    clearTimer();
    setBanner(null);
  }, [ownerId, clearTimer, deduper, jobTitles, titleFetches]);

  // Leaving provider mode hides the result: it is a provider's message.
  useEffect(() => {
    if (providerMode) return;
    clearTimer();
    setBanner(null);
  }, [providerMode, clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const value = useMemo<BidResultsContextValue>(
    () => ({
      lastResult,
      resyncSeq,
      jobTitles,
      loadJobTitle,
      registerPollSource,
      banner,
      dismissBanner,
    }),
    [lastResult, resyncSeq, loadJobTitle, registerPollSource, banner, dismissBanner]
  );

  return <BidResultsContext.Provider value={value}>{children}</BidResultsContext.Provider>;
}

export function useBidResults(): BidResultsContextValue {
  return useContext(BidResultsContext);
}

/**
 * Register the calling screen as a polling source for the 30 s fallback.
 *
 * The caller passes live read functions (not snapshots) so the shared interval
 * always sees the CURRENT state: `pendingCount` decides whether the provider has
 * anything that can still change, `focused` whether the screen showing it is on
 * screen, and `refetch` what to re-read when both hold.
 */
export function useProviderBidPolling(source: ProviderBidPollSource): void {
  const { registerPollSource } = useBidResults();
  const ref = useRef(source);
  useEffect(() => {
    ref.current = source;
  }, [source]);

  useEffect(
    () =>
      registerPollSource({
        pendingCount: () => ref.current.pendingCount(),
        focused: () => ref.current.focused(),
        refetch: () => ref.current.refetch(),
      }),
    [registerPollSource]
  );
}

export default BidResultsProvider;
