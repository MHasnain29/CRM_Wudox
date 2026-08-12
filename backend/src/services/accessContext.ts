/**
 * Dynamic access context: permissions + data scope from RBAC (not static role name lists).
 */
import type { DataScopeLevel } from '@prisma/client';
import type { JwtPayload } from '../middleware/auth';
import prisma from '../config/database';
import type { Permission } from '../config/permissions';
import { getDataScopeLevelForRoleKey, getEffectivePermissionKeysForRoleKey } from './rbac';

export type AccessContext = {
  userId: string;
  roleKey: string;
  subCompanyId: string;
  permissions: string[];
  scopeLevel: DataScopeLevel;
};

const SCOPE_RANK: Record<DataScopeLevel, number> = {
  own: 0,
  team: 1,
  agency: 2,
  global: 3,
};

export function scopeAtLeast(level: DataScopeLevel, min: DataScopeLevel): boolean {
  return SCOPE_RANK[level] >= SCOPE_RANK[min];
}

/**
 * Effective data scope for a role: DB scopeLevel plus minimum implied by permissions.
 * Prevents directors / ops / super admins from being treated as team-only managers
 * when RBAC scopeLevel is missing or set too low.
 */
export function resolveEffectiveScopeLevel(
  roleKey: string,
  scopeFromDb: DataScopeLevel | null,
  permissions: string[],
): DataScopeLevel {
  if (roleKey === 'super_admin') return 'global';
  const level: DataScopeLevel = scopeFromDb ?? 'own';
  if (permissions.includes('agencies:global')) return 'global';
  if (permissions.includes('agencies:cross_org') && SCOPE_RANK[level] < SCOPE_RANK.agency) {
    return 'agency';
  }
  return level;
}

export async function buildAccessContext(user: JwtPayload): Promise<AccessContext> {
  const roleKey = user.role ?? '';
  const [permissions, scopeFromDb] = await Promise.all([
    getEffectivePermissionKeysForRoleKey(roleKey),
    getDataScopeLevelForRoleKey(roleKey),
  ]);

  const scopeLevel = resolveEffectiveScopeLevel(roleKey, scopeFromDb, permissions);

  return {
    userId: user.sub,
    roleKey,
    subCompanyId: user.subCompanyId,
    permissions,
    scopeLevel,
  };
}

export function hasPermission(ctx: AccessContext, permission: Permission | string): boolean {
  if (ctx.roleKey === 'super_admin') return true;
  return ctx.permissions.includes(permission);
}

export function hasAnyPermission(ctx: AccessContext, permissions: (Permission | string)[]): boolean {
  if (permissions.length === 0) return true;
  return permissions.some((p) => hasPermission(ctx, p));
}

/** Cross-agency / org-wide agency picker (requires cross-org or global permission). */
export function canAccessMultipleAgencies(ctx: AccessContext): boolean {
  if (ctx.roleKey === 'super_admin') return true;
  return (
    hasPermission(ctx, 'agencies:cross_org') ||
    hasPermission(ctx, 'agencies:global')
  );
}

export function canViewAllDataInAgency(ctx: AccessContext): boolean {
  return scopeAtLeast(ctx.scopeLevel, 'agency');
}

export function canViewTeamData(ctx: AccessContext): boolean {
  return scopeAtLeast(ctx.scopeLevel, 'team');
}

/** Team-scope managers only (e.g. sales_manager), not agency leads like company_director. */
export function isTeamScopeManagerOnly(ctx: AccessContext): boolean {
  return ctx.scopeLevel === 'team' && !canAccessMultipleAgencies(ctx);
}

/** Single-agency elevated lead (company_director) without cross-org access. */
export function isSingleAgencyLead(ctx: AccessContext): boolean {
  return canViewAllDataInAgency(ctx) && !canAccessMultipleAgencies(ctx);
}

