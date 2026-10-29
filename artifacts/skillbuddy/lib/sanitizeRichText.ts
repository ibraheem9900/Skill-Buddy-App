/**
 * sanitizeRichText.ts — the nullable wrapper around the ONE HTML converter.
 *
 * Server-provided rich-text fields (`description`, `what_to_expect` on the
 * service endpoints, job descriptions) may contain HTML markup. React Native
 * has NO DOM, so raw tags would render as literal "<p>…</p>" text on screen.
 *
 * The conversion itself now lives in `lib/htmlText.ts` (htmlToPlainText), so
 * the app has exactly ONE implementation: cards use htmlToFlowText, detail
 * screens use htmlToPlainText, and the older call sites that need "null when
 * there is nothing to show" use this thin wrapper.
 */
import { htmlToPlainText } from '@/lib/htmlText';

/** HTML → plain text with line breaks, or null when nothing remains. */
export function sanitizeRichText(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const text = htmlToPlainText(raw);
  return text.length > 0 ? text : null;
}

export default sanitizeRichText;
