import { addressCreateFromJob, buildRepostJobRequest } from '../repostJob';
import type { JobResponse } from '@/types';

/**
 * The repost adapter (lib/repostJob): the ONLY place a JobResponse becomes a
 * create-job body. The API has no repost and no milestone update, so these
 * assertions pin the two rules that keep the client-composed flow honest:
 *   • config, title, description and address are carried over;
 *   • milestones carry only scheduled_at + expected_hours, with the edited
 *     single-day values replacing the old one.
 */

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function eq<T>(label: string, actual: T, expected: T) {
  if (actual === expected) passed += 1;
  else failures.push(`${label} (got ${String(actual)}, want ${String(expected)})`);
}

function check(label: string, ok: boolean) {
  if (ok) passed += 1;
  else failures.push(label);
}

const base = {
  id: 41,
  client_id: 9,
  category_id: 3,
  service_id: 12,
  title: 'Deep clean',
  description: 'Preferred time: 8:00 AM - 11:00 AM',
  request_type: 'REGULAR',
  booking_type: 'ONE_TIME',
  status: 'OPEN',
  scheduled_at: '2026-11-08T06:00:00Z',
  expected_hours: '3',
  is_urgent: false,
  is_bidding_open: true,
  is_editable: true,
  is_cancellable: true,
  can_restart_timer: false,
  can_convert_to_regular: false,
  can_convert_to_urgent: false,
  cancellation_fee_charged: false,
  timer_restart_count: 0,
  milestones: [
    {
      id: 1,
      sequence: 1,
      scheduled_at: '2026-11-08T06:00:00Z',
      expected_hours: '3',
      status: 'PENDING',
      created_at: '',
      updated_at: '',
    },
  ],
  address: {
    id: 5,
    job_id: 41,
    latitude: '59.396799',
    longitude: '24.6642473',
    house_number: '11/2',
    street_address: '36',
    postal_code: '12618',
    landmark: null,
    formatted_address: 'Akadeemia tee 11/2',
    country: { id: 1, name: 'Estonia' },
    county: { id: 2, name: 'Harju' },
    city: { id: 3, name: 'Tallinn' },
    created_at: '',
    updated_at: '',
  },
  created_at: '',
  updated_at: '',
} as unknown as JobResponse;

const address = addressCreateFromJob(base);
check('the address is carried by value', address !== null);
eq('country id comes from the nested object', address?.country_id, 1);
eq('city id comes from the nested object', address?.city_id, 3);
eq('the pin latitude is parsed from the wire string', address?.latitude, 59.396799);

const single = buildRepostJobRequest(base, {
  scheduled_at: '2026-11-09T07:00:00Z',
  expected_hours: 4,
});
check('a single-day repost builds', single.ok);
if (single.ok) {
  const body = single.body;
  eq('service is carried', body.service_id, 12);
  eq('category is carried', body.category_id, 3);
  eq('title is carried', body.title, 'Deep clean');
  eq('request type is carried', body.request_type, 'REGULAR');
  eq('booking type is carried', body.booking_type, 'ONE_TIME');
  eq('a repost is not a draft', body.is_draft, false);
  eq('one task survives', body.milestones.length, 1);
  eq('the edited start replaces the old start', body.milestones[0].scheduled_at, '2026-11-09T07:00:00Z');
  eq('the edited hours replace the old hours', body.milestones[0].expected_hours, 4);
  eq('the address is the old address', body.address.city_id, 3);
  check('no attachment field is invented', !JSON.stringify(body).includes('attachments'));
  check(
    'no task title or notes field is invented',
    !JSON.stringify(body.milestones).includes('title') &&
      !JSON.stringify(body.milestones).includes('notes')
  );
}

const multi = {
  ...base,
  booking_type: 'MULTI_DAY',
  request_type: 'URGENT',
  milestones: [
    { ...base.milestones![0], id: 1, sequence: 1, scheduled_at: '2026-11-08T06:00:00Z' },
    { ...base.milestones![0], id: 2, sequence: 2, scheduled_at: '2026-11-10T06:00:00Z' },
  ],
} as unknown as JobResponse;

const multiOut = buildRepostJobRequest(multi, { expected_hours: 9 });
check('a multi-day repost builds', multiOut.ok);
if (multiOut.ok) {
  eq('both days survive', multiOut.body.milestones.length, 2);
  eq('multi-day stays regular', multiOut.body.request_type, 'REGULAR');
  eq('a job-level hours edit never rewrites a task list', multiOut.body.milestones[1].expected_hours, 3);
}

const noAddress = buildRepostJobRequest({ ...base, address: null } as JobResponse, {});
check('a job without an address is refused', !noAddress.ok);
if (!noAddress.ok) eq('the reason is the address', noAddress.reason, 'address');

const noSchedule = buildRepostJobRequest(
  { ...base, milestones: [], scheduled_at: null } as unknown as JobResponse,
  {}
);
check('a job without any schedule is refused', !noSchedule.ok);
if (!noSchedule.ok) eq('the reason is the schedule', noSchedule.reason, 'schedule');

if (failures.length > 0) {
  console.log(`repostJob: ${passed} checks, ${failures.length} failure(s) — ${failures.join(', ')}`);
  throw new Error(`${failures.length} repostJob check(s) failed`);
}
console.log(`repostJob: ${passed} checks, 0 failure(s)`);
