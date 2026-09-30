/**
 * Unit tests for Add Attachment (POST /api/v1/jobs/{job_id}/attachments,
 * multipart/form-data, part name `file`).
 *
 * Run through the project's own harness: `pnpm run test`. No React, no axios, no
 * network, no file system — only the rules that decide WHICH FILES pass the local guard,
 * WHEN the action may be offered, what the multipart part is named, how a failure is
 * bucketed and worded, and how a lost upload response is resolved by comparing the
 * attachment COUNT before and after a re-read.
 */
import {
  ATTACHMENT_ALLOWED_EXT,
  ATTACHMENT_ALLOWED_MIME,
  ATTACHMENT_BLOCKED_STATUSES,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_UPLOAD_TIMEOUT_MS,
  attachmentAddedAfterResync,
  attachmentErrorKey,
  attachmentExtension,
  attachmentFailureMessage,
  attachmentFileFieldError,
  attachmentUploadMimeType,
  attachmentUploadName,
  canAddJobAttachment,
  classifyAttachmentJobFailure,
  classifyFileRejection,
  formatAttachmentSize,
  isAttachmentNotAllowed,
  isAttachmentUnauthorized,
  isValidJobId,
  shouldResyncAfterAttachmentFailure,
  sortAttachments,
  validateAttachmentFile,
} from '../jobAttachment';
import type { JobActionFailureKind } from '../jobAction';
import type { JobApiStatus, JobAttachmentResponse } from '../../types';

declare const console: { log: (msg: string) => void };

let passed = 0;
export const failures: string[] = [];

function check(label: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(label);
}

function eq(label: string, actual: unknown, expected: unknown): void {
  check(
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    actual === expected
  );
}

type AttachableJob = Parameters<typeof canAddJobAttachment>[0];

const active = {
  id: 42,
  status: 'IN_PROGRESS' as JobApiStatus,
  cancelled_at: null as string | null,
  completed_at: null as string | null,
};
const job = (over: Partial<NonNullable<AttachableJob>>) =>
  ({ ...active, ...over }) as AttachableJob;

/* ------------------------------------------------------------ the limits (client-side) */
eq('the size cap is 10 MB', ATTACHMENT_MAX_BYTES, 10 * 1024 * 1024);
eq('the multipart timeout is 120s', ATTACHMENT_UPLOAD_TIMEOUT_MS, 120000);
check('jpeg is an accepted MIME type', ATTACHMENT_ALLOWED_MIME.includes('image/jpeg'));
check('png is an accepted MIME type', ATTACHMENT_ALLOWED_MIME.includes('image/png'));
check('webp is an accepted MIME type', ATTACHMENT_ALLOWED_MIME.includes('image/webp'));
check('heic is an accepted MIME type (iOS camera photos)', ATTACHMENT_ALLOWED_MIME.includes('image/heic'));
check('pdf is NOT in the MIME allow-list (expo-document-picker is not installed)', !ATTACHMENT_ALLOWED_MIME.includes('application/pdf'));
check('heic is an accepted extension', ATTACHMENT_ALLOWED_EXT.includes('heic'));
check('pdf is NOT an accepted extension', !ATTACHMENT_ALLOWED_EXT.includes('pdf'));

