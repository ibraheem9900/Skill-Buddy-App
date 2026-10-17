/**
 * Provider skills (GET/POST/PATCH/DELETE /providers/me/skills), unit-tested
 * against the bodies the LIVE backend really answered (2026-10-16, test provider
 * id 3 / skill id 5) — so a message the provider reads is the backend's own
 * sentence, and every rule about which fields the app may send is pinned here.
 *
 * Covers: list state transitions (insert/replace/drop/reconcile + stable order),
 * the ACTIVE count the feed's nudge reads, the write bodies (only `is_active` is
 * ever sent on a PATCH), the diff that stops a no-op request, and the failure
 * mapping for 409 duplicate / 404 service-gone / 404 skill-gone / 422 / 403 / 401
 * / offline.
 *
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import {
  SKILL_TYPES,
  SKILL_YEARS_MAX,
  SKILL_YEARS_MIN,
  buildSkillCreateBody,
  buildSkillUpdateBody,
  countActiveSkills,
  dropSkill,
  isActiveSkill,
  isSkillType,
  isValidSkillYears,
  reconcileSkills,
  skillActions,
  skillErrorDetail,
  skillFailure,
  skillFailureText,
  skillServiceIds,
  skillUpdateDiff,
  sortSkills,
  upsertSkill,
} from '../providerSkills';
import type { ProviderSkill } from '@/types';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(label);
}

function equal(label: string, actual: unknown, expected: unknown): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) failures.push(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  else passed += 1;
}

/** The 201 response the live POST /providers/me/skills returned (verbatim). */
function liveSkill(overrides: Partial<ProviderSkill> = {}): ProviderSkill {
  return {
    id: 5,
    provider_id: 3,
    service_id: 35,
    service_title: 'Accountant',
    category_id: 34,
    category_name: 'Business & Professional Services',
    skill_type: 'PRIMARY',
    years_of_experience: 0,
    is_certified: false,
    certification_url: null,
    is_active: true,
    is_verified: false,
    verified_at: null,
    created_at: '2026-10-16T16:05:47',
    updated_at: '2026-10-16T16:05:47',
    ...overrides,
  };
}

/* ------------------------------------------------------------ list state */

const only = liveSkill();
equal('an empty list gains the server row', upsertSkill([], only).length, 1);
equal('the row keeps the server id', upsertSkill([], only)[0].id, 5);

const patched = liveSkill({ is_active: false, years_of_experience: 3 });
const afterPatch = upsertSkill([only], patched);
equal('a PATCH response REPLACES the row (no duplicate)', afterPatch.length, 1);
equal('the replacement carries the server value', afterPatch[0].is_active, false);
equal('the replacement keeps the years the server sent', afterPatch[0].years_of_experience, 3);

const second = liveSkill({ id: 6, service_id: 12, service_title: 'Plumber', category_id: 4, category_name: 'Home Services' });
equal('a second service is appended', upsertSkill([only], second).length, 2);
equal(
  'a null body changes nothing',
  upsertSkill([only], null).length,
  1
);
equal(
  'a body without an id is ignored',
  upsertSkill([only], { service_id: 9 } as unknown as ProviderSkill).length,
  1
);

equal('dropSkill removes exactly the id', dropSkill([only, second], 5).length, 1);
equal('dropSkill keeps the other row', dropSkill([only, second], 5)[0].id, 6);
equal('dropping an id that is not there is a no-op', dropSkill([only], 999).length, 1);

// The live GET returns a bare array; anything else must not wipe the list.
equal('reconcileSkills adopts a real array', reconcileSkills([], [only, second]).length, 2);
equal('a non-array body leaves the current list alone', reconcileSkills([only], { detail: 'nope' }).length, 1);
equal('a null body leaves the current list alone', reconcileSkills([only], null).length, 1);
equal(
  'rows without an id are filtered out (defensive)',
  reconcileSkills([], [only, { service_title: 'no id' }]).length,
  1
);
equal(
  'reconcile does NOT mutate the list it was given',
  (() => {
    const original: ProviderSkill[] = [only];
    reconcileSkills(original, [second]);
    return original.length;
  })(),
  1
);

// "Business & Professional Services" sorts before "Home Services", whatever
// order the server listed them in.
equal('sortSkills orders by category first', sortSkills([second, only]).map((s) => s.id), [5, 6]);
equal(
  'sortSkills breaks a category tie on the service title',
  sortSkills([liveSkill({ id: 8, service_title: 'Zebra' }), liveSkill({ id: 7, service_title: 'Accountant' })]).map((s) => s.id),
  [7, 8]
);

/* ------------------------------------------------------- ACTIVE counting */

check('isActiveSkill is true only for the server flag', isActiveSkill(liveSkill()) === true);
check('isActiveSkill treats a missing row as inactive', isActiveSkill(null) === false);
check('isActiveSkill treats an undefined flag as inactive', isActiveSkill({ id: 1 } as ProviderSkill) === false);
equal('countActiveSkills counts only active rows', countActiveSkills([only, patched, second]), 2);
equal('countActiveSkills on null is 0', countActiveSkills(null), 0);
equal('countActiveSkills on a non-array is 0', countActiveSkills(undefined), 0);

const ids = skillServiceIds([only, second]);
check('skillServiceIds carries both services', ids.has(35) && ids.has(12));
check('skillServiceIds ignores a row without a service_id', skillServiceIds([{} as ProviderSkill]).size === 0);

