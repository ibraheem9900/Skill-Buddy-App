import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { invalidateJobList } from '@/hooks/useJobList';
import { invalidateJobDetail } from '@/hooks/useJobDetail';
import {
  attachmentUploadMimeType,
  attachmentUploadName,
  classifyAttachmentJobFailure,
  isValidJobId,
  validateAttachmentFile,
  type PickedAttachmentFile,
} from '@/lib/jobAttachment';
import type { JobActionFailure } from '@/lib/jobAction';
import type { JobResponse, ValidationErrorDetail } from '@/types';

/**
 * Adds one file to a job (POST /api/v1/jobs/{job_id}/attachments, multipart/form-data,
 * part name `file`).
 *
 * The same shape as the other job actions — a protected request, a busy guard, both
 * caches invalidated, the returned job adopted whole — with the contract details this
 * endpoint brings:
 *
 *  1. the body is **multipart/form-data**, never JSON: the picked file is appended as the
 *     `file` part, exactly the way this project's four existing uploads do it, so React
 *     Native's networking layer builds the multipart header (boundary included). Nothing
 *     is JSON.stringify'd and no `Content-Type: application/json` can slip in;
 *  2. `uploaded_by`-style ownership is derived server-side from the Bearer token, so no
 *     identity field is ever sent;
 *  3. the 201 IS the job (no `{ message, job }` envelope and no `message` field), so the
 *     confirmation copy is written by the caller and the returned job replaces the cached
 *     one — the attachments list is NEVER appended to locally, because the server's copy
 *     (with its own `position` ordering) is the source of truth;
 *  4. the picked file is passed in on EVERY call, so a retry after a network failure
 *     re-uploads exactly the file the user chose — the caller keeps it selected for
 *     precisely this reason;
 *  5. `progress` reports the upload fraction (0..1) when the platform knows the total
 *     size and `null` when it does not, so the screen can show real progress with an
 *     honest indeterminate fallback. It is reset to null on every completion.
 *
 * Double uploads are blocked twice over — `uploading` disables the button and `inFlight`
 * rejects a second call — because a duplicated attachment is exactly what this endpoint
 * would happily accept twice.
 */
export type AttachmentUploadOutcome =
  | { ok: true; job: JobResponse }
  | (({ ok: false } & JobActionFailure) & {
        /**
         * The raw 422 `detail[]`, kept so the screen can put a rejected-`file` message on
         * the chosen file instead of showing a generic error. Absent for every other
         * failure — the bucket copy is used there.
         */
        detail?: ValidationErrorDetail[];
      })
  /** An upload is already running; the caller should not treat this as an error. */
  | { ok: false; kind: 'busy'; message: null };

export function useAddJobAttachment() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const inFlight = useRef(false);

  const addAttachment = useCallback(
    async (jobId: number, file: PickedAttachmentFile): Promise<AttachmentUploadOutcome> => {
      if (inFlight.current) return { ok: false, kind: 'busy', message: null };
      if (!isValidJobId(jobId)) return { ok: false, kind: 'badrequest', message: null };
      // Defence in depth: the screen validates before choosing, but a rejected file must
      // never be uploaded (it would be a pointless round-trip and a pointless 422).
      if (validateAttachmentFile(file) !== null) {
        return { ok: false, kind: 'invalid', message: null };
      }

      inFlight.current = true;
      setUploading(true);
      setProgress(null);
      try {
        const { data } = await authApi.addJobAttachment(
          jobId,
          {
            uri: file.uri,
            name: attachmentUploadName(file),
            mimeType: attachmentUploadMimeType(file),
          },
          (fraction) => setProgress(fraction)
        );
        invalidateJobList();
        invalidateJobDetail(jobId);
        // The 201 IS the job here (no envelope). A malformed payload must never put a
        // bogus object into the screen's state — treat it as a retryable failure instead
        // of adopting `undefined` and wiping the screen.
        if (!data || typeof data !== 'object' || typeof data.id !== 'number') {
          return { ok: false, kind: 'server', message: null };
        }
        return { ok: true, job: data };
      } catch (err) {
        const failure = classifyAttachmentJobFailure(err);
        // Keep the 422 detail[] for field-level mapping (e.g. a rejected file type).
        const rawDetail = (err as { response?: { data?: { detail?: unknown } } } | null | undefined)
          ?.response?.data?.detail;
        const detail = Array.isArray(rawDetail) ? (rawDetail as ValidationErrorDetail[]) : undefined;
        return { ok: false, ...failure, detail };
      } finally {
        inFlight.current = false;
        setUploading(false);
        setProgress(null);
      }
    },
    []
  );

  return { addAttachment, uploading, progress };
}

export default useAddJobAttachment;
