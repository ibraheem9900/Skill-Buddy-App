import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AxiosError } from 'axios';
import {
  MAX_ATTACHMENT_IMAGES,
  classifyImageUploadFailure,
  remainingAttachmentSlots,
  type ImageUploadFailure,
} from '@/lib/imageAttachments';

/**
 * Shared queue for every feedback image uploader (dispute photos, review photos).
 *
 * One upload at a time, in the order the photos were added: mobile networks
 * punish parallel multipart posts, and a failure must never cancel the rest of
 * the queue. Each entry carries its own status so the grid can show progress,
 * an error overlay and a Retry.
 *
 * `ownerId === null` means the row being attached to does not exist yet (the
 * dispute create API is still undocumented, and a review gets its id only after
 * the review itself is submitted). Photos then stay `queued` locally and are NOT
 * sent anywhere.
 *
 * NULL → ID ADOPTION: when a review is submitted, the screen passes the returned
 * review id and the existing queue must survive that transition and start
 * uploading. Changing from one real id to another real id still means a
 * different row and clears the queue.
 *
 * `uploaded` keeps its tile briefly (`removeUploadedDelayMs`) so the user sees
 * the success state while the server copy is being rendered; review photos use
 * 0ms because their uploaded tiles are rendered from the refreshed review.
 */
export type ImageUploadStatus = 'queued' | 'uploading' | 'uploaded' | 'failed';

/** One prepared image, ready to be sent as the multipart `file` part. */
export interface AttachmentImageFile {
  uri: string;
  name: string;
  mimeType: string;
}

export interface LocalImageAttachment extends AttachmentImageFile {
  /** Stable local key (the uri can repeat across retries). */
  key: string;
  status: ImageUploadStatus;
  /** 0..1 while uploading. */
  progress: number;
  failure: ImageUploadFailure | null;
}

export interface ImageAttachmentUploader {
  images: LocalImageAttachment[];
  /** Server-side attachments that count toward the limit. */
  existingCount: number;
  addImages: (files: readonly AttachmentImageFile[]) => { added: number; skipped: number };
  /**
   * Drops a LOCAL (not yet uploaded) photo without any request. Photos owned by
   * the server are removed through useAttachmentRemoval instead.
   */
  remove: (key: string) => void;
  /** Re-queues one failed local photo. */
  retry: (key: string) => void;
  /** Re-queues every failed local photo. */
  retryAll: () => void;
  /** True while a photo is being sent OR waiting to be sent with a real id. */
  uploading: boolean;
  failedCount: number;
  atLimit: boolean;
  remaining: number;
  limit: number;
}

export interface ImageAttachmentUploaderOptions {
  limit?: number;
  /** Defaults to 1400ms for screens whose server list refreshes separately. */
  removeUploadedDelayMs?: number;
  classifyFailure?: (status: number) => ImageUploadFailure;
}

export type UploadImageFn<T> = (
  ownerId: number,
  file: AttachmentImageFile,
  onProgress?: (progress: number) => void
) => Promise<T>;

function failureStatus(error: unknown): number {
  const axiosError = error as AxiosError | undefined;
  if (!axiosError?.isAxiosError) return -1;
  return axiosError.response?.status ?? 0;
}

