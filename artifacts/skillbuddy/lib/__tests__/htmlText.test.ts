/**
 * The ONE HTML → text converter (Fix 1c): paragraphs and lists keep line
 * breaks, every other tag disappears, entities are decoded, whitespace is
 * collapsed, and cards can ask for the same text on a single line.
 */
import { decodeHtmlEntities, htmlToFlowText, htmlToPlainText, looksLikeHtml } from '../htmlText';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function eq(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    passed += 1;
  } else {
    failures.push(label);
    console.log(`FAIL ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
  }
}

/* ── The boss's exact case: "<p>" before every paragraph ──────────────────── */
eq(
  'a leading <p> is removed from a card description',
  htmlToPlainText('<p>Reliable daily or one-off dog walks</p>'),
  'Reliable daily or one-off dog walks'
);
eq(
  'two paragraphs keep a line break on details screens',
  htmlToPlainText('<p>One</p><p>Two</p>'),
  'One\nTwo'
);
eq(
  'the same two paragraphs flow on one line for a card',
  htmlToFlowText('<p>One</p><p>Two</p>'),
  'One Two'
);
eq(
  'a <p dir="ltr"> with attributes is still just a paragraph',
  htmlToPlainText('<p dir="ltr">Certified electrical repairs</p>'),
  'Certified electrical repairs'
);

/* ── Breaks and lists ─────────────────────────────────────────────────────── */
eq('a <br> becomes a line break', htmlToPlainText('Line one<br>Line two'), 'Line one\nLine two');
eq('a self-closing <br/> becomes a line break', htmlToPlainText('A<br/>B'), 'A\nB');
eq(
  'list items become bullets',
  htmlToPlainText('<ul><li>First</li><li>Second</li></ul>'),
  '• First\n• Second'
);
eq(
  'an ordered list loses its numbers but keeps bullets',
  htmlToPlainText('<ol><li>Step one</li><li>Step two</li></ol>'),
  '• Step one\n• Step two'
);

/* ── Tags that must not split words ───────────────────────────────────────── */
eq('an inline tag never inserts a space', htmlToPlainText('Sk<span>ill</span>Buddy'), 'SkillBuddy');
eq('an unknown tag is removed', htmlToPlainText('<section>Hello</section>'), 'Hello');
eq('a <script> block is dropped whole', htmlToPlainText('A<script>alert(1)</script>B'), 'A B');
eq('a <style> block is dropped whole', htmlToPlainText('A<style>.x{}</style>B'), 'A B');
eq('a comment is dropped', htmlToPlainText('A<!-- hidden -->B'), 'A B');
eq('plain text is passed through untouched', htmlToPlainText('No tags here'), 'No tags here');

/* ── Entities ─────────────────────────────────────────────────────────────── */
eq('&amp; decodes', htmlToPlainText('Cats &amp; dogs'), 'Cats & dogs');
eq('&lt; and &gt; decode', htmlToPlainText('a &lt; b &gt; c'), 'a < b > c');
eq('&quot; decodes', htmlToPlainText('&quot;quoted&quot;'), '"quoted"');
eq('&#39; decodes', htmlToPlainText('it&#39;s'), "it's");
eq('&nbsp; becomes a space', htmlToPlainText('two&nbsp;words'), 'two words');
eq('a decimal entity decodes', htmlToPlainText('caf&#233;'), 'café');
eq('a hex entity decodes', htmlToPlainText('caf&#xE9;'), 'café');
eq('&euro; decodes', htmlToPlainText('&euro;15.00'), '€15.00');
eq('a named entity passes through the decoder', decodeHtmlEntities('&ouml;'), 'ö');
eq('an unknown entity is left as written', htmlToPlainText('&notarealentity;'), '&notarealentity;');

/* ── Whitespace ───────────────────────────────────────────────────────────── */
eq('runs of spaces collapse', htmlToPlainText('a    b'), 'a b');
eq('blank lines collapse to one', htmlToPlainText('<p>a</p><p></p><p>b</p>'), 'a\nb');
eq('the result is trimmed', htmlToPlainText('  <p> hello </p>  '), 'hello');
eq('blank input returns an empty string', htmlToPlainText('   '), '');
eq('null input returns an empty string', htmlToPlainText(null), '');
eq('undefined input returns an empty string', htmlToPlainText(undefined), '');

/* ── Detection ───────────────────────────────────────────────────────────── */
eq('an HTML string is detected', looksLikeHtml('<p>Hello</p>'), true);
eq('plain text is not HTML', looksLikeHtml('Hello'), false);
eq('a non-string is not HTML', looksLikeHtml(null), false);

/* ── Flow text is one line ────────────────────────────────────────────────── */
eq(
  'flow text collapses paragraph breaks',
  htmlToFlowText('<p>Deep cleaning</p><p>for carpets</p>'),
  'Deep cleaning for carpets'
);
eq('flow text drops bullets to inline text', htmlToFlowText('<ul><li>a</li><li>b</li></ul>'), '• a • b');

const total = passed + failures.length;
console.log(`htmlText: ${passed}/${total} assertions passed`);
