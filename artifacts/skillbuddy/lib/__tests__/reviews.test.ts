/**
 * Review helpers — the documented POST /api/v1/jobs/{job_id}/reviews contract
 * (rating 1..5, option_ids ≤20, comment ≤2000, show_publicly default false) and
 * the status mapping measured live against the backend.
 */
import type { FeedbackOption } from '../feedback';
import {
  PENDING_REVIEW_IS_BLOCKING,
  RATING_MAX,
  RATING_MIN,
  isExpired,
  normalizePendingReviews,
  pendingCountKey,
  pendingReviewRole,
  urgencyLevel,
  formatReviewAverage,
  formatReviewDeadline,
  hasProviderReviews,
  normalizeJobReviews,
  normalizeProviderReviewsPage,
  normalizeProviderReviewsSummary,
  normalizeReviewsPage,
  normalizeReviewsSummary,
  providerReviewCountKey,
  reviewCountKey,
  reviewAverageForDisplay,
  normalizeReview,
  parseReviewDeadline,
  reviewState,
  theirReviewVisible,
  timeLeft,
  REVIEW_COMMENT_LIMIT,
  REVIEW_OPTION_LIMIT,
  buildReviewPayload,
  classifyReviewFailure,
  isReviewDraftEmpty,
  ratingLabelIndex,
  reviewCanSubmit,
  reviewComment,
  reviewContext,
  reviewContextForRole,
  reviewErrorMessage,
  reviewFieldErrors,
  reviewProblem,
  selectedOtherOption,
  toggleReviewOption,
  type ReviewDraft,
} from '../reviews';

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

/* ── Context mapping ──────────────────────────────────────────────────────── */

eq('client writes with CLIENT_REVIEW', reviewContext('CLIENT'), 'CLIENT_REVIEW');
eq('pilot writes with PROVIDER_REVIEW', reviewContext('PROVIDER'), 'PROVIDER_REVIEW');
eq('the mapping is one object', Object.keys(reviewContextForRole).sort(), ['CLIENT', 'PROVIDER']);

/* ── Rating ───────────────────────────────────────────────────────────────── */

eq('schema rating bounds', [RATING_MIN, RATING_MAX], [1, 5]);
eq('label index for 1', ratingLabelIndex(1), 0);
eq('label index for 5', ratingLabelIndex(5), 4);
eq('label index for 0', ratingLabelIndex(0), -1);
eq('label index for 6', ratingLabelIndex(6), -1);
eq('label index for 3.5', ratingLabelIndex(3.5), -1);

/* ── Options ──────────────────────────────────────────────────────────────── */

eq('toggle adds', toggleReviewOption([], 3), [3]);
eq('toggle keeps order', toggleReviewOption([3], 5), [3, 5]);
eq('toggle removes', toggleReviewOption([3, 5], 3), [5]);
eq('toggle does not mutate', (() => {
  const ids = [1];
  toggleReviewOption(ids, 2);
  return ids;
})(), [1]);

const many = Array.from({ length: REVIEW_OPTION_LIMIT }, (_, i) => i + 1);
eq('toggle respects maxItems 20', toggleReviewOption(many, 99).length, REVIEW_OPTION_LIMIT);
check('toggle still allows deselect at the cap', !toggleReviewOption(many, 1).includes(1));

const options: FeedbackOption[] = [
  { id: 1, context: 'CLIENT_REVIEW', label: 'On time', is_other: false, sort_order: 0 },
  { id: 2, context: 'CLIENT_REVIEW', label: 'Other', is_other: true, sort_order: 1 },
];
eq('no other selected', selectedOtherOption(options, [1]), null);
eq('other selected', selectedOtherOption(options, [1, 2])?.id, 2);
eq('other must be a real option', selectedOtherOption(options, [42]), null);

/* ── Comment merging ──────────────────────────────────────────────────────── */

const base: ReviewDraft = {
  rating: 4,
  optionIds: [1],
  comment: '  Great work  ',
  otherText: '',
  showPublicly: false,
};

