/**
 * Ensures all system RBAC roles from code exist in the database.
 * Missing roles are upserted individually — never a full seed-rbac (that would
 * rewrite every system role's permissions).
 */
import { ensureMissingSystemRoles } from './ensureMissingSystemRoles';
import { syncMarketingRoleDisplayName } from './syncMarketingRoleDisplayName';

export async function ensureSystemRbacRoles(): Promise<void> {
  await ensureMissingSystemRoles();
  await syncMarketingRoleDisplayName();
}
