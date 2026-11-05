import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import { jobPermissions, type JobPermissionJob, type JobPermissions } from '@/lib/jobPermissions';

/**
 * THE permission matrix for one job, bound to the live auth/role contexts.
 *
 * Thin by design: all the rules (and their tests) are in lib/jobPermissions, so a
 * screen cannot accidentally re-implement "am I the owner?" a third way.
 */
export function useJobPermissions(job: JobPermissionJob | null | undefined): JobPermissions {
  const { user } = useAuth();
  const { activeRole } = useRole();
  return useMemo(
    () => jobPermissions(job, activeRole, user?.id),
    [job, activeRole, user?.id]
  );
}

export default useJobPermissions;