eq('comment is trimmed', reviewComment(base), 'Great work');
eq(
  '"other" text is prepended to the comment',
  reviewComment({ ...base, otherText: 'He arrived late' }),
  'He arrived late\n\nGreat work'
);
eq(
  'only "other" text becomes the comment',
  reviewComment({ ...base, comment: '', otherText: 'He arrived late' }),
  'He arrived late'
);
eq('both empty → empty comment', reviewComment({ ...base, comment: '' }), '');
check(
  'comment is capped at the documented 2000',
  reviewComment({ ...base, comment: 'x'.repeat(3000) }).length === REVIEW_COMMENT_LIMIT
);

/* ── Validation ───────────────────────────────────────────────────────────── */

eq('null draft is invalid', reviewProblem({ ...base, rating: 0 }, options), 'rating');
check('rating 1 is enough without options', reviewCanSubmit({ ...base, optionIds: [], rating: 1 }, options));
check('rating 5 is valid', reviewCanSubmit({ ...base, rating: 5 }, options));
eq('no rating blocks submit', reviewProblem({ ...base, rating: 0 }, options), 'rating');
eq(
  'rating 6 blocks submit',
  reviewProblem({ ...base, rating: 6 }, options),
  'rating'
);
eq(
  'a selected "other" without text blocks submit',
  reviewProblem({ ...base, optionIds: [2], otherText: '  ' }, options),
  'other'
);
check(
  'a selected "other" with text submits',
  reviewCanSubmit({ ...base, optionIds: [2], otherText: 'Late' }, options)
);
check('an empty draft is empty', isReviewDraftEmpty({
  rating: 0,
  optionIds: [],
  comment: '',
  otherText: '',
  showPublicly: false,
}));
check('a rating makes it non-empty', !isReviewDraftEmpty({ ...base, rating: 3 }));

/* ── Payload ──────────────────────────────────────────────────────────────── */

eq('payload matches the documented body', buildReviewPayload(base), {
  rating: 4,
  option_ids: [1],
  comment: 'Great work',
  show_publicly: false,
});
eq('payload keeps show_publicly', buildReviewPayload({ ...base, showPublicly: true }).show_publicly, true);
eq('payload de-duplicates ids', buildReviewPayload({ ...base, optionIds: [1, 1, 2] }).option_ids, [1, 2]);
eq('payload has no extra keys', Object.keys(buildReviewPayload(base)).sort(), [
  'comment',
  'option_ids',
  'rating',
  'show_publicly',
]);

/* ── Failure mapping (measured live) ──────────────────────────────────────── */

eq('offline', classifyReviewFailure(0), 'network');
eq('401', classifyReviewFailure(401), 'unauthorized');
eq('403', classifyReviewFailure(403), 'forbidden');
eq('404', classifyReviewFailure(404), 'notfound');
eq('409 → already reviewed', classifyReviewFailure(409), 'already');
eq('422 le 5', classifyReviewFailure(422), 'validation');
eq('500', classifyReviewFailure(500), 'server');
eq(
  '400 "A job can be reviewed once it is closed." → not closed',
  classifyReviewFailure(400, 'A job can be reviewed once it is closed.'),
  'notclosed'
);
eq(
  '400 window text → window over',
  classifyReviewFailure(400, 'The review window has ended.'),
  'window'
);
eq(
  '400 already text → already reviewed',
  classifyReviewFailure(400, 'You already reviewed this job.'),
  'already'
);
eq('400 without a message → rejected', classifyReviewFailure(400, null), 'rejected');
eq('410 → window over', classifyReviewFailure(410, null), 'window');
eq('418 → unknown', classifyReviewFailure(418), 'unknown');
eq(
  'readable detail is extracted',
  reviewErrorMessage({ detail: 'Job not found.' }),
  'Job not found.'
);
eq('non-string detail is ignored', reviewErrorMessage({ detail: [{ msg: 'x' }] }), null);
eq('a bare string body is ignored', reviewErrorMessage('nope'), null);

/* ── 422 field mapping ────────────────────────────────────────────────────── */

