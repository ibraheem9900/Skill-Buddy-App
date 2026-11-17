/**
 * Task feedback helpers — the documented List Milestone Feedback contract with
 * defensive handling of the two UNDOCUMENTED arrays and unknown kind/side.
 */
import {
  attachmentUrls,
  authorLabelKind,
  formatTaskFeedbackTime,
  kindLabelKind,
  normalizeTaskFeedback,
  resolveOptionLabels,
  sortTaskFeedback,
  type TaskFeedback,
} from '../taskFeedback';

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

function row(overrides: Partial<TaskFeedback> = {}): TaskFeedback {
  return {
    id: 1,
    job_id: 10,
    milestone_id: 20,
    kind: 'DENIAL',
    author_side: 'CLIENT',
    selected_options: [],
    message: 'Not done',
    attachments: [],
    created_at: '2026-11-15T19:56:24.796Z',
    ...overrides,
  };
}

/* ── Normalising ──────────────────────────────────────────────────────────── */

const live = normalizeTaskFeedback([
  {
    id: 7,
    job_id: 87,
    milestone_id: 161,
    kind: 'DENIAL',
    author_side: 'CLIENT',
    selected_options: [],
    message: 'Task not done as agreed',
    attachments: [],
    created_at: '2026-11-15T19:56:24.796Z',
  },
]);
eq('the documented row survives intact', live[0], row({ id: 7, job_id: 87, milestone_id: 161, message: 'Task not done as agreed' }));

eq('a non-array body is an empty list', normalizeTaskFeedback({ detail: 'x' }), []);
eq('null is an empty list', normalizeTaskFeedback(null), []);
eq(
  'rows without a usable id are dropped',
  normalizeTaskFeedback([{ message: 'no id' }, { id: '3', message: 'string id' }, null, 5]).length,
  0
);
const messy = normalizeTaskFeedback([
  {
    id: 2,
    kind: 42,
    author_side: null,
    selected_options: 'nope',
    message: 99,
    attachments: {},
    created_at: 123,
  },
])[0];
eq('an unknown kind shape becomes an empty string (never a crash)', messy.kind, '');
eq('an unknown author_side shape becomes an empty string', messy.author_side, '');
eq('a non-array selected_options becomes []', messy.selected_options, []);
eq('a non-array attachments becomes []', messy.attachments, []);
eq('a non-string message becomes an empty message', messy.message, '');
eq('a non-string created_at becomes an empty stamp', messy.created_at, '');

/* ── Ordering: OLDEST → NEWEST ────────────────────────────────────────────── */

const ordered = sortTaskFeedback([
  row({ id: 3, created_at: '2026-11-15T21:00:00.000Z' }),
  row({ id: 1, created_at: '2026-11-15T19:00:00.000Z' }),
  row({ id: 2, created_at: '2026-11-15T20:00:00.000Z' }),
]);
eq('items are chronological, oldest first', ordered.map((i) => i.id), [1, 2, 3]);
const broken = sortTaskFeedback([
  row({ id: 5, created_at: 'not-a-date' }),
  row({ id: 6, created_at: '2026-11-15T20:00:00.000Z' }),
]);
eq('an unparseable timestamp goes last', broken.map((i) => i.id), [6, 5]);
eq('same timestamp → id order', sortTaskFeedback([row({ id: 9 }), row({ id: 4 })]).map((i) => i.id), [4, 9]);

/* ── selected_options ─────────────────────────────────────────────────────── */

const lookup = new Map<number, string>([
  [1, 'Work not completed'],
  [2, 'Different from the description'],
  [3, 'Something else'],
]);

