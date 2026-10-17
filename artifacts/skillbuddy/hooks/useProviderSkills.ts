import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import { markNearbyStale } from '@/lib/nearbyStale';
import {
  buildSkillCreateBody,
  buildSkillUpdateBody,
  dropSkill,
  reconcileSkills,
  skillFailure,
  upsertSkill,
  type SkillFailure,
} from '@/lib/providerSkills';
import type { ProviderSkill } from '@/types';

/**
 * The provider's own skills (GET/POST/PATCH/DELETE /providers/me/skills) — the
 * visibility prerequisite the guide's §4.1 describes: ACTIVE skills are what make
 * jobs for those services rank first in the nearby feed (`matches_skill`).
 *
 * STATES
 *  - idle     not started
 *  - loading  first read in flight (the screen shows its skeleton)
 *  - ready    loaded — the array may legitimately be empty (the screen's empty state)
 *  - error    the read failed (network/5xx) — retryable
 *
 * SOURCE OF TRUTH: every write adopts the SERVER's response — the 201 body on
 * add, the 200 body on toggle — and a successful DELETE drops the row only after
 * the live 204. Nothing is optimistically inserted, toggled or removed, so a
 * refused write (409 duplicate, 404 service/skill gone, 403, offline) leaves the
 * list exactly as the server last described it.
 *
 * NON-BLOCKING FAILURES: a failed WRITE never replaces the screen with an error
 * state. It returns a failure the caller renders (the backend's own `detail`
 * when it sent one — the live 409 and 404 both carry a sentence worth reading)
 * and the list stays usable.
 *
 * ACCOUNT SWITCH: the module cache remembers which user it belongs to, so a
 * different account never sees the previous one's skills even if the screen was
 * unmounted during the switch; a logout clears it outright.
 *
 * STALE FEED: add/toggle/remove change which jobs rank first, so each confirmed
 * write marks the nearby feed stale (the feed re-reads on its next focus).
 */

export type ProviderSkillsStatus = 'idle' | 'loading' | 'ready' | 'error';

/** What one write did — the screen renders the failure, never throws it away. */
export type SkillWriteResult = { ok: true; skill?: ProviderSkill } | { ok: false; failure: SkillFailure };

interface SkillsCache {
  ownerId: string | null;
  skills: ProviderSkill[] | null;
}

let cache: SkillsCache = { ownerId: null, skills: null };
let cacheStatus: ProviderSkillsStatus = 'idle';

/** Drop the cached skills — logout, account switch, and the screens' reset path. */
export function resetProviderSkillsCache(): void {
  cache = { ownerId: null, skills: null };
  cacheStatus = 'idle';
}

