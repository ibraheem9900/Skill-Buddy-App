/**
 * Review photo helpers — POST /api/v1/reviews/{review_id}/attachments
 * (JPG/PNG/WebP only, max 5, multipart `file`, EXIF/GPS stripped server-side)
 * plus the documented `MediaItemResponse` attachment shape.
 */
import {
  MAX_REVIEW_PHOTOS,
  REVIEW_PHOTO_JPEG_QUALITY,
  REVIEW_PHOTO_MAX_DIMENSION,
  REVIEW_PHOTO_REMOVE_AVAILABLE,
  buildReviewPhotoName,
  canAddReviewPhoto,
  classifyReviewPhotoRemoveFailure,
  classifyReviewPhotoUploadFailure,
  remainingReviewPhotoSlots,
  resizeReviewPhotoDimensions,
  resolveReviewPhotoFormat,
  reviewPhotoAttachments,
  reviewPhotoExtension,
  reviewPhotoMime,
  selectNewReviewPhotoUris,
} from '../reviewPhotos';

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

/* ── Documented cap + removal status ──────────────────────────────────────── */

eq('five photos per review', MAX_REVIEW_PHOTOS, 5);
check('uploaded review photos can be removed by their author', REVIEW_PHOTO_REMOVE_AVAILABLE);

/* ── Formats ──────────────────────────────────────────────────────────────── */

eq('JPEG is accepted as-is', resolveReviewPhotoFormat('image/jpeg'), {
  format: 'jpeg',
  convert: false,
});
eq('PNG is accepted as-is', resolveReviewPhotoFormat('image/png'), {
  format: 'png',
  convert: false,
});
eq('WebP is accepted as-is', resolveReviewPhotoFormat('image/webp'), {
  format: 'webp',
  convert: false,
});
eq('HEIC must be converted', resolveReviewPhotoFormat('image/heic'), {
  format: 'jpeg',
  convert: true,
});
eq('a .HEIF name converts', resolveReviewPhotoFormat(undefined, 'IMG_1.HEIF'), {
  format: 'jpeg',
  convert: true,
});
eq('a missing mime falls back to the extension', resolveReviewPhotoFormat(null, 'photo.webp'), {
  format: 'webp',
  convert: false,
});
eq('GIF is refused', resolveReviewPhotoFormat('image/gif', 'a.gif'), null);
eq('PDF is refused', resolveReviewPhotoFormat('application/pdf', 'a.pdf'), null);

eq('jpeg mime', reviewPhotoMime('jpeg'), 'image/jpeg');
eq('png mime', reviewPhotoMime('png'), 'image/png');
eq('webp mime', reviewPhotoMime('webp'), 'image/webp');
eq('jpeg extension', reviewPhotoExtension('jpeg'), 'jpg');
eq('webp extension', reviewPhotoExtension('webp'), 'webp');

/* ── Names ────────────────────────────────────────────────────────────────── */

eq(
  'a clean review-photo name',
  buildReviewPhotoName(1700000000000, 2, 'jpeg'),
  'review-1700000000000-2.jpg'
);
eq('png keeps its extension', buildReviewPhotoName(1700000000000, 0, 'png'), 'review-1700000000000-0.png');
eq('webp keeps its extension', buildReviewPhotoName(1700000000000, 4, 'webp'), 'review-1700000000000-4.webp');
check(
  'two indices never collide',
  buildReviewPhotoName(1, 0, 'jpeg') !== buildReviewPhotoName(1, 1, 'jpeg')
);

/* ── Slots: server attachments + queued photos share the cap ──────────────── */

eq('nothing used → five free', remainingReviewPhotoSlots(0, 0), 5);
eq('server attachments count', remainingReviewPhotoSlots(2, 0), 3);
eq('queued photos count too', remainingReviewPhotoSlots(2, 2), 1);
eq('server + queue never goes negative', remainingReviewPhotoSlots(5, 3), 0);
eq('a negative count does not invent slots', remainingReviewPhotoSlots(-2, 0), 5);
check('room while under the cap', canAddReviewPhoto(4, 0));
check('no room with 4 server + 1 queued', !canAddReviewPhoto(4, 1));

