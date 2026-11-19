/**
 * useUpdateMedia — PATCH /api/v1/media-gallery/{item_id} for ONE photo.
 *
 * WHAT IT GUARANTEES
 *   • NOT optimistic: the form keeps the old values, and every cache changes
 *     only after the server confirms with the complete updated item.
 *   • ONE request at a time: a repeated tap while saving is ignored
 *     (`busyRef`), so a double submit can never fire two PATCHes.
 *   • Only the fields the caller passes are sent (lib/mediaEdit builds them).
 *   • The 200 body is the SOURCE OF TRUTH for every cache that may hold the
 *     item: the paginated public pages, the by-service and by-category group
 *     caches, the preview strips that read those groups, and the signed-in
 *     user's own "my media" list (whose hook re-reads its cache).
 *
 * VISIBILITY RULES
 *   • The item's NEW PUBLIC representation comes from normalizeMediaItem, which
 *     applies the documented public rules (is_public, COMPLETED feedback,
 *     supported media_type, usable URL). When it is null the photo is REMOVED
 *     from every public cache immediately — a public view must never show a
 *     photo that is no longer public.
 *   • A photo that BECAME public is never inserted into a list by guesswork:
 *     the public caches are marked stale, and their next load/refresh reads the
 *     server so the item lands in its real place.
 *   • A 404 removes the photo from every cache (public and the owner's list).
 *
 * ERRORS are classified into friendly codes (lib/mediaEdit) and, for a 422,
 * mapped to the form field they belong to. Raw JSON and status codes are never
 * surfaced; a short readable `detail` from the server is.
 */
import { useCallback, useRef, useState } from 'react';
import { BASE_URL, authApi } from '@/services/api';
import {
  classifyMediaUpdateFailure,
  fieldErrorsFromValidation,
  isValidMediaItemId,
  normalizeUpdatedMedia,
  publicDisplayMedia,
  readServerMessage,
  type MediaUpdateFailure,
  type MediaUpdateFieldErrors,
  type MediaUpdatePatch,
} from '@/lib/mediaEdit';
import {
  applyServiceGroupMedia,
  markServiceGroupsStale,
} from '@/hooks/useServiceMediaGroups';
import {
  applyCategoryGroupMedia,
  markCategoryGroupsStale,
} from '@/hooks/useCategoryMediaGroups';
import {
  applyMediaToPublicPageCaches,
  markPublicPageCachesStale,
} from '@/hooks/usePublicMediaPage';
import { patchMyMediaCache, removeMyMediaFromCache } from '@/hooks/useMyMedia';
import type { MediaItem } from '@/types';

export type MediaUpdateOutcome =
  | { status: 'saved'; item: MediaItem }
  /** Nothing changed — no request was made. */
  | { status: 'noop' }
  /** A save is already in flight (a repeated tap). */
  | { status: 'busy' }
  | { status: 'failed'; failure: MediaUpdateFailure; fieldErrors: MediaUpdateFieldErrors };

/**
 * Push one confirmed item into every cache that may hold it.
 *
 * `becamePublic` is true only when this PATCH turned a private photo public:
 * its position in the public lists is unknown, so those caches are marked stale
 * and never patched by insertion.
 */
export function applyUpdatedMediaToCaches(item: MediaItem, becamePublic = false): void {
  const next = publicDisplayMedia(item, BASE_URL);
  applyServiceGroupMedia(item.id, next);
  applyCategoryGroupMedia(item.id, next);
  applyMediaToPublicPageCaches(item.id, next);
  patchMyMediaCache(item, BASE_URL);
  if (becamePublic) {
    markServiceGroupsStale();
    markCategoryGroupsStale();
    markPublicPageCachesStale();
  }
}

/** A photo that is gone (404) disappears from every cache. */
export function removeMediaFromCaches(id: number): void {
  applyServiceGroupMedia(id, null);
  applyCategoryGroupMedia(id, null);
  applyMediaToPublicPageCaches(id, null);
  removeMyMediaFromCache(id);
}

export default function useUpdateMedia() {
  const [savingId, setSavingId] = useState<number | null>(null);
  const [failure, setFailure] = useState<MediaUpdateFailure | null>(null);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<MediaUpdateFieldErrors>({});
  const busyRef = useRef(false);

  /** Clear the error state (on a new keystroke, or when the form reopens). */
  const reset = useCallback(() => {
    setFailure(null);
    setServerMessage(null);
    setFieldErrors({});
  }, []);

  const mutate = useCallback(
    async (itemId: number, patch: MediaUpdatePatch): Promise<MediaUpdateOutcome> => {
      if (busyRef.current) return { status: 'busy' };
      if (!isValidMediaItemId(itemId)) {
        setFailure('invalid');
        setServerMessage(null);
        setFieldErrors({});
        return { status: 'failed', failure: 'invalid', fieldErrors: {} };
      }
      if (!patch || Object.keys(patch).length === 0) return { status: 'noop' };

      busyRef.current = true;
      setSavingId(itemId);
      setFailure(null);
      setServerMessage(null);
      setFieldErrors({});

      try {
        const raw = await authApi.updateMedia(itemId, patch);
        const updated = normalizeUpdatedMedia(raw);
        if (!updated) {
          // A 200 that is not a media item: nothing is written to any cache.
          console.log('[useUpdateMedia] PATCH returned an unreadable item');
          setFailure('unknown');
          setServerMessage(null);
          return { status: 'failed', failure: 'unknown', fieldErrors: {} };
        }
        applyUpdatedMediaToCaches(updated, patch.is_public === true);
        return { status: 'saved', item: updated };
      } catch (err: any) {
        const status = err?.response?.status;
        const mapped = classifyMediaUpdateFailure(status);
        const data = err?.response?.data;
        const fields = mapped === 'invalid' ? fieldErrorsFromValidation(data) : {};
        console.log(
          '[useUpdateMedia] PATCH /media-gallery/{id} failed',
          status ?? err?.message ?? 'network',
          mapped
        );
        if (mapped === 'not_found') removeMediaFromCaches(itemId);
        setFailure(mapped);
        setFieldErrors(fields);
        setServerMessage(readServerMessage(data));
        return { status: 'failed', failure: mapped, fieldErrors: fields };
      } finally {
        busyRef.current = false;
        setSavingId(null);
      }
    },
    []
  );

  return {
    /** Id of the item being saved, or null. */
    savingId,
    saving: savingId !== null,
    failure,
    /** The server's own short, readable message (never JSON / a status code). */
    serverMessage,
    fieldErrors,
    mutate,
    reset,
  };
}