eq(
  'rating loc maps to the rating input',
  reviewFieldErrors({
    detail: [{ loc: ['body', 'rating'], msg: 'Input should be less than or equal to 5' }],
  }),
  ['rating']
);
eq(
  'unknown loc is ignored',
  reviewFieldErrors({ detail: [{ loc: ['body', 'job_id'], msg: 'x' }] }),
  []
);
eq(
  'several fields, de-duplicated',
  reviewFieldErrors({
    detail: [
      { loc: ['body', 'comment'], msg: 'a' },
      { loc: ['body', 'rating'], msg: 'b' },
      { loc: ['body', 'comment'], msg: 'c' },
    ],
  }),
  ['comment', 'rating']
);
eq('a string detail yields no field errors', reviewFieldErrors({ detail: 'Validation error' }), []);
eq('a null body yields no field errors', reviewFieldErrors(null), []);

/* ── GET /api/v1/jobs/{job_id}/reviews ────────────────────────────────────── */

// Measured live: a job that is not closed answers with every key present,
// `review_deadline: null`, `my_review: null`, `their_review: null`.
const emptyReviews = normalizeJobReviews(
  {
    job_id: 82,
    can_review: false,
    review_deadline: null,
    my_review: null,
    their_review: null,
  },
  82
);
eq('empty body keeps the job id', emptyReviews.job_id, 82);
eq('empty body is not reviewable', emptyReviews.can_review, false);
eq('empty body has no deadline', emptyReviews.review_deadline, null);
eq('empty body has no reviews', [emptyReviews.my_review, emptyReviews.their_review], [null, null]);
eq('reviewState of the empty body', reviewState(emptyReviews), 'UNAVAILABLE');
eq('no data → UNAVAILABLE', reviewState(null), 'UNAVAILABLE');
eq('their review not visible', theirReviewVisible(emptyReviews), false);

const fullReview = {
  id: 11,
  job_id: 82,
  author_side: 'CLIENT',
  provider_profile_id: 4,
  client_profile_id: 7,
  rating: 4,
  selected_options: [1, { id: 2, label: 'On time' }],
  comment: 'Great work',
  show_publicly: true,
  status: 'SUBMITTED',
  published_at: null,
  attachments: [],
  created_at: '2026-11-15T21:09:37.308Z',
};

const myOnly = normalizeJobReviews(
  { job_id: 82, can_review: false, review_deadline: null, my_review: fullReview },
  82
);
eq('my review is normalised', myOnly.my_review?.rating, 4);
eq('a missing their_review stays null', myOnly.their_review, null);
eq('reviewState REVIEWED', reviewState(myOnly), 'REVIEWED');
eq('their review still hidden', theirReviewVisible(myOnly), false);

eq(
  'unknown author_side and status survive',
  [normalizeReview({ ...fullReview, author_side: 'ADMIN', status: 'WAT' })?.author_side, normalizeReview({ ...fullReview, author_side: 'ADMIN', status: 'WAT' })?.status],
  ['ADMIN', 'WAT']
);
eq('a null comment becomes an empty string', normalizeReview({ ...fullReview, comment: null })?.comment, '');
eq('a null published_at is kept as null', normalizeReview({ ...fullReview, published_at: null })?.published_at, null);
eq('an empty object is not a review', normalizeReview({}), null);
eq('undefined is not a review', normalizeReview(undefined), null);
eq('a review without a rating is not a review', normalizeReview({ id: 3 }), null);
eq(
  'unreadable body falls back to the neutral shape',
  normalizeJobReviews('nope', 4),
  { job_id: 4, can_review: false, review_deadline: null, my_review: null, their_review: null }
);
eq(
  'their review is visible only when present',
  theirReviewVisible({ their_review: myOnly.my_review }),
  true
);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = Date.parse('2026-11-15T12:00:00.000Z');
const at = (ms: number) => new Date(now + ms).toISOString();

