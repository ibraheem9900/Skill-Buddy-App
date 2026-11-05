/**
 * profileDisplay.ts — how another person is NAMED on a card.
 *
 * Boss screenshot (client's Bids screen): the bidder was titled
 * "zeeshan@gmail.com". An email is not a display name, and it is personal data
 * the other party should not see in a list. The API's `BidProviderSummary.name`
 * is meant to be a display name, but for accounts that never set one it falls
 * back to the email — so the app formats it here, once:
 *
 *   "zeeshan@gmail.com"      → "Zeeshan"
 *   "zeeshan.khan@gmail.com" → "Zeeshan K."
 *   "Zeeshan Khan"           → "Zeeshan Khan"   (a real display name is kept)
 *   ""                       → the translated fallback ("SkillBuddy Pilot")
 *
 * Nothing is invented: only the part before the "@" is used, and only the first
 * letter of a second name part is shown.
 */

export function isEmailLike(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Capitalise a name part without touching the rest ("zeeshan" → "Zeeshan"). */
function capitalise(part: string): string {
  const lower = part.toLocaleLowerCase();
  if (lower.length === 0) return '';
  return lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
}

/**
 * A safe display name. `fallback` is REQUIRED (the caller passes the translated
 * "SkillBuddy Pilot"), so this module never contains user-facing English.
 */
export function providerDisplayName(
  raw: string | null | undefined,
  fallback: string
): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length === 0) return fallback;

  if (!isEmailLike(value)) {
    // A real display name is shown exactly as the profile set it.
    return value;
  }

  const local = value.slice(0, value.indexOf('@'));
  const parts = local.split(/[._-]+/).filter((part) => part.length > 0);
  if (parts.length === 0) return fallback;
  const first = capitalise(parts[0]);
  if (parts.length === 1) return first;
  return `${first} ${capitalise(parts[1]).charAt(0)}.`;
}

/** The initial(s) for the avatar fallback ("Zeeshan K." → "ZK"). */
export function initialsFor(raw: string | null | undefined, fallback = '?'): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length === 0) return fallback;
  const source = isEmailLike(value) ? value.slice(0, value.indexOf('@')).split(/[._-]+/).join(' ') : value;
  const parts = source.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return fallback;
  const first = parts[0].charAt(0);
  const second = parts.length > 1 ? parts[1].charAt(0) : '';
  return (first + second || fallback).toLocaleUpperCase();
}

/**
 * A public-facing email check for the delivery audit: this text must never be
 * rendered as a title. Kept next to the formatter so the rule and its use share
 * one definition.
 */
export function containsEmail(value: string | null | undefined): boolean {
  return typeof value === 'string' && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value);
}
