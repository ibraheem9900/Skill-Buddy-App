import { useCallback, useEffect, useRef, useState } from 'react';
import type { AxiosError } from 'axios';
import { classifyImageRemoveFailure, type ImageRemoveFailure } from '@/lib/imageAttachments';

/**
 * Removing ONE already-uploaded image attachment — the ONE implementation used
 * by every flow that can delete an uploaded photo:
 *
 *   • dispute history → DELETE /milestone-feedback/{id}/attachments/{attachment_id}
 *   • "My review"     → DELETE /reviews/{id}/attachments/{attachment_id}
 *
 * The caller supplies the request itself, so both flows share the exact same
 * state machine, the same 401/403/404/409/422 mapping and the same double-tap
 * guard instead of growing a second copy.
 *
 * NOT optimistic: the tile keeps its place (dimmed with a loader) until the
 * server answers 204. Only then does `onRemoved` run — that is what refreshes
 * the list/cache, which actually drops the tile and frees a slot in the 5-photo
 * counter.
 *
 * Per-attachment state keeps several removals independent: a second photo can be
 * removed while the first is still in flight, while further taps on the SAME
 * photo are ignored (double-tap guard). A failure leaves the photo in place and
 * offers Retry.
 *
 * Local, not-yet-uploaded photos never reach this hook — the shared uploader
 * drops them instantly with no API call.
 */
export type RemovalState = 'removing' | 'failed';

export interface RemovalEntry {
  state: RemovalState;
  failure: ImageRemoveFailure | null;
}

export type RemovalResult =
  | { status: 'ok' }
  | { status: 'gone' }
  | { status: 'failed'; failure: ImageRemoveFailure }
  | { status: 'busy' }
  | { status: 'unavailable' };

export interface AttachmentRemoval {
  /** State for one attachment (undefined = idle/unknown). */
  stateOf: (attachmentId: number) => RemovalEntry | undefined;
  /** Runs the DELETE once per attachment; repeat taps return 'busy'. */
  remove: (attachmentId: number) => Promise<RemovalResult>;
  /** Retry after a failure (same call, no guard problems). */
  retry: (attachmentId: number) => Promise<RemovalResult>;
  /** Anything currently being deleted. */
  removing: boolean;
  /** True only while THIS attachment is being deleted. */
  removingId: (attachmentId: number) => boolean;
}

/** `(ownerId, attachmentId) => DELETE` — removeDisputeImage / removeReviewPhoto. */
export type RemoveAttachmentFn = (ownerId: number, attachmentId: number) => Promise<void>;

function statusOf(error: unknown): number {
  const axiosError = error as AxiosError | undefined;
  if (!axiosError?.isAxiosError) return -1;
  return axiosError.response?.status ?? 0;
}

export function useAttachmentRemoval(
  ownerId: number | null,
  removeFn: RemoveAttachmentFn,
  /** Runs after a 204 (or a 404, where the row is merely stale). */
  onRemoved?: (attachmentId: number) => void
): AttachmentRemoval {
  const [entries, setEntries] = useState<Record<number, RemovalEntry>>({});
  const inFlight = useRef(new Set<number>());
  const mounted = useRef(true);
  const removeRef = useRef(removeFn);
  const removedRef = useRef(onRemoved);

  useEffect(() => {
    removeRef.current = removeFn;
  }, [removeFn]);

  useEffect(() => {
    removedRef.current = onRemoved;
  }, [onRemoved]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A different row means different attachments.
  const idRef = useRef(ownerId);
  useEffect(() => {
    if (idRef.current === ownerId) return;
    idRef.current = ownerId;
    inFlight.current.clear();
    setEntries({});
  }, [ownerId]);

  const drop = useCallback((attachmentId: number) => {
    if (!mounted.current) return;
    setEntries((prev) => {
      if (!(attachmentId in prev)) return prev;
      const next = { ...prev };
      delete next[attachmentId];
      return next;
    });
  }, []);

  const remove = useCallback(
    async (attachmentId: number): Promise<RemovalResult> => {
      if (ownerId === null || !Number.isInteger(attachmentId) || attachmentId <= 0) {
        return { status: 'unavailable' };
      }
      if (inFlight.current.has(attachmentId)) return { status: 'busy' };
      inFlight.current.add(attachmentId);
      if (mounted.current) {
        setEntries((prev) => ({
          ...prev,
          [attachmentId]: { state: 'removing', failure: null },
        }));
      }

      try {
        await removeRef.current(ownerId, attachmentId);
        drop(attachmentId);
        removedRef.current?.(attachmentId);
        return { status: 'ok' };
      } catch (error) {
        const status = statusOf(error);
        if (status === 404) {
          // Already gone: nothing failed, the list is merely stale.
          drop(attachmentId);
          removedRef.current?.(attachmentId);
          return { status: 'gone' };
        }
        const failure = status === -1 ? 'unknown' : classifyImageRemoveFailure(status);
        if (mounted.current) {
          setEntries((prev) => ({ ...prev, [attachmentId]: { state: 'failed', failure } }));
        }
        return { status: 'failed', failure };
      } finally {
        inFlight.current.delete(attachmentId);
      }
    },
    [drop, ownerId]
  );

  const stateOf = useCallback(
    (attachmentId: number) => entries[attachmentId],
    [entries]
  );

  const removingId = useCallback(
    (attachmentId: number) => entries[attachmentId]?.state === 'removing',
    [entries]
  );

  return {
    stateOf,
    remove,
    retry: remove,
    removing: Object.values(entries).some((entry) => entry.state === 'removing'),
    removingId,
  };
}

export default useAttachmentRemoval;
