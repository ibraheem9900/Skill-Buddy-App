/**
 * Dispute image helpers — the documented POST /attachments rules: JPG/PNG/WebP
 * only, max 5 per feedback, EXIF/GPS stripped server-side (so nothing here
 * touches metadata), and no invented size limit.
 */
import {
  DISPUTE_JPEG_QUALITY,
  DISPUTE_MAX_DIMENSION,
  MAX_DISPUTE_IMAGES,
  attachmentItems,
  buildDisputeImageName,
  canAddDisputeImage,
  classifyDisputeRemoveFailure,
  classifyDisputeUploadFailure,
  disputeExtension,
  disputeMime,
  remainingDisputeSlots,
  resizeDimensions,
  resolveDisputeImageFormat,
  selectNewDisputeUris,
} from '../disputeImages';

let passed = 0;
const failures: string[] = [];

function eq(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed += 1;
  } else {
    failures.push(`${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
  }
}
function check(label: string, ok: boolean) {
  if (ok) passed += 1;
  else failures.push(label);
}

/* ── Formats ──────────────────────────────────────────────────────────────── */

eq('JPEG is accepted as-is', resolveDisputeImageFormat('image/jpeg'), {
  format: 'jpeg',
  convert: false,
});
eq('PNG is accepted as-is', resolveDisputeImageFormat('image/png'), {
  format: 'png',
  convert: false,
});
eq('WebP is accepted as-is', resolveDisputeImageFormat('image/webp'), {
  format: 'webp',
  convert: false,
});
eq('HEIC must be converted', resolveDisputeImageFormat('image/heic'), {
  format: 'jpeg',
  convert: true,
});
eq('HEIF must be converted', resolveDisputeImageFormat('image/heif'), {
  format: 'jpeg',
  convert: true,
});
eq('an iOS-style uppercase mime still maps', resolveDisputeImageFormat('IMAGE/JPEG'), {
  format: 'jpeg',
  convert: false,
});
eq('a missing mime falls back to the extension', resolveDisputeImageFormat(null, 'photo.png'), {
  format: 'png',
  convert: false,
});
eq('a .heic name with no mime converts', resolveDisputeImageFormat(undefined, 'IMG_0001.HEIC'), {
  format: 'jpeg',
  convert: true,
});
eq('GIF is refused', resolveDisputeImageFormat('image/gif', 'a.gif'), null);
eq('a PDF is refused', resolveDisputeImageFormat('application/pdf', 'a.pdf'), null);
eq('a video is refused', resolveDisputeImageFormat('video/mp4', 'a.mp4'), null);
eq('nothing usable is refused', resolveDisputeImageFormat(null, null), null);

eq('jpeg mime', disputeMime('jpeg'), 'image/jpeg');
eq('png mime', disputeMime('png'), 'image/png');
eq('webp mime', disputeMime('webp'), 'image/webp');
eq('jpeg extension', disputeExtension('jpeg'), 'jpg');
eq('webp extension', disputeExtension('webp'), 'webp');

/* ── Names ────────────────────────────────────────────────────────────────── */

eq('a clean, correct-extension name', buildDisputeImageName(1700000000000, 2, 'jpeg'), 'dispute-1700000000000-2.jpg');
eq('png keeps its extension', buildDisputeImageName(1700000000000, 0, 'png'), 'dispute-1700000000000-0.png');
eq('webp keeps its extension', buildDisputeImageName(1700000000000, 4, 'webp'), 'dispute-1700000000000-4.webp');
check('two indices never collide', buildDisputeImageName(1, 0, 'jpeg') !== buildDisputeImageName(1, 1, 'jpeg'));

/* ── Slots ────────────────────────────────────────────────────────────────── */

eq('five is the cap', MAX_DISPUTE_IMAGES, 5);
eq('nothing used → five free', remainingDisputeSlots(0, 0), 5);
eq('server attachments count against the cap', remainingDisputeSlots(2, 0), 3);
eq('queued photos count too', remainingDisputeSlots(2, 2), 1);
eq('never negative', remainingDisputeSlots(5, 3), 0);
eq('a negative count does not invent slots', remainingDisputeSlots(-2, 0), 5);
check('room while under the cap', canAddDisputeImage(4, 0));
check('no room at the cap', !canAddDisputeImage(4, 1));

const selected = selectNewDisputeUris(['a', 'b'], ['b', 'c', 'd', 'e'], 2);
eq('already-added uris are dropped as duplicates', selected.duplicates, 1);
eq('only what fits is accepted', selected.accepted, ['c', 'd']);
eq('the rest is reported as overflow', selected.overflow, 1);
eq(
  'duplicates inside the pick itself are dropped',
  selectNewDisputeUris([], ['x', 'x', 'y'], 5),
  { accepted: ['x', 'y'], overflow: 0, duplicates: 1 }
);
eq('no slots means nothing is accepted', selectNewDisputeUris(['a'], ['b'], 0), {
  accepted: [],
  overflow: 1,
  duplicates: 0,
});

/* ── Resize ───────────────────────────────────────────────────────────────── */

eq('a small photo needs no resize', resizeDimensions(1200, 900), null);
eq('exactly at the cap needs no resize', resizeDimensions(1600, 1600), null);
eq('a landscape photo is capped on its longest side', resizeDimensions(3200, 1600), {
  width: DISPUTE_MAX_DIMENSION,
  height: 800,
});
eq('a portrait photo keeps its aspect ratio', resizeDimensions(1000, 4000), {
  width: 400,
  height: DISPUTE_MAX_DIMENSION,
});
eq('an extreme ratio never collapses to zero', resizeDimensions(20000, 1)?.height, 1);
eq('missing dimensions mean no resize', resizeDimensions(0, 0), null);
eq('the documented-ish compression quality is 0.8', DISPUTE_JPEG_QUALITY, 0.8);

/* ── Failures ─────────────────────────────────────────────────────────────── */

eq('no response → offline', classifyDisputeUploadFailure(0), 'offline');
eq('401 → unauthorized', classifyDisputeUploadFailure(401), 'unauthorized');
eq('403 → not your dispute', classifyDisputeUploadFailure(403), 'notallowed');
eq('404 → dispute gone', classifyDisputeUploadFailure(404), 'notallowed');
eq('413 → too large', classifyDisputeUploadFailure(413), 'too-large');
eq('422 → rejected file', classifyDisputeUploadFailure(422), 'invalid');
eq('500 → server', classifyDisputeUploadFailure(500), 'server');
eq('400 → unknown', classifyDisputeUploadFailure(400), 'unknown');

/* ── Attachment items (undocumented shape) ────────────────────────────────── */

eq(
  'an object with an id and url is removable',
  attachmentItems([{ id: 12, url: 'https://cdn/a.jpg' }]),
  [{ id: 12, url: 'https://cdn/a.jpg' }]
);
eq(
  'attachment_id is accepted as the id',
  attachmentItems([{ attachment_id: 7, file_url: 'https://cdn/b.png' }]),
  [{ id: 7, url: 'https://cdn/b.png' }]
);
eq(
  'an object without an id is view-only',
  attachmentItems([{ url: 'https://cdn/c.jpg' }]),
  [{ id: null, url: 'https://cdn/c.jpg' }]
);
eq(
  'a bare url string is view-only',
  attachmentItems(['https://cdn/d.jpg']),
  [{ id: null, url: 'https://cdn/d.jpg' }]
);
eq('non-image entries are dropped', attachmentItems([{ id: 3, type: 'pdf' }, null, 5]), []);
eq(
  'duplicate urls collapse',
  attachmentItems([{ id: 1, url: 'https://cdn/e.jpg' }, 'https://cdn/e.jpg']),
  [{ id: 1, url: 'https://cdn/e.jpg' }]
);
eq('a non-numeric id is not invented', attachmentItems([{ id: '9', url: 'https://cdn/f.jpg' }])[0].id, null);

eq('an empty attachments array is empty', attachmentItems([]), []);

/* ── Remove failures ──────────────────────────────────────────────────────── */

eq('remove: no response → offline', classifyDisputeRemoveFailure(0), 'offline');
eq('remove: 401', classifyDisputeRemoveFailure(401), 'unauthorized');
eq('remove: 403 → forbidden', classifyDisputeRemoveFailure(403), 'forbidden');
eq('remove: 404 → already gone', classifyDisputeRemoveFailure(404), 'gone');
eq('remove: 409 → conflict', classifyDisputeRemoveFailure(409), 'conflict');
eq('remove: 422 → invalid', classifyDisputeRemoveFailure(422), 'invalid');
eq('remove: 500 → server', classifyDisputeRemoveFailure(500), 'server');
eq('remove: 400 → unknown', classifyDisputeRemoveFailure(400), 'unknown');

if (failures.length > 0) {
  console.error(`disputeImages: ${passed}/${passed + failures.length} assertions passed`);
  for (const failure of failures) console.error(`  ✕ ${failure}`);
  throw new Error('disputeImages tests failed');
}
console.log(`disputeImages: ${passed}/${passed} assertions passed`);