/* ------------------------------------------------------------------ file validation */
eq('a null file is rejected before upload', validateAttachmentFile(null), 'jobd_attach_err_nofile');
eq('an undefined file is rejected before upload', validateAttachmentFile(undefined), 'jobd_attach_err_nofile');
eq('a file with no uri is rejected', validateAttachmentFile({ uri: '' }), 'jobd_attach_err_nofile');
eq('a whitespace-only uri is rejected', validateAttachmentFile({ uri: '   ' }), 'jobd_attach_err_nofile');
eq('a jpeg passes', validateAttachmentFile({ uri: 'file:///a.jpg', mimeType: 'image/jpeg' }), null);
eq('a png passes', validateAttachmentFile({ uri: 'file:///a.png', mimeType: 'image/png' }), null);
eq('a webp passes', validateAttachmentFile({ uri: 'file:///a.webp', mimeType: 'image/webp' }), null);
eq('an upper-case MIME type still passes', validateAttachmentFile({ uri: 'file:///a.jpg', mimeType: 'IMAGE/JPEG' }), null);
eq('a heic photo passes', validateAttachmentFile({ uri: 'file:///a.heic', mimeType: 'image/heic' }), null);
eq(
  'an unlisted but still-image/* MIME passes (the backend is the final judge)',
  validateAttachmentFile({ uri: 'file:///a.bmp', mimeType: 'image/bmp' }),
  null
);
eq(
  'a non-image MIME is rejected locally',
  validateAttachmentFile({ uri: 'file:///a.pdf', mimeType: 'application/pdf' }),
  'jobd_attach_err_type'
);
eq(
  'a video MIME is rejected locally',
  validateAttachmentFile({ uri: 'file:///a.mov', mimeType: 'video/quicktime' }),
  'jobd_attach_err_type'
);
eq(
  'with no MIME type the extension decides — bad extension rejected',
  validateAttachmentFile({ uri: 'file:///a.pdf', fileName: 'contract.pdf', mimeType: null }),
  'jobd_attach_err_type'
);
eq(
  'with no MIME type the extension decides — good extension accepted',
  validateAttachmentFile({ uri: 'file:///a.JPG', fileName: 'photo.JPG', mimeType: null }),
  null
);
eq(
  'with neither MIME nor extension nothing is blocked locally',
  validateAttachmentFile({ uri: 'file:///noext' }),
  null
);
eq(
  'a file exactly at the size cap passes',
  validateAttachmentFile({ uri: 'file:///a.jpg', mimeType: 'image/jpeg', fileSize: ATTACHMENT_MAX_BYTES }),
  null
);
eq(
  'a file one byte over the cap is rejected as too large',
  validateAttachmentFile({ uri: 'file:///a.jpg', mimeType: 'image/jpeg', fileSize: ATTACHMENT_MAX_BYTES + 1 }),
  'jobd_attach_err_size'
);
eq(
  'size is checked before type (an oversized PDF reports size)',
  validateAttachmentFile({ uri: 'file:///a.pdf', mimeType: 'application/pdf', fileSize: ATTACHMENT_MAX_BYTES + 1 }),
  'jobd_attach_err_size'
);
eq(
  'an unknown size does not block the upload',
  validateAttachmentFile({ uri: 'file:///a.jpg', mimeType: 'image/jpeg', fileSize: null }),
  null
);

/* ------------------------------------------------------------- name / type helpers */
eq('the extension is lower-cased', attachmentExtension('photo.JPG'), 'jpg');
eq('a multi-dot name takes the last part', attachmentExtension('my.photo.one.jpeg'), 'jpeg');
eq('a name with no dot has no extension', attachmentExtension('photo'), '');
eq('a trailing dot has no extension', attachmentExtension('photo.'), '');
eq('a null name has no extension', attachmentExtension(null), '');
eq('the upload name uses the picker file name', attachmentUploadName({ uri: 'file:///x/y.jpg', fileName: 'y.jpg' }), 'y.jpg');
eq('the upload name trims', attachmentUploadName({ uri: 'file:///x/y.jpg', fileName: '  y.jpg  ' }), 'y.jpg');
eq('the upload name falls back to the uri basename', attachmentUploadName({ uri: 'file:///x/y.jpg' }), 'y.jpg');
eq('the upload name has a stable last resort', attachmentUploadName({ uri: 'file:///x/' }), 'attachment.jpg');
eq('the multipart type uses the picker MIME type', attachmentUploadMimeType({ uri: 'u', mimeType: 'image/png' }), 'image/png');
eq('the multipart type falls back to image/jpeg', attachmentUploadMimeType({ uri: 'u' }), 'image/jpeg');

