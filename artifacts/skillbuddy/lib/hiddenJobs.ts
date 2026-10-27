import AsyncStorage from '@react-native-async-storage/async-storage';
import { hiddenJobsKey, sanitizeHiddenIds } from '@/lib/jobRemoval';

/**
 * hiddenJobs.ts — the AsyncStorage half of the client's "Remove from my list".
 *
 * The RULES (which statuses may be removed, how the id list behaves) live in
 * lib/jobRemoval.ts, which is pure and unit-tested. This module only persists
 * them: per-user key, read on mount, write on every change, and neither
 * direction ever throws — a storage failure must not break the list.
 *
 * LOCAL-ONLY BY DESIGN: no delete/archive/hide job endpoint exists (see the
 * report), so a removed job is hidden on THIS device for THIS user id only.
 */

export {
  REMOVABLE_JOB_STATUSES,
  addHiddenId,
  canRemoveJob,
  filterHiddenJobs,
  hiddenJobsKey,
  removeHiddenId,
  removalReason,
  sanitizeHiddenIds,
} from '@/lib/jobRemoval';

/** The hidden ids for this user (a read failure reads as none). */
export async function readHiddenJobIds(
  userId: number | string | null | undefined
): Promise<number[]> {
  try {
    const raw = await AsyncStorage.getItem(hiddenJobsKey(userId));
    return sanitizeHiddenIds(raw);
  } catch {
    return [];
  }
}

/** Persist the hidden ids for this user (returns false when the write failed). */
export async function writeHiddenJobIds(
  userId: number | string | null | undefined,
  ids: readonly number[]
): Promise<boolean> {
  try {
    await AsyncStorage.setItem(hiddenJobsKey(userId), JSON.stringify(Array.from(ids)));
    return true;
  } catch {
    return false;
  }
}
