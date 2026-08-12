/** Client-side mirror of backend roleHierarchy (approval route junior → senior). */

export const DIRECTOR_TIER_ROLE_KEYS = ['director', 'company_director'] as const;
export const MANAGER_ROUTE_JUNIOR_KEYS = ['sales_manager', 'recruitment_manager'] as const;

export type RoleHierarchyNode = {
  key: string;
  name: string;
  parentKey: string | null;
};

function isDirectorTierRoleKey(roleKey: string): boolean {
  return (DIRECTOR_TIER_ROLE_KEYS as readonly string[]).includes(roleKey);
}

function isManagerRouteJuniorKey(roleKey: string): boolean {
  return (MANAGER_ROUTE_JUNIOR_KEYS as readonly string[]).includes(roleKey);
}

export function buildParentKeyMap(roles: RoleHierarchyNode[]): Map<string, string | null> {
  return new Map(roles.map((r) => [r.key, r.parentKey]));
}

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

function isValidApprovalRouteStep(
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
  workflow?: string;
  message: string;
};

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
        message: `Step ${i + 2} (${higherName}) must be higher in the role hierarchy than step ${i + 1} (${lowerName}). Order routes from junior to senior (Settings → Roles).`,
      });
    }
  }

  return issues;
}

export function getValidRolesForRouteStep(
  route: string[],
  index: number,
  roles: RoleHierarchyNode[],
): RoleHierarchyNode[] {
  return roles.filter((role) => {
    if (route.includes(role.key) && route[index] !== role.key) return false;
    const candidate = [...route];
    candidate[index] = role.key;
    return validateApprovalRouteHierarchy(candidate, roles).length === 0;
  });
}

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

export function validateAllWorkflowRoutes(
  workflows: Record<string, { mode: string; route?: string[] }>,
  roles: RoleHierarchyNode[],
): RouteHierarchyIssue[] {
  const issues: RouteHierarchyIssue[] = [];
  for (const [workflow, cfg] of Object.entries(workflows)) {
    if (cfg.mode !== 'route' || !cfg.route?.length) continue;
    for (const issue of validateApprovalRouteHierarchy(cfg.route, roles)) {
      issues.push({ ...issue, workflow });
    }
  }
  return issues;
}
