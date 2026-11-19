/**
 * mediaEditSession.ts — the tiny hand-off between the control that opens the
 * edit screen and the screen itself.
 *
 * WHY: expo-router passes only STRINGS through the URL. A media row is an
 * object (id, url, caption, visibility flags) and serialising it into query
 * params would expose internal fields and break on long captions. Instead the
 * caller stores the item here for the duration of the navigation, exactly the
 * way the app hands a draft to other popup screens.
 *
 * This module holds NO React state and NO network code; the edit screen reads
 * the current session once when it mounts.
 */
import type { MediaEditable } from '@/lib/mediaEdit';
import type { MediaItem } from '@/types';

export interface MediaEditSession {
  /** The photo being edited, as the owner's list knows it. */
  item: MediaEditable;
  /**
   * Optional: called with the server's updated item right before the screen
   * closes, so the opener can, for example, re-open the viewer on that photo.
   * Wrapped by the caller — never throws into the save flow.
   */
  onSaved?: (item: MediaItem) => void;
}

let session: MediaEditSession | null = null;

/** Store the item the edit screen should show. */
export function startMediaEditSession(next: MediaEditSession): void {
  session = next;
}

/** What the edit screen should show (null when opened without a session). */
export function readMediaEditSession(): MediaEditSession | null {
  return session;
}

/** Drop the session (used after a successful save/test cleanup). */
export function clearMediaEditSession(): void {
  session = null;
}
