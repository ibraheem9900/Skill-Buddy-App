/**
 * providerSkills.ts
 *
 * Pure logic behind the provider's skills screen — the visibility prerequisite
 * the Integration Guide calls out in section 4.1: a provider's ACTIVE skills are
 * what make matching jobs rank first in the nearby feed (`matches_skill` true).
 *
 * LIVE-VERIFIED (2026-10-16, test provider id 3, against the live API):
 *   GET    /providers/me/skills          200 array of ProviderSkillResponse
 *   POST   /providers/me/skills          {service_id} → 201 ProviderSkillResponse
 *   POST   same service again            409 {"detail":"You already have this service as a skill."}
 *   POST   bad service_id                404 {"detail":"Service not found."}
 *   POST   missing service_id            422 detail[loc=["body","service_id"]]
 *   GET    /providers/me/skills/{id}     200 (404 {"detail":"Skill not found."} when gone)
 *   PATCH  /providers/me/skills/{id}     200; body accepts ONLY skill_type,
 *                                        years_of_experience (0..80; 81 → 422
 *                                        less_than_equal), is_active (bool, works);
 *                                        unknown fields are ignored, {} is a 200 no-op
 *   DELETE /providers/me/skills/{id}     204 (404 "Skill not found." the second time)
 *
 * `is_active` here is the SKILL's own flag — never the provider profile's
 * approval flag, which this chunk never reads or writes.
 *
 * No React and no axios, so every rule below is unit-testable.
 */
import type { ProviderSkill } from '@/types';

/** The live SkillType enum — the only two values the schema allows. */
export const SKILL_TYPES = ['PRIMARY', 'SECONDARY'] as const;
export type SkillType = (typeof SKILL_TYPES)[number];

/** Live bounds of `years_of_experience` (PATCH 81 → 422 less_than_equal 80). */
export const SKILL_YEARS_MIN = 0;
export const SKILL_YEARS_MAX = 80;

export function isSkillType(value: unknown): value is SkillType {
  return typeof value === 'string' && (SKILL_TYPES as readonly string[]).includes(value);
}

/** Server truth for one skill; `null`/undefined parts never throw. */
export function isActiveSkill(skill: ProviderSkill | null | undefined): boolean {
  return skill?.is_active === true;
}

/** How many skills are ACTIVE. This is the number the feed's nudge reads. */
export function countActiveSkills(skills: readonly ProviderSkill[] | null | undefined): number {
  if (!Array.isArray(skills)) return 0;
  let count = 0;
  for (const skill of skills) if (isActiveSkill(skill)) count += 1;
  return count;
}

/** Service ids the provider already has (any state) — used by the picker. */
export function skillServiceIds(skills: readonly ProviderSkill[] | null | undefined): Set<number> {
  const ids = new Set<number>();
  if (!Array.isArray(skills)) return ids;
  for (const skill of skills) {
    if (typeof skill?.service_id === 'number') ids.add(skill.service_id);
  }
  return ids;
}

/* ──────────────────────────────────────────────── list state transitions ── */

/**
 * Apply a SERVER-returned skill to the list: replace the row with the same id,
 * or insert it. Never a locally-built row — every caller passes the 201/200
 * response body, which is why nothing here fabricates an id, a category or an
 * `is_active` flag the server has not confirmed.
 *
 * A duplicate `service_id` under a DIFFERENT id cannot arrive from the live
 * backend (409 instead), so it is not guessed at here; the row is simply kept
 * in id order so two overlapping rows would both be visible rather than one
 * silently hiding the other.
 */
export function upsertSkill(
  skills: readonly ProviderSkill[],
  skill: ProviderSkill | null | undefined
): ProviderSkill[] {
  if (!skill || typeof skill.id !== 'number') return [...skills];
  const index = skills.findIndex((row) => row?.id === skill.id);
  if (index < 0) return [...skills, skill];
  const next = [...skills];
  next[index] = skill;
  return next;
}

