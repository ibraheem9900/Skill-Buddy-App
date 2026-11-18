/**
 * Public media gallery rules — GET /api/v1/media-gallery/public (wrapper
 * {service_id, category_id, items}) and GET …/public/by-service (bare
 * ServiceGalleryGroup[]).
 *
 * These tests pin the parts that decide what a user is allowed to see: only
 * is_public === true, only feedback_type === "COMPLETED", only supported
 * media_type values, only rows with a resolvable URL; groups left with nothing
 * are dropped; `rawCount` (pre-filter) drives the "may have more" rule; and the
 * group's category_id — not the item's — drives category filtering.
 */
import {
  CATEGORY_GALLERY_PATH,
  DEFAULT_PER_CATEGORY,
  DEFAULT_PER_SERVICE,
  MAX_PER_SERVICE,
  PUBLIC_MEDIA_PAGE_SIZE,
  SERVICE_GALLERY_PATH,
  clampPerCategory,
  clampPerService,
  filterGroupsByCategory,
  findGroupForCategory,
  findGroupForService,
  groupCoverUrl,
  mediaKindOf,
  normalizeCategoryGroups,
  normalizeMediaItem,
  normalizeMediaItems,
  normalizePublicMediaResponse,
  normalizeServiceGroups,
  resolveCategoryName,
  resolveMediaUrl,
  resolveServiceTitle,
  toGalleryViewerItems,
  type DisplayMedia,
} from '../mediaGallery';

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

const BASE = 'https://api.skillbuddy.zeyshan.com';

/** A complete, public, COMPLETED row — the happy path. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    uploaded_by_side: 'CLIENT',
    feedback_type: 'COMPLETED',
    is_public: true,
    can_be_public: true,
    job_id: 77,
    service_id: 5,
    category_id: 3,
    media_type: 'image/jpeg',
    caption: 'Clean kitchen',
    url: 'https://cdn.example.com/a.jpg',
    created_at: '2026-11-17T15:09:41.639Z',
    ...overrides,
  };
}

/* ── media_type ──────────────────────────────────────────────────────────── */

eq('media_type image/jpeg', mediaKindOf('image/jpeg'), 'image');
eq('media_type IMAGE (upper)', mediaKindOf('IMAGE'), 'image');
eq('media_type photo', mediaKindOf('photo'), 'image');
eq('media_type video/mp4', mediaKindOf('video/mp4'), 'video');
eq('media_type VIDEO (upper)', mediaKindOf('VIDEO'), 'video');
eq('media_type missing → image (needs a url)', mediaKindOf(undefined), 'image');
eq('media_type empty → image', mediaKindOf('   '), 'image');
eq('media_type unsupported → null (skipped)', mediaKindOf('application/pdf'), null);
eq('media_type audio/mpeg → null', mediaKindOf('audio/mpeg'), null);

/* ── URLs ────────────────────────────────────────────────────────────────── */

eq('absolute url kept', resolveMediaUrl('https://cdn/a.jpg', BASE), 'https://cdn/a.jpg');
eq('absolute http kept', resolveMediaUrl('http://cdn/a.jpg', BASE), 'http://cdn/a.jpg');
eq('protocol-relative upgraded', resolveMediaUrl('//cdn/a.jpg', BASE), 'https://cdn/a.jpg');
eq('root-relative resolved', resolveMediaUrl('/uploads/a.jpg', BASE), `${BASE}/uploads/a.jpg`);
eq('path-relative resolved', resolveMediaUrl('uploads/a.jpg', BASE), `${BASE}/uploads/a.jpg`);
eq('whitespace trimmed', resolveMediaUrl('  /a.jpg  ', BASE), `${BASE}/a.jpg`);
eq('empty → null', resolveMediaUrl('', BASE), null);
eq('null → null', resolveMediaUrl(null, BASE), null);
eq('undefined → null', resolveMediaUrl(undefined, BASE), null);
eq('internal whitespace → null', resolveMediaUrl('/a b.jpg', BASE), null);
eq(
  'base trailing slash not doubled',
  resolveMediaUrl('/a.jpg', 'https://api.example.com/'),
  'https://api.example.com/a.jpg'
);

/* ── per_service ─────────────────────────────────────────────────────────── */