export function useProviderSkills() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [status, setStatus] = useState<ProviderSkillsStatus>(cacheStatus);
  const [skills, setSkillsState] = useState<ProviderSkill[] | null>(cache.skills);
  /** The translated key for a failed READ (the list could not be loaded at all). */
  const [errorMessage, setErrorMessage] = useState<TranslationKey | null>(null);
  /** The last failed WRITE, kept for the screen's inline error, or null. */
  const [writeFailure, setWriteFailure] = useState<SkillFailure | null>(null);
  /** The write currently in flight: 'add' or the skill id being toggled/removed. */
  const [pending, setPending] = useState<'add' | number | null>(null);

  const inFlight = useRef(false);

  const ownerId = user?.id != null ? String(user.id) : null;

  const apply = useCallback((next: ProviderSkill[], owner: string | null) => {
    cache = { ownerId: owner, skills: next };
    cacheStatus = 'ready';
    setSkillsState(next);
    setStatus('ready');
  }, []);

  /**
   * GET /providers/me/skills — reads once per account and then serves the cache;
   * `force` (pull-to-refresh / after a write) always goes to the network. The
   * cache is only trusted while it belongs to the signed-in account.
   */
  const load = useCallback(
    async (force = false) => {
      if (inFlight.current) return;
      const cached = cache.ownerId === ownerId ? cache.skills : null;
      if (!force && cacheStatus === 'ready' && cached !== null) return;
      inFlight.current = true;
      setStatus('loading');
      try {
        const { data } = await authApi.getProviderSkills();
        const next = reconcileSkills([], data);
        apply(next, ownerId);
        setErrorMessage(null);
        setWriteFailure(null);
      } catch {
        cacheStatus = 'error';
        setStatus('error');
        setErrorMessage('skills_err_load');
      } finally {
        inFlight.current = false;
      }
    },
    [apply, ownerId]
  );

  const refresh = useCallback(() => load(true), [load]);

  // Logout / account switch: another account's skills must never be shown.
  useEffect(() => {
    if (ownerId === null) {
      resetProviderSkillsCache();
      setSkillsState(null);
      setStatus('idle');
      setWriteFailure(null);
      return;
    }
    if (cache.ownerId !== null && cache.ownerId !== ownerId) {
      // Signed in as somebody else while this screen was mounted.
      cache = { ownerId: null, skills: null };
      cacheStatus = 'idle';
      setSkillsState(null);
      setStatus('idle');
      setWriteFailure(null);
    }
  }, [ownerId]);

  /**
   * POST /providers/me/skills { service_id } — the backend applies its own
   * defaults and 201-returns the finished row, which is upserted as-is. A 409
   * (already a skill for this service), 404 (service gone) or 403 comes back as
   * a failure carrying the backend's own sentence.
   */
  const add = useCallback(
    async (serviceId: number): Promise<SkillWriteResult> => {
      if (pending !== null || inFlight.current) return { ok: false, failure: skillFailure(0, null) };
      const current = cache.ownerId === ownerId ? cache.skills ?? [] : [];
      setPending('add');
      setWriteFailure(null);
      try {
        const { data } = await authApi.createProviderSkill(buildSkillCreateBody(serviceId));
        const next = upsertSkill(current, data);
        apply(next, ownerId);
        markNearbyStale(); // new active skill → the feed's ranking changed
        return { ok: true, skill: data };
      } catch (error: unknown) {
        const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
        const failure = skillFailure(
          typeof response?.status === 'number' ? response.status : 0,
          response?.data
        );
        setWriteFailure(failure);
        return { ok: false, failure };
      } finally {
        setPending(null);
      }
    },
    [apply, ownerId, pending]
  );

  /**
   * PATCH /providers/me/skills/{id} with ONLY `is_active` — the ACTIVE/INACTIVE
   * toggle. Sending the value the server already reports is a no-op, not a
   * request (the live endpoint ignores unknown fields and accepts `{}`, so an
   * empty body would silently do nothing while looking like it worked).
   */
  const setActive = useCallback(
    async (skill: ProviderSkill, isActive: boolean): Promise<SkillWriteResult> => {
      if (pending !== null || inFlight.current) return { ok: false, failure: skillFailure(0, null) };
      const current = cache.ownerId === ownerId ? cache.skills ?? [] : [];
      const body = buildSkillUpdateBody({ isActive });
      if (body.is_active === undefined || skill.is_active === isActive) {
        return { ok: true, skill };
      }
      setPending(skill.id);
      setWriteFailure(null);
      try {
        const { data } = await authApi.updateProviderSkill(skill.id, body);
        apply(upsertSkill(current, data), ownerId);
        markNearbyStale(); // an active skill appearing/disappearing re-ranks the feed
        return { ok: true, skill: data };
      } catch (error: unknown) {
        const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
        const failure = skillFailure(
          typeof response?.status === 'number' ? response.status : 0,
          response?.data
        );
        setWriteFailure(failure);
        return { ok: false, failure };
      } finally {
        setPending(null);
      }
    },
    [apply, ownerId, pending]
  );

  /**
   * DELETE /providers/me/skills/{id}. The live 204 carries no body, so the row is
   * dropped only after that confirmation; a 404 means the skill is already gone,
   * which is treated as success and the list re-read from the server.
   */
  const remove = useCallback(
    async (skillId: number): Promise<SkillWriteResult> => {
      if (pending !== null || inFlight.current) return { ok: false, failure: skillFailure(0, null) };
      const current = cache.ownerId === ownerId ? cache.skills ?? [] : [];
      setPending(skillId);
      setWriteFailure(null);
      try {
        await authApi.deleteProviderSkill(skillId);
        apply(dropSkill(current, skillId), ownerId);
        markNearbyStale(); // removing the skill changes which jobs match
        return { ok: true };
      } catch (error: unknown) {
        const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
        const httpStatus = typeof response?.status === 'number' ? response.status : 0;
        if (httpStatus === 404) {
          // Already gone — the list re-read is the truth (nothing is guessed).
          apply(dropSkill(current, skillId), ownerId);
          markNearbyStale();
          void load(true);
          return { ok: true };
        }
        const failure = skillFailure(httpStatus, response?.data);
        setWriteFailure(failure);
        return { ok: false, failure };
      } finally {
        setPending(null);
      }
    },
    [apply, load, ownerId, pending]
  );

  /** The backend's sentence when it sent one, else the translated fallback. */
  const failureText = useCallback(
    (failure: SkillFailure): string => failure.detail ?? t(failure.messageKey),
    [t]
  );

  /** Service ids already used — the picker hides nothing, but the screen warns. */
  const usedServiceIds = useCallback(
    (): number[] => (skills ?? []).map((skill) => skill.service_id),
    [skills]
  );

  return {
    status,
    /** null until the first read finishes — the screen's skeleton condition. */
    skills,
    errorMessage,
    writeFailure,
    dismissWriteFailure: () => setWriteFailure(null),
    /** 'add', the id of the skill being written, or null. */
    pending,
    load,
    refresh,
    add,
    setActive,
    remove,
    failureText,
    usedServiceIds,
  };
}

export default useProviderSkills;
