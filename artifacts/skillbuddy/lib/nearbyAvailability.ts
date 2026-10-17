/**
 * nearbyAvailability.ts
 *
 * "This job is no longer available to bid on" — the one piece of feed state the
 * provider JOB screen cannot read from its own request.
 *
 * WHY IT IS A TINY STORE AND NOT A PROP: the feed and the job/bid screen are
 * different routes. `job.nearby_closed` arrives while the provider is reading a
 * job (the feed that received it may already have been left), and the job's own
 * GET /jobs/{job_id} can lag behind the feed — so the frame's job ids are held
 * here (module scope, not React state) and any screen can ask about one.
 *
 * It is deliberately dumb: a set of job ids plus per-id subscribers. No timers,
 * no network, no persistence — a cold start simply has nothing to remember, and
 * the job's own flags cover that case. No React import, so the rules are
 * unit-testable without a renderer.
 */

const goneJobIds = new Set<number>();
const listeners = new Map<number, Set<() => void>>();

/** `job.nearby_closed` for a job the provider may be looking at right now. */
export function markNearbyJobGone(jobId: number): void {
  if (!Number.isInteger(jobId) || goneJobIds.has(jobId)) return;
  goneJobIds.add(jobId);
  notify(jobId);
}

/**
 * The job is back in the feed (a later refetch listed it again), or it must not
 * be remembered: the state is dropped so the screen renders normally.
 */
export function clearNearbyJobGone(jobId: number): void {
  if (!Number.isInteger(jobId) || !goneJobIds.has(jobId)) return;
  goneJobIds.delete(jobId);
  notify(jobId);
}

/** Should this job be shown as "no longer available"? */
export function isNearbyJobGone(jobId: number | null | undefined): boolean {
  return typeof jobId === 'number' && goneJobIds.has(jobId);
}

/**
 * Watch one job id. The callback runs on every change of THAT id, and the
 * returned function unsubscribes (call it on unmount).
 */
export function subscribeNearbyJobGone(jobId: number, listener: () => void): () => void {
  let set = listeners.get(jobId);
  if (!set) {
    set = new Set();
    listeners.set(jobId, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(jobId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(jobId);
  };
}

/**
 * Forget everything — logout and account switch. Without this, a recycled job
 * id (or simply the next user of the phone) would inherit a stale verdict.
 */
export function resetNearbyAvailability(): void {
  const ids = Array.from(goneJobIds);
  goneJobIds.clear();
  for (const id of ids) notify(id);
}

function notify(jobId: number): void {
  const set = listeners.get(jobId);
  if (!set) return;
  for (const listener of Array.from(set)) {
    try {
      listener();
    } catch {
      // One failing subscriber must never stop the others.
    }
  }
}