/* --------------------------------------------------------------- size formatting */
eq('an unknown size formats to nothing', formatAttachmentSize(null), null);
eq('an undefined size formats to nothing', formatAttachmentSize(undefined), null);
eq('a negative size formats to nothing', formatAttachmentSize(-1), null);
eq('bytes stay bytes', formatAttachmentSize(512), '512 B');
eq('kilobytes are rounded', formatAttachmentSize(2048), '2 KB');
eq('megabytes get one decimal', formatAttachmentSize(1572864), '1.5 MB');
eq('the cap reads as 10.0 MB', formatAttachmentSize(ATTACHMENT_MAX_BYTES), '10.0 MB');

/* ------------------------------------------------------------- ordering the list */
const att = (id: number, position: number) => ({
  id,
  media_type: 'image/jpeg',
  media_url: `https://cdn/${id}.jpg`,
  position,
  created_at: '2026-09-30T18:00:00Z',
}) as JobAttachmentResponse;
eq('a null list sorts to an empty list', sortAttachments(null).length, 0);
eq('an undefined list sorts to an empty list', sortAttachments(undefined).length, 0);
eq(
  'attachments sort by position, ties by id',
  sortAttachments([att(3, 2), att(1, 0), att(2, 1)]).map((a) => a.id).join(','),
  '1,2,3'
);
eq(
  'equal positions fall back to id order',
  sortAttachments([att(9, 1), att(4, 1)]).map((a) => a.id).join(','),
  '4,9'
);
eq('sorting does not mutate the original array', (() => {
  const input = [att(2, 1), att(1, 0)];
  sortAttachments(input);
  return input.map((a) => a.id).join(',');
})(), '2,1');

/* ------------------------------------------------------------------- gating */
eq('an in-progress job accepts an attachment', canAddJobAttachment(active), true);
eq('an assigned-but-unstarted job accepts an attachment', canAddJobAttachment(job({ status: 'PROVIDER_ASSIGNED' })), true);
eq('a draft job is offered (the screen does not guess the backend rule)', canAddJobAttachment(job({ status: 'DRAFT' })), true);
eq('a bidding job is offered', canAddJobAttachment(job({ status: 'OPEN' })), true);
eq('a paused job is offered', canAddJobAttachment(job({ status: 'PAUSED_BY_CLIENT' })), true);
eq('a blocked job is offered (attachments can document the block)', canAddJobAttachment(job({ status: 'BLOCKED' })), true);
eq('a completed job is refused client-side', canAddJobAttachment(job({ status: 'COMPLETED', completed_at: '2026-09-30T10:00:00Z' })), false);
eq('a completion stamp alone refuses the action', canAddJobAttachment(job({ completed_at: '2026-09-30T10:00:00Z' })), false);
eq('a cancelled job is refused client-side', canAddJobAttachment(job({ status: 'CANCELLED' })), false);
eq('a cancellation stamp alone refuses the action', canAddJobAttachment(job({ cancelled_at: '2026-09-30T10:00:00Z' })), false);
eq('a client-cancelled job is refused', canAddJobAttachment(job({ status: 'CANCELLED_BY_CLIENT' })), false);
eq('a provider-cancelled job is refused', canAddJobAttachment(job({ status: 'CANCELLED_BY_PROVIDER' })), false);
eq('an invalid job id (0) refuses the action', canAddJobAttachment(job({ id: 0 })), false);
eq('a non-integer job id refuses the action', canAddJobAttachment(job({ id: 1.5 })), false);
eq('a null job is refused', canAddJobAttachment(null), false);
eq('an undefined job is refused', canAddJobAttachment(undefined), false);
eq(
  'only terminal statuses are blocked',
  ATTACHMENT_BLOCKED_STATUSES.join(','),
  'COMPLETED,CANCELLED,CANCELLED_BY_CLIENT,CANCELLED_BY_PROVIDER'
);

/* The full status sweep: 14 statuses, 4 terminal ones blocked, so 10 are offered and the
   backend decides the rest. */
