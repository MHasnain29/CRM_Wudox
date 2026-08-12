import { hasAnyPermission, type Role } from '../config/permissions';

/**
 * Roles that may send From a SendGrid-authenticated personal domain
 * (e.g. getvision.ca) when it does not match the agency send-as domain.
 *
 * company_director + database_manager must be hardcoded — they lack
 * agencies:global / agencies:cross_org in default grants.
 * Do NOT use isAgencyIndependentRole (includes data_entry_specialist).
 * Linked Accounts keep associate roles → false here.
 */
const GLOBAL_SEND_AS_ROLES = new Set([
  'super_admin',
  'director',
  'company_director',
  'operations_manager',
  'database_manager',
]);

export function isGlobalSendAsUser(role: string | null | undefined): boolean {
  if (!role) return false;
  if (GLOBAL_SEND_AS_ROLES.has(role)) return true;
  try {
    return hasAnyPermission(role as Role, ['agencies:global', 'agencies:cross_org']);
  } catch {
    return false;
  }
}