const selected = selectNewReviewPhotoUris(['a', 'b'], ['b', 'c', 'd', 'e'], 2);
eq('already-added uris are duplicates', selected.duplicates, 1);
eq('only what fits is accepted', selected.accepted, ['c', 'd']);
eq('the rest is overflow', selected.overflow, 1);
eq(
  'duplicates inside the pick are dropped',
  selectNewReviewPhotoUris([], ['x', 'x', 'y'], 5),
  { accepted: ['x', 'y'], overflow: 0, duplicates: 1 }
);

/* ── Resize ───────────────────────────────────────────────────────────────── */

eq('a small photo needs no resize', resizeReviewPhotoDimensions(1200, 900), null);
eq('a landscape photo is capped on its longest side', resizeReviewPhotoDimensions(3200, 1600), {
  width: REVIEW_PHOTO_MAX_DIMENSION,
  height: 800,
});
eq('a portrait photo keeps its aspect ratio', resizeReviewPhotoDimensions(1000, 4000), {
  width: 400,
  height: REVIEW_PHOTO_MAX_DIMENSION,
});
eq('missing dimensions mean no resize', resizeReviewPhotoDimensions(0, 0), null);
eq('quality is 0.8', REVIEW_PHOTO_JPEG_QUALITY, 0.8);

/* ── Documented MediaItemResponse attachment items ────────────────────────── */

eq(
  'MediaItemResponse with id + url is rendered',
  reviewPhotoAttachments([
    {
      id: 42,
      uploaded_by_side: 'CLIENT',
      feedback_type: 'CLIENT_REVIEW',
      is_public: true,
      can_be_public: true,
      job_id: 7,
      service_id: 2,
      category_id: 1,
      media_type: 'image/jpeg',
      caption: null,
      url: 'https://cdn.skillbuddy/review-42.jpg',
      created_at: '2026-11-16T10:00:00Z',
    },
  ]),
  [{ id: 42, url: 'https://cdn.skillbuddy/review-42.jpg' }]
);
eq(
  'a nullable url is skipped instead of a broken tile',
  reviewPhotoAttachments([{ id: 43, url: null, media_type: 'image/jpeg' }]),
  []
);
eq(
  'an attachment without a numeric id is view-only',
  reviewPhotoAttachments([{ url: 'https://cdn.skillbuddy/review.jpg' }]),
  [{ id: null, url: 'https://cdn.skillbuddy/review.jpg' }]
);
eq('duplicate urls collapse', reviewPhotoAttachments([
  { id: 1, url: 'https://cdn/x.jpg' },
  { id: 2, url: 'https://cdn/x.jpg' },
]), [{ id: 1, url: 'https://cdn/x.jpg' }]);
eq('unreadable rows are dropped', reviewPhotoAttachments([{ id: 9 }, null, 'not-a-url']), []);

/* ── Failures ─────────────────────────────────────────────────────────────── */

eq('no response → offline', classifyReviewPhotoUploadFailure(0), 'offline');
eq('401 → unauthorized', classifyReviewPhotoUploadFailure(401), 'unauthorized');
eq('403 → notallowed', classifyReviewPhotoUploadFailure(403), 'notallowed');
eq('404 → notallowed', classifyReviewPhotoUploadFailure(404), 'notallowed');
eq('413 → too-large', classifyReviewPhotoUploadFailure(413), 'too-large');
eq('422 → invalid', classifyReviewPhotoUploadFailure(422), 'invalid');
eq('500 → server', classifyReviewPhotoUploadFailure(500), 'server');
eq('400 → unknown', classifyReviewPhotoUploadFailure(400), 'unknown');

eq('remove 404 → gone', classifyReviewPhotoRemoveFailure(404), 'gone');
eq('remove 409 → conflict', classifyReviewPhotoRemoveFailure(409), 'conflict');
eq('remove 422 → invalid', classifyReviewPhotoRemoveFailure(422), 'invalid');

if (failures.length > 0) {
  console.error(`reviewPhotos: ${passed}/${passed + failures.length} assertions passed`);
  for (const failure of failures) console.error(`  ✕ ${failure}`);
  throw new Error('reviewPhotos tests failed');
}
console.log(`reviewPhotos: ${passed}/${passed} assertions passed`);