const offered = (
  [
    'DRAFT',
    'OPEN',
    'PAYMENT_PENDING',
    'PROVIDER_ASSIGNED',
    'IN_PROGRESS',
    'DECLINED_BY_PROVIDER',
    'DECLINED_BY_CLIENT',
    'PAUSED_BY_CLIENT',
    'PAUSED_BY_PROVIDER',
    'BLOCKED',
    'COMPLETED',
    'CANCELLED',
    'CANCELLED_BY_CLIENT',
    'CANCELLED_BY_PROVIDER',
  ] as JobApiStatus[]
).filter((status) => canAddJobAttachment(job({ status }))).length;
eq('10 of the 14 statuses are offered, the 4 terminal ones are not', offered, 10);

/* ------------------------------------------------- failure classification */
const http = (status: number) => ({ isAxiosError: true, response: { status } });
const bucket = (status: number): JobActionFailureKind => classifyAttachmentJobFailure(http(status)).kind;
eq('400 → badrequest', bucket(400), 'badrequest');
eq('401 → unauthorized', bucket(401), 'unauthorized');
eq('403 → forbidden', bucket(403), 'forbidden');
eq('404 → notfound', bucket(404), 'notfound');
eq('409 → conflict', bucket(409), 'conflict');
eq('413 → unknown (undocumented, falls back to the generic copy)', bucket(413), 'unknown');
eq('422 → invalid', bucket(422), 'invalid');
eq('500 → server', bucket(500), 'server');
eq('no response → network', classifyAttachmentJobFailure(new Error('offline')).kind, 'network');
eq(
  'a plain {detail: "..."} message is carried through verbatim',
  classifyAttachmentJobFailure({
    isAxiosError: true,
    response: { status: 413, data: { detail: 'File too large' } },
  }).message,
  'File too large'
);
eq('401 is the unauthorized bucket', isAttachmentUnauthorized('unauthorized'), true);
eq('409 is not unauthorized', isAttachmentUnauthorized('conflict'), false);

/* ------------------------------------------------------- refusal + re-sync */
eq('400 is a not-allowed bucket', isAttachmentNotAllowed('badrequest'), true);
eq('409 is a not-allowed bucket', isAttachmentNotAllowed('conflict'), true);
eq('404 is NOT the not-allowed bucket', isAttachmentNotAllowed('notfound'), false);
eq('network is NOT a not-allowed bucket', isAttachmentNotAllowed('network'), false);
eq('400 re-syncs the job', shouldResyncAfterAttachmentFailure('badrequest'), true);
eq('409 re-syncs the job', shouldResyncAfterAttachmentFailure('conflict'), true);
eq('403 re-syncs the job (stale ownership/state)', shouldResyncAfterAttachmentFailure('forbidden'), true);
eq('404 re-syncs the job', shouldResyncAfterAttachmentFailure('notfound'), true);
eq('422 does NOT re-sync (the FILE was rejected — re-reading cannot fix it)', shouldResyncAfterAttachmentFailure('invalid'), false);
eq('server does NOT re-sync', shouldResyncAfterAttachmentFailure('server'), false);
eq('network does NOT re-sync here (handled separately)', shouldResyncAfterAttachmentFailure('network'), false);

/* --------------------------------------------- lost response after a timeout */
eq(
  'one more attachment than before a lost response → the upload landed',
  attachmentAddedAfterResync({ attachments: [] }, { attachments: [att(1, 0)] }),
  true
);
eq(
  'the same number of attachments → the upload really failed',
  attachmentAddedAfterResync({ attachments: [att(1, 0)] }, { attachments: [att(1, 0)] }),
  false
);
eq(
  'fewer attachments than before → nothing was added',
  attachmentAddedAfterResync({ attachments: [att(1, 0), att(2, 1)] }, { attachments: [att(1, 0)] }),
  false
);
eq(
  'a null "before" (no cached job) claims nothing',
  attachmentAddedAfterResync(null, { attachments: [att(1, 0)] }),
  false
);
eq('a failed re-read claims nothing', attachmentAddedAfterResync({ attachments: [] }, null), false);
eq(
  'missing attachment arrays count as zero on both sides',
  attachmentAddedAfterResync({ attachments: undefined }, { attachments: undefined }),
  false
);

