import {
  classifyJobActionFailure,
  isJobActionRefused,
  isJobActionUnauthorized,
  type JobActionFailureKind,
} from '@/lib/jobAction';
import { isJobCancelledStatus, isJobCompleted } from '@/lib/jobDetail';
import { isValidJobId } from '@/lib/jobPublish';
import type { JobApiStatus, JobAttachmentResponse, JobResponse, ValidationErrorDetail } from '@/types';

/**
 * POST /api/v1/jobs/{job_id}/attachments — pure rules, no React, no network, no file
 * system. Swagger title: "Add Attachment".
 *
 * WHAT THE LIVE OPENAPI ACTUALLY SAYS (read from openapi.json, not inferred from the
 * Swagger UI):
 *   - `security: [{OAuth2PasswordBearer: []}]` — the Bearer token is mandatory
 *   - exactly ONE parameter: the required integer path `job_id`
 *   - a **REQUIRED `multipart/form-data` body** (schema
 *     `Body_add_attachment_api_v1_jobs__job_id__attachments_post`) with exactly ONE
 *     property, `file` (required, `type: string`, `contentMediaType:
 *     application/octet-stream`). It is NOT JSON, and the part is named `file` — the
 *     same field name the other uploads in this app use (profile picture, residence
 *     permits, face video, certification).
 *   - its 201 is the **JobResponse DIRECTLY** (no `{ message, job }` envelope and no
 *     `message` field), and 422 is HTTPValidationError.
 *   - the operation declares NO description and no property carries one, so NOTHING
 *     about the server-side effect is asserted here.
 *   - the 201 example renders `attachments: []` — that is FastAPI's generic placeholder
 *     for an array, NOT proof that nothing was stored. The REAL entry shape is in the
 *     spec's own schema, `JobAttachmentResponse`: required `id` (integer), `media_type`
 *     (string, UNCONSTRAINED — no enum anywhere in the document), `position` (integer),
 *     `created_at` (date-time), plus optional/nullable `media_url`. It already matches
 *     `JobAttachmentResponse` in types/index.ts, which is what the Job Details list
 *     renders — so no shape is guessed here.
 *   - VERIFIED LIVE (no token): POST → 401 {"detail":"Not authenticated"}; GET on the
 *     same path → 405, so POST is the registered method (DELETE on the same path is the
 *     sibling Remove Attachment endpoint, deliberately NOT used here).
 *
 * NO WRAPPER, SO THE WHOLE JOB IS ADOPTED. Because the 201 is the full job, the caller
 * replaces its cached copy with the response instead of appending the new file to a local
 * array — the attachments list, position ordering, flags and status_history all stay in
 * sync with the server by construction.
 *
 * WHO MAY ATTACH: `uploaded_by` / owner is derived server-side from the Bearer token (the
 * schema has no such field and none is ever sent by the app). The contract does not say
 * whether the client, the provider or both may attach, so the gate is deliberately
 * role-free like Report Blocker — the backend authorises the real party, and a refusal
 * (403/404/400/409) is surfaced as its own message with a re-sync rather than being
 * pre-empted by a guess.
 *
 * WHICH STATUSES ALLOW ATTACHMENTS: also undocumented. The only honest line that can be
 * drawn from the data is TERMINAL — a cancelled or completed job is refused client-side,
 * and everything else is offered and left to the server to accept or refuse. Its refusal
 * gets its own copy ("this job can no longer take attachments") plus a job re-read.
 *
 * CLIENT-SIDE LIMITS (flagged for the team — the spec documents none):
 *   - MIME/extension allow-list covering the image types expo-image-picker can hand back
 *     (iOS camera photos are commonly HEIC), matching the app's existing upload
 *     convention;
 *   - `ATTACHMENT_MAX_BYTES` per file. Both are guards only — the backend is the final
 *     judge and its own 422 text is what the user sees.
 *   - There is NO attachments-count limit in the contract, so none is invented.
 */

/** Re-export so callers have one import for the whole action. */
export { isValidJobId };

/**
 * Accepted MIME types. Mirrors the app's existing image-upload allow-list
 * (useCertificationUpload) widened with the HEIC/HEIF pair iOS cameras produce — the
 * backend remains the final judge and its 422 reaches the user verbatim.
 */
export const ATTACHMENT_ALLOWED_MIME: readonly string[] = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

/** Accepted extensions, used only when the picker reports no MIME type. */
export const ATTACHMENT_ALLOWED_EXT: readonly string[] = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'heic',
  'heif',
] as const;

/**
 * Per-file size cap. The contract documents none; this is a client-side guard so an
 * obviously oversized pick fails instantly instead of after a slow upload. 10 MB covers a
 * modern phone photo with headroom.
 */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Multipart timeout — uploads are far slower than the 15s JSON default. */