eq('5 minutes left is under a day', timeLeft(at(5 * MINUTE), now).underDay, true);
eq('5 minutes left is not expired', timeLeft(at(5 * MINUTE), now).expired, false);
eq('23 hours left is under a day', timeLeft(at(23 * HOUR), now).underDay, true);
eq('23 hours left reads 0 days', timeLeft(at(23 * HOUR), now).days, 0);
eq('3 days left', timeLeft(at(3 * DAY), now).days, 3);
eq('3 days left is not urgent', timeLeft(at(3 * DAY), now).underDay, false);
eq('a past deadline is expired', timeLeft(at(-MINUTE), now).expired, true);
eq('exactly now is expired', timeLeft(at(0), now).expired, true);
eq('no deadline is not expired', timeLeft(null, now).expired, false);
eq('no deadline is unknown', timeLeft(undefined, now).known, false);
eq('junk deadline is unknown', timeLeft('soon', now).known, false);
eq(
  'a deadline without a zone is read as UTC',
  timeLeft('2026-11-20T12:00:00', now).days,
  5
);

eq(
  'CAN_REVIEW with the deadline still ahead',
  reviewState(
    { can_review: true, review_deadline: at(2 * DAY), my_review: null },
    now
  ),
  'CAN_REVIEW'
);
eq(
  'EXPIRED when can_review is still true but the deadline passed',
  reviewState(
    { can_review: true, review_deadline: at(-DAY), my_review: null },
    now
  ),
  'EXPIRED'
);
eq(
  'my review wins over a passed deadline',
  reviewState({ can_review: false, review_deadline: at(-DAY), my_review: fullReview as never }, now),
  'REVIEWED'
);
eq(
  'can_review false with a future deadline is UNAVAILABLE',
  reviewState(
    { can_review: false, review_deadline: at(DAY), my_review: null },
    now
  ),
  'UNAVAILABLE'
);
eq('formatReviewDeadline returns "" without a date', formatReviewDeadline(null, 'en'), '');
check(
  'formatReviewDeadline formats a real deadline',
  formatReviewDeadline(at(DAY), 'en').length > 0
);
eq('parseReviewDeadline rejects junk', parseReviewDeadline('nope'), null);

/* ── GET /api/v1/reviews/pending ─────────────────────────────────────────── */

const pendingAt = (jobId: number, deadline: string, title = `Job ${jobId}`) => ({
  job_id: jobId,
  title,
  closed_at: at(-DAY),
  review_deadline: deadline,
});

eq('always an array (null)', normalizePendingReviews(null, now), []);
eq('always an array (undefined)', normalizePendingReviews(undefined, now), []);
eq('always an array (garbage)', normalizePendingReviews('nope', now), []);
eq('empty list stays empty', normalizePendingReviews([], now), []);
eq(
  'items without a job id are dropped',
  normalizePendingReviews([{ title: 'x', review_deadline: at(DAY) }], now),
  []
);
eq(
  'expired items are dropped',
  normalizePendingReviews([pendingAt(1, at(-MINUTE)), pendingAt(2, at(2 * DAY))], now).map(
    (item) => item.job_id
  ),
  [2]
);
eq(
  'sorted soonest-first',
  normalizePendingReviews(
    [pendingAt(1, at(3 * DAY)), pendingAt(2, at(5 * MINUTE)), pendingAt(3, at(DAY))],
    now
  ).map((item) => item.job_id),
  [2, 3, 1]
);
eq(
  'an unusable deadline sorts last',
  normalizePendingReviews([pendingAt(1, 'soon'), pendingAt(2, at(2 * DAY))], now).map(
    (item) => item.job_id
  ),
  [2, 1]
);
eq(
  'a missing title becomes empty, never undefined',
  normalizePendingReviews([{ job_id: 4, review_deadline: at(DAY) }], now)[0].title,
  ''
);
eq('count is the filtered length', normalizePendingReviews([
  pendingAt(1, at(-DAY)),
  pendingAt(2, at(DAY)),
  pendingAt(3, at(2 * DAY)),
], now).length, 2);

