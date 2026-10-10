/**
 * Failure classification for POST /api/v1/jobs.
 *
 * The bug these assertions lock down: every non-401/non-422 outcome used to be
 * reported as "Could not post the job — please check your connection", which
 * made a server error, a timeout or a client-side crash indistinguishable from
 * being offline. Now each bucket has its own copy, and ONLY a real transport
 * failure may claim the connection wording.
 *
 * Also covers the 422 → wizard-step routing: a body error is named by FIELD,
 * the wizard shows STEPS, so the earliest offending step must be the one the
 * user is taken to.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import {
  JOB_FIELD_STEPS,
  buildCreateJobRequest,
  classifyCreateJobFailure,
  createJobErrorCopy,
  firstErrorStep,
  mapValidationErrors,
  type CreateJobFailureKind,
} from '../jobCreate';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean) {
  if (condition) passed += 1;
  else {
    failures.push(label);
    console.log(`FAIL ${label}`);
  }
}

function eq<T>(label: string, actual: T, expected: T) {
  check(`${label} (got ${String(actual)}, want ${String(expected)})`, actual === expected);
}

/** An axios-like rejection with a status and optional body. */
const httpError = (status: number, body?: unknown) => ({
  isAxiosError: true,
  response: { status, data: body },
});

/* ─────────────────────────────────────────── no response: three buckets apart */

