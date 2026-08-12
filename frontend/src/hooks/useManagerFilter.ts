import { useMemo } from 'react';
import type { ApiUser } from '@/lib/api';
import type { AssignableRoleOption, DataScopeLevel } from '@/lib/rbacApi';
import { useAuthStore } from '@/lib/authStore';
import { useCanAccessMultipleAgencies, useDataScopeLevel } from '@/lib/access';
import { useAssignableRoles } from '@/hooks/useAssignableRoles';
import {
  buildHierarchyFilter,
  type HierarchyFilterResult,
  type HierarchyFilterSelections,
  type ScopeDomain,
} from '@/lib/hierarchyFilter';

export type { HierarchyFilterTier, HierarchyFilterResult } from '@/lib/hierarchyFilter';

/**
 * RBAC-driven agency user tiers (leader → team → own) from Settings → Roles.
 */
export function useHierarchyFilter(
  agencyUsers: ApiUser[],
  selections: HierarchyFilterSelections,
  options?: {
    viewerRoleKey?: string;
    viewerScope?: DataScopeLevel;
    viewerUserId?: string;
    viewerHasCrossOrg?: boolean;
    assignableRoles?: AssignableRoleOption[];
    viewerApiUser?: ApiUser;
    domain?: ScopeDomain;
  },
): HierarchyFilterResult {
  const viewerRole = useAuthStore((s) => s.user?.role);
  const viewerScope = useDataScopeLevel();
  const viewerUserId = useAuthStore((s) => s.user?.id);
  const isElevated = useCanAccessMultipleAgencies();
  const { assignableRoles: loadedRoles } = useAssignableRoles();

  const viewerRoleKey = options?.viewerRoleKey ?? viewerRole;
  const scope = options?.viewerScope ?? viewerScope;
  const userId = options?.viewerUserId ?? viewerUserId;
  const viewerHasCrossOrg = options?.viewerHasCrossOrg ?? isElevated;
  const assignableRoles = options?.assignableRoles ?? loadedRoles;
  const viewerApiUser = options?.viewerApiUser;
  const domain = options?.domain;

  return useMemo(
    () =>
      buildHierarchyFilter(
        agencyUsers,
        assignableRoles,
        viewerRoleKey,
        scope,
        selections,
        { viewerUserId: userId, viewerHasCrossOrg, viewerApiUser, domain },
      ),
    [agencyUsers, assignableRoles, viewerRoleKey, scope, selections, userId, viewerHasCrossOrg, viewerApiUser, domain],
  );
}

/**
 * @deprecated Prefer useHierarchyFilter — kept for gradual migration.
 * Returns team-tier managers and own-tier associates from RBAC scope levels.
 */
export function useManagerFilter(agencyUsers: ApiUser[]) {
  const selections: HierarchyFilterSelections = {
    leaderId: 'all',
    managerId: 'all',
    userId: 'all',
  };
  const { managers, associates, getAssociatesForManager, getUsersForLeader, tiers } =
    useHierarchyFilter(agencyUsers, selections);

  return { managers, associates, getAssociatesForManager, getUsersForLeader, tiers };
}