export const ATTACHMENT_UPLOAD_TIMEOUT_MS = 120000;

/** Minimal shape of whatever the device picker handed us. */
export interface PickedAttachmentFile {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}

export type AttachmentFileErrorKey =
  | 'jobd_attach_err_nofile'
  | 'jobd_attach_err_type'
  | 'jobd_attach_err_size';

/** The extension of a file name, lower-cased, or '' when there is none. */
export function attachmentExtension(fileName: string | null | undefined): string {
  const raw = typeof fileName === 'string' ? fileName.trim() : '';
  const dot = raw.lastIndexOf('.');
  if (dot < 0 || dot === raw.length - 1) return '';
  return raw.slice(dot + 1).toLowerCase();
}

/**
 * Validate a picked file BEFORE any network call.
 *
 * The MIME type wins when the picker reported one; otherwise the extension decides. A
 * file with NEITHER is accepted (nothing to judge it by — the server gets the final say)
 * but an empty/absent uri never is: there is nothing to upload.
 */
export function validateAttachmentFile(
  file: PickedAttachmentFile | null | undefined
): AttachmentFileErrorKey | null {
  if (!file || typeof file.uri !== 'string' || file.uri.trim().length === 0) {
    return 'jobd_attach_err_nofile';
  }
  if (file.fileSize != null && Number.isFinite(file.fileSize) && file.fileSize > ATTACHMENT_MAX_BYTES) {
    return 'jobd_attach_err_size';
  }

  const mime = typeof file.mimeType === 'string' ? file.mimeType.trim().toLowerCase() : '';
  if (mime) {
    // A picker that reports an explicit type is trusted to be right about it.
    const okMime = ATTACHMENT_ALLOWED_MIME.includes(mime) || mime.startsWith('image/');
    if (!okMime) return 'jobd_attach_err_type';
    return null;
  }

  const ext = attachmentExtension(file.fileName);
  if (ext && !ATTACHMENT_ALLOWED_EXT.includes(ext)) return 'jobd_attach_err_type';
  return null;
}

/**
 * The multipart part's file name. React Native needs a non-empty `name` to build the
 * part; when the picker gave nothing usable we fall back to a stable name so the part is
 * still well-formed (the server derives identity from the token, not the file name).
 */
export function attachmentUploadName(file: PickedAttachmentFile): string {
  const raw = typeof file.fileName === 'string' ? file.fileName.trim() : '';
  if (raw) return raw;
  const fromUri = file.uri.split('/').pop() ?? '';
  return fromUri.trim() || 'attachment.jpg';
}

/** The multipart MIME type. Defaults to image/jpeg when the picker reported none. */
export function attachmentUploadMimeType(file: PickedAttachmentFile): string {
  const raw = typeof file.mimeType === 'string' ? file.mimeType.trim() : '';
  return raw || 'image/jpeg';
}

/** 1234567 → "1.2 MB", 20480 → "20 KB". Used for the picked-file line. */
export function formatAttachmentSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The attachment list in display order: `position` ascending, ties broken by id — the
 * same ordering the Job Details screen already uses, kept here so both the screen and its
 * tests share one rule. Safe with null/undefined.
 */
export function sortAttachments(
  items: JobAttachmentResponse[] | null | undefined
): JobAttachmentResponse[] {
  if (!Array.isArray(items)) return [];
  return [...items].sort((a, b) => a.position - b.position || a.id - b.id);
}

/** Statuses that can NEVER take a new attachment (terminal ones only — see header). */
export const ATTACHMENT_BLOCKED_STATUSES: readonly JobApiStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_PROVIDER',
] as const;

/**
 * Whether "Add Attachment" may be OFFERED: a real job id, not cancelled (status OR the
 * `cancelled_at` stamp) and not completed. Everything else is offered and left to the
 * backend — the contract never says which statuses accept an upload.
 *
 * Takes NO role on purpose: the spec does not say whether the client, the provider or
 * both may attach, and `uploaded_by` is derived from the Bearer token server-side.
 */
export function canAddJobAttachment(
  job:
    | Pick<
        JobResponse,
        'id' | 'status' | 'cancelled_at' | 'completed_at'
      >
    | null
    | undefined
): boolean {
  if (!job) return false;
  if (!isValidJobId(job.id)) return false;
  if (isJobCancelledStatus(job)) return false;
  if (isJobCompleted(job)) return false;
  if (ATTACHMENT_BLOCKED_STATUSES.includes(job.status)) return false;
  return true;
}

/**
 * True for the buckets that mean "the server refused because the job cannot take an
 * attachment right now" — these get their own copy instead of a generic error.
 */
