import {
  REGULAR_BIDDING_WINDOW_MINUTES,
  URGENT_BIDDING_WINDOW_MINUTES,
  resolveJobStatus,
} from '../jobStatus';

/**
 * The shared resolver: every JobApiStatus maps to a translated label and tone,
 * and an OPEN job is closed as soon as its real deadline has passed — even when
 * the API still calls it OPEN. Edge cases sit either side of the window.
 */

declare const console: { log: (msg: string) => void };

const ALL_STATUSES = [
  'DRAFT',
  'OPEN',
  'PAYMENT_PENDING',
  'PROVIDER_ASSIGNED',
  'IN_PROGRESS',
  'DECLINED_BY_PROVIDER',
  'DECLINED_BY_CLIENT',
  'PAUSED_BY_CLIENT',
  'PAUSED_BY_PROVIDER',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_PROVIDER',
] as const;

const NOW = Date.parse('2026-11-11T12:00:00Z');

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean) {
  if (ok) passed += 1;
  else failures.push(label);
}

for (const status of ALL_STATUSES) {
  const resolved = resolveJobStatus(
    { status, ...(status === 'OPEN' ? { is_bidding_open: true } : {}) },
    { nowMs: NOW }
  );
  check(`${status} keeps its exact display status`, resolved.displayStatus === status);
  check(`${status} has a translation key`, typeof resolved.labelKey === 'string' && resolved.labelKey.length > 0);
  check(`${status} is never the raw unknown label`, resolved.labelKey !== 'status_unknown');
}

const unknown = resolveJobStatus({ status: 'A_NEW_STATUS' }, { nowMs: NOW });
check('unknown status becomes UNKNOWN', unknown.displayStatus === 'UNKNOWN');
check('unknown status uses the translated Unknown key', unknown.labelKey === 'status_unknown');
check('unknown status never bids', unknown.biddingOpen === false);
check('missing status becomes UNKNOWN', resolveJobStatus({}, { nowMs: NOW }).displayStatus === 'UNKNOWN');
check('null job becomes UNKNOWN', resolveJobStatus(null, { nowMs: NOW }).displayStatus === 'UNKNOWN');

/* ── The core bug: stale OPEN after the deadline ─────────────────────────── */

const staleOpen = resolveJobStatus(
  {
    status: 'OPEN',
    is_bidding_open: true,
    bidding_ends_at: '2026-11-11T11:59:59',
    assigned_provider_id: null,
  },
  { nowMs: NOW }
);
check('OPEN one second after its deadline becomes BIDDING_CLOSED', staleOpen.displayStatus === 'BIDDING_CLOSED');
check('a derived close is not open', staleOpen.biddingOpen === false);
check('a derived close renders no countdown', staleOpen.deadlineMs === null);
check('a derived close uses the translated key', staleOpen.labelKey === 'status_bidding_closed');

const justOpen = resolveJobStatus(
  {
    status: 'OPEN',
    is_bidding_open: true,
    bidding_ends_at: '2026-11-11T12:00:01',
  },
  { nowMs: NOW }
);
check('OPEN one second before its deadline stays OPEN', justOpen.displayStatus === 'OPEN');
check('before the deadline bidding is open', justOpen.biddingOpen === true);
check('before the deadline a countdown exists', justOpen.deadlineMs === NOW + 1000);

const exactlyAt = resolveJobStatus(
  { status: 'OPEN', is_bidding_open: true, bidding_ends_at: '2026-11-11T12:00:00' },
  { nowMs: NOW }
);
check('exactly at the deadline is closed', exactlyAt.displayStatus === 'BIDDING_CLOSED');

/* ── Remaining seconds + created_at fallbacks ───────────────────────────── */

const remaining = resolveJobStatus(
  { status: 'OPEN', is_bidding_open: true, remaining_bidding_seconds: 120 },
  { nowMs: NOW }
);
check('remaining seconds become an absolute deadline', remaining.deadlineMs === NOW + 120_000);
check('remaining seconds keep bidding open', remaining.biddingOpen);

const expiredRemaining = resolveJobStatus(
  { status: 'OPEN', is_bidding_open: true, remaining_bidding_seconds: 0 },
  { nowMs: NOW }
);
check('zero remaining seconds is closed', expiredRemaining.displayStatus === 'BIDDING_CLOSED');

const regularCreated = resolveJobStatus(
  {
    status: 'OPEN',
    is_bidding_open: true,
    created_at: '2026-11-11T09:00:00Z',
    request_type: 'REGULAR',
  },
  { nowMs: NOW }
);
check('REGULAR created 3h ago is closed', regularCreated.displayStatus === 'BIDDING_CLOSED');
check(
  'REGULAR gets the 180-minute window',
  resolveJobStatus(
    { status: 'OPEN', is_bidding_open: true, created_at: '2026-11-11T11:00:00Z', request_type: 'REGULAR' },
    { nowMs: NOW }
  ).deadlineMs === Date.parse('2026-11-11T14:00:00Z')
);
check('REGULAR window constant is 180', REGULAR_BIDDING_WINDOW_MINUTES === 180);

const urgentCreated = resolveJobStatus(
  {
    status: 'OPEN',
    is_bidding_open: true,
    created_at: '2026-11-11T11:31:00Z',
    request_type: 'URGENT',
  },
  { nowMs: NOW }
);
check('URGENT created 29m ago is still open', urgentCreated.displayStatus === 'OPEN');
const urgentExpired = resolveJobStatus(
  {
    status: 'OPEN',
    is_bidding_open: true,
    created_at: '2026-11-11T11:30:00Z',
    request_type: 'URGENT',
  },
  { nowMs: NOW }
);
check('URGENT created 30m ago is closed', urgentExpired.displayStatus === 'BIDDING_CLOSED');
check('URGENT window constant is 30', URGENT_BIDDING_WINDOW_MINUTES === 30);

/* ── Explicit flags, assignment, terminal statuses ───────────────────────── */

check(
  'is_bidding_open false closes an OPEN job',
  resolveJobStatus({ status: 'OPEN', is_bidding_open: false }, { nowMs: NOW }).displayStatus ===
    'BIDDING_CLOSED'
);
check(
  'an assigned provider closes bidding and maps to Provider Assigned',
  resolveJobStatus(
    { status: 'OPEN', is_bidding_open: true, assigned_provider_id: 4 },
    { nowMs: NOW }
  ).displayStatus === 'PROVIDER_ASSIGNED'
);
check(
  'terminal statuses never render a countdown',
  resolveJobStatus(
    { status: 'COMPLETED', bidding_ends_at: '2026-11-11T13:00:00Z' },
    { nowMs: NOW }
  ).deadlineMs === null
);
check(
  'cancelled by client keeps its own exact status',
  resolveJobStatus({ status: 'CANCELLED_BY_CLIENT' }, { nowMs: NOW }).labelKey ===
    'status_cancelled_by_client'
);
check(
  'a missing open flag is never "probably open"',
  resolveJobStatus({ status: 'OPEN' }, { nowMs: NOW }).displayStatus === 'BIDDING_CLOSED'
);
check(
  'an explicit open flag without a deadline stays OPEN (no fake deadline)',
  resolveJobStatus({ status: 'OPEN', is_bidding_open: true }, { nowMs: NOW }).displayStatus === 'OPEN'
);

if (failures.length > 0) {
  console.log(`jobStatus: ${passed} checks, ${failures.length} failure(s) — ${failures.join(', ')}`);
  throw new Error(`${failures.length} jobStatus check(s) failed`);
}
console.log(`jobStatus: ${passed} checks, 0 failure(s)`);
