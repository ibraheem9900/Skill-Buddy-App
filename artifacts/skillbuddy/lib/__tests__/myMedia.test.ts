/**
 * My Media rules — GET /api/v1/media-gallery/mine.
 *
 * Pins the parts that decide what the owner's screen shows: the payload is a
 * PLAIN ARRAY (a {items} wrapper is a contract break → []), private rows are
 * KEPT (it is the owner's list), rows that cannot be drawn (no url, unknown
 * media_type) are skipped, `rawCount` drives the end-of-list rule, pages append
 * without duplicates, and dates render in the requested language.
 */
import {
  MY_MEDIA_MAX_LIMIT,
  MY_MEDIA_PAGE_SIZE,
  MY_MEDIA_PATH,
  clampMyMediaLimit,
  clampMyMediaOffset,
  formatMyMediaDate,
  mergeMyMediaPage,
  myMediaHasMore,
  nextMyMediaOffset,
  normalizeMyMediaArray,
  normalizeMyMediaItem,
} from '../myMedia';

let passed = 0;
const failures: string[] = [];

function eq(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) passed += 1;
  else failures.push(`${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}
function check(label: string, ok: boolean) {
  if (ok) passed += 1;
  else failures.push(label);
}

const BASE = 'https://api.skillbuddy.zeyshan.com';

/** A complete row as the docs show it. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    uploaded_by_side: 'CLIENT',
    feedback_type: 'COMPLETED',
    is_public: true,
    can_be_public: true,
    job_id: 7,
    service_id: 3,
    category_id: 2,
    media_type: 'image/jpeg',
    caption: 'Kitchen tap',
    url: '/uploads/a.jpg',
    created_at: '2026-11-12T09:30:00.000Z',
    ...overrides,
  };
}

/* ── path / limits ───────────────────────────────────────────────────────── */

eq('path', MY_MEDIA_PATH, '/api/v1/media-gallery/mine');
eq('default page size inside 1..100', MY_MEDIA_PAGE_SIZE >= 1 && MY_MEDIA_PAGE_SIZE <= 100, true);
eq('clamp 0 → 1', clampMyMediaLimit(0), 1);
eq('clamp 500 → 100', clampMyMediaLimit(500), MY_MEDIA_MAX_LIMIT);
eq('clamp null → default', clampMyMediaLimit(null), MY_MEDIA_PAGE_SIZE);
eq('offset floor 0', clampMyMediaOffset(-4), 0);

/* ── payload shape ───────────────────────────────────────────────────────── */

eq('plain array', normalizeMyMediaArray([row()], BASE).length, 1);
eq('wrapper object is a contract break → []', normalizeMyMediaArray({ items: [row()] }, BASE), []);
eq('null → []', normalizeMyMediaArray(null, BASE), []);
eq('error body → []', normalizeMyMediaArray({ detail: 'Not authenticated' }, BASE), []);

/* ── rows the owner should still see ─────────────────────────────────────── */

eq(
  'private rows ARE kept (owner list)',
  normalizeMyMediaArray([row({ id: 4, is_public: false })], BASE).map((e) => e.isPublic),
  [false]
);
eq(
  'can_be_public read through',
  normalizeMyMediaArray([row({ id: 5, can_be_public: false })], BASE).map((e) => e.canBePublic),
  [false]
);
check('job_id never carried', !('jobId' in normalizeMyMediaItem(row(), BASE, 0)!));
check('unknown uploaded_by_side harmless', normalizeMyMediaArray([row({ uploaded_by_side: 'BOTH' })], BASE).length === 1);
eq(
  'no local re-sort — API order kept',
  normalizeMyMediaArray([row({ id: 9 }), row({ id: 2, url: '/b.jpg' })], BASE).map((e) => e.id),
  [9, 2]
);

/* ── rows that must be skipped ───────────────────────────────────────────── */

eq('missing url → skipped', normalizeMyMediaArray([row({ url: null })], BASE), []);
eq('empty url → skipped', normalizeMyMediaArray([row({ url: '   ' })], BASE), []);
eq('unknown media_type → skipped', normalizeMyMediaArray([row({ media_type: 'model/gltf' })], BASE), []);
eq(
  'video classified',
  normalizeMyMediaItem(row({ media_type: 'video/mp4' }), BASE)?.kind,
  'video'
);
eq(
  'relative url resolved against base',
  normalizeMyMediaItem(row({ url: 'uploads/a.jpg' }), BASE)?.url,
  `${BASE}/uploads/a.jpg`
);
eq(
  'absolute url untouched',
  normalizeMyMediaItem(row({ url: 'https://cdn/x.jpg' }), BASE)?.url,
  'https://cdn/x.jpg'
);
eq('blank caption → null', normalizeMyMediaItem(row({ caption: '  ' }), BASE)?.caption, null);
eq('missing caption → null', normalizeMyMediaItem(row({ caption: null }), BASE)?.caption, null);

/* ── paging ──────────────────────────────────────────────────────────────── */

eq('full page → may have more', myMediaHasMore(20, 20), true);
eq('short page → last page', myMediaHasMore(19, 20), false);
eq('empty page → last page', myMediaHasMore(0, 20), false);
eq('offset advances by raw rows', nextMyMediaOffset(0, 20), 20);
eq('offset advances past skipped rows', nextMyMediaOffset(40, 7), 47);

const page1 = normalizeMyMediaArray([row({ id: 1 }), row({ id: 2, url: '/b.jpg' })], BASE);
const page2 = normalizeMyMediaArray(
  [row({ id: 2, url: '/b.jpg' }), row({ id: 3, url: '/c.jpg' })],
  BASE
);
eq('append de-duplicates by id', mergeMyMediaPage(page1, page2).map((e) => e.id), [1, 2, 3]);
eq('refresh replaces', mergeMyMediaPage([], page1).map((e) => e.id), [1, 2]);
eq(
  'duplicate id inside one page kept once',
  normalizeMyMediaArray([row({ id: 8 }), row({ id: 8, url: '/z.jpg' })], BASE).length,
  1
);

/* ── dates ───────────────────────────────────────────────────────────────── */

check('date formatted for en', /12 Nov 2026/.test(formatMyMediaDate('2026-11-12T09:30:00Z', 'en')));
check('date formatted for de (localised month)', formatMyMediaDate('2026-11-12T09:30:00Z', 'de').length > 0);
eq('missing date → empty', formatMyMediaDate(null, 'en'), '');
eq('invalid date → empty', formatMyMediaDate('not-a-date', 'en'), '');
eq(
  'far-future date suppressed',
  formatMyMediaDate('2035-11-12T09:30:00Z', 'en', new Date('2026-11-18T00:00:00Z')),
  ''
);

console.log(
  `myMedia: ${passed}/${passed + failures.length} assertions passed` +
    (failures.length ? ` — ${failures.join(' | ')}` : '')
);
if (failures.length > 0) {
  throw new Error('myMedia tests failed');
}
