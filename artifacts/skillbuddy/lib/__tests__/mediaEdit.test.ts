/**
 * Update Media rules — PATCH /api/v1/media-gallery/{item_id}.
 *
 * Pins the parts that decide what is sent and what the caches keep:
 *   • ONLY the changed fields go in the body (a caption edit never carries a
 *     visibility change), an untouched form sends nothing, and clearing a
 *     caption sends '' — the documented "empty string" way to remove it;
 *   • failures map to friendly codes (403 → forbidden, 404 → not_found, …) and
 *     a server message is surfaced only when it is a short readable sentence
 *     (never JSON, a URL or a bare status code);
 *   • the 200 body is validated before it is trusted, and the item's PUBLIC
 *     representation is null exactly when it must leave every public view;
 *   • the cache transforms replace/remove one photo, drop a group left empty and
 *     keep `rawCount` honest, returning the same array when nothing changed.
 */
import {
  MEDIA_ITEM_PATH,
  applyMediaToGroups,
  applyMediaToMediaList,
  buildMediaUpdatePatch,
  classifyMediaUpdateFailure,
  draftFor,
  editableFromMediaItem,
  fieldErrorsFromValidation,
  isValidMediaItemId,
  normalizeUpdatedMedia,
  publicDisplayMedia,
  readServerMessage,
  toEditableMedia,
  updatedMyMediaFields,
  type MediaEditable,
} from '../mediaEdit';
import type { DisplayMedia } from '../mediaGallery';

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

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    uploaded_by_side: 'CLIENT',
    feedback_type: 'COMPLETED',
    is_public: false,
    can_be_public: true,
    job_id: 7,
    service_id: 3,
    category_id: 2,
    media_type: 'image/jpeg',
    caption: 'Kitchen tap',
    url: '/uploads/a.jpg',
    created_at: '2026-11-19T18:33:55.085Z',
    ...overrides,
  };
}

function media(id: number, caption: string | null = null): DisplayMedia {
  return { id, url: `https://cdn.test/${id}.jpg`, kind: 'image', caption, createdAt: null };
}

const editable: MediaEditable = {
  id: 12,
  url: 'https://cdn.test/12.jpg',
  kind: 'image',
  caption: 'Kitchen tap',
  isPublic: false,
  canBePublic: true,
};

/* ── path / ids ──────────────────────────────────────────────────────────── */
eq('path', MEDIA_ITEM_PATH(12), '/api/v1/media-gallery/12');
eq('zero is not a valid id', isValidMediaItemId(0), false);
eq('negative is not a valid id', isValidMediaItemId(-3), false);
eq('fraction is not a valid id', isValidMediaItemId(1.5), false);
eq('string is not a valid id', isValidMediaItemId('12'), false);
eq('positive integer is valid', isValidMediaItemId(12), true);

/* ── draft / body ────────────────────────────────────────────────────────── */
eq('draft from item', draftFor(editable), { caption: 'Kitchen tap', isPublic: false });
eq('untouched form sends nothing', buildMediaUpdatePatch(draftFor(editable), editable), null);

eq(
  'caption only',
  buildMediaUpdatePatch({ caption: 'New caption', isPublic: false }, editable),
  { caption: 'New caption' }
);
eq(
  'visibility only',
  buildMediaUpdatePatch({ caption: 'Kitchen tap', isPublic: true }, editable),
  { is_public: true }
);
eq(
  'both fields when both changed',
  buildMediaUpdatePatch({ caption: 'New', isPublic: true }, editable),
  { caption: 'New', is_public: true }
);
eq(
  'clearing sends an empty string',
  buildMediaUpdatePatch({ caption: '', isPublic: false }, editable),
  { caption: '' }
);
eq(
  'whitespace-only clears too',
  buildMediaUpdatePatch({ caption: '   ', isPublic: false }, editable),
  { caption: '' }
);
eq(
  'edge whitespace is trimmed, not a change',
  buildMediaUpdatePatch({ caption: '  Kitchen tap  ', isPublic: false }, editable),
  null
);
eq(
  'already private + private draft → no body',
  buildMediaUpdatePatch({ caption: 'Kitchen tap', isPublic: false }, editable),
  null
);
eq(
  'turning a public photo private',
  buildMediaUpdatePatch({ caption: 'Kitchen tap', isPublic: false }, { ...editable, isPublic: true }),
  { is_public: false }
);
eq(
  'a null caption compares as empty',
  buildMediaUpdatePatch({ caption: '', isPublic: false }, { ...editable, caption: null }),
  null
);
eq(
  'never asks to publish an ineligible photo',
  buildMediaUpdatePatch({ caption: 'Kitchen tap', isPublic: true }, { ...editable, canBePublic: false }),
  null
);
eq(
  'making an ineligible photo private is still allowed',
  buildMediaUpdatePatch(
    { caption: 'Kitchen tap', isPublic: false },
    { ...editable, canBePublic: false, isPublic: true }
  ),
  { is_public: false }
);

