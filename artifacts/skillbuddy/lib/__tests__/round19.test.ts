/**
 * Round 19 — the pure rules behind the client/provider job-flow fixes:
 *   • My Jobs opens newest-first ("Date posted", descending)
 *   • a task's hours come from the slots the client chose, not one slot's length
 *   • slots sort and merge into readable ranges
 *   • bids stay visible once the bidding window has expired
 */
import { DEFAULT_JOB_SORT, isDefaultJobSort, sortJobs } from '../jobSort';
import { mergedSlotRanges, taskExpectedHours, totalTaskHours } from '../jobDetail';
import { CLIENT_VISIBLE_BID_STATUSES, filterClientVisibleBids } from '../bid';
import type { BidResponse, JobMilestoneTimeSlotResponse } from '../../types';

let passed = 0;
function eq<T>(label: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
  passed += 1;
}
function ok(label: string, value: boolean) {
  if (!value) throw new Error(`${label}: expected true`);
  passed += 1;
}

/* ── A: newest job first ─────────────────────────────────────────────────── */

eq('the default sort is Date posted', DEFAULT_JOB_SORT.key, 'created');
eq('the default direction is descending', DEFAULT_JOB_SORT.direction, 'desc');
ok('isDefaultJobSort recognises it', isDefaultJobSort(DEFAULT_JOB_SORT));

const newer = { id: 12, created_at: '2026-11-18T15:55:00' };
const older = { id: 4, created_at: '2026-11-16T09:00:00' };
const closed = { id: 7, created_at: '2026-11-17T10:00:00' }; // no deadline at all

eq(
  'newest first even when closed jobs carry no deadline',
  sortJobs([older, closed, newer], DEFAULT_JOB_SORT).map((job) => job.id),
  [12, 7, 4]
);

const sameSecondLow = { id: 8, created_at: '2026-11-18T12:00:00' };
const sameSecondHigh = { id: 9, created_at: '2026-11-18T12:00:00' };
eq(
  'a tie is broken by the newer id',
  sortJobs([sameSecondLow, sameSecondHigh], DEFAULT_JOB_SORT).map((job) => job.id),
  [9, 8]
);

/* ── G: hours and slots ──────────────────────────────────────────────────── */

const slot = (
  start: string,
  end: string
): JobMilestoneTimeSlotResponse => ({
  code: `${start}-${end}`,
  label: `${start} - ${end}`,
  start_time: start,
  end_time: end,
  window: `${start} - ${end}`,
  arrival_options: [],
});

const threeHourSlots = [
  slot('08:00', '11:00'),
  slot('11:00', '14:00'),
  slot('14:00', '17:00'),
  slot('17:00', '20:00'),
  slot('20:00', '23:00'),
];

eq(
  'five adjacent 3-hour slots merge into one 8:00-23:00 range',
  mergedSlotRanges(threeHourSlots),
  [{ startMinutes: 8 * 60, endMinutes: 23 * 60 }]
);

eq(
  'one task built from five slots is 15 hours, not 3',
  taskExpectedHours({ expected_hours: '3', time_slots: threeHourSlots }),
  15
);
eq(
  'three adjacent slots are 9 hours',
  taskExpectedHours({
    expected_hours: '3',
    time_slots: [slot('14:00', '17:00'), slot('17:00', '20:00'), slot('20:00', '23:00')],
  }),
  9
);
eq(
  'a single 3-hour slot stays 3 hours',
  taskExpectedHours({ expected_hours: '3', time_slots: [slot('20:00', '23:00')] }),
  3
);
eq(
  'the stored per-task hours are the fallback when no slots exist',
  taskExpectedHours({ expected_hours: '7', time_slots: [] }),
  7
);
eq(
  'the total is the sum of the task hours (3 + 9 + 15 + 15 = 42)',
  totalTaskHours([
    { expected_hours: '3', time_slots: [slot('20:00', '23:00')] },
    {
      expected_hours: '3',
      time_slots: [slot('14:00', '17:00'), slot('17:00', '20:00'), slot('20:00', '23:00')],
    },
    { expected_hours: '3', time_slots: threeHourSlots },
    { expected_hours: '3', time_slots: threeHourSlots },
  ]),
  42
);

eq(
  'non-contiguous slots stay separate and sorted',
  mergedSlotRanges([slot('20:00', '23:00'), slot('08:00', '11:00')]),
  [
    { startMinutes: 8 * 60, endMinutes: 11 * 60 },
    { startMinutes: 20 * 60, endMinutes: 23 * 60 },
  ]
);
eq(
  'overlapping slots are not double counted',
  mergedSlotRanges([slot('08:00', '12:00'), slot('09:00', '11:00')]),
  [{ startMinutes: 8 * 60, endMinutes: 12 * 60 }]
);

/* ── E: expired bids stay on the client's list ───────────────────────────── */

ok('EXPIRED is a client-visible status', CLIENT_VISIBLE_BID_STATUSES.includes('EXPIRED'));
const bids = [
  { id: 1, status: 'EXPIRED' },
  { id: 2, status: 'PENDING' },
  { id: 3, status: 'WITHDRAWN' },
] as unknown as BidResponse[];
eq(
  'a closed job still lists the bids that were placed',
  filterClientVisibleBids(bids).map((bid) => bid.status),
  ['EXPIRED', 'PENDING']
);

console.log(`round19: ${passed}/${passed} assertions passed`);
