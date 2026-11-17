/**
 * Feedback helpers — the documented GET /api/v1/feedback/options contract plus
 * the one-screen/seven-context rules (sort order, role split, "other" text).
 */
import {
  FEEDBACK_CONTEXTS,
  MAX_DISPUTE_IMAGES,
  classifyFeedbackFailure,
  feedbackCanSubmit,
  feedbackKind,
  feedbackOptionsAsChips,
  feedbackProblem,
  feedbackRole,
  feedbackShowsImages,
  feedbackShowsRating,
  firstValidationMessage,
  isFeedbackContext,
  normalizeFeedbackOptions,
  selectedFeedbackOption,
  sortFeedbackOptions,
  type FeedbackOption,
} from '../feedback';

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

/* ── Contexts ─────────────────────────────────────────────────────────────── */

eq('all seven contexts are known', FEEDBACK_CONTEXTS.length, 7);
check('CLIENT_REVIEW is valid', isFeedbackContext('CLIENT_REVIEW'));
check('MILESTONE_DENIAL is valid', isFeedbackContext('MILESTONE_DENIAL'));
check('lowercase is not valid', !isFeedbackContext('client_review'));
check('null is not valid', !isFeedbackContext(null));

eq('CLIENT_REVIEW is the client’s', feedbackRole('CLIENT_REVIEW'), 'CLIENT');
eq('MILESTONE_DENIAL is the client’s', feedbackRole('MILESTONE_DENIAL'), 'CLIENT');
eq('DISPUTE_BY_CLIENT is the client’s', feedbackRole('DISPUTE_BY_CLIENT'), 'CLIENT');
eq('CLIENT_CANCELLATION is the client’s', feedbackRole('CLIENT_CANCELLATION'), 'CLIENT');
eq('PROVIDER_REVIEW is the pilot’s', feedbackRole('PROVIDER_REVIEW'), 'PROVIDER');
eq('DISPUTE_BY_PROVIDER is the pilot’s', feedbackRole('DISPUTE_BY_PROVIDER'), 'PROVIDER');
eq('PROVIDER_CANCELLATION is the pilot’s', feedbackRole('PROVIDER_CANCELLATION'), 'PROVIDER');
check('no context maps to both roles', new Set(FEEDBACK_CONTEXTS.map(feedbackRole)).size === 2);

eq('reviews are reviews', feedbackKind('PROVIDER_REVIEW'), 'review');
eq('denial is a denial', feedbackKind('MILESTONE_DENIAL'), 'denial');
eq('dispute is a dispute', feedbackKind('DISPUTE_BY_PROVIDER'), 'dispute');
eq('cancellation is a cancellation', feedbackKind('CLIENT_CANCELLATION'), 'cancellation');

check('only reviews show stars', feedbackShowsRating('CLIENT_REVIEW') && !feedbackShowsRating('MILESTONE_DENIAL'));
check('only reviews use chips', feedbackOptionsAsChips('PROVIDER_REVIEW') && !feedbackOptionsAsChips('DISPUTE_BY_CLIENT'));
check('only disputes show photos', feedbackShowsImages('DISPUTE_BY_CLIENT') && !feedbackShowsImages('CLIENT_REVIEW'));

/* ── Options ──────────────────────────────────────────────────────────────── */

const raw: unknown = [
  { id: 3, context: 'CLIENT_REVIEW', label: 'Late', is_other: false, sort_order: 30 },
  { id: 1, context: 'CLIENT_REVIEW', label: 'Great work', is_other: false, sort_order: 10 },
  { id: 2, context: 'CLIENT_REVIEW', label: 'Something else', is_other: true, sort_order: 20 },
];
const sorted = normalizeFeedbackOptions(raw);
eq('options come back in sort_order order', sorted.map((o) => o.id), [1, 2, 3]);
eq('labels are untouched', sorted.map((o) => o.label), ['Great work', 'Something else', 'Late']);
eq('is_other survives', sorted[1].is_other, true);

eq(
  'ties break on id so the list never reshuffles',
  sortFeedbackOptions([
    { id: 9, context: '', label: 'b', is_other: false, sort_order: 5 },
    { id: 4, context: '', label: 'a', is_other: false, sort_order: 5 },
  ]).map((o) => o.id),
  [4, 9]
);