/**
 * Drop one skill by id — called ONLY after the live 204 (or the 404 that means
 * "already gone"). No optimistic removal: an id that is not in the list leaves
 * it untouched rather than throwing.
 */
export function dropSkill(skills: readonly ProviderSkill[], skillId: number): ProviderSkill[] {
  return skills.filter((row) => row?.id !== skillId);
}

/**
 * Reconcile the list with a freshly-read server list: the server's array wins
 * whole, and only a non-array body (a 200 that is not a list) is ignored.
 * Used after a write to re-read the truth instead of patching rows locally.
 */
export function reconcileSkills(
  current: readonly ProviderSkill[],
  incoming: unknown
): ProviderSkill[] {
  if (!Array.isArray(incoming)) return [...current];
  return incoming.filter((row): row is ProviderSkill => !!row && typeof (row as ProviderSkill).id === 'number');
}

/** The same list, in a stable order: category, then service, then id. */
export function sortSkills(skills: readonly ProviderSkill[]): ProviderSkill[] {
  return [...skills].sort((a, b) => {
    const category = (a?.category_name ?? '').localeCompare(b?.category_name ?? '');
    if (category !== 0) return category;
    const service = (a?.service_title ?? '').localeCompare(b?.service_title ?? '');
    if (service !== 0) return service;
    return (a?.id ?? 0) - (b?.id ?? 0);
  });
}

/* ────────────────────────────────────────────────────────── write bodies ── */

/** POST body: only `service_id` is required by the live schema. */
export function buildSkillCreateBody(serviceId: number): { service_id: number } {
  return { service_id: serviceId };
}

/**
 * PATCH body: ONLY the three fields the live schema defines, and only those the
 * caller actually wants changed. `null`/`undefined` are omitted rather than sent
 * as nulls (the schema would accept null, but sending "change nothing" fields is
 * how an accidental wipe happens). An empty result is legal — the live endpoint
 * answers 200 to `{}` — so callers should avoid it rather than the module
 * blocking it.
 */
export function buildSkillUpdateBody(change: {
  skillType?: SkillType | null;
  yearsOfExperience?: number | null;
  isActive?: boolean | null;
}): { skill_type?: SkillType; years_of_experience?: number; is_active?: boolean } {
  const body: { skill_type?: SkillType; years_of_experience?: number; is_active?: boolean } = {};
  if (isSkillType(change.skillType)) body.skill_type = change.skillType;
  if (typeof change.yearsOfExperience === 'number' && Number.isInteger(change.yearsOfExperience)) {
    body.years_of_experience = change.yearsOfExperience;
  }
  if (typeof change.isActive === 'boolean') body.is_active = change.isActive;
  return body;
}

/**
 * The fields that actually differ between the skill on screen and the desired
 * one, so a toggle sends ONE field instead of a full body. `is_active` is
 * compared strictly: a skill whose flag the server already reports as desired
 * produces no request at all.
 */
export function skillUpdateDiff(
  current: Pick<ProviderSkill, 'skill_type' | 'years_of_experience' | 'is_active'> | null | undefined,
  next: { skillType?: SkillType; yearsOfExperience?: number; isActive?: boolean }
): { skill_type?: SkillType; years_of_experience?: number; is_active?: boolean } {
  return buildSkillUpdateBody({
    skillType: next.skillType !== undefined && next.skillType !== current?.skill_type ? next.skillType : null,
    yearsOfExperience:
      next.yearsOfExperience !== undefined && next.yearsOfExperience !== current?.years_of_experience
        ? next.yearsOfExperience
        : null,
    isActive: next.isActive !== undefined && next.isActive !== current?.is_active ? next.isActive : null,
  });
}

/** Is this years value one the live endpoint accepts (0..80, integer)? */
export function isValidSkillYears(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= SKILL_YEARS_MIN &&
    value <= SKILL_YEARS_MAX
  );
}

/* ───────────────────────────────────────────────────────── failure mapping ── */

