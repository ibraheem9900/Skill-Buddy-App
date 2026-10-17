import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { authApi } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import {
  useOnRealtimeReconnect,
  useRealtimeEvent,
  useRealtimeStatus,
} from '@/context/RealtimeContext';
import { createRequestSequencer } from '@/lib/jobBidsLive';
import { clearNearbyJobGone, markNearbyJobGone, resetNearbyAvailability } from '@/lib/nearbyAvailability';
import { consumeNearbyStale, resetNearbyStale } from '@/lib/nearbyStale';
import {
  NEARBY_DEFAULT_FILTERS,
  NEARBY_POLL_MS,
  buildNearbyJobsQuery,
  classifyNearbyFailure,
  dedupeNearbyJobs,
  filterNearbyJobs,
  hideExpiredNearbyJobs,
  isNewNearbyJob,
  nearbyVisibilityState,
  nextNearbyExpiryAt,
  parseNearbyJob,
  removeNearbyJob,
  shouldPollNearbyJobs,
  upsertNearbyJob,
  type NearbyJob,
  type NearbyJobFilters,
  type NearbyVisibilityState,
} from '@/lib/nearbyJobs';

/**
 * The provider "Available jobs" feed — REST is the source of truth, realtime is
 * an accelerator.
 *
 * WHAT THIS HOOK OWNS
 *   - the LIST: GET /providers/me/nearby-jobs, de-duplicated by job_id, sorted
 *     the way the server documents it (matching skills first, then closest).
 *   - the 400: `classifyNearbyFailure` splits a visibility 400 (→ an onboarding
 *     state, with the cause read from the profile, status and address) from a
 *     real error (→ the backend's own text). A 403 stays a 403: a client
 *     account that reached a provider endpoint is not an onboarding case.
 *   - STALE REPLIES: every load claims a sequencer id and only applies its own
 *     result while it is still the newest, so a slow reply can never overwrite a
 *     newer list (the same guard the bids screen uses).
 *   - LOCAL EXPIRY with ONE timer: not one interval per card — the single timer
 *     is armed for the earliest future deadline on screen and prunes when it
 *     fires, so a job disappears the moment its bidding window ends even if no
 *     server event ever arrives.
 *   - REALTIME, when the socket is open: `job.nearby_opened` upserts and
 *     re-sorts (and raises the "new job near you" notice ONLY for a job that was
 *     not already listed, and only while the feed is on screen),
 *     `job.nearby_closed` removes the job and remembers it as gone for the job
 *     screen, and every reconnect re-reads the list — events are never stored.
 *   - the POLLING FALLBACK: while the socket is NOT open the list is re-read
 *     every 20s, but only while this screen is focused AND the app is in the
 *     foreground; as soon as the socket opens the interval is gone.
 *
 * It never invents data: an item is whatever the schema sends, and every field
 * the card cannot read is simply not rendered.
 */

export type NearbyFeedStatus = 'idle' | 'loading' | 'ready' | 'onboarding' | 'forbidden' | 'error';

type LoadMode = 'initial' | 'refresh' | 'quiet';

interface Options {
  /**
   * Provider mode with the Available tab on screen. False keeps the hooks
   * mounted (the rules of hooks) but performs no request, no polling and no
   * event handling.
   */
  enabled?: boolean;
}