eq('a non-array body is empty, not a crash', normalizeFeedbackOptions({ detail: 'x' }), []);
eq(
  'malformed rows are dropped',
  normalizeFeedbackOptions([
    { id: '1', label: 'bad id' },
    { id: 2 },
    { id: 3, label: 'good', sort_order: 1 },
    null,
  ]).map((o) => o.id),
  [3]
);
eq(
  'a missing sort_order falls back to 0 instead of NaN',
  normalizeFeedbackOptions([{ id: 1, label: 'x', sort_order: undefined }])[0].sort_order,
  0
);
eq('an unknown sort_order type is 0', normalizeFeedbackOptions([{ id: 1, label: 'x', sort_order: 'high' }])[0].sort_order, 0);
eq('is_other defaults to false', normalizeFeedbackOptions([{ id: 1, label: 'x' }])[0].is_other, false);

const options: FeedbackOption[] = sorted;

eq('selected option is found by id', selectedFeedbackOption(options, 2)?.label, 'Something else');
eq('no selection → null', selectedFeedbackOption(options, null), null);
eq('unknown id → null', selectedFeedbackOption(options, 99), null);

/* ── Required fields ──────────────────────────────────────────────────────── */

const reviewBase = {
  context: 'CLIENT_REVIEW' as const,
  optionId: null as number | null,
  rating: 0,
  otherText: '',
};

eq('a review needs a rating first', feedbackProblem(reviewBase, options), 'rating');
eq(
  'a review with a rating still needs an option',
  feedbackProblem({ ...reviewBase, rating: 4 }, options),
  'option'
);
eq(
  'a complete review may be sent',
  feedbackProblem({ ...reviewBase, rating: 4, optionId: 1 }, options),
  null
);
eq(
  'an "other" option demands the extra text',
  feedbackProblem({ ...reviewBase, rating: 5, optionId: 2 }, options),
  'other'
);
eq(
  'whitespace is not text',
  feedbackProblem({ ...reviewBase, rating: 5, optionId: 2, otherText: '   ' }, options),
  'other'
);
eq(
  'the extra text unblocks submit',
  feedbackProblem({ ...reviewBase, rating: 5, optionId: 2, otherText: 'Third floor buzzer' }, options),
  null
);
eq(
  'the denial context needs no rating',
  feedbackProblem(
    { context: 'MILESTONE_DENIAL', optionId: 1, rating: 0, otherText: '' },
    options
  ),
  null
);
eq(
  'the denial context still needs an option',
  feedbackProblem(
    { context: 'MILESTONE_DENIAL', optionId: null, rating: 0, otherText: '' },
    options
  ),
  'option'
);
check(
  'no options at all → cannot submit',
  !feedbackCanSubmit({ context: 'CLIENT_CANCELLATION', optionId: 1, rating: 0, otherText: '' }, [])
);
check(
  'an out-of-range rating is not accepted',
  feedbackProblem({ ...reviewBase, rating: 6, optionId: 1 }, options) === 'rating'
);

/* ── Photos ───────────────────────────────────────────────────────────────── */

eq('the documented cap is five photos per feedback', MAX_DISPUTE_IMAGES, 5);

/* ── Errors ───────────────────────────────────────────────────────────────── */

eq('offline is a network failure', classifyFeedbackFailure(0), 'network');
eq('401 is unauthorized', classifyFeedbackFailure(401), 'unauthorized');
eq('403 is forbidden', classifyFeedbackFailure(403), 'forbidden');
eq('404 is notfound', classifyFeedbackFailure(404), 'notfound');
eq('422 is validation', classifyFeedbackFailure(422), 'validation');
eq('503 is a server failure', classifyFeedbackFailure(503), 'server');
eq('anything else is unknown', classifyFeedbackFailure(400), 'unknown');

eq(
  'the first 422 message is surfaced',
  firstValidationMessage({
    detail: [{ loc: ['query', 'context'], msg: 'Input should be a valid enum', type: 'enum', input: 'x', ctx: {} }],
  }),
  'Input should be a valid enum'
);
eq(
  'a plain-string detail is surfaced',
  firstValidationMessage({ detail: 'Not authenticated' }),
  'Not authenticated'
);
eq('no detail → null (the screen keeps its own copy)', firstValidationMessage({}), null);
eq('a non-object body → null', firstValidationMessage('oops'), null);

if (failures.length > 0) {
  console.error(`feedback: ${passed}/${passed + failures.length} assertions passed`);
  for (const failure of failures) console.error(`  ✕ ${failure}`);
  throw new Error('feedback tests failed');
}
console.log(`feedback: ${passed}/${passed} assertions passed`);
