import { useEffect, useMemo, useState } from 'react';
import { resolveJobStatus, type JobStatusInput, type ResolvedJobStatus } from '@/lib/jobStatus';
import { serverNowMs } from '@/lib/serverClock';

/**
 * The resolver + a one-second ticker that runs ONLY while a deadline is
 * pending. When the deadline passes, the recomputed status flips to
 * BIDDING_CLOSED and the timer stops by itself.
 */
export function useLiveJobStatus(
  job: JobStatusInput | null | undefined
): ResolvedJobStatus {
  const initial = useMemo(
    () => resolveJobStatus(job, { nowMs: serverNowMs() }),
    [job]
  );
  const [resolved, setResolved] = useState(initial);

  useEffect(() => {
    setResolved(resolveJobStatus(job, { nowMs: serverNowMs() }));
    if (!job || !initial.biddingOpen || initial.deadlineMs === null) return;

    const tick = () => {
      const next = resolveJobStatus(job, { nowMs: serverNowMs() });
      setResolved(next);
      if (!next.biddingOpen) {
        clearInterval(interval);
      }
    };
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
    // The job object is replaced by every refetch; initial captures its current
    // resolved window. No dependency on `resolved` (would restart each tick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  return resolved;
}