eq('default per_service', DEFAULT_PER_SERVICE, 6);
eq('clamp high', clampPerService(999), MAX_PER_SERVICE);
eq('clamp low', clampPerService(0), 1);
eq('clamp negative', clampPerService(-3), 1);
eq('clamp truncates', clampPerService(6.9), 6);
eq('clamp undefined → default', clampPerService(undefined), DEFAULT_PER_SERVICE);
eq('clamp NaN → default', clampPerService(Number.NaN), DEFAULT_PER_SERVICE);
eq('page size within server max', PUBLIC_MEDIA_PAGE_SIZE <= 100, true);

/* ── one item ────────────────────────────────────────────────────────────── */

const good = normalizeMediaItem(row(), BASE, 0) as DisplayMedia;
eq('item url resolved', good.url, 'https://cdn.example.com/a.jpg');
eq('item kind', good.kind, 'image');
eq('item caption trimmed', good.caption, 'Clean kitchen');
eq('item createdAt kept', good.createdAt, '2026-11-17T15:09:41.639Z');
eq('item id kept', good.id, 1);
// PRIVACY: the public view must not carry any private field.
check('no job_id on display media', !('job_id' in (good as unknown as Record<string, unknown>)));
check(
  'no uploaded_by_side on display media',
  !('uploaded_by_side' in (good as unknown as Record<string, unknown>))
);
check(
  'no can_be_public on display media',
  !('can_be_public' in (good as unknown as Record<string, unknown>))
);

eq('is_public false → null', normalizeMediaItem(row({ is_public: false }), BASE, 0), null);
eq('is_public missing → null', normalizeMediaItem(row({ is_public: undefined }), BASE, 0), null);
eq('DENIAL → null', normalizeMediaItem(row({ feedback_type: 'DENIAL' }), BASE, 0), null);
eq('DISPUTE → null', normalizeMediaItem(row({ feedback_type: 'DISPUTE' }), BASE, 0), null);
eq('feedback_type missing → null', normalizeMediaItem(row({ feedback_type: undefined }), BASE, 0), null);
eq('unsupported media_type → null', normalizeMediaItem(row({ media_type: 'application/pdf' }), BASE, 0), null);
eq('url null → null', normalizeMediaItem(row({ url: null }), BASE, 0), null);
eq('caption blank → null', normalizeMediaItem(row({ caption: '   ' }), BASE, 0)?.caption, null);
eq('caption missing → null', normalizeMediaItem(row({ caption: undefined }), BASE, 0)?.caption, null);
eq('non-object → null', normalizeMediaItem('nope', BASE, 0), null);
eq('null row → null', normalizeMediaItem(null, BASE, 0), null);
eq(
  'synthetic id when the row has none',
  normalizeMediaItem(row({ id: undefined }), BASE, 4)?.id,
  -5
);
eq(
  'very long caption preserved',
  normalizeMediaItem(row({ caption: 'x'.repeat(400) }), BASE, 0)?.caption,
  'x'.repeat(400)
);

/* ── item arrays ─────────────────────────────────────────────────────────── */

eq('non-array → []', normalizeMediaItems(null, BASE), []);
eq('empty array → []', normalizeMediaItems([], BASE), []);
eq(
  'mixed array keeps only displayable rows, in order',
  normalizeMediaItems(
    [
      row({ id: 1, url: '/a.jpg' }),
      row({ id: 2, is_public: false }),
      row({ id: 3, url: 'https://cdn/b.jpg' }),
      row({ id: 4, feedback_type: 'DISPUTE' }),
      row({ id: 5, media_type: 'audio/mp3' }),
    ],
    BASE
  ).map((item) => item.id),
  [1, 3]
);
eq(
  'duplicate url kept once',
  normalizeMediaItems([row({ id: 1 }), row({ id: 2 })], BASE).length,
  1
);
eq(
  'duplicate id kept once even with a re-signed url',
  normalizeMediaItems(
    [row({ id: 7, url: '/x.jpg' }), row({ id: 7, url: '/y.jpg' })],
    BASE
  ).length,
  1
);

/* ── groups ──────────────────────────────────────────────────────────────── */

eq('non-array payload → []', normalizeServiceGroups(null, BASE, 6), []);
eq('null group payload → []', normalizeServiceGroups({}, BASE, 6), []);