export function canAccessUserHierarchy(ctx: AccessContext): boolean {
  return canAccessMultipleAgencies(ctx) || isTeamScopeManagerOnly(ctx) || isSingleAgencyLead(ctx);
}

export function isOwnDataOnlyScope(ctx: AccessContext): boolean {
  return ctx.scopeLevel === 'own';
}

/** UserRole enum values for users whose RBAC role has the given scope levels (for Prisma `role in [...]`). */
export async function getUserRoleEnumKeysForScopeLevels(
  levels: DataScopeLevel[],
  subCompanyId?: string,
): Promise<string[]> {
  const roles = await prisma.rbacRole.findMany({
    where: { isActive: true, scopeLevel: { in: levels } },
    select: { key: true },
  });
  const keys = roles.map((r) => r.key);
  if (!subCompanyId) return keys;
  const used = await prisma.user.findMany({
    where: { subCompanyId, isActive: true, role: { in: keys } },
    select: { role: true },
    distinct: ['role'],
  });
  return used.map((u) => u.role);
}

/** Active user IDs in an agency with at least the given scope (managers, directors, etc.). */
export async function getUserIdsWithMinScope(
  subCompanyId: string,
  minScope: DataScopeLevel,
): Promise<string[]> {
  const levels = (Object.keys(SCOPE_RANK) as DataScopeLevel[]).filter(
    (l) => SCOPE_RANK[l] >= SCOPE_RANK[minScope],
  );
  const roleKeys = await getUserRoleEnumKeysForScopeLevels(levels, subCompanyId);
  if (roleKeys.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { subCompanyId, isActive: true, role: { in: roleKeys } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** Users in agency with a specific permission (e.g. notify managers). */
export async function roleKeyHasMinScope(roleKey: string, minScope: DataScopeLevel): Promise<boolean> {
  const scope = await getDataScopeLevelForRoleKey(roleKey);
  if (!scope) return false;
  return scopeAtLeast(scope, minScope);
}

/** Owner / team filters on list endpoints (elevated or manager scope). */
export async function requestCanUseOwnerIdsFilter(req: {
  access?: AccessContext;
  user?: JwtPayload;
}): Promise<boolean> {
  if (req.access) {
    return canAccessMultipleAgencies(req.access) || canViewTeamData(req.access);
  }
  if (!req.user) return false;
  const ctx = await buildAccessContext(req.user);
  return canAccessMultipleAgencies(ctx) || canViewTeamData(ctx);
}

/** Active users org-wide with a given RBAC role key (any agency; includes agency-less DB managers' approvers). */
export async function getUserIdsForRoleKeyOrgWide(roleKey: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, role: roleKey },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** Active users in an agency with a given RBAC role key (User.role enum). */
export async function getUserIdsForRoleKeyInAgency(
  subCompanyId: string,
  roleKey: string,
): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { subCompanyId, isActive: true, role: roleKey },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function getUserIdsWithPermissionInAgency(
  subCompanyId: string,
  permission: string,
): Promise<string[]> {
  const grants = await prisma.rolePermission.findMany({
    where: { permission: { key: permission, isGroup: false } },
    select: { roleId: true },
  });
  const roleIds = grants.map((g) => g.roleId);
  if (roleIds.length === 0) return [];

  const rbacRoles = await prisma.rbacRole.findMany({
    where: { id: { in: roleIds }, isActive: true },
    select: { key: true },
  });
  const roleKeys = rbacRoles.map((r) => r.key);
  if (roleKeys.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { subCompanyId, isActive: true, role: { in: roleKeys } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** Users who may approve clients (pending submissions, org-wide client alerts). */
export async function getClientApproverUserIds(
  subCompanyId: string,
  options?: { excludeUserId?: string },
): Promise<string[]> {
  const ids = await getUserIdsWithPermissionInAgency(subCompanyId, 'clients:approve');
  if (!options?.excludeUserId) return ids;
  return ids.filter((id) => id !== options.excludeUserId);
}