export type SkillFailureKind =
  | 'duplicate'
  | 'service-missing'
  | 'gone'
  | 'invalid'
  | 'forbidden'
  | 'unauthorized'
  | 'network';

export type SkillErrorKey =
  | 'skills_err_duplicate'
  | 'skills_err_service_missing'
  | 'skills_err_gone'
  | 'skills_err_invalid'
  | 'skills_err_forbidden'
  | 'skills_err_session'
  | 'skills_err_network'
  | 'skills_err_generic';

export interface SkillFailure {
  kind: SkillFailureKind;
  /** The key to render when the backend sent no usable detail. */
  messageKey: SkillErrorKey;
  /** The backend's own words when it sent any — shown verbatim. */
  detail: string | null;
  /** Per-field 422 messages, when the failure was a validation error. */
  fieldMessages: string[];
}

/** One message out of FastAPI's `detail` (string, or an array of {msg, loc}). */
export function skillErrorDetail(body: unknown): string | null {
  if (typeof body === 'string' && body.trim().length > 0) return body.trim();
  if (!body || typeof body !== 'object') return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string' && detail.trim().length > 0) return detail.trim();
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (item && typeof item === 'object' ? (item as { msg?: unknown }).msg : null))
      .filter((msg): msg is string => typeof msg === 'string' && msg.trim().length > 0);
    return messages.length > 0 ? messages.join('; ') : null;
  }
  return null;
}

/**
 * Map a skills failure to what the screen shows.
 *
 * The backend's own detail is KEPT whenever it sent one (the live 409 and 404
 * both carry a sentence the provider should read); the translated key is only
 * the fallback for a body-less failure, so the app never rewrites a message the
 * server did send and never shows a raw status code alone.
 */
export function skillFailure(httpStatus: number, body: unknown): SkillFailure {
  const detail = skillErrorDetail(body);
  const fieldMessages = Array.isArray((body as { detail?: unknown })?.detail)
    ? ((body as { detail: unknown[] }).detail
        .map((item) => (item && typeof item === 'object' ? (item as { msg?: unknown }).msg : null))
        .filter((msg): msg is string => typeof msg === 'string') as string[])
    : [];

  if (httpStatus === 409) return { kind: 'duplicate', messageKey: 'skills_err_duplicate', detail, fieldMessages };
  if (httpStatus === 404) {
    return {
      kind: detail && /service/i.test(detail) ? 'service-missing' : 'gone',
      messageKey: detail && /service/i.test(detail) ? 'skills_err_service_missing' : 'skills_err_gone',
      detail,
      fieldMessages,
    };
  }
  if (httpStatus === 422) return { kind: 'invalid', messageKey: 'skills_err_invalid', detail, fieldMessages };
  if (httpStatus === 403) return { kind: 'forbidden', messageKey: 'skills_err_forbidden', detail, fieldMessages };
  if (httpStatus === 401) return { kind: 'unauthorized', messageKey: 'skills_err_session', detail, fieldMessages };
  return { kind: 'network', messageKey: 'skills_err_network', detail, fieldMessages };
}

/** The body the screen renders: the server's own words, else the translated key. */
export function skillFailureText(
  failure: SkillFailure,
  translate: (key: SkillErrorKey) => string
): string {
  return failure.detail ?? translate(failure.messageKey);
}

/* ───────────────────────────────────────────────── actions available ── */

/**
 * What the screen may do with one skill. Kept here (not in the component) so
 * the rules are testable: a skill can always be deactivated and deleted, and
 * reactivated when it is inactive.
 */
export interface SkillActions {
  canToggleActive: boolean;
  /** The flag the toggle would send. */
  nextActive: boolean;
  canDelete: boolean;
}

export function skillActions(skill: ProviderSkill | null | undefined): SkillActions {
  const active = isActiveSkill(skill);
  return { canToggleActive: skill != null, nextActive: !active, canDelete: skill != null };
}