eq('isExpired: past', isExpired(at(-MINUTE), now), true);
eq('isExpired: future', isExpired(at(MINUTE), now), false);
eq('isExpired: bad date is not expired', isExpired('soon', now), false);
eq('isExpired: null is not expired', isExpired(null, now), false);
eq('urgency 5 minutes', urgencyLevel(at(5 * MINUTE), now), 'SOON');
eq('urgency 23 hours', urgencyLevel(at(23 * HOUR), now), 'SOON');
eq('urgency 3 days', urgencyLevel(at(3 * DAY), now), 'NORMAL');
eq('urgency past', urgencyLevel(at(-MINUTE), now), 'EXPIRED');
eq('urgency bad date', urgencyLevel('soon', now), 'NORMAL');
eq('timeLeft minutes', timeLeft(at(5 * MINUTE), now).minutes, 5);
eq('PENDING_REVIEW_IS_BLOCKING is off', PENDING_REVIEW_IS_BLOCKING, false);

eq('plural en 1', pendingCountKey(1, 'en'), 'fb_pending_count_one');
eq('plural en 0', pendingCountKey(0, 'en'), 'fb_pending_count_other');
eq('plural en 10', pendingCountKey(10, 'en'), 'fb_pending_count_other');
eq('plural de 1', pendingCountKey(1, 'de'), 'fb_pending_count_one');
eq('plural et 21', pendingCountKey(21, 'et'), 'fb_pending_count_other');
eq('plural lv 1', pendingCountKey(1, 'lv'), 'fb_pending_count_one');
eq('plural lv 21', pendingCountKey(21, 'lv'), 'fb_pending_count_one');
eq('plural lv 11', pendingCountKey(11, 'lv'), 'fb_pending_count_other');
eq('plural lt 21', pendingCountKey(21, 'lt'), 'fb_pending_count_one');
eq('plural lt 11', pendingCountKey(11, 'lt'), 'fb_pending_count_other');
eq('plural lt 19', pendingCountKey(19, 'lt'), 'fb_pending_count_other');

eq('role: own job → client', pendingReviewRole({ client_id: 5 }, 5), 'CLIENT');
eq('role: someone else\u2019s job → provider', pendingReviewRole({ client_id: 9 }, 5), 'PROVIDER');
eq('role: no job → null', pendingReviewRole(null, 5), null);
eq('role: no user → null', pendingReviewRole({ client_id: 5 }, null), null);
eq('role: job without client id → null', pendingReviewRole({}, 5), null);
eq('role: non-numeric client id → null', pendingReviewRole({ client_id: '5' }, 5), null);

/* ── GET /api/v1/providers/{provider_id}/reviews ──────────────────────────── */

const provReview = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  job_id: 100 + id,
  author_side: 'CLIENT',
  provider_profile_id: 3,
  client_profile_id: 7,
  rating: 5,
  selected_options: [],
  comment: 'ok',
  show_publicly: true,
  status: 'SUBMITTED',
  published_at: '2026-11-15T10:00:00Z',
  attachments: [],
  created_at: '2026-11-15T10:00:00Z',
  ...extra,
});

eq(
  'provider page: null body → zero summary + empty list',
  normalizeProviderReviewsPage(null),
  { summary: { star_rating: 0, review_average: null, review_count: 0 }, reviews: [] }
);
eq(
  'provider page: missing reviews → []',
  normalizeProviderReviewsPage({ summary: { review_count: 2 } }).reviews.length,
  0
);
eq(
  'provider page: missing summary → zeros',
  normalizeProviderReviewsPage({ reviews: [] }).summary,
  { star_rating: 0, review_average: null, review_count: 0 }
);
eq(
  'provider page: live empty payload',
  normalizeProviderReviewsPage({
    summary: { star_rating: 4, review_average: null, review_count: 0 },
    reviews: [],
  }).summary,
  { star_rating: 4, review_average: null, review_count: 0 }
);
eq(
  'provider page: reviews are normalised and keep SERVER order',
  normalizeProviderReviewsPage({
    summary: { star_rating: 4.3, review_average: 4.33, review_count: 3 },
    reviews: [provReview(3), provReview(1), provReview(2)],
  }).reviews.map((review) => review.id),
  [3, 1, 2]
);
eq(
  'provider page: unknown author_side/status survive untouched',
  (() => {
    const page = normalizeProviderReviewsPage({
      summary: { review_count: 1 },
      reviews: [provReview(1, { status: 'WHATEVER', author_side: 'ADMIN' })],
    });
    return [page.reviews[0]?.status, page.reviews[0]?.author_side];
  })(),
  ['WHATEVER', 'ADMIN']
);
eq(
  'provider page: 105 reviews normalise to 100? no — every item is kept in order',
  normalizeProviderReviewsPage({
    summary: { review_count: 21 },
    reviews: Array.from({ length: 20 }, (_, i) => provReview(i + 1)),
  }).reviews.length,
  20
);