const groups = normalizeServiceGroups(
  [
    { service_id: 5, service_title: 'Plumbing', category_id: 3, items: [row({ id: 1 }), row({ id: 2, url: '/b.jpg' })] },
    // All items private → the whole section must vanish.
    { service_id: 6, service_title: 'Cleaning', category_id: 4, items: [row({ id: 3, is_public: false })] },
    // Empty items → also dropped.
    { service_id: 7, service_title: 'Moving', category_id: 4, items: [] },
    // No items key at all → dropped.
    { service_id: 8, service_title: 'Catering', category_id: null },
    // category_id null on the wire is legal.
    { service_id: 9, service_title: 'Electric', category_id: null, items: [row({ id: 9, url: '/e.jpg' })] },
  ],
  BASE,
  2
);

eq('only groups with displayable items survive', groups.map((g) => g.serviceId), [5, 9]);
eq('group title preserved', groups[0].serviceTitle, 'Plumbing');
eq('group category from the GROUP', groups[0].categoryId, 3);
eq('null category_id stays null', groups[1].categoryId, null);
eq('rawCount is pre-filter length', groups[0].rawCount, 2);
eq('mayHaveMore when rawCount >= per_service', groups[0].mayHaveMore, true);
eq('no mayHaveMore when fewer than per_service', groups[1].mayHaveMore, false);
eq('relative item url resolved in groups', groups[1].media[0].url, `${BASE}/e.jpg`);

const onlyOne = normalizeServiceGroups(
  [{ service_id: 1, service_title: 'A', category_id: 1, items: [row()] }],
  BASE,
  6
);
eq('one item below per_service → mayHaveMore false', onlyOne[0].mayHaveMore, false);

const exactly = normalizeServiceGroups(
  [
    {
      service_id: 1,
      service_title: 'A',
      category_id: 1,
      items: [row({ id: 1, url: '/1.jpg' }), row({ id: 2, url: '/2.jpg' })],
    },
  ],
  BASE,
  2
);
eq('exactly per_service → mayHaveMore true (may be truncated)', exactly[0].mayHaveMore, true);

/** A filtered-out row still counts for "may have more" — the server's total. */
const filteredCount = normalizeServiceGroups(
  [
    {
      service_id: 2,
      service_title: 'B',
      category_id: 2,
      items: [row({ id: 1, url: '/1.jpg' }), row({ id: 2, url: '/2.jpg', is_public: false })],
    },
  ],
  BASE,
  2
);
eq('rawCount counts filtered rows too', filteredCount[0].rawCount, 2);
eq('but only displayable media are exposed', filteredCount[0].media.length, 1);
eq('mayHaveMore follows the RAW count', filteredCount[0].mayHaveMore, true);

const many = normalizeServiceGroups(
  Array.from({ length: 55 }, (_, i) => ({
    service_id: i + 1,
    service_title: `Service ${i + 1}`,
    category_id: i % 3,
    items: [row({ id: i + 1, url: `/img-${i + 1}.jpg` })],
  })),
  BASE,
  6
);
eq('55 groups all normalised', many.length, 55);
eq('server order preserved (no silent sort)', many[0].serviceId, 1);
eq('last group still in server order', many[54].serviceId, 55);

eq(
  'very long service_title preserved as received',
  normalizeServiceGroups(
    [{ service_id: 1, service_title: 'T'.repeat(300), category_id: 1, items: [row()] }],
    BASE,
    6
  )[0].serviceTitle.length,
  300
);
eq(
  'missing service_title → empty string (UI falls back)',
  normalizeServiceGroups([{ service_id: 1, items: [row()] }], BASE, 6)[0].serviceTitle,
  ''
);
eq(
  'group without a numeric service_id is skipped',
  normalizeServiceGroups([{ service_title: 'X', items: [row()] }], BASE, 6),
  []
);

/* ── category filter (client-side, by GROUP category) ────────────────────── */

const catGroups = normalizeServiceGroups(
  [
    { service_id: 1, service_title: 'A', category_id: 3, items: [row({ id: 1, category_id: 99 })] },
    { service_id: 2, service_title: 'B', category_id: 4, items: [row({ id: 2, url: '/2.jpg', category_id: 3 })] },
  ],
  BASE,
  6
);
eq('no category → all groups', filterGroupsByCategory(catGroups, null).length, 2);
eq('category 3 → group 1 only', filterGroupsByCategory(catGroups, 3).map((g) => g.serviceId), [1]);
eq(
  'item category_id never decides the filter',
  filterGroupsByCategory(catGroups, 3).length,
  1
);
eq('unknown category → empty', filterGroupsByCategory(catGroups, 42), []);

