/**
 * Step-1 rules after the title field was removed and attachments were added:
 *
 *   • the API title is derived from the selected service (still REQUIRED by
 *     JobCreate: minLength 3 / maxLength 150);
 *   • the description counter's single source of truth: count, hard clamp and
 *     the three colour states;
 *   • the attachment queue's app-side limits (the API documents none).
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import {
  DESC_WORD_MAX,
  DESC_WORD_WARN,
  JOB_TITLE_MAX,
  buildCreateJobRequest,
  clampToWordLimit,
  countWords,
  titleForService,
  wordCounterTone,
} from '../jobCreate';
import {
  ACCEPTED_ATTACHMENT_MIME,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  addToAttachmentQueue,
  formatBytes,
  isAcceptedMime,
  mimeFromName,
  remainingSlots,
  type AttachmentDraft,
} from '../jobAttachments';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean) {
  if (ok) {
    passed += 1;
  } else {
    failures.push(label);
    console.log(`FAIL ${label}`);
  }
}

function eq<T>(label: string, actual: T, expected: T) {
  check(`${label} (got ${String(actual)}, want ${String(expected)})`, actual === expected);
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

// ── Title derived from the service ────────────────────────────────────────
eq('the service title is the job title', titleForService('Accountant'), 'Accountant');
eq('a two-letter title is widened to the schema minimum', titleForService('AC'), 'AC service');
eq('surrounding whitespace is trimmed', titleForService('  Plumber  '), 'Plumber');
eq('no service falls back to a legal title', titleForService(null), 'Service request');
eq('a blank service falls back too', titleForService('   '), 'Service request');
eq(
  'the schema maximum is enforced',
  titleForService('x'.repeat(JOB_TITLE_MAX + 25)).length,
  JOB_TITLE_MAX
);
check('the derived title is never shorter than 3', titleForService('A').length >= 3);

// ── The counter's single source of truth ──────────────────────────────────
eq('an empty description is 0 words', countWords(''), 0);
eq('whitespace only is 0 words', countWords('   \n\t '), 0);
eq('one word is 1', countWords('hello'), 1);
eq('two words are 2', countWords('hello world'), 2);
eq('newlines and repeated spaces do not create words', countWords('a\n\n b   c\t'), 3);
eq('leading/trailing whitespace is ignored', countWords('  hello world  '), 2);
eq('typing grows the count', countWords('paint') , 1);
eq('space + word grows it again', countWords('paint the'), 2);
eq('deleting shrinks it', countWords('paint'), 1);
eq('a paste is counted in full', countWords(words(120)), 120);
eq('500 words counts as 500', countWords(words(500)), 500);

const long = words(600);
eq('a paste over the ceiling is truncated to 500', countWords(clampToWordLimit(long)), DESC_WORD_MAX);
eq('the truncation keeps the FIRST words', clampToWordLimit(long).startsWith('w0 w1 w2'), true);
eq('text under the ceiling is returned untouched', clampToWordLimit('a  b\nc'), 'a  b\nc');
eq('the default ceiling is the schema’s 500', DESC_WORD_MAX, 500);
eq('typing the 501st word is refused', countWords(clampToWordLimit(`${words(500)} extra`)), 500);
eq('a custom ceiling is respected', countWords(clampToWordLimit(words(10), 4)), 4);

// The hidden "Preferred time" line must never push the stored description over
// the backend's own 500-word ceiling (it would be an avoidable 422).
const request = buildCreateJobRequest({
  serviceId: 1,
  serviceCategoryId: 2,
  title: titleForService('Accountant'),
  description: words(DESC_WORD_MAX),
  preferredTimeLine: 'Preferred time: 8:00 AM - 11:00 AM',
  requestType: 'regular',
  bookingType: 'one_time',
  scheduledAtIso: '2026-10-21T08:00:00.000Z',
  expectedHours: 1,
  countryId: 1,
  countyId: 2,
  cityId: 3,
  houseNumber: '1',
  streetAddress: 'Main street',
  postalCode: '10111',
  landmark: '',
  formattedAddress: '',
  isDraft: false,
});
check(
  '500 typed words plus the time line still fit the backend ceiling',
  countWords(request.description) <= DESC_WORD_MAX
);
check(
  'the time line survives the clamp',
  (request.description ?? '').endsWith('Preferred time: 8:00 AM - 11:00 AM')
);
check('the typed words are kept, only the overflow is dropped', (request.description ?? '').startsWith('w0 w1'));
eq('the counter is normal below the warning band', wordCounterTone(0), 'normal');
eq('the counter is normal just under it', wordCounterTone(DESC_WORD_WARN - 1), 'normal');
eq('the counter warns at 450', wordCounterTone(DESC_WORD_WARN), 'warn');
eq('the counter still warns at 499', wordCounterTone(499), 'warn');
eq('the counter is an error at exactly 500', wordCounterTone(500), 'error');
eq('the counter stays an error above it', wordCounterTone(712), 'error');

// ── Attachment guard rails ────────────────────────────────────────────────
check('jpeg is accepted', isAcceptedMime('image/jpeg'));
check('png is accepted', isAcceptedMime('image/png'));
check('webp is accepted', isAcceptedMime('image/webp'));
check('heic is not (it must be converted first)', !isAcceptedMime('image/heic'));
check('an empty mime is not accepted', !isAcceptedMime(''));
eq('the accepted list is exactly the three formats', ACCEPTED_ATTACHMENT_MIME.length, 3);
eq('a .png name maps to png', mimeFromName('photo.PNG'), 'image/png');
eq('a .webp name maps to webp', mimeFromName('a.webp'), 'image/webp');
eq('a .heic name maps to heic', mimeFromName('a.heic'), 'image/heic');
eq('an unknown name defaults to jpeg', mimeFromName('a.jpg'), 'image/jpeg');

eq('bytes are shown in MB above 1 MB', formatBytes(2.5 * 1024 * 1024), '2.5 MB');
eq('kilobytes below 1 MB', formatBytes(840 * 1024), '840 KB');
eq('a missing size is 0 KB', formatBytes(null), '0 KB');

const file = (id: string, size = 1024, mimeType = 'image/jpeg'): AttachmentDraft => ({
  id,
  uri: `file:///${id}.jpg`,
  name: `${id}.jpg`,
  mimeType,
  size,
});

let queue = addToAttachmentQueue([], [file('a'), file('b')]);
eq('two picked files join the queue', queue.accepted.length, 2);
eq('nothing is rejected', queue.rejected.length, 0);

queue = addToAttachmentQueue([], [file('a'), file('a')]);
eq('the same photo picked twice is ignored', queue.accepted.length, 1);
eq('and is not reported as an error', queue.rejected.length, 0);

queue = addToAttachmentQueue(
  [file('a'), file('b'), file('c'), file('d'), file('e')],
  [file('f')],
  MAX_ATTACHMENTS
);
eq('the queue never exceeds the maximum', queue.accepted.length, MAX_ATTACHMENTS);
eq('the extra file is rejected as too many', queue.rejected[0].reason, 'too_many');
eq('the rejection names the file', queue.rejected[0].name, 'f.jpg');

queue = addToAttachmentQueue([], [file('big', MAX_ATTACHMENT_BYTES + 1)]);
eq('an oversized file is rejected', queue.rejected[0].reason, 'too_large');
eq('and does not enter the queue', queue.accepted.length, 0);

queue = addToAttachmentQueue([], [file('heic', 1024, 'image/heic')]);
eq('an unsupported format is rejected', queue.rejected[0].reason, 'type');

queue = addToAttachmentQueue([], [file('a'), file('big', MAX_ATTACHMENT_BYTES + 1), file('b')]);
eq('good files still go through around a bad one', queue.accepted.length, 2);
eq('the bad one is reported once', queue.rejected.length, 1);

eq('remaining slots shrink as files are added', remainingSlots(2), MAX_ATTACHMENTS - 2);
eq('remaining slots never go negative', remainingSlots(MAX_ATTACHMENTS + 3), 0);

console.log(`postDetails: ${passed} checks, ${failures.length} failure(s)`);
if (failures.length > 0) throw new Error(`${failures.length} postDetails check(s) failed`);
