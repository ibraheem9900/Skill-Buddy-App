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
import { useOnRealtimeReconnect, useRealtimeEvent } from '@/context/RealtimeContext';
import { useAuth } from '@/context/AuthContext';
import { invalidateJobList } from '@/hooks/useJobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import { broadcastProviderBidResync } from '@/hooks/useMyBid';
import { refreshWallets } from '@/hooks/useWallet';
import { debounce, DEBOUNCE_DEFAULT_MS } from '@/lib/debounce';
import {
  MONEY_BANNER_MS,
  MONEY_EVENT_TYPES,
  applyMoneyRefreshPlan,
  createMoneyEventDeduper,
  emitMoneyRefresh,
  moneyBannerContent,
  moneyEventKey,
  moneyEventIds,
  moneyRefreshPlan,
  moneyResyncPlan,
  resetMoneyRefreshBus,
  type MoneyBannerContent,
  type MoneyEventPlan,
} from '@/lib/moneyEvents';

/**
 * The money side of the realtime layer — ONE handler for the whole app.
 *
 * WHAT IT OWNS
 *   - the ten user-targeted money events the guide names (payment.*, invoice.*,
 *     escrow.*, wallet.credit_earned). They need no `watch_job`, so the
 *     subscriptions live here, inside the realtime provider, never in a screen.
 *   - the REFETCH: one plan per event (lib/moneyEvents.moneyRefreshPlan) naming
 *     the reads the app already performs — the job itself, the job list, the
 *     bids, the wallets. A burst is debounced ({@link DEBOUNCE_DEFAULT_MS} ms,
 *     inside the 300–500 ms band) so one burst is one refetch per target.
 *   - the BANNER: a translated, dismissible announcement. It never navigates on
 *     its own; its action opens an EXISTING screen when the event named a job,
 *     otherwise it just dismisses.
 *   - the RE-SYNC: every socket (re)open and every return to the foreground
 *     re-reads everything, because events are never stored and a frame that
 *     arrived while nothing was listening is gone.
 *
 * THE EVENT IS NEVER THE STATUS. Nothing here writes a job or bid status: the
 * refetch re-reads REST, and REST is what the screens display. An event only
 * says "something about money changed".
 *
 * IDEMPOTENCE: a repeat of the same (type, id) inside
 * {@link MONEY_DEDUPE_WINDOW_MS} (5 s) is not news twice — no second banner and
 * no second refetch. A type the guide does not document produces a plan with no
 * targets, so a new server event is ignored rather than mis-handled.
 */

export interface MoneyBannerState {
  content: MoneyBannerContent;
}

interface MoneyEventsContextValue {
  banner: MoneyBannerState | null;
  dismissBanner: () => void;
  /** Bumped whenever a plan was applied — screens may simply watch this. */
  appliedSeq: number;
}

const noop = () => {};

const MoneyEventsContext = createContext<MoneyEventsContextValue>({
  banner: null,
  dismissBanner: noop,
  appliedSeq: 0,
});

