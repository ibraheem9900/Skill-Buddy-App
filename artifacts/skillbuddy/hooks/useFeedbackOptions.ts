import { useCallback, useEffect, useRef, useState } from 'react';
import type { AxiosError } from 'axios';
import {
  classifyFeedbackFailure,
  type FeedbackContext,
  type FeedbackFailureKind,
  type FeedbackOption,
} from '@/lib/feedback';
import { getFeedbackOptions } from '@/services/feedback';

/**
 * Feedback options, cached PER CONTEXT for the session.
 *
 * The list is admin-managed and barely changes, so reopening the same feedback
 * screen (review → back → review again) must not re-request it. `refetch()`
 * forces a fresh read for Try Again and pull-to-refresh. Cache is module-level
 * (survives screen unmounts) but never persisted to storage: a language switch
 * or app restart reads the server again, and stale options can never outlive a
 * session.
 */
type Status = 'idle' | 'loading' | 'ready' | 'error';

const cache = new Map<FeedbackContext, FeedbackOption[]>();
const inFlight = new Map<FeedbackContext, Promise<FeedbackOption[]>>();

/** Clears the session cache (logout / e2e helpers). */
export function clearFeedbackOptionsCache(): void {
  cache.clear();
  inFlight.clear();
}

function statusFromError(error: unknown): FeedbackFailureKind {
  const axiosError = error as AxiosError | undefined;
  if (axiosError?.isAxiosError) {
    return classifyFeedbackFailure(axiosError.response?.status ?? 0);
  }
  return 'unknown';
}

export function useFeedbackOptions(context: FeedbackContext | null) {
  const cached = context ? cache.get(context) : undefined;
  const [options, setOptions] = useState<FeedbackOption[]>(cached ?? []);
  const [status, setStatus] = useState<Status>(cached ? 'ready' : context ? 'loading' : 'idle');
  const [failure, setFailure] = useState<FeedbackFailureKind | null>(null);
  const mounted = useRef(true);
  const token = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (force: boolean) => {
      if (!context) return;

      const hit = cache.get(context);
      if (!force && hit) {
        setOptions(hit);
        setStatus('ready');
        setFailure(null);
        return;
      }

      const ticket = ++token.current;
      if (!hit) setStatus('loading');
      setFailure(null);

      try {
        // Reuse an in-flight read for the same context (double mount, fast
        // back-and-forward) instead of firing twice.
        let pending = inFlight.get(context);
        if (!pending) {
          pending = getFeedbackOptions(context);
          inFlight.set(context, pending);
        }
        const fresh = await pending.finally(() => inFlight.delete(context));
        cache.set(context, fresh);
        if (!mounted.current || ticket !== token.current) return;
        setOptions(fresh);
        setStatus('ready');
      } catch (error) {
        if (!mounted.current || ticket !== token.current) return;
        // A failed refresh keeps the last good list on screen — the user can
        // still pick an option while the retry button is visible.
        const stale = cache.get(context);
        setOptions(stale ?? []);
        setStatus(stale ? 'ready' : 'error');
        setFailure(statusFromError(error));
      }
    },
    [context]
  );

  useEffect(() => {
    if (!context) {
      setOptions([]);
      setStatus('idle');
      setFailure(null);
      return;
    }
    const hit = cache.get(context);
    setOptions(hit ?? []);
    setStatus(hit ? 'ready' : 'loading');
    setFailure(null);
    void load(false);
  }, [context, load]);

  const refetch = useCallback(() => load(true), [load]);

  return { options, status, failure, refetch };
}

export default useFeedbackOptions;
