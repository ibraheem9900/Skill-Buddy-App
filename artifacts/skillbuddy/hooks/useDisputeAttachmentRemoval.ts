import { removeDisputeImage } from '@/services/feedback';
import {
  useAttachmentRemoval,
  type AttachmentRemoval,
} from '@/hooks/useAttachmentRemoval';

/**
 * Removing an uploaded DISPUTE photo.
 *
 * This is now only a binding: the state machine, the double-tap guard, the
 * 401/403/404/409/422 mapping and the non-optimistic behaviour live in
 * useAttachmentRemoval, which the review-photo flow uses too. Dispute behaviour
 * is unchanged — the same DELETE, the same `stateOf`/`remove`/`retry`/`removing`
 * contract the dispute history already consumes.
 */
export type DisputeAttachmentRemoval = AttachmentRemoval;

export function useDisputeAttachmentRemoval(
  feedbackId: number | null
): DisputeAttachmentRemoval {
  return useAttachmentRemoval(feedbackId, removeDisputeImage);
}

export default useDisputeAttachmentRemoval;
