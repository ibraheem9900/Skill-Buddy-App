/**
 * jobRoute.ts — the ONE way a job card opens job details.
 *
 * ROUND 18 root cause: (tabs)/jobs.tsx pushed `{ href: '/job/123', params }`.
 * Expo Router's object form is `{ pathname, params }`; `href` is not a route
 * key, so the push had nothing to resolve and the tap did nothing (silently, in
 * release builds). Every caller now builds the route here, so the shape is
 * valid by construction and unit-tested.
 *
 * Params must be STRINGS (Expo Router serialises them into the URL): a number,
 * `undefined`, `NaN` or an object is never allowed through.
 */

/** Only the fields the route needs, so any card/list item can call this. */
export interface JobRouteSource {
  id: number;
  distance_km?: unknown;
}

export interface JobDetailsRoute {
  pathname: '/job/[id]';
  params: { id: string; distance?: string };
}

/**
 * `{ pathname: '/job/[id]', params: { id } }`, plus `distance` ONLY when the
 * item really carries a finite, non-negative number. Never a NaN/Infinity/null
 * and never an object.
 */
export function jobDetailsRoute(job: JobRouteSource): JobDetailsRoute {
  const params: JobDetailsRoute['params'] = { id: String(job.id) };
  const raw = job.distance_km;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    params.distance = String(raw);
  }
  return { pathname: '/job/[id]', params };
}