export function useNearbyJobs({ enabled = true }: Options = {}) {
  const socketStatus = useRealtimeStatus();
  const { user } = useAuth();

  const [status, setStatus] = useState<NearbyFeedStatus>('idle');
  const [jobs, setJobs] = useState<NearbyJob[]>([]);
  const [filters, setFilters] = useState<NearbyJobFilters>(NEARBY_DEFAULT_FILTERS);
  const [refreshing, setRefreshing] = useState(false);
  /** A refetch that failed while the list was already on screen: non-blocking. */
  const [inlineError, setInlineError] = useState(false);
  /** The backend's own message for a HARD failure (and the 400's own text). */
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<NearbyVisibilityState | null>(null);
  /** The "new job near you" notice (already translated by the caller). */
  const [notice, setNotice] = useState<NearbyJob | null>(null);
  /**
   * How many ACTIVE skills the provider has, read once per feed mount and only
   * after the list loaded. null means "not known" (the read failed), which is
   * what keeps the nudge from being shown on a guess.
   */
  const [activeSkills, setActiveSkills] = useState<number | null>(null);
  const skillsReadRef = useRef(false);
  /**
   * Bumped when the provider changed a visibility input (skill or address) on
   * another screen, so the one-shot skills audit below runs again even though
   * `status` never changed — that audit is what hides the "add your skills"
   * nudge, and the write happened while this hook was out of focus.
   */
  const [skillsAuditKey, setSkillsAuditKey] = useState(0);

  const sequencer = useRef(createRequestSequencer()).current;
  const jobsRef = useRef<NearbyJob[]>([]);
  const focusedRef = useRef(false);
  const activeRef = useRef(AppState.currentState === 'active');
  const enabledRef = useRef(enabled);
  const mountedRef = useRef(true);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* --------------------------------------------------------------- loading */

  /**
   * Read the reason behind a visibility 400 from the three read-only sources the
   * backend documents (profile + current status + saved address), plus the
   * provider's own skills for the RECOMMENDED row. Nothing here writes.
   */
  const loadCause = useCallback(async () => {
    const [profile, currentStatus, address, skills] = await Promise.allSettled([
      authApi.getProviderProfile(),
      authApi.getCurrentProviderStatus(),
      authApi.getAddresses(),
      authApi.getProviderSkills(),
    ]);
    if (!mountedRef.current) return;
    const activeSkills =
      skills.status === 'fulfilled' && Array.isArray(skills.value.data)
        ? skills.value.data.filter((skill) => skill?.is_active).length
        : 0;
    setVisibility(
      nearbyVisibilityState(
        profile.status === 'fulfilled' ? profile.value.data : null,
        currentStatus.status === 'fulfilled' ? currentStatus.value.data : null,
        address.status === 'fulfilled' ? address.value.data : null,
        activeSkills
      )
    );
  }, []);

  const load = useCallback(
    async (mode: LoadMode) => {
      if (!enabledRef.current) return;
      const seq = sequencer.next();
      if (mode === 'initial') setStatus('loading');
      if (mode === 'refresh') setRefreshing(true);

      try {
        const { data } = await authApi.getNearbyJobs(buildNearbyJobsQuery());
        if (!sequencer.isCurrent(seq) || !mountedRef.current) return;
        const list = dedupeNearbyJobs(
          hideExpiredNearbyJobs(Array.isArray(data) ? data : [], Date.now())
        );
        // A job that IS in a fresh list is available again: forget the verdict
        // an earlier `job.nearby_closed` left behind.
        for (const job of list) clearNearbyJobGone(job.job_id);
        jobsRef.current = list;
        setJobs(list);
        setStatus('ready');
        setInlineError(false);
        setServerMessage(null);
        setVisibility(null);
      } catch (error: unknown) {
        if (!sequencer.isCurrent(seq) || !mountedRef.current) return;
        const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
        const httpStatus = typeof response?.status === 'number' ? response.status : 0;
        const failure = classifyNearbyFailure(httpStatus, response?.data);
        const hasRows = jobsRef.current.length > 0;

        if (failure.kind === 'onboarding') {
          setStatus('onboarding');
          setServerMessage(failure.detail);
          setVisibility(null);
          void loadCause();
          return;
        }
        if (failure.kind === 'forbidden') {
          setStatus('forbidden');
          setServerMessage(failure.detail);
          return;
        }
        if (hasRows) {
          // The list on screen stays; only a small notice says the refresh failed.
          setInlineError(true);
          setStatus('ready');
          return;
        }
        setStatus('error');
        setServerMessage(failure.detail);
      } finally {
        if (sequencer.isCurrent(seq) && mountedRef.current) setRefreshing(false);
      }
    },
    [loadCause, sequencer]
  );

  /* ----------------------------------------------------------------- focus */

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      if (enabledRef.current) {
        // A skill or address write on another screen marked this feed stale (the
        // provider's visibility inputs decide what may be listed at all, and in
        // which order). One re-read per focus, plus a fresh skills audit so the
        // nudge reflects the skill that was just added.
        if (consumeNearbyStale()) {
          skillsReadRef.current = false;
          setSkillsAuditKey((key) => key + 1);
        }
        void load(jobsRef.current.length === 0 ? 'initial' : 'quiet');
      }
      return () => {
        focusedRef.current = false;
      };
    }, [load])
  );

  // Turning the Available tab on (or the role switching) starts the feed.
  useEffect(() => {
    if (!enabled) return;
    void load(jobsRef.current.length === 0 ? 'initial' : 'quiet');
  }, [enabled, load]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      activeRef.current = next === 'active';
    });
    return () => subscription.remove();
  }, []);

  /* -------------------------------------------------------- local expiry */

  /**
   * ONE shared timer for the whole list: armed for the earliest future deadline
   * on screen, it prunes everything that has ended when it fires and then re-arms
   * itself for the next one. No interval per card, and nothing to clean up
   * beyond this one handle.
   */
  useEffect(() => {
    const next = nextNearbyExpiryAt(jobs, Date.now());
    if (next === null) return;
    const delay = Math.max(500, next - Date.now() + 250);
    const timer = setTimeout(() => {
      const pruned = hideExpiredNearbyJobs(jobsRef.current, Date.now());
      jobsRef.current = pruned;
      setJobs(pruned);
    }, delay);
    return () => clearTimeout(timer);
  }, [jobs]);

  /**
   * Skills are AUDITED, never managed here: one read tells the feed whether the
   * provider has any active skill, which is all the non-blocking nudge needs. A
   * failed read leaves the nudge hidden reather than guessing.
   */
  useEffect(() => {
    if (!enabled || status !== 'ready' || skillsReadRef.current) return;
    skillsReadRef.current = true;
    void (async () => {
      try {
        const { data } = await authApi.getProviderSkills();
        if (!mountedRef.current) return;
        setActiveSkills(
          Array.isArray(data) ? data.filter((skill) => skill?.is_active === true).length : 0
        );
      } catch {
        if (!mountedRef.current) return;
        setActiveSkills(null);
        skillsReadRef.current = false;
      }
    })();
  }, [enabled, status, skillsAuditKey]);

  /* -------------------------------------------------------------- realtime */

  useRealtimeEvent('job.nearby_opened', (event) => {
    if (!enabledRef.current) return;
    const item = parseNearbyJob((event as { data?: unknown }).data);
    if (!item) return;
    const wasNew = isNewNearbyJob(jobsRef.current, item);
    clearNearbyJobGone(item.job_id);
    const next = upsertNearbyJob(
      hideExpiredNearbyJobs(jobsRef.current, Date.now()),
      item
    ).jobs;
    jobsRef.current = next;
    setJobs(next);
    // An event proves the provider IS visible again: re-read the list rather
    // than leaving an onboarding card in front of real jobs.
    if (status === 'onboarding') void load('quiet');
    // The notice only fires for a job that was not already listed, while the
    // feed is on screen, and is silently dropped otherwise.
    if (wasNew && focusedRef.current) setNotice(item);
  });

  useRealtimeEvent('job.nearby_closed', (event) => {
    if (!enabledRef.current) return;
    const jobId = (event as { data?: { job_id?: unknown } }).data?.job_id;
    if (typeof jobId !== 'number' || !Number.isInteger(jobId)) return;
    markNearbyJobGone(jobId);
    const next = removeNearbyJob(jobsRef.current, jobId);
    jobsRef.current = next;
    setJobs(next);
  });

  useOnRealtimeReconnect(() => {
    if (enabledRef.current && focusedRef.current) void load('quiet');
  });

  /* ------------------------------------------------------ polling fallback */

  useEffect(() => {
    if (!enabled) return;
    // The socket is carrying the changes: no polling at all.
    if (!shouldPollNearbyJobs(socketStatus)) return;
    const timer = setInterval(() => {
      if (!focusedRef.current || !activeRef.current) return;
      void load('quiet');
    }, NEARBY_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, load, socketStatus]);

  /* -------------------------------------------------------------- cleanup */

  // Logout and account switch drop the in-memory "no longer available" verdicts
  // AND any pending "visibility inputs changed" mark — a mark left over from the
  // previous account must never make the next one refetch on a false premise.
  // The mark is deliberately NOT cleared on unmount: it is consumed when this
  // feed next regains focus, which is the whole point of the flag.
  useEffect(() => {
    if (!user) {
      resetNearbyAvailability();
      resetNearbyStale();
    }
    return () => {
      resetNearbyAvailability();
    };
  }, [user]);

  // The notice hides itself.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4_000);
    return () => clearTimeout(timer);
  }, [notice]);

  /* ------------------------------------------------------------------ view */

  const visibleJobs = useMemo(() => filterNearbyJobs(jobs, filters), [jobs, filters]);

  const refresh = useCallback(() => load('refresh'), [load]);
  const retry = useCallback(() => load('initial'), [load]);

  return {
    status,
    /** Already filtered by the All/Urgent/Regular chips and "Only my skills". */
    jobs: visibleJobs,
    /** Everything the server listed (for the "N jobs near you" header). */
    totalCount: jobs.length,
    filters,
    setFilters,
    refreshing,
    refresh,
    retry,
    inlineError,
    serverMessage,
    /** The ordered onboarding checklist, once the cause has been read. */
    visibility,
    /** `job.nearby_opened` for a job that was not listed: show the notice. */
    notice,
    dismissNotice: () => setNotice(null),
    /** Is the socket carrying this feed? False → the 20s polling fallback runs. */
    live: socketStatus === 'open',
    socketStatus,
    /** Active skills counted by the feed's one read, or null while unknown. */
    activeSkills,
  };
}

export default useNearbyJobs;
