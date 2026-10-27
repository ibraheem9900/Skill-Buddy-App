import {
  REMOVABLE_JOB_STATUSES,
  addHiddenId,
  canRemoveJob,
  filterHiddenJobs,
  hiddenJobsKey,
  removeHiddenId,
  removalReason,
  sanitizeHiddenIds,
} from '../jobRemoval';
import type { JobApiStatus } from '@/types';

/**
 * The Remove button's visibility rule (which statuses may be removed) and the
 * local hide list's array rules — all from the PURE half (lib/jobRemoval), so
 * the test never pulls the React Native storage module into plain node.
 * Every value of the live JobStatus enum is asserted, so a future status cannot
 * silently become removable.
 */

declare const console: { log: (msg: string) => void };
declare const process: { exitCode: number };

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean) {
  if (ok) {
    passed += 1;
  } else {
    failures.push(label);
  }
}

/* ── Which statuses are removable ─────────────────────────────────────────── */

// Terminal statuses: the job is finished, so removing it hides nothing live.
const ALLOWED = ['CANCELLED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_PROVIDER', 'COMPLETED'];
// Everything else is excluded — each of these can still move.
// OPEN is asserted separately below (it depends on is_bidding_open).
const BLOCKED_BY_STATUS = [
  'DRAFT',
  'PAYMENT_PENDING',
  'PROVIDER_ASSIGNED',
  'IN_PROGRESS',
  'DECLINED_BY_PROVIDER',
  'DECLINED_BY_CLIENT',
  'PAUSED_BY_CLIENT',
  'PAUSED_BY_PROVIDER',
  'BLOCKED',
];

for (const status of ALLOWED) {
  check(`${status} is removable`, canRemoveJob({ status: status as JobApiStatus, is_bidding_open: false }));
  check(
    `${status} reason is terminal`,
    removalReason({ status: status as JobApiStatus, is_bidding_open: false }) === 'terminal'
  );
}

for (const status of BLOCKED_BY_STATUS) {
  check(`${status} is NOT removable`, !canRemoveJob({ status: status as JobApiStatus, is_bidding_open: false }));
}

// The one clock-free "expired" case: still OPEN, but the API's own flag says the
// bidding window is closed (the list's "Expired" chip).
check(
  'OPEN with bidding closed is removable (expired)',
  canRemoveJob({ status: 'OPEN', is_bidding_open: false })
);
check(
  'OPEN with bidding closed reason is bidding-closed',
  removalReason({ status: 'OPEN', is_bidding_open: false }) === 'bidding-closed'
);
// An OPEN job with bidding still running is live — never removable.
check('OPEN with bidding open is NOT removable', !canRemoveJob({ status: 'OPEN', is_bidding_open: true }));
// A DRAFT has no bidding window at all, so the closed flag must not qualify it.
check('DRAFT with bidding closed is NOT removable', !canRemoveJob({ status: 'DRAFT', is_bidding_open: false }));

// Missing/garbage input: the button must not appear on a row we cannot read.
check('null job is NOT removable', !canRemoveJob(null));
check('undefined job is NOT removable', !canRemoveJob(undefined));
check('missing status is NOT removable', !canRemoveJob({ is_bidding_open: false } as never));
check('numeric status is NOT removable', !canRemoveJob({ status: 7, is_bidding_open: false } as never));
check('missing status has no reason', removalReason({} as never) === null);

// The exported list matches the rule exactly (no drift between the two).
check(
  'REMOVABLE_JOB_STATUSES holds exactly the four terminal values',
  REMOVABLE_JOB_STATUSES.length === 4 && ALLOWED.every((s) => (REMOVABLE_JOB_STATUSES as readonly string[]).includes(s))
);

/* ── The hidden-id array rules ────────────────────────────────────────────── */

check('addHiddenId appends', JSON.stringify(addHiddenId([1, 2], 3)) === '[1,2,3]');
check('addHiddenId is idempotent', JSON.stringify(addHiddenId([1, 2], 2)) === '[1,2]');
check('addHiddenId ignores junk', JSON.stringify(addHiddenId([1], 0)) === '[1]');
check('addHiddenId ignores NaN', JSON.stringify(addHiddenId([1], Number.NaN)) === '[1]');
check('removeHiddenId drops one', JSON.stringify(removeHiddenId([1, 2, 3], 2)) === '[1,3]');
check('removeHiddenId of a missing id is a no-op', JSON.stringify(removeHiddenId([1], 9)) === '[1]');

check(
  'sanitizeHiddenIds keeps positive integers only',
  JSON.stringify(sanitizeHiddenIds('[1,"2",-3,0,null,"x",2.5]')) === '[1,2]'
);
check('sanitizeHiddenIds tolerates a JSON array', JSON.stringify(sanitizeHiddenIds([4, 5])) === '[4,5]');
check('sanitizeHiddenIds survives garbage', JSON.stringify(sanitizeHiddenIds('{oops')) === '[]');
check('sanitizeHiddenIds of empty string is empty', JSON.stringify(sanitizeHiddenIds('')) === '[]');
check('sanitizeHiddenIds of null is empty', JSON.stringify(sanitizeHiddenIds(null)) === '[]');
check('sanitizeHiddenIds of an object is empty', JSON.stringify(sanitizeHiddenIds({ a: 1 })) === '[]');

const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
check('filterHiddenJobs drops the hidden rows', JSON.stringify(filterHiddenJobs(rows, [2])) === '[{"id":1},{"id":3}]');
check('filterHiddenJobs with nothing hidden keeps everything', filterHiddenJobs(rows, []).length === 3);
check('filterHiddenJobs ignores ids that are not there', filterHiddenJobs(rows, [99]).length === 3);
check('filterHiddenJobs never mutates the input', rows.length === 3);

/* ── Per-user key ─────────────────────────────────────────────────────────── */

check('key carries the user id', hiddenJobsKey(7) === 'sb_hidden_jobs_7');
check('key of a string id', hiddenJobsKey('42') === 'sb_hidden_jobs_42');
check('key of null is anon, never a shared user bucket', hiddenJobsKey(null) === 'sb_hidden_jobs_anon');
check('key of undefined is anon', hiddenJobsKey(undefined) === 'sb_hidden_jobs_anon');
check('two users never share a key', hiddenJobsKey(1) !== hiddenJobsKey(2));

if (failures.length > 0) {
  console.log(`hiddenJobs: ${passed} checks, ${failures.length} failure(s) — ${failures.join(', ')}`);
  throw new Error(`${failures.length} hiddenJobs check(s) failed`);
} else {
  console.log(`hiddenJobs: ${passed} checks, 0 failure(s)`);
}