export function MoneyEventsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const ownerId = user?.id === undefined || user?.id === null ? null : String(user.id);

  const [banner, setBanner] = useState<MoneyBannerState | null>(null);
  const [appliedSeq, setAppliedSeq] = useState(0);

  const deduper = useRef(createMoneyEventDeduper()).current;
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const ownerRef = useRef<string | null>(ownerId);

  /**
   * Apply one plan: the cache invalidations and list resyncs the app already has
   * (each one a helper another chunk established), then ONE publish to the
   * screens that subscribe to a target. A resync plan carries `jobIds: null`, so
   * every mounted job screen re-reads its own job.
   */
  const runPlan = useCallback((plan: MoneyEventPlan) => {
    applyMoneyRefreshPlan(plan, {
      invalidateJobDetail,
      invalidateJobList,
      resyncMyBids: broadcastProviderBidResync,
      refreshWallets,
    });
    emitMoneyRefresh(plan);
    setAppliedSeq((seq) => seq + 1);
  }, []);

  const debounced = useMemo(
    () =>
      debounce<[MoneyEventPlan]>((plan) => runPlan(plan), DEBOUNCE_DEFAULT_MS, {
        schedule: (run, delayMs) => setTimeout(run, delayMs),
        cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      }),
    [runPlan]
  );

  // A pending refetch must not run against a session that is already gone.
  useEffect(() => () => debounced.cancel(), [debounced]);

  const clearBannerTimer = useCallback(() => {
    if (bannerTimer.current !== null) {
      clearTimeout(bannerTimer.current);
      bannerTimer.current = null;
    }
  }, []);

  const dismissBanner = useCallback(() => {
    clearBannerTimer();
    setBanner(null);
  }, [clearBannerTimer]);

  /* --------------------------------------------------------- the handler */

  const handle = useCallback(
    (type: string, data: unknown) => {
      const plan = moneyRefreshPlan(type, data);
      // Undocumented type: no banner and no refetch. The guide adds events over
      // time, so the app reacts only to names it actually knows.
      if (!plan.known) return;

      // (type, id) inside the window: a re-delivered frame is not news twice.
      if (deduper.seen(moneyEventKey(type, moneyEventIds(data)))) return;

      seqRef.current += 1;
      const content = moneyBannerContent(type, data, seqRef.current);
      if (content) {
        clearBannerTimer();
        setBanner({ content });
        bannerTimer.current = setTimeout(() => setBanner(null), MONEY_BANNER_MS);
      }

      debounced(plan);
    },
    [clearBannerTimer, debounced, deduper]
  );

  // One subscription per documented type (MONEY_EVENT_TYPES is the single list).
  useRealtimeEvent(MONEY_EVENT_TYPES[0], (event) => handle(event.type, event.data));
  useRealtimeEvent(MONEY_EVENT_TYPES[1], (event) => handle(event.type, event.data));
  useRealtimeEvent(MONEY_EVENT_TYPES[2], (event) => handle(event.type, event.data));
  useRealtimeEvent(MONEY_EVENT_TYPES[3], (event) => handle(event.type, event.data));
  useRealtimeEvent(MONEY_EVENT_TYPES[4], (event) => handle(event.type, event.data));
  useRealtimeEvent(MONEY_EVENT_TYPES[5], (event) => handle(event.type, event.data));
  useRealtimeEvent(MONEY_EVENT_TYPES[6], (event) => handle(event.type, event.data));
  useRealtimeEvent(MONEY_EVENT_TYPES[7], (event) => handle(event.type, event.data));
  useRealtimeEvent(MONEY_EVENT_TYPES[8], (event) => handle(event.type, event.data));
  useRealtimeEvent(MONEY_EVENT_TYPES[9], (event) => handle(event.type, event.data));

  /* ----------------------------------------------------------- the resync */

  // Every (re)open of the socket, including the first: a missed frame is lost.
  useOnRealtimeReconnect(() => {
    runPlan(moneyResyncPlan());
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') return;
      runPlan(moneyResyncPlan());
    });
    return () => subscription.remove();
  }, [runPlan]);

  /* ----------------------------------------------------------- lifecycle */

  // Logout / account switch: results, banner and the previous account's screen
  // subscribers are all dropped, and nothing queued survives it.
  useEffect(() => {
    if (ownerRef.current === ownerId) return;
    ownerRef.current = ownerId;
    deduper.clear();
    seqRef.current = 0;
    debounced.cancel();
    clearBannerTimer();
    setBanner(null);
    resetMoneyRefreshBus();
  }, [ownerId, clearBannerTimer, debounced, deduper]);

  const value = useMemo<MoneyEventsContextValue>(
    () => ({ banner, dismissBanner, appliedSeq }),
    [banner, dismissBanner, appliedSeq]
  );

  return <MoneyEventsContext.Provider value={value}>{children}</MoneyEventsContext.Provider>;
}

export function useMoneyEvents(): MoneyEventsContextValue {
  return useContext(MoneyEventsContext);
}

export default MoneyEventsProvider;
