import { useEffect, useMemo, useState } from 'react';
import { authApi } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import {
  jobPermissionsForIds,
  sameUserId,
  type JobPermissionJob,
  type JobPermissions,
} from '@/lib/jobPermissions';

/** Client-profile ids already resolved for an account (one request per session). */
const clientIdCache = new Map<string, Array<string | number>>();

/**
 * THE permission matrix for one job, bound to the live auth/role contexts.
 *
 * `/users/me` and `/clients/profile` do not guarantee the same numeric id, and
 * `job.client_id` can be either. When the /users/me id does not match, this hook
 * resolves the client profile once and checks BOTH ids before deciding the
 * viewer is a stranger — that mismatch is what hid every owner action.
 */
export function useJobPermissions(job: JobPermissionJob | null | undefined): JobPermissions {
  const { user } = useAuth();
  const { activeRole } = useRole();
  const [clientIds, setClientIds] = useState<Array<string | number>>([]);
  const accountId = user?.id ?? null;

  useEffect(() => {
    let active = true;
    if (!accountId || !job) {
      setClientIds([]);
      return;
    }

    // The common path costs nothing: if /users/me already identifies the owner,
    // there is no reason to hit the client profile at all.
    if (sameUserId(job.client_id, accountId)) {
      setClientIds([]);
      return;
    }

    const cached = clientIdCache.get(String(accountId));
    if (cached) {
      setClientIds(cached);
      return;
    }

    void authApi
      .getClientProfile()
      .then(({ data }) => {
        const ids: Array<string | number> = [];
        if (data && typeof data.id === 'number') ids.push(data.id);
        const maybeUserId = (data as { user_id?: unknown } | null)?.user_id;
        if (typeof maybeUserId === 'number' || typeof maybeUserId === 'string') {
          ids.push(maybeUserId);
        }
        clientIdCache.set(String(accountId), ids);
        if (active) setClientIds(ids);
      })
      .catch(() => {
        // No client profile is a neutral answer, not an ownership grant.
        clientIdCache.set(String(accountId), []);
        if (active) setClientIds([]);
      });

    return () => {
      active = false;
    };
  }, [accountId, job?.client_id]);

  const idKey = useMemo(
    () => [accountId ?? '', ...clientIds.map(String)].join('|'),
    [accountId, clientIds]
  );

  return useMemo(() => {
    const ids: Array<string | number> = [];
    if (accountId) ids.push(accountId);
    ids.push(...clientIds);
    return jobPermissionsForIds(job, activeRole, ids);
    // idKey covers clientIds without making a new array a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, activeRole, accountId, idKey]);
}

export default useJobPermissions;