export function isAttachmentNotAllowed(kind: JobActionFailureKind): boolean {
  return kind === 'badrequest' || kind === 'conflict';
}


/**
 * Whether the screen should re-read the job after a failure.
 *
 * A refusal or a 403/404 means the state this screen gated on is stale — that is WHY the
 * backend said no — so the cached job is re-synced. A 422 stays out on purpose: it
 * normally means the FILE was rejected (wrong type, too large), which re-reading the job
 * cannot fix.
 */
export function shouldResyncAfterAttachmentFailure(kind: JobActionFailureKind): boolean {
  return isAttachmentNotAllowed(kind) || isJobActionRefused(kind);
}

/**
 * Whether a network failure was in fact already carried out by the server.
 *
 * An upload whose response was lost may still have been processed. Unlike a status
 * change, ADDING AN ATTACHMENT IS COUNTABLE, so the caller re-reads the job and compares
 * the attachment count with the one held before the upload: MORE entries than before
 * means the file landed and nobody should be asked to upload it again. `refetched` is
 * null when the re-read itself failed, in which case nothing is claimed and the normal
 * network error + retry path applies (the picked file stays selected either way).
 */
export function attachmentAddedAfterResync(
  before: Pick<JobResponse, 'attachments'> | null | undefined,
  refetched: Pick<JobResponse, 'attachments'> | null | undefined
): boolean {
  if (!before || !refetched) return false;
  const beforeCount = Array.isArray(before.attachments) ? before.attachments.length : 0;
  const afterCount = Array.isArray(refetched.attachments) ? refetched.attachments.length : 0;
  return afterCount > beforeCount;
}

/** A 401 that survived the shared client's refresh + single replay → login. */
export { isJobActionUnauthorized as isAttachmentUnauthorized };

export type AttachmentErrorKey =
  | 'jobd_attach_err_invalid'
  | 'jobd_attach_err_notallowed'
  | 'jobd_attach_err_forbidden'
  | 'jobd_attach_err_notfound'
  | 'jobd_attach_err_server'
  | 'jobd_attach_err_network';

/**
 * Translated copy per bucket. 400 and 409 share the "can no longer take attachments"
 * copy; `unauthorized` is absent because it never reaches the UI (the caller sends the
 * user to login, the same rule the other job actions use), and `unknown` falls through to
 * the generic server copy.
 */
export function attachmentErrorKey(kind: JobActionFailureKind): AttachmentErrorKey {
  switch (kind) {
    case 'invalid':
      return 'jobd_attach_err_invalid';
    case 'badrequest':
    case 'conflict':
      return 'jobd_attach_err_notallowed';
    case 'forbidden':
      return 'jobd_attach_err_forbidden';
    case 'notfound':
      return 'jobd_attach_err_notfound';
    case 'network':
      return 'jobd_attach_err_network';
    default:
      return 'jobd_attach_err_server';
  }
}

/**
 * The body copy for a failure: the backend's own message when it sent one (a 422
 * `detail[].msg`, or a plain-string `detail`), otherwise the translated copy for the
 * bucket — so the server's exact reason for refusing an upload reaches the user as
 * worded.
 */
export function attachmentFailureMessage(
  failure: { kind: JobActionFailureKind; message: string | null },
  translate: (key: AttachmentErrorKey) => string
): string {
  return failure.message ?? translate(attachmentErrorKey(failure.kind));
}

/**
 * Pull the server's message about the uploaded FILE out of a 422 `detail[]`, so a
 * rejected upload is shown against the file instead of as a generic failure.
 *
 * The multipart part is named `file`, so that is what the `loc` path is matched on.
 */
export function attachmentFileFieldError(
  detail: ValidationErrorDetail[] | null | undefined
): string | null {
  if (!Array.isArray(detail)) return null;
  for (const entry of detail) {
    if (!entry || !Array.isArray(entry.loc)) continue;
    if (entry.loc.some((part) => part === 'file') && entry.msg) return entry.msg;
  }
  return null;
}

/**
 * Whether a 422 for the uploaded file looks like a TYPE or a SIZE rejection, so the
 * screen can point at the right client-side guard instead of parroting raw validation
 * jargon. Returns null when the message says neither (the caller then shows the raw text).
 */
export function classifyFileRejection(
  message: string | null | undefined
): 'type' | 'size' | null {
  const raw = typeof message === 'string' ? message : '';
  if (!raw) return null;
  if (/size|length|large|limit|exceed/i.test(raw)) return 'size';
  if (/type|content|mime|format|extension/i.test(raw)) return 'type';
  return null;
}

/** Bucket a rejected attachment upload (delegates to the shared core). */
export { classifyJobActionFailure as classifyAttachmentJobFailure };