/* --------------------------------------------------------- write bodies */

equal('POST sends service_id alone (the live default the backend applies)', buildSkillCreateBody(35), { service_id: 35 });
equal('PATCH sends ONLY is_active when it is the change', buildSkillUpdateBody({ isActive: false }), { is_active: false });
equal('an empty PATCH body stays empty (the live endpoint answers 200 to {})', buildSkillUpdateBody({}), {});
equal(
  'a null years value is omitted rather than sent',
  buildSkillUpdateBody({ yearsOfExperience: null, isActive: true }),
  { is_active: true }
);
equal('the SKILL_TYPES enum matches the live schema', [...SKILL_TYPES], ['PRIMARY', 'SECONDARY']);
check('isSkillType rejects the web app vocabulary', !isSkillType('primary') && !isSkillType('activist'));
check('years bounds match the live 422 (81 → less_than_equal 80)', SKILL_YEARS_MIN === 0 && SKILL_YEARS_MAX === 80);
check('isValidSkillYears accepts 0 and 80', isValidSkillYears(0) && isValidSkillYears(80));
check('isValidSkillYears rejects -1, 81 and 7.5', !isValidSkillYears(-1) && !isValidSkillYears(81) && !isValidSkillYears(7.5));

// The diff sends one field, and NOTHING when the server already agrees.
equal('toggling an active skill sends is_active:false', skillUpdateDiff(only, { isActive: false }), { is_active: false });
equal('a toggle the server already applies sends no field at all', skillUpdateDiff(only, { isActive: true }), {});
equal(
  'a years change is sent on its own',
  skillUpdateDiff(only, { yearsOfExperience: 3 }),
  { years_of_experience: 3 }
);
equal('an unchanged years value is not sent', skillUpdateDiff({ ...only, years_of_experience: 3 }, { yearsOfExperience: 3 }), {});

/* --------------------------------------------------------- failure map */

// The exact bodies the live endpoint answered.
equal(
  'the live 409 detail is the backend sentence',
  skillErrorDetail({ detail: 'You already have this service as a skill.' }),
  'You already have this service as a skill.'
);
check('a 422 detail[] array becomes one message per field', skillErrorDetail({ detail: [{ msg: 'Field required' }] }) === 'Field required');
check('a body-less failure has no detail', skillErrorDetail(null) === null);

const duplicate = skillFailure(409, { detail: 'You already have this service as a skill.' });
check('409 maps to the duplicate kind', duplicate.kind === 'duplicate');
equal('the duplicate fallback key is the translated one', duplicate.messageKey, 'skills_err_duplicate');
equal(
  'the duplicate message shown is the backend wording, not the fallback',
  skillFailureText(duplicate, () => 'translated fallback'),
  'You already have this service as a skill.'
);

const serviceMissing = skillFailure(404, { detail: 'Service not found.' });
check('404 "Service not found." is the service-missing kind', serviceMissing.kind === 'service-missing');
equal('its fallback key is the service-missing one', serviceMissing.messageKey, 'skills_err_service_missing');

const gone = skillFailure(404, { detail: 'Skill not found.' });
check('404 "Skill not found." is the gone kind', gone.kind === 'gone');
equal('its fallback key is the gone one', gone.messageKey, 'skills_err_gone');

const invalid = skillFailure(422, { detail: [{ loc: ['body', 'years_of_experience'], msg: 'Input should be less than or equal to 80' }] });
check('422 maps to invalid', invalid.kind === 'invalid');
equal('422 keeps per-field messages', invalid.fieldMessages.length, 1);
// A 422 detail[] IS the backend's own field message — it is shown as sent
// (the live "Input should be less than or equal to 80"), never replaced.
equal(
  'a 422 field message is shown as the backend wrote it',
  skillFailureText(invalid, (key) => `T:${key}`),
  'Input should be less than or equal to 80'
);
equal(
  'a 422 with NO usable detail falls back to the translated key',
  skillFailureText(skillFailure(422, { detail: [] }), (key) => `T:${key}`),
  'T:skills_err_invalid'
);

check('403 is forbidden', skillFailure(403, { detail: 'Only approved, active providers can bid on jobs.' }).kind === 'forbidden');
check('401 is unauthorized (session)', skillFailure(401, null).kind === 'unauthorized');
const offline = skillFailure(0, null);
check('no HTTP status means offline/network', offline.kind === 'network');
check(
  'a status the app does not know also maps to the network fallback',
  skillFailure(500, { detail: 'boom' }).messageKey === 'skills_err_network'
);

/* ------------------------------------------------------- available actions */

const activeActions = skillActions(only);
check('an ACTIVE skill can be deactivated', activeActions.canToggleActive && activeActions.nextActive === false);
check('an ACTIVE skill can be deleted', activeActions.canDelete);
const inactiveActions = skillActions({ ...only, is_active: false });
check('an INACTIVE skill can be reactivated', inactiveActions.nextActive === true);
const emptyActions = skillActions(null);
check('no row means no action', !emptyActions.canToggleActive && !emptyActions.canDelete);

/* ----------------------------------------------------------------- report */
for (const failure of failures) console.log(`  ✗ ${failure}`);
console.log(`providerSkills: ${passed}/${passed + failures.length} assertions passed`);
