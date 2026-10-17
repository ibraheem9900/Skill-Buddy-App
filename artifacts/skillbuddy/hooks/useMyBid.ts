import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { authApi } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import {
  isBidPending,
  isStaleBid,
  isValidBidId,
  isUsableBidResponse,
  myBidLookupFromData,
  myBidLookupFromError,
  type MyBidLookup,
} from '@/lib/bid';
import { classifyJobActionFailure, type JobActionFailure } from '@/lib/jobAction';
import { applyBidResultToMyBid, type ProviderBidResult } from '@/lib/bidResults';
import type { BidResponse, BidStatus, BidUpdateRequest, ValidationErrorDetail } from '@/types';

/**
 * THIS provider's bid on ONE job (GET /api/v1/jobs/{job_id}/bids/mine).
 *
 * The answer has three states and they are not interchangeable: a bid exists, no
 * bid exists, or the question could not be answered. lib/bid.myBidLookupFromError
 * decides which — and it was written from the measured behaviour of the deployed
 * backend, not from the schema, because the schema documents only 200 and 422:
 *
 *   no bid            404  {"detail":"You have not placed a bid on this job."}
 *   unknown job id    404  the SAME body, so the code alone cannot tell them
 *                          apart — the job detail the screen already loads does
 *   no token          401  {"detail":"Not authenticated"}
 *   bad id            422  int_parsing on ["path", "job_id"]
 *
 * ── ONE FETCH PATH, TWO CALLERS ────────────────────────────────────────────
 * `useFocusEffect` performs the opening load and re-reads on every return to the
 * screen; the poll interval performs background refreshes. They share `load`, so
 * they can never run at once (`inFlight`) or disagree about what a failure means.
 *
 * ── POLLING IS NARROW BY DESIGN ────────────────────────────────────────────
 * The caller passes `pollMs` only while bidding is open (20 s), and a tick then
 * additionally requires the screen to be FOCUSED, the app to be in the
 * FOREGROUND and the bid to still be PENDING. The first status that is not
 * PENDING tears the interval down, so accepted/rejected/withdrawn/expired bids
 * stop the requests by themselves — there is no push channel to subscribe to.
 *
 * ── A FAILED REFRESH IS NOT A FAILED SCREEN ────────────────────────────────
 * Once an answer is on screen, a failed background refresh keeps it and raises
 * `refreshFailed`, which the screen renders as a small non-blocking notice; the
 * next tick retries. A 404 during a refresh is NOT a failure — it is the
 * endpoint's own "no bid" answer — and a 401 still ends the session, because
 * then nothing on screen can be trusted.
 *
 * ── THE CACHE IS OWNED BY AN ACCOUNT ───────────────────────────────────────
 * Answers are cached per job id TOGETHER WITH the user id that asked, and a
 * cached answer is only ever read back by that same user. Logging out or
 * switching accounts therefore cannot show one provider another provider's bid:
 * the new account's key misses, and the entries are dropped outright the moment
 * the user id changes.
 *
 * NO SCORES ARE READ HERE OR ANYWHERE DOWNSTREAM: BidResponse carries
 * total_score, is_recommended and the seven component scores, and the provider
 * screen shows none of them — they are internal ranking data.
 */

/** How often a PENDING bid is re-read while the window is open and the app live. */
export const MY_BID_POLL_MS = 20000;

/**
 * The result of a Modify Bid.
 *
 * `busy` is not an error: the screen must not report a second save that never
 * left the device. A refusal carries the raw 422 `detail[]` so the sheet can put
 * a rejected price / time / message back on its own field.
 */
export type EditBidOutcome =
  | { ok: true; bid: BidResponse }
  | ({ ok: false } & JobActionFailure & { detail?: ValidationErrorDetail[] })
  | { ok: false; kind: 'busy'; message: null };

interface CacheEntry {
  /** The account that asked. A mismatch is never shown to another account. */
  ownerId: string | null;
  lookup: MyBidLookup;
}

const cache = new Map<number, CacheEntry>();

