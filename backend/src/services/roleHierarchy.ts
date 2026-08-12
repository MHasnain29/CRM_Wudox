/** Role tree helpers for approval route ordering (junior → senior). */

import prisma from '../config/database';
import {
  APPROVAL_OVERRIDE_ROLE_KEYS,
  isApprovalOverrideRoleKey,
  isDirectorTierRoleKey,
  isManagerRouteJuniorKey,
} from '../config/directorTierRoles';
export type RoleHierarchyNode = {
  key: string;
  name: string;
  parentKey: string | null;
};

export function buildParentKeyMap(roles: RoleHierarchyNode[]): Map<string, string | null> {
  return new Map(roles.map((r) => [r.key, r.parentKey]));
}

/** Active role parent keys for hierarchy checks at runtime. */
export async function getRoleParentKeyMap(): Promise<Map<string, string | null>> {
  const rows = await prisma.rbacRole.findMany({
    where: { isActive: true },
    select: { key: true, parent: { select: { key: true } } },
  });
  return new Map(rows.map((r) => [r.key, r.parent?.key ?? null]));
}

/** True when `actorRoleKey` may direct-approve while the item waits on `targetRoleKey`. */
export function canSeniorOverrideTarget(
  actorRoleKey: string,
  targetRoleKey: string,
  parentByKey: Map<string, string | null>,
): boolean {
  if (!isApprovalOverrideRoleKey(actorRoleKey)) return false;
  if (actorRoleKey === 'super_admin') return true;
  if (actorRoleKey === targetRoleKey) return false;
  if (isRoleAncestorOf(actorRoleKey, targetRoleKey, parentByKey)) return true;
  if (isDirectorTierRoleKey(actorRoleKey) && isManagerRouteJuniorKey(targetRoleKey)) return true;
  return false;
}

export { APPROVAL_OVERRIDE_ROLE_KEYS };

/** True when `ancestorKey` appears above `descendantKey` in Settings → Roles hierarchy. */
export function isRoleAncestorOf(
  ancestorKey: string,
  descendantKey: string,
  parentByKey: Map<string, string | null>,
): boolean {
  if (ancestorKey === descendantKey) return false;
  let current: string | null | undefined = parentByKey.get(descendantKey) ?? null;
  while (current) {
    if (current === ancestorKey) return true;
    current = parentByKey.get(current) ?? null;
  }
  return false;
}

/** Director-tier final approvers may follow manager roles that report to director in the tree. */
export function isValidApprovalRouteStep(
  lowerRoleKey: string,
  higherRoleKey: string,
  parentByKey: Map<string, string | null>,
): boolean {
  if (isRoleAncestorOf(higherRoleKey, lowerRoleKey, parentByKey)) return true;
  if (isDirectorTierRoleKey(higherRoleKey) && isManagerRouteJuniorKey(lowerRoleKey)) {
    if (isRoleAncestorOf('company_director', lowerRoleKey, parentByKey)) return true;
    return isRoleAncestorOf('director', lowerRoleKey, parentByKey);
  }
  return false;
}

export type RouteHierarchyIssue = {
  stepIndex: number;
  lowerRoleKey: string;
  higherRoleKey: string;
  message: string;
};

/** Each step must be more junior than the next (walk up the role tree toward final approver). */
export function validateApprovalRouteHierarchy(
  route: string[],
  roles: RoleHierarchyNode[],
): RouteHierarchyIssue[] {
  if (route.length < 2) return [];

  const parentByKey = buildParentKeyMap(roles);
  const nameByKey = new Map(roles.map((r) => [r.key, r.name]));
  const issues: RouteHierarchyIssue[] = [];

  for (let i = 0; i < route.length - 1; i++) {
    const lower = route[i];
    const higher = route[i + 1];
    if (!isValidApprovalRouteStep(lower, higher, parentByKey)) {
      const lowerName = nameByKey.get(lower) ?? lower.replace(/_/g, ' ');
      const higherName = nameByKey.get(higher) ?? higher.replace(/_/g, ' ');
      issues.push({
        stepIndex: i + 1,
        lowerRoleKey: lower,
        higherRoleKey: higher,
        message: `Step ${i + 2} (${higherName}) must be higher in the role hierarchy than step ${i + 1} (${lowerName}). Order routes from junior to senior (Settings → Roles).`,
      });
    }
  }

  return issues;
}

/** Roles that keep the route valid when placed at `index`. */
export function getValidRolesForRouteStep(
  route: string[],
  index: number,
  roles: RoleHierarchyNode[],
  options?: { excludeInRoute?: boolean },
): RoleHierarchyNode[] {
  const excludeInRoute = options?.excludeInRoute ?? true;
  return roles.filter((role) => {
    if (excludeInRoute && route.includes(role.key) && route[index] !== role.key) return false;
    const candidate = [...route];
    candidate[index] = role.key;
    return validateApprovalRouteHierarchy(candidate, roles).length === 0;
  });
}

/** Next senior role above `roleKey` not already in the route (for Add step). */
export function findNextSeniorRoleKey(
  roleKey: string,
  route: string[],
  parentByKey: Map<string, string | null>,
): string | null {
  let current: string | null | undefined = parentByKey.get(roleKey) ?? null;
  while (current) {
    if (!route.includes(current)) return current;
    current = parentByKey.get(current) ?? null;
  }
  return null;
}
