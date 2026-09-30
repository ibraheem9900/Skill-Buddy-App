/**
 * sanitizeRichText.ts
 *
 * Server-provided rich-text fields (`description`, `what_to_expect` on the
 * service endpoints) may contain HTML markup. React Native has NO DOM, so
 * raw tags would render as literal "<p>…</p>" text on screen — the mobile
 * app has no react-native-render-html / webView dependency, so we sanitize
 * to clean plain text instead of rendering markup.
 *
 * This is the app-wide sanitizer for that pattern (flagged to the user: it
 * is NEW, not a reuse — no sanitized-HTML component existed in the app).
 *
 * Pipeline (dependency-free, mirror-safe against malformed input):
 *   1. <br> / block-closing tags → "\n" so paragraphs stay visually separated
 *   2. strip <script>/<style> blocks WITH their content (never leak their text)
 *   3. strip every remaining <tag> (also malformed "< img", unclosed tags)
 *   4. decode the handful of entities RN cannot render
 *   5. collapse whitespace runs (but keep intentional line breaks)
 *   6. trim
 *
 * Returns null for null/empty input so callers can fall back cleanly.
 */

// Block-level tags whose closing tag starts a new line.
const BLOCK_CLOSE = /<\/(?:p|div|h[1-6]|li|ul|ol|tr|table|blockquote|section|article)>/gi;

const SCRIPT_STYLE = /<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi;
const ANY_TAG = /<[^>]*>?/g;

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&hellip;': '…',
  '&mdash;': '—',
  '&ndash;': '–',
  '&euro;': '€',
};

export function sanitizeRichText(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;

  let text = raw;
  if (/<[a-z!/][^>]*>/i.test(text)) {
    text = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(BLOCK_CLOSE, '\n')
      .replace(SCRIPT_STYLE, ' ')
      .replace(ANY_TAG, '');
  }

  text = text.replace(/&(?:nbsp|amp|lt|gt|quot|#39|apos|hellip|mdash|ndash|euro);/gi, (m) => {
    const decoded = ENTITIES[m.toLowerCase()];
    return decoded ?? m;
  });

  // Collapse space/tab runs, trim each line, drop empty line runs > 1,
  // and drop leading/trailing blank lines.
  text = text
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();

  return text.length > 0 ? text : null;
}

export default sanitizeRichText;
