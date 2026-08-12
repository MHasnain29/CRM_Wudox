/** Senior approver roles equivalent to Director for approval route validation. */
export const DIRECTOR_TIER_ROLE_KEYS = ['director', 'company_director'] as const;

export type DirectorTierRoleKey = (typeof DIRECTOR_TIER_ROLE_KEYS)[number];

/** Manager roles that typically forward to director-tier in default approval routes. */
export const MANAGER_ROUTE_JUNIOR_KEYS = ['sales_manager', 'recruitment_manager'] as const;

/** Roles that may final-approve over junior steps (in or out of the configured route). */
export const APPROVAL_OVERRIDE_ROLE_KEYS = ['super_admin', 'director', 'company_director'] as const;

export function isApprovalOverrideRoleKey(roleKey: string): boolean {
  return (APPROVAL_OVERRIDE_ROLE_KEYS as readonly string[]).includes(roleKey);
}

export function isDirectorTierRoleKey(roleKey: string): boolean {
  return (DIRECTOR_TIER_ROLE_KEYS as readonly string[]).includes(roleKey);
}

export function isManagerRouteJuniorKey(roleKey: string): boolean {
  return (MANAGER_ROUTE_JUNIOR_KEYS as readonly string[]).includes(roleKey);
}
