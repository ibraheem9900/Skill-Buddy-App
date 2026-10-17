import { useEffect, useState } from 'react';
import { isNearbyJobGone, subscribeNearbyJobGone } from '@/lib/nearbyAvailability';

/**
 * Is this job known to have left the provider's nearby feed?
 *
 * `job.nearby_closed` (taken, cancelled, or no longer OPEN) is remembered by
 * lib/nearbyAvailability, so the job screen can show its "no longer available"
 * state even though the event was delivered to the feed. A job that comes back
 * in a fresh list clears the verdict.
 */
export function useNearbyJobGone(jobId: number | null | undefined): boolean {
  const [gone, setGone] = useState<boolean>(() => isNearbyJobGone(jobId));

  useEffect(() => {
    if (typeof jobId !== 'number') {
      setGone(false);
      return;
    }
    setGone(isNearbyJobGone(jobId));
    return subscribeNearbyJobGone(jobId, () => setGone(isNearbyJobGone(jobId)));
  }, [jobId]);

  return gone;
}

export default useNearbyJobGone;