/* ── failures ────────────────────────────────────────────────────────────── */
eq('401', classifyMediaUpdateFailure(401), 'unauthorized');
eq('403', classifyMediaUpdateFailure(403), 'forbidden');
eq('404', classifyMediaUpdateFailure(404), 'not_found');
eq('409', classifyMediaUpdateFailure(409), 'conflict');
eq('422', classifyMediaUpdateFailure(422), 'invalid');
eq('500', classifyMediaUpdateFailure(500), 'server');
eq('503', classifyMediaUpdateFailure(503), 'server');
eq('no response → offline', classifyMediaUpdateFailure(undefined), 'offline');
eq('status 0 → offline', classifyMediaUpdateFailure(0), 'offline');
eq('400 stays unknown', classifyMediaUpdateFailure(400), 'unknown');

eq('detail string is readable', readServerMessage({ detail: 'This photo is locked.' }), 'This photo is locked.');
eq(
  'first validation message is readable',
  readServerMessage({ detail: [{ loc: ['body', 'caption'], msg: 'String too long' }] }),
  'String too long'
);
eq('JSON is never shown', readServerMessage({ detail: '{"error":true}' }), null);
eq('a URL is never shown', readServerMessage({ detail: 'https://x.test/err' }), null);
eq('a bare status is never shown', readServerMessage({ detail: '422' }), null);
eq('an empty detail is not a message', readServerMessage({ detail: '   ' }), null);
eq('no body', readServerMessage(null), null);
eq('plain string body', readServerMessage('nope'), null);
eq('an overlong message is dropped', readServerMessage({ detail: 'x'.repeat(400) }), null);

const fields = fieldErrorsFromValidation({
  detail: [
    { loc: ['body', 'caption'], msg: 'Caption is too long' },
    { loc: ['body', 'is_public'], msg: 'Only completed tasks can be public' },
    { loc: ['body', 'other'], msg: 'ignored' },
  ],
});
eq('caption field error', fields.caption, 'Caption is too long');
eq('visibility field error', fields.is_public, 'Only completed tasks can be public');
eq('unknown loc is ignored', Object.keys(fields).sort(), ['caption', 'is_public']);
eq('no detail → no field errors', fieldErrorsFromValidation({}), {});

/* ── response ────────────────────────────────────────────────────────────── */
const updated = normalizeUpdatedMedia(
  row({ is_public: true, can_be_public: true, caption: '  Fixed  ' })
);
check('a documented row is accepted', updated !== null);
eq('the accepted row keeps its caption raw', updated?.caption, '  Fixed  ');
eq('missing id → rejected', normalizeUpdatedMedia(row({ id: 0 })), null);
eq('missing is_public → rejected', normalizeUpdatedMedia(row({ is_public: undefined })), null);
eq('missing can_be_public → rejected', normalizeUpdatedMedia(row({ can_be_public: undefined })), null);
eq('missing media_type → rejected', normalizeUpdatedMedia(row({ media_type: undefined })), null);
eq('non-object → rejected', normalizeUpdatedMedia('ok'), null);