function readCache(jobId: number, ownerId: string | null): MyBidLookup | null {
  const entry = cache.get(jobId);
  if (!entry || entry.ownerId !== ownerId) return null;
  return entry.lookup;
}

/** Only real answers are cached — an error is a question, not an answer. */
function writeCache(jobId: number, ownerId: string | null, lookup: MyBidLookup): void {
  if (lookup.state === 'error') {
    cache.delete(jobId);
    return;
  }
  cache.set(jobId, { ownerId, lookup });
}

/* ─────────────────────────────────── the global bid-result handler ────── */

/**
 * A message from context/BidResultsContext, the app's ONE handler for the
 * provider's `bid.accepted` / `bid.rejected` events:
 *
 *   'result'  the event named THIS provider's bid — its status is known now;
 *   'resync'  the socket re-opened or the app returned to the foreground, and
 *             events are never stored, so the answer must be re-read.
 */
type MyBidBroadcast =
  | { kind: 'result'; result: ProviderBidResult }
  | { kind: 'resync' };

const broadcastListeners = new Set<(message: MyBidBroadcast) => void>();

function emit(message: MyBidBroadcast): void {
  for (const listener of Array.from(broadcastListeners)) listener(message);
}

/**
 * Record a result for the ONE-JOB answer before any screen sees it, so a screen
 * that mounts afterwards already reads `ACCEPTED` / `REJECTED` instead of the
 * pre-event status.
 *
 * The cached lookup is transformed through lib/bidResults.applyBidResultToMyBid,
 * which only accepts a result naming the SAME bid and job — so an event about
 * another job cannot rewrite this job's answer, and no owner check is needed
 * here (the entry is transformed whatever account asked for it).
 */
export function broadcastProviderBidResult(result: ProviderBidResult): void {
  const entry = cache.get(result.jobId);
  if (entry) {
    const next = applyBidResultToMyBid(entry.lookup, result);
    if (next && next !== entry.lookup) cache.set(result.jobId, { ...entry, lookup: next });
  }
  emit({ kind: 'result', result });
}

/** Tell every mounted screen to re-read the one-job answer now. */
export function broadcastProviderBidResync(): void {
  emit({ kind: 'resync' });
}

interface Options {
  /**
   * Interval for background refreshes while the bid is PENDING, or null to never
   * poll. The screen passes MY_BID_POLL_MS only while bidding is open.
   */
  pollMs?: number | null;
  /**
   * Suspend background refreshes without changing the interval — the screen sets
   * it while the Edit bid sheet is open, so a poll can never land in the middle
   * of a save. Focus and pull-to-refresh still work.
   */
  paused?: boolean;
}

