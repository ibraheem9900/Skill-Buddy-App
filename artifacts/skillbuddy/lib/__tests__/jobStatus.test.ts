import { jobStatusLabelKey, jobStatusTone, type JobStatusTone } from '../jobList';

/**
 * The shared status helpers: every value of the LIVE JobStatus enum resolves
 * to a label key AND a badge tone, and unknown/missing values fall back
 * safely (null label / neutral tone) instead of crashing or showing a raw
 * enum anywhere the helpers are used.
 */

declare const console: { log: (msg: string) => void };
declare const process: { exitCode: number };

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

const EXPECTED_LABELS: Record<string, string | null> = {
  DRAFT: 'status_draft',
  OPEN: 'status_open',
  PAYMENT_PENDING: 'status_payment_pending',
  PROVIDER_ASSIGNED: 'status_provider_assigned',
  IN_PROGRESS: 'status_in_progress',
  DECLINED_BY_PROVIDER: 'status_declined_by_provider',
  DECLINED_BY_CLIENT: 'status_declined_by_client',
  PAUSED_BY_CLIENT: 'status_paused_by_client',
  PAUSED_BY_PROVIDER: 'status_paused_by_provider',
  BLOCKED: 'status_blocked',
  COMPLETED: 'status_completed',
  CANCELLED: 'status_cancelled',
  CANCELLED_BY_CLIENT: 'status_cancelled_by_client',
  CANCELLED_BY_PROVIDER: 'status_cancelled_by_provider',
};

const EXPECTED_TONES: Record<string, JobStatusTone> = {
  DRAFT: 'muted',
  OPEN: 'success',
  PAYMENT_PENDING: 'muted',
  PROVIDER_ASSIGNED: 'muted',
  IN_PROGRESS: 'success',
  DECLINED_BY_PROVIDER: 'muted',
  DECLINED_BY_CLIENT: 'muted',
  PAUSED_BY_CLIENT: 'muted',
  PAUSED_BY_PROVIDER: 'muted',
  BLOCKED: 'muted',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
  CANCELLED_BY_CLIENT: 'destructive',
  CANCELLED_BY_PROVIDER: 'destructive',
};

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean) {
  if (ok) {
    passed += 1;
  } else {
    failures.push(label);
  }
}

// Each status has a label key.
for (const status of ALL_STATUSES) {
  check(`label key for ${status}`, jobStatusLabelKey(status) === EXPECTED_LABELS[status]);
}

// Each status has a tone, and the pessimistic ones are loud.
for (const status of ALL_STATUSES) {
  check(`tone for ${status}`, jobStatusTone(status) === EXPECTED_TONES[status]);
}

// "Accepting Bids" replaces the raw 'Open' wording — the label key for OPEN is
// the status_open key, which the translations render as "Accepting Bids".
check('OPEN maps to status_open', jobStatusLabelKey('OPEN') === 'status_open');

// Fallbacks: unknown value → neutral tone; garbage/missing → neutral tone
// (and null label so a chip omits instead of printing the raw enum).
check('unknown status label is null', jobStatusLabelKey('TOTALLY_NEW_STATUS') === null);
check('empty status label is null', jobStatusLabelKey('') === null);
check('null status label is null', jobStatusLabelKey(null) === null);
check('undefined status label is null', jobStatusLabelKey(undefined) === null);
check('number status label is null', jobStatusLabelKey(42 as unknown as string) === null);
check('unknown status tone is muted', jobStatusTone('TOTALLY_NEW_STATUS') === 'muted');
check('empty status tone is muted', jobStatusTone('') === 'muted');
check('null status tone is muted', jobStatusTone(null) === 'muted');
check('undefined status tone is muted', jobStatusTone(undefined) === 'muted');
check('number status tone is muted', jobStatusTone(42 as unknown as string) === 'muted');

if (failures.length > 0) {
  console.log(`jobStatus: ${passed} checks, ${failures.length} failure(s) — ${failures.join(', ')}`);
  throw new Error(`${failures.length} jobStatus check(s) failed`);
} else {
  console.log(`jobStatus: ${passed} checks, 0 failure(s)`);
}