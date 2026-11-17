import { useMemo } from 'react';
import { useFeedbackOptions } from '@/hooks/useFeedbackOptions';

/**
 * id → label for every feedback option a Task history OR a review can
 * reference.
 *
 * `selected_options` items are undocumented; when they are option IDS they can
 * only be turned into labels through GET /api/v1/feedback/options, and that
 * endpoint is per-context. A Task can carry a denial or a dispute from either
 * side, and a job review comes from CLIENT_REVIEW or PROVIDER_REVIEW — so all
 * five contexts are loaded (each already session-cached by useFeedbackOptions)
 * and merged into ONE lookup. Ids that are not found are skipped by the
 * renderer instead of being printed.
 */
export function useFeedbackOptionLabels() {
  const denial = useFeedbackOptions('MILESTONE_DENIAL');
  const disputeClient = useFeedbackOptions('DISPUTE_BY_CLIENT');
  const disputeProvider = useFeedbackOptions('DISPUTE_BY_PROVIDER');
  const reviewClient = useFeedbackOptions('CLIENT_REVIEW');
  const reviewProvider = useFeedbackOptions('PROVIDER_REVIEW');

  const labels = useMemo(() => {
    const map = new Map<number, string>();
    for (const list of [
      denial.options,
      disputeClient.options,
      disputeProvider.options,
      reviewClient.options,
      reviewProvider.options,
    ]) {
      for (const option of list) map.set(option.id, option.label);
    }
    return map;
  }, [
    denial.options,
    disputeClient.options,
    disputeProvider.options,
    reviewClient.options,
    reviewProvider.options,
  ]);

  const loading = [denial, disputeClient, disputeProvider, reviewClient, reviewProvider].some(
    (state) => state.status === 'loading'
  );

  return { labels, loading };
}

export default useFeedbackOptionLabels;