export function useImageAttachmentUploader<T>(
  ownerId: number | null,
  existingCount: number,
  upload: UploadImageFn<T>,
  onUploaded?: (updated: T) => void,
  options?: ImageAttachmentUploaderOptions
): ImageAttachmentUploader {
  const limit = options?.limit ?? MAX_ATTACHMENT_IMAGES;
  const removeUploadedDelayMs = options?.removeUploadedDelayMs ?? 1400;
  // A stable classifier reference keeps the upload callback from changing on
  // every render of a caller that passes the module function directly.
  const classifyFailure = options?.classifyFailure ?? classifyImageUploadFailure;

  const [images, setImages] = useState<LocalImageAttachment[]>([]);
  const listRef = useRef<LocalImageAttachment[]>([]);
  const busy = useRef(false);
  const counter = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const uploadedRef = useRef(onUploaded);
  const uploadRef = useRef(upload);
  const idRef = useRef(ownerId);

  // Keep the freshest callbacks without re-triggering the upload effect.
  useEffect(() => {
    uploadedRef.current = onUploaded;
  }, [onUploaded]);

  useEffect(() => {
    uploadRef.current = upload;
  }, [upload]);

  useEffect(() => {
    listRef.current = images;
  }, [images]);

  /**
   * null → real id means "the row was just created": ADOPT the new id and keep
   * the queue, which is what makes submit-then-upload work. A different real id
   * is a different row, so the old queue is discarded.
   */
  useEffect(() => {
    if (ownerId === null) {
      idRef.current = null;
      return;
    }
    if (idRef.current === null) {
      idRef.current = ownerId;
      return;
    }
    if (idRef.current === ownerId) return;
    idRef.current = ownerId;
    listRef.current = [];
    setImages([]);
  }, [ownerId]);

  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
    },
    []
  );

  const patch = useCallback((key: string, next: Partial<LocalImageAttachment>) => {
    setImages((prev) => prev.map((item) => (item.key === key ? { ...item, ...next } : item)));
  }, []);

  const dropLater = useCallback(
    (key: string) => {
      // The 201 already carries the new attachment, so the local tile makes way
      // for the server one once the list has had time to refresh.
      const timer = setTimeout(() => {
        setImages((prev) => prev.filter((item) => item.key !== key));
      }, Math.max(0, removeUploadedDelayMs));
      timers.current.push(timer);
    },
    [removeUploadedDelayMs]
  );

  const runNextRef = useRef<() => Promise<void>>(async () => {});

  const runNext = useCallback(async () => {
    const id = idRef.current;
    if (id === null || busy.current) return;
    const next = listRef.current.find((item) => item.status === 'queued');
    if (!next) return;

    busy.current = true;
    patch(next.key, { status: 'uploading', progress: 0, failure: null });
    try {
      const updated = await uploadRef.current(
        id,
        { uri: next.uri, name: next.name, mimeType: next.mimeType },
        (progress) => patch(next.key, { progress })
      );
      patch(next.key, { status: 'uploaded', progress: 1 });
      uploadedRef.current?.(updated);
      dropLater(next.key);
    } catch (error) {
      const status = failureStatus(error);
      patch(next.key, {
        status: 'failed',
        progress: 0,
        // A response that is not even an axios error is the unexpected-body
        // case: report it as a rejected file rather than a network problem.
        failure: status === -1 ? 'invalid' : classifyFailure(status),
      });
    } finally {
      busy.current = false;
      // Continue with the rest of the queue, regardless of this one's outcome.
      void runNextRef.current();
    }
  }, [classifyFailure, dropLater, patch]);

  useEffect(() => {
    runNextRef.current = runNext;
  }, [runNext]);

  // Kick the queue whenever a photo is waiting and a real id exists.
  useEffect(() => {
    if (ownerId === null) return;
    if (images.some((item) => item.status === 'queued')) void runNext();
  }, [ownerId, images, runNext]);

  const addImages = useCallback(
    (files: readonly AttachmentImageFile[]) => {
      const existingUris = new Set(listRef.current.map((item) => item.uri));
      const slots = remainingAttachmentSlots(
        existingCount,
        listRef.current.length,
        limit
      );
      const additions: LocalImageAttachment[] = [];
      let skipped = 0;
      for (const file of files) {
        if (additions.length >= slots) {
          skipped += 1;
          continue;
        }
        if (existingUris.has(file.uri)) {
          skipped += 1;
          continue;
        }
        existingUris.add(file.uri);
        counter.current += 1;
        additions.push({
          ...file,
          key: `${file.uri}#${counter.current}`,
          status: 'queued',
          progress: 0,
          failure: null,
        });
      }
      if (additions.length > 0) setImages((prev) => [...prev, ...additions]);
      return { added: additions.length, skipped };
    },
    [existingCount, limit]
  );

  const remove = useCallback((key: string) => {
    setImages((prev) =>
      prev.filter((item) => item.key !== key || item.status === 'uploading')
    );
  }, []);

  const retry = useCallback(
    (key: string) => {
      patch(key, { status: 'queued', progress: 0, failure: null });
    },
    [patch]
  );

  const retryAll = useCallback(() => {
    setImages((prev) =>
      prev.map((item) =>
        item.status === 'failed'
          ? { ...item, status: 'queued', progress: 0, failure: null }
          : item
      )
    );
  }, []);

  const { uploading, failedCount } = useMemo(() => {
    const failed = images.filter((item) => item.status === 'failed').length;
    const pending =
      images.some((item) => item.status === 'uploading') ||
      (ownerId !== null && images.some((item) => item.status === 'queued'));
    return { uploading: pending, failedCount: failed };
  }, [ownerId, images]);

  const remaining = remainingAttachmentSlots(existingCount, images.length, limit);

  return {
    images,
    existingCount,
    addImages,
    remove,
    retry,
    retryAll,
    uploading,
    failedCount,
    atLimit: remaining === 0,
    remaining,
    limit,
  };
}

export default useImageAttachmentUploader;
