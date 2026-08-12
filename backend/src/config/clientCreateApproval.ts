import { getDataScopeLevelForRoleKey } from '../services/rbac';

/** Roles that must always enter the approval queue for client changes (regardless of scope). */
const ROLES_ALWAYS_PENDING_CLIENT_CHANGES = new Set(['database_manager']);

/**
 * Whether manual add must enter the agency/org approval queue before create.
 * Scope alone must not skip Settings → Approvals workflows; bypass is decided in submitEntityForApproval.
 */
export async function clientManualCreateBypassesApproval(_role: string | undefined): Promise<boolean> {
  return false;
}

export async function clientManualChangeBypassesApproval(role: string | undefined): Promise<boolean> {
  if (!role) return false;
  if (ROLES_ALWAYS_PENDING_CLIENT_CHANGES.has(role)) return false;
  const scope = await getDataScopeLevelForRoleKey(role);
  if (!scope) return false;
  return scope !== 'own';
}

export function isDatabaseManagerRole(role: string | undefined): boolean {
  return role === 'database_manager';
}

/** Super Users screen roles (Settings → Super Users). */
export const SUPER_USER_SCREEN_ROLES = new Set([
  'super_admin',
  'director',
  'company_director',
  'operations_manager',
]);

export function isSuperUserScreenRole(role: string | undefined): boolean {
  return !!role && SUPER_USER_SCREEN_ROLES.has(role);
}