eq('ids resolve to labels', resolveOptionLabels([1, 2], lookup), ['Work not completed', 'Different from the description']);
eq('an unresolvable id is skipped, never printed', resolveOptionLabels([1, 987], lookup), ['Work not completed']);
eq('objects with a label are used as-is', resolveOptionLabels([{ label: 'Custom reason' }], lookup), ['Custom reason']);
eq(
  'objects with a name are accepted',
  resolveOptionLabels([{ name: 'Named reason' }], lookup),
  ['Named reason']
);
eq('objects carrying only an id resolve through the lookup', resolveOptionLabels([{ id: 3 }], lookup), ['Something else']);
eq('duplicates collapse', resolveOptionLabels([1, { label: 'Work not completed' }], lookup), ['Work not completed']);
eq('garbage is ignored', resolveOptionLabels([null, undefined, true, [], {}], lookup), []);
eq('a numeric STRING id resolves', resolveOptionLabels(['2'], lookup), ['Different from the description']);
eq('a non-numeric string label is not invented', resolveOptionLabels(['Some label'], lookup), []);
eq('an empty selection is empty', resolveOptionLabels([], lookup), []);

/* ── attachments ──────────────────────────────────────────────────────────── */

eq(
  'plain image urls are kept',
  attachmentUrls(['https://cdn.example.com/a.jpg', 'http://cdn.example.com/b.png']),
  ['https://cdn.example.com/a.jpg', 'http://cdn.example.com/b.png']
);
eq('non-url strings are ignored', attachmentUrls(['not-a-url']), []);
eq('local file uris are allowed', attachmentUrls(['file:///tmp/a.jpg']), ['file:///tmp/a.jpg']);
eq(
  'object urls are found under the documented-ish keys',
  attachmentUrls([
    { url: 'https://cdn.example.com/c.jpg' },
    { file_url: 'https://cdn.example.com/d.jpg' },
    { image_url: 'https://cdn.example.com/e.jpg' },
    { uri: 'https://cdn.example.com/f.jpg' },
  ]),
  [
    'https://cdn.example.com/c.jpg',
    'https://cdn.example.com/d.jpg',
    'https://cdn.example.com/e.jpg',
    'https://cdn.example.com/f.jpg',
  ]
);
eq('non-image objects render nothing', attachmentUrls([{ id: 4, type: 'pdf' }, null, 7]), []);
eq('duplicates collapse', attachmentUrls(['https://x/a.jpg', { url: 'https://x/a.jpg' }]), ['https://x/a.jpg']);

/* ── Labels ───────────────────────────────────────────────────────────────── */

eq('own side reads as You (client)', authorLabelKind('CLIENT', 'CLIENT'), 'you');
eq('own side reads as You (pilot)', authorLabelKind('PROVIDER', 'PROVIDER'), 'you');
eq('client sees Pilot', authorLabelKind('PROVIDER', 'CLIENT'), 'pilot');
eq('pilot sees Client', authorLabelKind('CLIENT', 'PROVIDER'), 'client');
eq('unknown side is neutral', authorLabelKind('ADMIN', 'CLIENT'), 'participant');
eq('lowercase side still maps', authorLabelKind('client', 'PROVIDER'), 'client');

eq('DENIAL is a denial', kindLabelKind('DENIAL'), 'denial');
eq('DISPUTE is a dispute', kindLabelKind('DISPUTE'), 'dispute');
eq('an unknown kind falls back', kindLabelKind('ESCALATION'), 'other');
eq('an empty kind falls back', kindLabelKind(''), 'other');

/* ── Time ─────────────────────────────────────────────────────────────────── */

const formatted = formatTaskFeedbackTime('2026-11-15T19:56:24.796Z', 'en');
check('a real stamp formats with a year and a time', /\d{4}/.test(formatted) && formatted.includes(':'));
eq('an unusable stamp renders nothing', formatTaskFeedbackTime('garbage', 'en'), '');
eq('an empty stamp renders nothing', formatTaskFeedbackTime('', 'en'), '');
check(
  'an unknown language still formats',
  formatTaskFeedbackTime('2026-11-15T19:56:24.796Z', 'ru').length > 0
);
const zoned = formatTaskFeedbackTime('2026-11-15T19:56:24Z', 'en');
const naive = formatTaskFeedbackTime('2026-11-15T19:56:24', 'en');
eq('a marker-less stamp is read as UTC, like the rest of the app', naive, zoned);

if (failures.length > 0) {
  console.error(`taskFeedback: ${passed}/${passed + failures.length} assertions passed`);
  for (const failure of failures) console.error(`  ✕ ${failure}`);
  throw new Error('taskFeedback tests failed');
}
console.log(`taskFeedback: ${passed}/${passed} assertions passed`);