/* ------------------------------------------------------------ 422 → the file */
eq(
  'a file-level 422 maps onto the chosen file',
  attachmentFileFieldError([
    { loc: ['body', 'file'], msg: 'File type not allowed', type: 'value_error' },
  ]),
  'File type not allowed'
);
eq(
  'a message about another field does not land on the file',
  attachmentFileFieldError([{ loc: ['body', 'job_id'], msg: 'Input should be a valid integer', type: 'int_parsing' }]),
  null
);
eq('no detail array maps to nothing', attachmentFileFieldError(null), null);
eq('a non-array detail maps to nothing', attachmentFileFieldError({} as any), null);
eq('an entry without a message maps to nothing', attachmentFileFieldError([{ loc: ['body', 'file'], msg: '', type: 'x' }]), null);

/* -------------------------------------------- 422 wording → the right local guard */
eq('a size-worded rejection is recognised', classifyFileRejection('File is too large'), 'size');
eq('a limit-worded rejection is recognised', classifyFileRejection('Upload exceeds the allowed limit'), 'size');
eq('a plain "characters" message is NOT read as a file-size rejection', classifyFileRejection('String should have at most 1000 characters'), null);
eq('a type-worded rejection is recognised', classifyFileRejection('Invalid file type'), 'type');
eq('a mime-worded rejection is recognised', classifyFileRejection('Unsupported content type'), 'type');
eq('an unrelated rejection is not classified', classifyFileRejection('Something else entirely'), null);
eq('an empty rejection is not classified', classifyFileRejection(''), null);
eq('a null rejection is not classified', classifyFileRejection(null), null);

/* --------------------------------------------------------------------- copy */
eq('422 copy key', attachmentErrorKey('invalid'), 'jobd_attach_err_invalid');
eq('400 copy key', attachmentErrorKey('badrequest'), 'jobd_attach_err_notallowed');
eq('409 copy key', attachmentErrorKey('conflict'), 'jobd_attach_err_notallowed');
eq('403 copy key', attachmentErrorKey('forbidden'), 'jobd_attach_err_forbidden');
eq('404 copy key', attachmentErrorKey('notfound'), 'jobd_attach_err_notfound');
eq('500 copy key', attachmentErrorKey('server'), 'jobd_attach_err_server');
eq('network copy key', attachmentErrorKey('network'), 'jobd_attach_err_network');
eq('an unknown bucket falls back to the server copy', attachmentErrorKey('unknown'), 'jobd_attach_err_server');

const fake = (key: string) => `<${key}>`;
eq(
  "the backend's own message always wins",
  attachmentFailureMessage({ kind: 'conflict', message: 'Job is closed' }, fake as any),
  'Job is closed'
);
eq(
  'no server message → the bucket copy',
  attachmentFailureMessage({ kind: 'conflict', message: null }, fake as any),
  '<jobd_attach_err_notallowed>'
);
eq(
  '403 with no server message → the not-allowed-to-attach copy',
  attachmentFailureMessage({ kind: 'forbidden', message: null }, fake as any),
  '<jobd_attach_err_forbidden>'
);
eq(
  'network with no server message → the network copy',
  attachmentFailureMessage({ kind: 'network', message: null }, fake as any),
  '<jobd_attach_err_network>'
);

/* -------------------------------------------------------------- path id guard */
eq('accepts a real job id', isValidJobId(42), true);
eq('rejects 0', isValidJobId(0), false);
eq('rejects a float', isValidJobId(1.5), false);
eq('rejects NaN', isValidJobId(Number.NaN), false);
eq('rejects a string id', isValidJobId('7' as unknown as number), false);

/* -------------------------------------------------------------------- report */

export const summary = { passed, total: passed + failures.length };
for (const failure of failures) console.log(`  ✗ ${failure}`);
console.log(`jobAttachment: ${summary.passed}/${summary.total} assertions passed`);