eq('average: no count → null even with stored stars', reviewAverageForDisplay({ star_rating: 4, review_average: null, review_count: 0 }), null);
eq('average: uses review_average', reviewAverageForDisplay({ star_rating: 4, review_average: 4.67, review_count: 3 }), 4.67);
eq('average: falls back to star_rating only with a count', reviewAverageForDisplay({ star_rating: 4.2, review_average: null, review_count: 3 }), 4.2);
eq('average: nothing to show', reviewAverageForDisplay({ star_rating: 0, review_average: null, review_count: 0 }), null);
eq('average: no summary at all', reviewAverageForDisplay(null), null);
eq('hasProviderReviews: zero', hasProviderReviews({ star_rating: 4, review_average: null, review_count: 0 }), false);
eq('hasProviderReviews: one', hasProviderReviews({ star_rating: 4, review_average: 4, review_count: 1 }), true);
eq('format: en one decimal', formatReviewAverage(4.666, 'en'), '4.7');
eq('format: de comma', formatReviewAverage(4.666, 'de'), '4,7');
eq('format: exact 5 keeps a decimal', formatReviewAverage(5, 'en'), '5.0');
eq('format: null → empty', formatReviewAverage(null, 'en'), '');
eq('plural: en 1', providerReviewCountKey(1, 'en'), 'fb_prov_count_one');
eq('plural: en 0', providerReviewCountKey(0, 'en'), 'fb_prov_count_other');
eq('plural: lv 21', providerReviewCountKey(21, 'lv'), 'fb_prov_count_one');
eq('plural: lv 11', providerReviewCountKey(11, 'lv'), 'fb_prov_count_other');
eq('plural: lt 11', providerReviewCountKey(11, 'lt'), 'fb_prov_count_other');
eq('plural: de 1', providerReviewCountKey(1, 'de'), 'fb_prov_count_one');

/* ── GET /api/v1/clients/{client_id}/reviews (shared reader) ──────────────── */

eq(
  'client page: same shape as the provider page',
  normalizeReviewsPage({
    summary: { star_rating: 4, review_average: null, review_count: 0 },
    reviews: [],
  }),
  { summary: { star_rating: 4, review_average: null, review_count: 0 }, reviews: [] }
);
eq(
  'client page: unknown author_side/status still survive',
  (() => {
    const page = normalizeReviewsPage({
      summary: { review_count: 1 },
      reviews: [provReview(9, { author_side: 'PROVIDER', status: 'PENDING_REVIEW' })],
    });
    return [page.reviews[0]?.author_side, page.reviews[0]?.status];
  })(),
  ['PROVIDER', 'PENDING_REVIEW']
);
eq(
  'client page: a 20-item page normalises fully',
  normalizeReviewsPage({
    summary: { review_count: 45 },
    reviews: Array.from({ length: 20 }, (_, i) => provReview(i + 1)),
  }).reviews.length,
  20
);
eq('normalizer aliases point at one implementation', normalizeProviderReviewsPage, normalizeReviewsPage);
eq('summary aliases point at one implementation', normalizeProviderReviewsSummary, normalizeReviewsSummary);
eq('count key alias is the shared helper', providerReviewCountKey, reviewCountKey);
eq('client subject label key exists', reviewContext('PROVIDER'), 'PROVIDER_REVIEW');
eq('provider subject label key exists', reviewContext('CLIENT'), 'CLIENT_REVIEW');

if (failures.length > 0) {
  console.error(`reviews: ${passed}/${passed + failures.length} assertions passed`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  throw new Error('reviews tests failed');
}
console.log(`reviews: ${passed}/${passed} assertions passed`);