/* ── public representation ───────────────────────────────────────────────── */
check(
  'public + COMPLETED is displayable',
  publicDisplayMedia(normalizeUpdatedMedia(row({ is_public: true }))!, BASE) !== null
);
eq(
  'private is removed from public views',
  publicDisplayMedia(normalizeUpdatedMedia(row({ is_public: false }))!, BASE),
  null
);
eq(
  'non-COMPLETED is removed from public views',
  publicDisplayMedia(normalizeUpdatedMedia(row({ is_public: true, feedback_type: 'DISPUTE' }))!, BASE),
  null
);
eq(
  'a row without a URL is removed from public views',
  publicDisplayMedia(normalizeUpdatedMedia(row({ is_public: true, url: null }))!, BASE),
  null
);

/* ── my media fields ─────────────────────────────────────────────────────── */
eq('trimmed caption is kept', updatedMyMediaFields(normalizeUpdatedMedia(row({ caption: ' Hi ' }))!), {
  caption: 'Hi',
  isPublic: false,
  canBePublic: true,
});
eq('blank caption clears', updatedMyMediaFields(normalizeUpdatedMedia(row({ caption: '  ' }))!), {
  caption: null,
  isPublic: false,
  canBePublic: true,
});

/* ── editor view model ───────────────────────────────────────────────────── */
eq('toEditableMedia keeps the flags', toEditableMedia(editable), editable);
check(
  'a private row is still editable',
  editableFromMediaItem(row({ is_public: false }) as any, BASE) !== null
);
eq('a row without an id cannot be edited', editableFromMediaItem(row({ id: 0 }) as any, BASE), null);
check(
  'a non-COMPLETED row is still editable by its owner',
  editableFromMediaItem(row({ feedback_type: 'DISPUTE', is_public: false }) as any, BASE) !== null
);
eq(
  'a row without a usable URL cannot be edited',
  editableFromMediaItem(row({ url: null }) as any, BASE),
  null
);

/* ── list transform ──────────────────────────────────────────────────────── */
const list = [media(1), media(2), media(3)];
const replaced = applyMediaToMediaList(list, 2, { ...media(2, 'New'), url: 'https://cdn.test/2b.jpg' });
check('replace reports a change', replaced.changed);
eq('replace keeps order and position', replaced.media.map((m) => m.id), [1, 2, 3]);
eq('replace updates the caption', replaced.media[1].caption, 'New');

const removed = applyMediaToMediaList(list, 2, null);
eq('remove drops the photo', removed.media.map((m) => m.id), [1, 3]);
const untouched = applyMediaToMediaList(list, 99, null);
eq('an absent id is not a change', untouched.changed, false);
check('an absent id returns the same array', untouched.media === list);

/* ── group transform ─────────────────────────────────────────────────────── */
const groups = [
  { serviceId: 3, media: [media(1), media(2)], rawCount: 2, mayHaveMore: false },
  { serviceId: 4, media: [media(3)], rawCount: 1, mayHaveMore: false },
];
const groupReplace = applyMediaToGroups(groups, 2, media(2, 'Edited'));
eq('the group is patched in place', groupReplace.groups[0].media[1].caption, 'Edited');
eq('other groups are untouched', groupReplace.groups[1].media.map((m) => m.id), [3]);

const groupRemove = applyMediaToGroups(groups, 2, null);
eq('removal updates the list', groupRemove.groups[0].media.map((m) => m.id), [1]);
eq('removal decrements rawCount', groupRemove.groups[0].rawCount, 1);

const emptied = applyMediaToGroups(groups, 3, null);
eq('a group left empty is dropped', emptied.groups.map((g) => g.serviceId), [3]);
const groupUntouched = applyMediaToGroups(groups, 99, null);
eq('an absent id changes no group', groupUntouched.changed, false);
check('an absent id returns the same array', groupUntouched.groups === groups);

/* ── report ──────────────────────────────────────────────────────────────── */
console.log(
  `mediaEdit: ${passed}/${passed + failures.length} assertions passed` +
    (failures.length ? ` — ${failures.join(' | ')}` : '')
);
if (failures.length > 0) {
  throw new Error('mediaEdit tests failed');
}
