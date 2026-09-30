import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobList } from '@/hooks/useJobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import { classifyAttachmentJobFailure, isValidJobId } from '@/lib/jobAttachment';
import type { JobActionFailure } from '@/lib/jobAction';
import type { ValidationErrorDetail } from '@/types';

/**
 * Removes ONE attachment from a job
 * (DELETE /api/v1/jobs/{job_id}/attachments/{attachment_id}).
 *
 * SHAPE OF THE CONTRACT, and why this hook looks different from the other job actions:
 *
 *  1. the success response is **204 NO CONTENT** — there is no body, so nothing is read
 *     from it and NOTHING is assumed. Every other job action hands back a job object this
 *     could adopt; this one cannot, so the caller patches its own cached job instead
 *     (filtering the attachment out BY ID) and invalidates the job caches so the next read
 *     re-confirms against the server. The patch is applied by the CALLER and only after
 *     this hook reports `ok`, so the list is never changed optimistically.
 *  2. the attachment id travels in the PATH (its own `id` from `JobAttachmentResponse`),
 *     not in a body — and both ids are validated here as well as in the api method, so an
 *     invalid id can never produce a pointless round trip.
 *  3. a **404 means the attachment is already gone**: that comes back as `kind:
 *     'notfound'` for the caller to report as a soft "already removed" state (and sync
 *     local state with), NOT as an error.
 *
 * `removingId` carries the id currently being removed (null when idle) so a list can
 * disable/spin exactly the row in flight, and a second call for a DIFFERENT row is
 * refused by the in-flight guard rather than being allowed to interleave two deletions.
 */
export type RemoveAttachmentOutcome =
  | { ok: true }
  | (({ ok: false } & JobActionFailure) & {
        /** The raw 422 `detail[]`, kept for the caller's error mapping. */
        detail?: ValidationErrorDetail[];
      })
  /** A removal is already running; the caller should not treat this as an error. */
  | { ok: false; kind: 'busy'; message: null };

export function useRemoveJobAttachment() {
  const [removingId, setRemovingId] = useState<number | null>(null);
  const inFlight = useRef(false);

  const removeAttachment = useCallback(
    async (jobId: number, attachmentId: number): Promise<RemoveAttachmentOutcome> => {
      if (inFlight.current) return { ok: false, kind: 'busy', message: null };
      if (!isValidJobId(jobId) || !isValidJobId(attachmentId)) {
        return { ok: false, kind: 'badrequest', message: null };
      }

      inFlight.current = true;
      setRemovingId(attachmentId);
      try {
        await authApi.removeJobAttachment(jobId, attachmentId);
        // 204 → the record is gone. The caller removes it from the job it holds; these
        // invalidations make the next list/detail read re-confirm from the server.
        invalidateJobList();
        invalidateJobDetail(jobId);
        return { ok: true };
      } catch (err) {
        const failure = classifyAttachmentJobFailure(err);
        // Keep the 422 detail[] so a rejected removal can be worded specifically.
        const rawDetail = (err as { response?: { data?: { detail?: unknown } } } | null | undefined)
          ?.response?.data?.detail;
        const detail = Array.isArray(rawDetail) ? (rawDetail as ValidationErrorDetail[]) : undefined;
        return { ok: false, ...failure, detail };
      } finally {
        inFlight.current = false;
        setRemovingId(null);
      }
    },
    []
  );

  return { removeAttachment, removingId };
}

export default useRemoveJobAttachment;
