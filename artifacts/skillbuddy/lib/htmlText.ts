/**
 * htmlText.ts — ONE converter for the HTML that the API stores in text fields.
 *
 * WHY (boss, Services list): "<p>Reliable daily or one-off dog walks…" was
 * rendered literally on every card, because the API's `description`,
 * `what_to_expect` and other prose fields are HTML (`<p>`, `<p dir="ltr">`,
 * `<br>`, lists, entities like `&nbsp;` and `&ouml;`). React Native has no DOM,
 * so the tags must be converted to plain text by us.
 *
 * TWO SHAPES, ONE IMPLEMENTATION:
 *   • htmlToPlainText(raw) — paragraphs and list items keep their line breaks
 *     (details screens, job descriptions);
 *   • htmlToFlowText(raw)  — the same text on ONE line (cards, previews),
 *     because a 2-line card with hard breaks reads worse than a flowing one.
 *
 * Rules: block end tags and <br> become a line break, <li> becomes "• ",
 * scripts/styles are dropped whole, every other tag is removed (NOT replaced
 * with a space — an inline tag must not split a word), entities are decoded
 * (named + decimal + hex), whitespace is collapsed and the result is trimmed.
 * Unknown entities are left exactly as they are rather than guessed.
 */

/**
 * The named entities that appear in SkillBuddy content (English, Estonian,
 * German, Latvian, Lithuanian). Anything missing is left as written.
 */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
  middot: '·',
  euro: '€',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  times: '×',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  otilde: 'õ',
  Otilde: 'Õ',
  aring: 'å',
  Aring: 'Å',
  oslash: 'ø',
  Oslash: 'Ø',
  aelig: 'æ',
  AElig: 'Æ',
  eacute: 'é',
  Eacute: 'É',
  egrave: 'è',
  agrave: 'à',
  aacute: 'á',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ccedil: 'ç',
  scaron: 'š',
  Scaron: 'Š',
  zcaron: 'ž',
  Zcaron: 'Ž',
  ntilde: 'ñ',
};

const NAMED_ENTITY = /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

/** Decode named, decimal (`&#39;`) and hex (`&#x27;`) entities. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(NAMED_ENTITY, (match, body: string) => {
    if (body.charCodeAt(0) === 35 /* # */) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = ENTITIES[body];
    if (named !== undefined) return named;
    const lower = ENTITIES[body.toLowerCase()];
    return lower !== undefined ? lower : match;
  });
}

/** Does this text contain anything HTML-ish worth converting? */
export function looksLikeHtml(raw: unknown): boolean {
  return typeof raw === 'string' && /<\/?[a-z][^>]*>/i.test(raw);
}

/**
 * HTML → plain text with real line breaks.
 *
 * `description` of "<p>One</p><p>Two</p>" becomes "One\nTwo"; a list becomes
 * "• First\n• Second"; "&nbsp;" becomes a space and "&ouml;" becomes "ö".
 */
export function htmlToPlainText(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';

  let text = raw
    // Comments and whole script/style blocks are never user-visible text.
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    // Explicit breaks.
    .replace(/<br\s*\/?>/gi, '\n')
    // List items become bullets on their own lines.
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/li\s*>/gi, '\n')
    // Block ends become a line break.
    .replace(/<\/(p|div|h[1-6]|ul|ol|li|section|article|blockquote|pre|table|tr|figure)\s*>/gi, '\n')
    // Any remaining tag disappears (never a space: it would split words).
    .replace(/<\/?[a-zA-Z][^>]*>/g, '');

  text = decodeHtmlEntities(text);

  return text
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** The same text on ONE line — for 2–3-line cards and previews. */
export function htmlToFlowText(raw: string | null | undefined): string {
  return htmlToPlainText(raw).replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}