export function useMyBid(jobId: number | null, { pollMs = null, paused = false }: Options = {}) {
  const { user } = useAuth();
  const ownerId = user?.id ?? null;

  const [lookup, setLookup] = useState<MyBidLookup | null>(() =>
    jobId !== null ? readCache(jobId, ownerId) : null
  );
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  /** Set when a refresh observed a status the previous answer did not have. */
  const [changedStatus, setChangedStatus] = useState<BidStatus | null>(null);

  const inFlight = useRef(false);
  /** A refresh asked for while one was already running, to replay afterwards. */
  const queuedRefresh = useRef(false);
  /** A Modify Bid is in flight; guards the save itself, not the polling. */
  const saving = useRef(false);
  /** The last answer — read by the change detection and by refresh fallbacks. */
  const current = useRef<MyBidLookup | null>(jobId !== null ? readCache(jobId, ownerId) : null);
  const focused = useRef(false);
  const appActive = useRef(AppState.currentState === 'active');
  const ownerRef = useRef(ownerId);
  /** The job `current` refers to, so another job's answer is never rendered. */
  const currentJob = useRef(jobId);

  const apply = useCallback(
    (next: MyBidLookup, detectChange: boolean) => {
      const previous = current.current;
      // A poll that was in flight when the provider saved can land AFTER the
      // save and would quietly restore the pre-save price. The response's own
      // updated_at decides (lib/bid.isStaleBid) — a stale answer is dropped.
      if (
        next.state === 'exists' &&
        previous?.state === 'exists' &&
        isStaleBid(next.bid, previous.bid)
      ) {
        return;
      }
      // A STATUS CHANGE is the one thing a refresh can announce: the client
      // decided, or the bid lapsed. The FIRST answer announces nothing (there
      // was nothing to compare against), the same rule the client list's
      // new-card animation follows.
      if (
        detectChange &&
        previous?.state === 'exists' &&
        next.state === 'exists' &&
        previous.bid.status !== next.bid.status
      ) {
        setChangedStatus(next.bid.status);
      }
      current.current = next;
      if (jobId !== null) writeCache(jobId, ownerId, next);
      setLookup(next);
      setRefreshFailed(false);
    },
    [jobId, ownerId]
  );

  const load = useCallback(
    async (mode: 'open' | 'refresh') => {
      if (jobId === null) return;
      if (inFlight.current) {
        // A CONFirming read asked for while a poll was running is replayed once
        // that poll finishes, so a save is never left unconfirmed.
        if (mode === 'refresh') queuedRefresh.current = true;
        return;
      }
      inFlight.current = true;
      if (mode === 'refresh') setRefreshing(true);
      try {
        const { data } = await authApi.getMyBid(jobId);
        apply(myBidLookupFromData(data), mode === 'refresh');
      } catch (err) {
        const next = myBidLookupFromError(err);
        if (mode === 'refresh' && current.current !== null && next.state === 'error') {
          if (next.kind === 'unauthorized') {
            // The session is over: nothing on screen can be trusted any more.
            current.current = next;
            setLookup(next);
          } else {
            // Keep the last good answer on screen; the next tick retries.
            setRefreshFailed(true);
          }
        } else {
          apply(next, mode === 'refresh');
        }
      } finally {
        inFlight.current = false;
        if (mode === 'refresh') setRefreshing(false);
        if (queuedRefresh.current) {
          queuedRefresh.current = false;
          void load('refresh');
        }
      }
    },
    [jobId, apply]
  );

  // Opening load + re-read on every return to this screen.
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void load(current.current !== null ? 'refresh' : 'open');
      return () => {
        focused.current = false;
      };
    }, [load])
  );

  // Background refreshes — only while a PENDING bid is on screen, only while
  // focused, only while the app is foregrounded, and only if the caller asked.
  const pending = lookup?.state === 'exists' && isBidPending(lookup.bid.status);
  const intervalMs = pollMs !== null && pending && !paused ? pollMs : null;

  useEffect(() => {
    if (jobId === null || intervalMs === null) return;
    const tick = () => {
      if (!focused.current || !appActive.current || inFlight.current) return;
      void load('refresh');
    };
    const interval = setInterval(tick, intervalMs);
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const wasActive = appActive.current;
      appActive.current = next === 'active';
      // Back in the foreground: catch up now instead of waiting for the tick.
      if (!wasActive && appActive.current) tick();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [jobId, intervalMs, load]);

  // A DIFFERENT JOB on the same mounted hook (the route param changed) must not
  // render the previous job's answer: reset to whatever this job has cached.
  useEffect(() => {
    if (currentJob.current === jobId) return;
    currentJob.current = jobId;
    const cached = jobId !== null ? readCache(jobId, ownerId) : null;
    current.current = cached;
    setLookup(cached);
    setChangedStatus(null);
    setRefreshFailed(false);
  }, [jobId, ownerId]);

  // Account switch (or logout): every cached answer belongs to the account that
  // asked for it, so nothing may survive the change.
  useEffect(() => {
    if (ownerRef.current === ownerId) return;
    ownerRef.current = ownerId;
    cache.clear();
    current.current = null;
    setLookup(null);
    setChangedStatus(null);
    setRefreshFailed(false);
    void load('open');
  }, [ownerId, load]);

  /**
   * The global result handler's two messages (context/BidResultsContext):
   *   result → the announced status is written into the answer THIS screen shows,
   *            in place, and the screen's own change notice is raised with it so
   *            a provider already looking at the bid sees the same news as the
   *            banner (lib/bid.isBidFinal: only an outcome can arrive this way);
   *   resync → the socket re-opened or the app came back to the foreground, so
   *            the answer is re-read (events are never stored).
   *
   * A result about ANOTHER job is a no-op here: readCache() returns the same
   * object for this job, which never reaches setLookup.
   */
  useEffect(() => {
    const listener = (message: MyBidBroadcast) => {
      if (message.kind === 'resync') {
        if (jobId === null) return;
        void load('refresh');
        return;
      }
      if (jobId === null) return;
      const { result } = message;
      const cached = readCache(jobId, ownerId);
      if (cached === null) return;
      const shown = current.current;
      if (shown?.state === 'exists' && shown.bid.id !== result.bidId) return;
      current.current = cached;
      setLookup(cached);
      if (cached.state === 'exists' && shown?.state === 'exists' && shown.bid.status !== cached.bid.status) {
        setChangedStatus(cached.bid.status);
      }
    };
    broadcastListeners.add(listener);
    return () => {
      broadcastListeners.delete(listener);
    };
  }, [jobId, ownerId, load]);

  /**
   * Adopt the bid a 201 Create Bid just returned, then confirm it with a real
   * read. The POST body is authoritative enough to render immediately (no
   * form→card flicker), and the refetch is what settles the question.
   */
  const adopt = useCallback(
    (bid: BidResponse) => {
      apply({ state: 'exists', bid }, false);
      void load('refresh');
    },
    [apply, load]
  );

  /**
   * Modify Bid (PUT /jobs/{job_id}/bids/{bid_id}). The bid id comes from the bid
   * the server sent, never from user input, so only this provider's own bid can
   * ever be addressed.
   *
   * A 200 updates the card from the PUT response itself — no flash of the old
   * price — and then CONFIRMS it with a read of /bids/mine, which the stale
   * guard prevents from winning if it was already in flight. A malformed 200 is
   * refused rather than adopted: the card would otherwise show a status nobody
   * sent.
   */
  const saveEdit = useCallback(
    async (bidId: number, body: BidUpdateRequest): Promise<EditBidOutcome> => {
      if (saving.current) return { ok: false, kind: 'busy', message: null };
      if (jobId === null || !isValidBidId(bidId)) {
        return { ok: false, kind: 'badrequest', message: null };
      }
      saving.current = true;
      setSavingEdit(true);
      try {
        const { data } = await authApi.updateBid(jobId, bidId, body);
        if (!isUsableBidResponse(data)) return { ok: false, kind: 'server', message: null };
        apply({ state: 'exists', bid: data }, false);
        void load('refresh');
        return { ok: true, bid: data };
      } catch (err) {
        const failure = classifyJobActionFailure(err);
        const rawDetail = (err as { response?: { data?: { detail?: unknown } } } | null | undefined)
          ?.response?.data?.detail;
        const detail = Array.isArray(rawDetail)
          ? (rawDetail as ValidationErrorDetail[])
          : undefined;
        return { ok: false, ...failure, detail };
      } finally {
        saving.current = false;
        setSavingEdit(false);
      }
    },
    [jobId, apply, load]
  );

  return {
    /** null until something is known; 'exists' / 'none' / 'error' afterwards. */
    lookup,
    /** A pull-to-refresh is in flight (never the opening load). */
    refreshing,
    /** A background refresh failed; the answer on screen is the previous one. */
    refreshFailed,
    /** The status a refresh observed changing, for the in-screen banner. */
    changedStatus,
    /** Dismiss the change banner once the provider has seen it. */
    clearChangedStatus: useCallback(() => setChangedStatus(null), []),
    /** A Modify Bid is in flight — the sheet locks its fields and its button. */
    savingEdit,
    /** PUT the edited values; the card follows the response, then a read. */
    saveEdit,
    /** Pull-to-refresh / banner retry. Never blanks the screen. */
    refresh: useCallback(() => load('refresh'), [load]),
    /** Retry from the error state — behaves like the opening load. */
    reload: useCallback(() => load('open'), [load]),
    adopt,
  };
}

export default useMyBid;
