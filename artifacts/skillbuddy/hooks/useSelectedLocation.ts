import { useSyncExternalStore } from 'react';
import { registerSessionReset } from '@/lib/sessionReset';

/**
 * The location the user picked on the /location screen.
 *
 * There is no server endpoint for a "current location" preference, so the
 * selection lives in a small module-level store for the app session (like the
 * other catalog caches in this app) rather than in a fixture. The ids/names
 * are exactly what the PUBLIC geo endpoints returned — nothing is invented —
 * and the home header reflects the choice reactively via
 * useSyncExternalStore (tab screens stay mounted, so a plain module read
 * would not re-render).
 */
export interface SelectedLocation {
  countryId: number;
  countryName: string;
  countyId: number | null;
  countyName: string | null;
  cityId: number | null;
  cityName: string | null;
}

let selected: SelectedLocation | null = null;
const listeners = new Set<() => void>();

// Account switch / logout: the chosen posting location is user data too — it
// seeds the Post-a-Job address and must not follow the next account.
registerSessionReset(() => {
  selected = null;
  emit();
});

function emit() {
  for (const listener of listeners) listener();
}

/** Replace the session selection (or clear it with null). */
export function setSelectedLocation(next: SelectedLocation | null) {
  selected = next;
  emit();
}function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SelectedLocation | null {
  return selected;
}

export function useSelectedLocation(): SelectedLocation | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export default useSelectedLocation;
