import { canOwnerRunAction, jobPermissions, sameUserId } from '../jobPermissions';
import type { JobPermissionJob } from '../jobPermissions';

/**
 * THE PERMISSION MATRIX (boss screenshot): the SkillBuddy Pilot saw "Place a Bid"
 * together with "Edit Job", "Restart Timer" and "Convert to Urgent" on someone
 * else's open job. Owner actions are now gated on BOTH "I am the client" and
 * "this job is mine".
 */

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean) {
  if (ok) passed += 1;
  else failures.push(label);
}

/** An open, editable job belonging to client 7, with every backend flag open. */
const job: JobPermissionJob = {
  client_id: 7,
  is_editable: true,
  is_cancellable: true,
  can_restart_timer: true,
  can_convert_to_regular: true,
  can_convert_to_urgent: true,
  is_bidding_open: true,
  status: 'OPEN',
  assigned_provider_id: null,
};

/* ── Id comparison across types ───────────────────────────────────────────── */

check('a number id matches the string id from /users/me', sameUserId(7, '7'));
check('a string id matches a number client_id', sameUserId('7', 7));
check('padded ids match', sameUserId(' 7 ', 7));
check('different ids do not match', !sameUserId(7, 8));
check('null is never a match', !sameUserId(null, 7));
check('undefined is never a match', !sameUserId(undefined, 7));
check('empty strings are never a match', !sameUserId('', ''));

/* ── The client who owns the job ─────────────────────────────────────────── */

const owner = jobPermissions(job, 'CLIENT', '7');
check('the owner is recognised', owner.isOwner);
check('the owner may edit', owner.canEditJob);
check('the owner may edit the address', owner.canEditAddress);
check('the owner may restart the timer', owner.canRestartTimer);
check('the owner may convert to regular', owner.canConvertToRegular);
check('the owner may convert to urgent', owner.canConvertToUrgent);
check('the owner may cancel', owner.canCancelJob);
check('the owner may view bids', owner.canViewBids);
check('the owner cannot place a bid on their own job', !owner.canPlaceBid);
check('the owner cannot see a "my bid" block', !owner.canViewOwnBid);

/* ── A provider looking at that SAME job (the reported bug) ──────────────── */

const pilot = jobPermissions(job, 'PROVIDER', '9');
check('a pilot is not the owner', !pilot.isOwner);
check('a pilot may place a bid', pilot.canPlaceBid);
check('a pilot may NOT edit the job', !pilot.canEditJob);
check('a pilot may NOT edit the address', !pilot.canEditAddress);
check('a pilot may NOT restart the timer', !pilot.canRestartTimer);
check('a pilot may NOT convert to regular', !pilot.canConvertToRegular);
check('a pilot may NOT convert to urgent', !pilot.canConvertToUrgent);
check('a pilot may NOT cancel the job', !pilot.canCancelJob);
check('a pilot may NOT view the bids list', !pilot.canViewBids);
check('a pilot may NOT assign a provider', !pilot.canAssignProvider);
check('a pilot may NOT confirm payment', !pilot.canConfirmPayment);
check('a pilot may NOT repost', !pilot.canRepost);
check(
  'NO owner action survives for a pilot',
  Object.values(canOwnerRunAction(pilot)).every((allowed) => allowed === false)
);

/* ── The client id coincidentally matches while acting as a pilot ────────── */

const clientIdAsPilot = jobPermissions(job, 'PROVIDER', '7');
check(
  'the active role decides: client id + PILOT role is NOT the owner',
  !clientIdAsPilot.isOwner
);

/* ── A different client ──────────────────────────────────────────────────── */

const stranger = jobPermissions(job, 'CLIENT', '8');
check('another client is not the owner', !stranger.isOwner);
check('another client may not edit', !stranger.canEditJob);
check('another client may not cancel', !stranger.canCancelJob);
check('another client may not view bids', !stranger.canViewBids);
check('another client is not a pilot either', !stranger.isProviderViewer);

/* ── No role chosen, no user, no job ─────────────────────────────────────── */

const noRole = jobPermissions(job, null, '7');
check('no active role → no owner rights', !noRole.isOwner && !noRole.canEditJob);
check('no active role → no bidding either', !noRole.canPlaceBid);
const noUser = jobPermissions(job, 'CLIENT', null);
check('no signed-in user → no owner rights', !noUser.isOwner);
const noJob = jobPermissions(null, 'CLIENT', '7');
check('no job → nothing is allowed', !noJob.isOwner && !noJob.canPlaceBid && !noJob.canViewOwnBid);

/* ── The backend's flags still rule ──────────────────────────────────────── */

const closedJob: JobPermissionJob = {
  ...job,
  is_editable: false,
  can_restart_timer: false,
  is_bidding_open: false,
};
const closedOwner = jobPermissions(closedJob, 'CLIENT', '7');
check('the owner cannot edit a job the backend closed', !closedOwner.canEditJob);
check('the owner cannot restart a closed timer', !closedOwner.canRestartTimer);
const closedPilot = jobPermissions(closedJob, 'PROVIDER', '9');
check('a pilot cannot bid once bidding closed', !closedPilot.canPlaceBid);
check('a pilot sees their own bid when bidding closed', closedPilot.canViewOwnBid);

const assignedJob: JobPermissionJob = { ...job, is_bidding_open: true, assigned_provider_id: 9 };
const assignedPilot = jobPermissions(assignedJob, 'PROVIDER', '9');
check('nobody bids on a job that already has a provider', !assignedPilot.canPlaceBid);
check('a provider on an assigned job sees their bid block', assignedPilot.canViewOwnBid);

/* ── Drafts ──────────────────────────────────────────────────────────────── */

const draft: JobPermissionJob = { ...job, status: 'DRAFT' };
const draftOwner = jobPermissions(draft, 'CLIENT', '7');
check('a draft is still owned by its client', draftOwner.isOwner);
check('a draft has no bids to view', !draftOwner.canViewBids);
check('a draft cannot be assigned yet', !draftOwner.canAssignProvider);

/* ── Payment + repost ────────────────────────────────────────────────────── */

const paymentPending: JobPermissionJob = { ...job, status: 'PAYMENT_PENDING' };
check(
  'only the owner may confirm payment',
  jobPermissions(paymentPending, 'CLIENT', '7').canConfirmPayment &&
    !jobPermissions(paymentPending, 'PROVIDER', '9').canConfirmPayment
);
check(
  'only the owner may repost',
  jobPermissions(job, 'CLIENT', '7').canRepost && !jobPermissions(job, 'PROVIDER', '9').canRepost
);

if (failures.length > 0) {
  console.log(`jobPermissions: ${passed} checks, ${failures.length} failure(s) — ${failures.join(', ')}`);
  throw new Error(`${failures.length} jobPermissions check(s) failed`);
}
console.log(`jobPermissions: ${passed} checks, 0 failure(s)`);
