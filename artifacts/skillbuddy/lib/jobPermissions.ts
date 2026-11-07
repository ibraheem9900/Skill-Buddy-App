/**
 * jobPermissions.ts — WHO may do WHAT on a job, in one matrix.
 *
 * THE BUG (boss screenshot): the SkillBuddy Pilot saw "Place a Bid" TOGETHER
 * WITH "Edit Job", "Restart Timer" and "Convert to Urgent" on the same job.
 *
 * WHY: the screen rendered every action from `visibleJobActions(job)`, which
 * only reads the BACKEND's permission flags (`is_editable`, `can_restart_timer`,
 * `can_convert_to_urgent`, …). The backend computes those flags for the JOB, not
 * for the viewer — they say "this job is still editable", not "you own it". Only
 * `cancel` was additionally filtered by the active role. So a provider looking at
 * someone else's open job inherited the owner's actions.
 *
 * THE RULE:
 *   OWNER  = `job.client_id` equals the signed-in user's id. The active role
 *            does NOT decide ownership: an owner who last switched the app to
 *            PILOT mode still owns their job and must still see Edit / View
 *            bids / Restart / Convert / Cancel. Every owner action additionally
 *            requires the backend's own flag for it.
 *   PILOT  = the viewer is NOT the owner and the active role is PROVIDER. The
 *            pilot may only bid / see their own bid.
 *
 * Both checks are used: visibility (what renders) AND the handlers themselves,
 * so a stale render can never fire an owner request.
 */

import type { JobResponse } from '@/types';

export type JobActorRole = 'CLIENT' | 'PROVIDER' | null | undefined;

export interface JobPermissionJob
  extends Pick<
    JobResponse,
    | 'client_id'
    | 'is_editable'
    | 'is_cancellable'
    | 'can_restart_timer'
    | 'can_convert_to_regular'
    | 'can_convert_to_urgent'
    | 'is_bidding_open'
    | 'status'
    | 'assigned_provider_id'
  > {}

export interface JobPermissions {
  /** The signed-in user owns this job AND is acting as the client. */
  isOwner: boolean;
  /** The viewer is in PILOT mode (and therefore not the owner). */
  isProviderViewer: boolean;
  canEditJob: boolean;
  canEditAddress: boolean;
  canRestartTimer: boolean;
  canConvertToRegular: boolean;
  canConvertToUrgent: boolean;
  canCancelJob: boolean;
  canViewBids: boolean;
  canAssignProvider: boolean;
  canConfirmPayment: boolean;
  /** Reposting is editing a finished job — owner only. */
  canRepost: boolean;
  canPlaceBid: boolean;
  canViewOwnBid: boolean;
}

/**
 * Compare ids that arrive as different types: `user.id` is a STRING from
 * /users/me while `job.client_id` is a NUMBER. A naive `===` would make every
 * real owner look like a stranger (and, in the other direction, a coercion bug
 * could make a stranger look like the owner), so both sides are normalised once.
 */
export function sameUserId(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const left = String(a).trim();
  const right = String(b).trim();
  if (left.length === 0 || right.length === 0) return false;
  return left === right;
}

/** The whole matrix for one job, one signed-in user and one active role. */
export function jobPermissions(
  job: JobPermissionJob | null | undefined,
  role: JobActorRole,
  userId: string | number | null | undefined
): JobPermissions {
  // Ownership is an id fact, not a mode. RoleContext restores the user's last
  // chosen role per account, so an owner who used PILOT mode was losing every
  // owner action when the guard started requiring `role === 'CLIENT'`.
  const isOwner = !!job && sameUserId(job.client_id, userId);
  // The owner never gets the provider surface, even while the role switch is on
  // PROVIDER: no "Place a Bid" / pilot view on their own job.
  const isProviderViewer = role === 'PROVIDER' && !isOwner;
  const owner = isOwner && !!job;

  // A draft has no bidding window: the client cannot view bids yet and a pilot
  // cannot bid. Everything else defers to the backend's own flags.
  const notDraft = !!job && job.status !== 'DRAFT';
  const canPlaceBid =
    isProviderViewer &&
    !!job &&
    job.is_bidding_open === true &&
    (job.assigned_provider_id === null || job.assigned_provider_id === undefined);

  return {
    isOwner,
    isProviderViewer,
    canEditJob: owner && job!.is_editable === true,
    canEditAddress: owner && job!.is_editable === true,
    canRestartTimer: owner && job!.can_restart_timer === true,
    canConvertToRegular: owner && job!.can_convert_to_regular === true,
    canConvertToUrgent: owner && job!.can_convert_to_urgent === true,
    canCancelJob: owner && job!.is_cancellable === true,
    canViewBids: owner && notDraft,
    canAssignProvider: owner && notDraft,
    canConfirmPayment: owner && job?.status === 'PAYMENT_PENDING',
    canRepost: owner,
    canPlaceBid,
    canViewOwnBid: isProviderViewer && !!job && notDraft && !canPlaceBid,
  };
}

/** Every action id the owner may run, from the matrix (never from the role alone). */
export function canOwnerRunAction(permissions: JobPermissions): Record<string, boolean> {
  return {
    edit: permissions.canEditJob,
    cancel: permissions.canCancelJob,
    restartTimer: permissions.canRestartTimer,
    convertToRegular: permissions.canConvertToRegular,
    convertToUrgent: permissions.canConvertToUrgent,
  };
}