/* ── selectors ───────────────────────────────────────────────────────────── */

eq('findGroupForService hit', findGroupForService(catGroups, 2)?.serviceId, 2);
eq('findGroupForService miss → null', findGroupForService(catGroups, 77), null);
eq('findGroupForService null id → null', findGroupForService(catGroups, null), null);
eq('groupCoverUrl → first photo', groupCoverUrl(catGroups[0]), 'https://cdn.example.com/a.jpg');
eq('groupCoverUrl null group → null', groupCoverUrl(null), null);
eq(
  'resolveServiceTitle prefers the cached app title',
  resolveServiceTitle({ serviceTitle: 'Plumbing' }, 'Toruabi'),
  'Toruabi'
);
eq(
  'resolveServiceTitle falls back to service_title',
  resolveServiceTitle({ serviceTitle: 'Plumbing' }, null),
  'Plumbing'
);
eq(
  'resolveServiceTitle blank cached title falls back',
  resolveServiceTitle({ serviceTitle: 'Plumbing' }, '   '),
  'Plumbing'
);
eq(
  'resolveServiceTitle with neither → empty string',
  resolveServiceTitle({ serviceTitle: '  ' }, undefined),
  ''
);

/* ── wrapped list endpoint ───────────────────────────────────────────────── */

eq('wrapper null → []', normalizePublicMediaResponse(null, BASE), []);
eq('wrapper without items → []', normalizePublicMediaResponse({}, BASE), []);
eq(
  'wrapper items normalised',
  normalizePublicMediaResponse(
    { service_id: 5, category_id: null, items: [row({ id: 1 }), row({ id: 2, is_public: false })] },
    BASE
  ).map((item) => item.id),
  [1]
);

/* ── viewer mapping ──────────────────────────────────────────────────────── */

const viewerItems = toGalleryViewerItems(
  [
    { id: 1, url: 'https://cdn/a.jpg', kind: 'image', caption: 'Kitchen', createdAt: '2026-11-17T15:09:41.639Z' },
    { id: 2, url: 'https://cdn/b.mp4', kind: 'video', caption: null, createdAt: null },
  ],
  (iso) => `date:${iso.slice(0, 10)}`
);
eq('viewer keeps the url', viewerItems[0].uri, 'https://cdn/a.jpg');
eq('viewer shows the caption', viewerItems[0].title, 'Kitchen');
eq('viewer formats the date', viewerItems[0].subtitle, 'date:2026-11-17');
eq('viewer keeps the kind', viewerItems[1].kind, 'video');
eq('missing caption → empty string', viewerItems[1].title, '');
eq('missing date → empty string', viewerItems[1].subtitle, '');

/* ── result ──────────────────────────────────────────────────────────────── */

/* ── category groups (by-category) ───────────────────────────────────────── */

eq('clampPerCategory low', clampPerCategory(0), 1);
eq('clampPerCategory high', clampPerCategory(99), MAX_PER_SERVICE);
eq('clampPerCategory default', clampPerCategory(undefined), DEFAULT_PER_CATEGORY);

eq('category payload non-array → []', normalizeCategoryGroups(null, BASE, 6), []);
eq('category payload object → []', normalizeCategoryGroups({}, BASE, 6), []);

const catView = normalizeCategoryGroups(
  [
    { category_id: 3, category_name: 'Plumbing', items: [row({ id: 1 }), row({ id: 2, url: '/b.jpg' })] },
    // Everything private → the section must vanish.
    { category_id: 4, category_name: 'Cleaning', items: [row({ id: 3, is_public: false })] },
    // Empty items → drop.
    { category_id: 5, category_name: 'Moving', items: [] },
    // No items key → drop.
    { category_id: 6, category_name: 'Catering' },
    // A legal group with one item.
    { category_id: 7, category_name: 'Electric', items: [row({ id: 7, url: '/e.jpg' })] },
  ],
  BASE,
  2
);