eq(
  'offline (axios ERR_NETWORK) is the connection bucket',
  classifyCreateJobFailure({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' }).kind,
  'network'
);
eq(
  'the ERR_NETWORK code alone is enough',
  classifyCreateJobFailure({ code: 'ERR_NETWORK' }).kind,
  'network'
);
eq(
  'an axios error with no response is a transport failure',
  classifyCreateJobFailure({ isAxiosError: true }).kind,
  'network'
);
eq(
  'a bare thrown Error is NEVER a connection failure',
  classifyCreateJobFailure(new Error('boom')).kind,
  'unknown'
);
eq(
  'a TypeError thrown while handling the 201 is NEVER a connection failure',
  classifyCreateJobFailure(new TypeError('undefined is not a function')).kind,
  'unknown'
);
eq(
  'a thrown string is not a connection failure either',
  classifyCreateJobFailure('nope').kind,
  'unknown'
);
eq(
  'a thrown plain object with only a request is not claimed as network',
  classifyCreateJobFailure({ request: {} }).kind,
  'unknown'
);

/* ─────────────────────────────────────────────────────────────────── timeouts */

eq(
  'ECONNABORTED is a timeout',
  classifyCreateJobFailure({ isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }).kind,
  'timeout'
);
eq(
  'ETIMEDOUT is a timeout',
  classifyCreateJobFailure({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' }).kind,
  'timeout'
);
eq(
  'a timeout message without a code is still a timeout',
  classifyCreateJobFailure({ isAxiosError: true, message: 'timeout of 15000ms exceeded' }).kind,
  'timeout'
);
eq(
  'the timeout check is case-insensitive',
  classifyCreateJobFailure({ isAxiosError: true, message: 'Timeout of 15000ms exceeded' }).kind,
  'timeout'
);
eq(
  'a cancelled request is not a connectivity problem',
  classifyCreateJobFailure({ isAxiosError: true, code: 'ERR_CANCELED', message: 'canceled' }).kind,
  'unknown'
);
eq(
  'a cancelled request is not a timeout either',
  classifyCreateJobFailure({ isAxiosError: true, code: 'ERR_CANCELED' }).kind === 'timeout',
  false
);

/* ───────────────────────────────────────────────────────────── status buckets */

eq('401 is unauthorized', classifyCreateJobFailure(httpError(401)).kind, 'unauthorized');
eq('422 is invalid', classifyCreateJobFailure(httpError(422)).kind, 'invalid');
eq('400 is badrequest', classifyCreateJobFailure(httpError(400)).kind, 'badrequest');
eq('403 is forbidden', classifyCreateJobFailure(httpError(403)).kind, 'forbidden');
eq('404 is notfound', classifyCreateJobFailure(httpError(404)).kind, 'notfound');
eq('409 is conflict', classifyCreateJobFailure(httpError(409)).kind, 'conflict');
eq('500 is a server failure', classifyCreateJobFailure(httpError(500)).kind, 'server');
eq('502 is a server failure', classifyCreateJobFailure(httpError(502)).kind, 'server');
eq('503 is a server failure', classifyCreateJobFailure(httpError(503)).kind, 'server');
eq('504 is a server failure', classifyCreateJobFailure(httpError(504)).kind, 'server');
eq('429 falls through to unknown', classifyCreateJobFailure(httpError(429)).kind, 'unknown');
eq('418 falls through to unknown', classifyCreateJobFailure(httpError(418)).kind, 'unknown');
eq('an impossible 200 rejection is unknown, not network', classifyCreateJobFailure(httpError(200)).kind, 'unknown');

/* ───────────────────────────────────────────── the backend's own detail text */

eq(
  'a plain-string detail is carried through',
  classifyCreateJobFailure(httpError(400, { detail: 'Service is not available in your city.' })).message,
  'Service is not available in your city.'
);
eq(
  'the first detail[].msg is carried through',
  classifyCreateJobFailure(httpError(500, { detail: [{ loc: ['body'], msg: 'Internal error' }] })).message,
  'Internal error'
);
eq(
  'an empty array detail yields no message',
  classifyCreateJobFailure(httpError(422, { detail: [] })).message,
  null
);
eq(
  'a bodyless failure yields no message',
  classifyCreateJobFailure(httpError(500)).message,
  null
);
eq(
  'a non-object body yields no message',
  classifyCreateJobFailure(httpError(500, 'Internal Server Error')).message,
  null
);
eq(
  'a network failure carries no server message',
  classifyCreateJobFailure({ isAxiosError: true, code: 'ERR_NETWORK' }).message,
  null
);

/* ──────────────────────────────────────────────────────────── the dialog copy */

const ALL_KINDS: CreateJobFailureKind[] = [
  'network',
  'timeout',
  'unauthorized',
  'invalid',
  'badrequest',
  'forbidden',
  'notfound',
  'conflict',
  'server',
  'unknown',
];

for (const kind of ALL_KINDS) {
  const copy = createJobErrorCopy(kind);
  check(
    `${kind} has a title and a message key`,
    typeof copy.titleKey === 'string' &&
      copy.titleKey.startsWith('post_err_') &&
      typeof copy.messageKey === 'string' &&
      copy.messageKey.startsWith('post_err_')
  );
  check(`${kind} has an icon`, typeof copy.icon === 'string' && copy.icon.length > 0);
}

eq('network keeps the original connection title', createJobErrorCopy('network').titleKey, 'post_err_network_title');
eq('network is the ONLY bucket using the connection copy', createJobErrorCopy('network').messageKey, 'post_err_network_msg');
eq('network uses the wifi-off icon', createJobErrorCopy('network').icon, 'wifi-off');
eq('timeout gets its own title', createJobErrorCopy('timeout').titleKey, 'post_err_timeout_title');
eq('timeout uses the clock icon', createJobErrorCopy('timeout').icon, 'clock');
eq('a server failure gets its own title', createJobErrorCopy('server').titleKey, 'post_err_server_title');
eq('an unknown failure gets its own title', createJobErrorCopy('unknown').titleKey, 'post_err_unknown_title');
eq('an unknown failure is not the connection copy', createJobErrorCopy('unknown').messageKey, 'post_err_unknown_msg');
eq('401 maps to the session copy', createJobErrorCopy('unauthorized').messageKey, 'post_err_session_msg');
eq('422 maps to the invalid copy', createJobErrorCopy('invalid').titleKey, 'post_err_invalid_title');
eq('422 has a fallback message key', createJobErrorCopy('invalid').messageKey, 'post_err_invalid_msg');
eq('400 prefers the backend text', createJobErrorCopy('badrequest').preferServerMessage, true);
eq('403 prefers the backend text', createJobErrorCopy('forbidden').preferServerMessage, true);
eq('404 prefers the backend text', createJobErrorCopy('notfound').preferServerMessage, true);
eq('409 prefers the backend text', createJobErrorCopy('conflict').preferServerMessage, true);
eq('400/403/404/409 share one title', createJobErrorCopy('conflict').titleKey, 'post_err_rejected_title');
eq('a 5xx never shows the raw server text', createJobErrorCopy('server').preferServerMessage, false);
eq('network never shows a server message', createJobErrorCopy('network').preferServerMessage, false);
eq('timeout never shows a server message', createJobErrorCopy('timeout').preferServerMessage, false);
eq('unknown never shows a server message', createJobErrorCopy('unknown').preferServerMessage, false);

/* ─────────────────────────────────────────── 422 → the wizard step to show */

eq('no mapped error means no step jump', firstErrorStep({}), null);
eq('a title error is step 0', firstErrorStep({ title: 'too short' }), 0);
eq('a description error is step 0', firstErrorStep({ description: 'required' }), 0);
eq('a service error is step 0', firstErrorStep({ service: 'required' }), 0);
eq('a milestone error is step 2', firstErrorStep({ date: 'required' }), 2);
eq('a time error is step 2', firstErrorStep({ time: 'required' }), 2);
eq('an hours error is step 2', firstErrorStep({ hours: 'required' }), 2);
eq('a city error is step 3', firstErrorStep({ city_id: 'required' }), 3);
eq('a postal-code error is step 3', firstErrorStep({ postal_code: 'required' }), 3);
eq('the EARLIEST offending step wins', firstErrorStep({ city_id: 'x', title: 'y' }), 0);
eq('a later step does not outrank an earlier one', firstErrorStep({ date: 'x', description: 'y' }), 0);
eq(
  'an empty string value is not an error',
  firstErrorStep({ title: '', city_id: 'x' }),
  3
);
eq('every form field maps to a real step', Object.values(JOB_FIELD_STEPS).every((step) => step >= 0 && step <= 3), true);
eq(
  'the request-type cards live on step 2, not step 1',
  JOB_FIELD_STEPS.hours === 2 && JOB_FIELD_STEPS.date === 2,
  true
);

/* ─────────────────────────── end to end: a real 422 body routes to a step */

const addressOnly = mapValidationErrors([
  { loc: ['body', 'address', 'city_id'], msg: 'field required', type: 'missing' },
  { loc: ['body', 'address', 'street_address'], msg: 'field required', type: 'missing' },
]);
eq('an address-only 422 lands on the address step', firstErrorStep(addressOnly.fieldErrors), 3);
eq('an address-only 422 leaves no toast', addressOnly.formErrors.length, 0);

const mixed = mapValidationErrors([
  { loc: ['body', 'address', 'city_id'], msg: 'field required', type: 'missing' },
  { loc: ['body', 'title'], msg: 'String should have at least 3 characters', type: 'string_too_short' },
]);
eq('a mixed 422 jumps to the earliest step', firstErrorStep(mixed.fieldErrors), 0);
eq('a mixed 422 still maps the address field', mixed.fieldErrors.city_id, 'field required');

const milestoneOnly = mapValidationErrors([
  { loc: ['body', 'milestones', 0, 'scheduled_at'], msg: 'Input should be a valid datetime', type: 'datetime_parsing' },
]);
eq('a milestone 422 lands on the schedule step', firstErrorStep(milestoneOnly.fieldErrors), 2);

const unmappable = mapValidationErrors([
  { loc: ['body', 'is_draft'], msg: 'Input should be a valid boolean', type: 'bool_parsing' },
]);
eq('an unmappable 422 maps no field', firstErrorStep(unmappable.fieldErrors), null);
eq('an unmappable 422 becomes a toast instead of being dropped', unmappable.formErrors.length, 1);
eq(
  'an unmappable 422 keeps the server text',
  unmappable.formErrors[0],
  'Input should be a valid boolean'
);

/* ───────────────────────────────────────────────── the payload stays intact */

const base = {
  serviceId: 12,
  serviceCategoryId: 3,
  title: 'TEST - ignore',
  description: 'ignore',
  requestType: 'regular' as const,
  bookingType: 'one_time' as const,
  scheduledAtIso: '2026-10-20T09:00:00.000Z',
  expectedHours: 2,
  countryId: 1,
  countyId: 2,
  cityId: 4,
  houseNumber: '6',
  streetAddress: 'Sepa',
  postalCode: '89000',
  landmark: '',
  formattedAddress: 'Sepa 6, 89000',
  isDraft: false,
};

const built = buildCreateJobRequest(base);
eq('the classifier work did not disturb the payload', built.service_id, 12);
eq('the payload still sends ONE_TIME', built.booking_type, 'ONE_TIME');
eq('the payload still sends the milestone', built.milestones.length, 1);
eq('the payload still sends is_draft', built.is_draft, false);
eq('a blank landmark is still null, not ""', built.address.landmark, null);

/* ------------------------------------------------------------------ report */

export const summary = { passed, total: passed + failures.length };
console.log(`jobCreateError: ${summary.passed}/${summary.total} assertions passed`);