eq('only categories with displayable items survive', catView.map((g) => g.categoryId), [3, 7]);
eq('category name preserved', catView[0].categoryName, 'Plumbing');
eq('category rawCount is pre-filter', catView[0].rawCount, 2);
eq('category mayHaveMore at per_category', catView[0].mayHaveMore, true);
eq('category below per_category', catView[1].mayHaveMore, false);
eq('category item url resolved', catView[1].media[0].url, `${BASE}/e.jpg`);

eq(
  'category items keep only public COMPLETED photos',
  normalizeCategoryGroups(
    [
      {
        category_id: 1,
        category_name: 'A',
        items: [
          row({ id: 1, url: '/1.jpg' }),
          row({ id: 2, url: '/2.jpg', feedback_type: 'DISPUTE' }),
          row({ id: 3, url: '/3.jpg', is_public: false }),
          row({ id: 4, url: '/4.jpg', media_type: 'application/pdf' }),
          row({ id: 5, url: null }),
        ],
      },
    ],
    BASE,
    6
  )[0].media.map((m) => m.id),
  [1]
);

const manyCats = normalizeCategoryGroups(
  Array.from({ length: 52 }, (_, i) => ({
    category_id: i + 1,
    category_name: `Category ${i + 1}`,
    items: [row({ id: i + 1, url: `/c-${i + 1}.jpg` })],
  })),
  BASE,
  6
);
eq('52 category groups normalised', manyCats.length, 52);
eq('category server order preserved', manyCats[0].categoryId, 1);
eq('category last group in order', manyCats[51].categoryId, 52);

eq(
  'very long category_name preserved as received',
  normalizeCategoryGroups(
    [{ category_id: 1, category_name: 'C'.repeat(300), items: [row()] }],
    BASE,
    6
  )[0].categoryName.length,
  300
);
eq(
  'missing category_name → empty string',
  normalizeCategoryGroups([{ category_id: 1, items: [row()] }], BASE, 6)[0].categoryName,
  ''
);
eq(
  'category group without numeric category_id is skipped',
  normalizeCategoryGroups([{ category_name: 'X', items: [row()] }], BASE, 6),
  []
);

/* ── category selectors ──────────────────────────────────────────────────── */

eq('findGroupForCategory hit', findGroupForCategory(catView, 7)?.categoryId, 7);
eq('findGroupForCategory miss → null', findGroupForCategory(catView, 99), null);
eq('findGroupForCategory null id → null', findGroupForCategory(catView, null), null);
eq('groupCoverUrl works for a category group', groupCoverUrl(catView[0]), 'https://cdn.example.com/a.jpg');
eq(
  'resolveCategoryName prefers the app localised name',
  resolveCategoryName({ categoryName: 'Plumbing' }, 'Toruabi', 'Plumbing (server)'),
  'Toruabi'
);
eq(
  'resolveCategoryName falls back to the cached name',
  resolveCategoryName({ categoryName: 'Plumbing' }, '', 'Sanitaar'),
  'Sanitaar'
);
eq(
  'resolveCategoryName falls back to the server name',
  resolveCategoryName({ categoryName: ' Plumbing ' }, null, null),
  'Plumbing'
);
eq(
  'resolveCategoryName with nothing → empty',
  resolveCategoryName({ categoryName: '  ' }, '', null),
  ''
);

/* ── dedicated single-service page ───────────────────────────────────────── */
eq(
  'service gallery path is the documented service-scoped URL',
  SERVICE_GALLERY_PATH(42),
  '/api/v1/services/42/gallery'
);
eq(
  'service gallery path never hardcodes an id',
  SERVICE_GALLERY_PATH(7),
  '/api/v1/services/7/gallery'
);

/* ── dedicated single-category page ─────────────────────────────────────── */
eq(
  'category gallery path is the documented category-scoped URL',
  CATEGORY_GALLERY_PATH(42),
  '/api/v1/categories/42/gallery'
);
eq(
  'category gallery path never hardcodes an id',
  CATEGORY_GALLERY_PATH(7),
  '/api/v1/categories/7/gallery'
);

if (failures.length > 0) {
  console.error(`mediaGallery: ${passed}/${passed + failures.length} assertions passed`);
  for (const failure of failures) console.error(`  ✕ ${failure}`);
  throw new Error('mediaGallery tests failed');
}
console.log(`mediaGallery: ${passed}/${passed} assertions passed`);
