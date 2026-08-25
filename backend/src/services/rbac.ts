/**
 * Dynamic RBAC: load roles and effective permissions from DB (fallback to static config).
 */
import type { DataScopeLevel } from '@prisma/client';
import prisma from '../config/database';
import { isAgencyIndependentRole } from '../config/agencyIndependentRoles';
import { agencyLabelForUser } from './agencyIndependentUsers';
import {
  getPermissionsForRole as getStaticPermissionsForRole,
  getRoleLabel as getStaticRoleLabel,
  type Permission,
} from '../config/permissions';
import { PERMISSIONS_BY_ROLE_KEY, SYSTEM_ROLE_KEYS } from '../config/systemRolePermissions';

export type RbacRoleTreeNode = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  parentRoleId: string | null;
  sortOrder: number;
  scopeLevel: DataScopeLevel;
  isSystem: boolean;
  isActive: boolean;
  children: RbacRoleTreeNode[];
};

/** Leaf permission keys granted to a role (excludes group nodes). */
export async function getEffectivePermissionKeysForRoleKey(roleKey: string): Promise<string[]> {
  const staticKeys = getStaticPermissionsForRole(roleKey);

  const role = await prisma.rbacRole.findUnique({
    where: { key: roleKey, isActive: true },
    select: {
      id: true,
      key: true,
      isSystem: true,
      permissions: {
        include: { permission: { select: { key: true, isGroup: true } } },
      },
    },
  });

  const dbKeys =
    role?.permissions
      .map((rp) => rp.permission)
      .filter((p) => !p.isGroup)
      .map((p) => p.key) ?? [];

  if (roleKey === 'super_admin') {
    const all = await prisma.rbacPermission.findMany({
      where: { isGroup: false },
      select: { key: true },
    });
    return [...new Set([...staticKeys, ...dbKeys, ...all.map((p) => p.key)])];
  }

  if (!role || dbKeys.length === 0) {
    return staticKeys;
  }

  // Saved role_permissions are authoritative (system + custom). Union with static prevented
  // removing grants like pipeline:write / leads:write from system roles in Settings → Roles.
  return dbKeys;
}

export async function getPermissionsForRoleKey(roleKey: string): Promise<Permission[]> {
  const keys = await getEffectivePermissionKeysForRoleKey(roleKey);
  return keys as Permission[];
}

export async function roleHasPermission(roleKey: string, permission: Permission): Promise<boolean> {
  if (roleKey === 'super_admin') return true;
  const keys = await getEffectivePermissionKeysForRoleKey(roleKey);
  return keys.includes(permission);
}

export async function getRoleDisplayName(roleKey: string): Promise<string> {
  const row = await prisma.rbacRole.findUnique({
    where: { key: roleKey },
    select: { name: true },
  });
  return row?.name ?? getStaticRoleLabel(roleKey);
}

/** Per-user role display: custom Role Title (`userType`) first, then RBAC/static role name. */
export async function getUserRoleTitle(user: {
  userType?: string | null;
  role: string;
}): Promise<string> {
  const trimmed = user.userType?.trim();
  if (trimmed) return trimmed;
  return getRoleDisplayName(user.role);
}

export function getUserRoleTitleSync(user: {
  userType?: string | null;
  role: string;
}): string {
  const trimmed = user.userType?.trim();
  if (trimmed) return trimmed;
  return getStaticRoleLabel(user.role);
}

export async function getDataScopeLevelForRoleKey(roleKey: string): Promise<DataScopeLevel | null> {
  const row = await prisma.rbacRole.findUnique({
    where: { key: roleKey },
    select: { scopeLevel: true },
  });
  return row?.scopeLevel ?? null;
}

/** Active RBAC role keys with any of the given scope levels (for reports, targets, filters). */
export async function getActiveRoleKeysByScopeLevels(
  levels: DataScopeLevel[],
): Promise<string[]> {
  const rows = await prisma.rbacRole.findMany({
    where: { isActive: true, scopeLevel: { in: levels } },
    select: { key: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return rows.map((r) => r.key);
}

function buildRoleTree(
  flat: Array<{
    id: string;
    key: string;
    name: string;
    description: string | null;
    parentRoleId: string | null;
    sortOrder: number;
    scopeLevel: DataScopeLevel;
    isSystem: boolean;
    isActive: boolean;
  }>,
): RbacRoleTreeNode[] {
  const byId = new Map<string, RbacRoleTreeNode>();
  for (const r of flat) {
    byId.set(r.id, { ...r, children: [] });
  }
  const roots: RbacRoleTreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentRoleId && byId.has(node.parentRoleId)) {
      byId.get(node.parentRoleId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (nodes: RbacRoleTreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

export type AssignableRoleOption = {
  key: string;
  name: string;
  scopeLevel: DataScopeLevel;
  sortOrder: number;
  isSystem: boolean;
  /** Parent role key when this role sits under another in the hierarchy. */
  parentKey: string | null;
};

/** Flat list of active roles for user-management and settings dropdowns. */
export async function listAssignableRoles(): Promise<AssignableRoleOption[]> {
  const rows = await prisma.rbacRole.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      key: true,
      name: true,
      scopeLevel: true,
      sortOrder: true,
      isSystem: true,
      parent: { select: { key: true } },
    },
  });
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    scopeLevel: r.scopeLevel,
    sortOrder: r.sortOrder,
    isSystem: r.isSystem,
    parentKey: r.parent?.key ?? null,
  }));
}

export async function getActiveRbacRoleByKey(roleKey: string) {
  const key = roleKey.trim().toLowerCase();
  return prisma.rbacRole.findFirst({
    where: { key, isActive: true },
    select: { id: true, key: true, name: true },
  });
}

/** Active `own`-scope child roles under a parent (e.g. sales_associate under sales_manager). */
export async function getOwnScopeChildRoleKeys(parentRoleKey: string): Promise<string[]> {
  const parent = await prisma.rbacRole.findUnique({
    where: { key: parentRoleKey, isActive: true },
    select: { id: true },
  });
  if (!parent) return [];
  const children = await prisma.rbacRole.findMany({
    where: { parentRoleId: parent.id, isActive: true, scopeLevel: 'own' },
    select: { key: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return children.map((c) => c.key);
}

/** Whether a role key is own-scope (field staff), from RBAC or static fallback. */
export async function isOwnScopeRoleKey(roleKey: string): Promise<boolean> {
  const scope = await getDataScopeLevelForRoleKey(roleKey);
  if (scope) return scope === 'own';
  return ['sales_associate', 'sales_executive', 'marketing', 'recruiter', 'sr_recruiter', 'data_entry_specialist'].includes(roleKey);
}

export async function listRolesTree(): Promise<RbacRoleTreeNode[]> {
  const rows = await prisma.rbacRole.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      parentRoleId: true,
      sortOrder: true,
      scopeLevel: true,
      isSystem: true,
      isActive: true,
    },
  });
  return buildRoleTree(rows);
}

export type PermissionTreeNode = {
  id: string;
  key: string;
  name: string;
  module: string | null;
  parentId: string | null;
  sortOrder: number;
  isGroup: boolean;
  actionType: string | null;
  children: PermissionTreeNode[];
};

function buildPermissionTree(
  flat: Array<{
    id: string;
    key: string;
    name: string;
    module: string | null;
    parentId: string | null;
    sortOrder: number;
    isGroup: boolean;
    actionType: string | null;
  }>,
): PermissionTreeNode[] {
  const byId = new Map<string, PermissionTreeNode>();
  for (const p of flat) {
    byId.set(p.id, { ...p, children: [] });
  }
  const roots: PermissionTreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (nodes: PermissionTreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

export async function listPermissionsTree(): Promise<PermissionTreeNode[]> {
  const rows = await prisma.rbacPermission.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      key: true,
      name: true,
      module: true,
      parentId: true,
      sortOrder: true,
      isGroup: true,
      actionType: true,
    },
  });
  return buildPermissionTree(rows);
}

export async function getRolePermissionKeys(roleId: string): Promise<string[]> {
  const grants = await prisma.rolePermission.findMany({
    where: { roleId },
    include: { permission: { select: { key: true, isGroup: true } } },
  });
  return grants.filter((g) => !g.permission.isGroup).map((g) => g.permission.key);
}

export type RbacRoleDetail = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  parentRoleId: string | null;
  sortOrder: number;
  scopeLevel: DataScopeLevel;
  isSystem: boolean;
  isActive: boolean;
  version: number;
  userCount: number;
  parent: { id: string; key: string; name: string } | null;
};

export async function getRoleById(roleId: string): Promise<RbacRoleDetail | null> {
  const role = await prisma.rbacRole.findUnique({
    where: { id: roleId },
    include: {
      parent: { select: { id: true, key: true, name: true } },
      _count: { select: { users: true } },
    },
  });
  if (!role) return null;
  const { _count, parent, ...rest } = role;
  return { ...rest, userCount: _count.users, parent };
}

async function isDescendantRole(ancestorId: string, nodeId: string): Promise<boolean> {
  let current = await prisma.rbacRole.findUnique({
    where: { id: nodeId },
    select: { parentRoleId: true },
  });
  while (current?.parentRoleId) {
    if (current.parentRoleId === ancestorId) return true;
    current = await prisma.rbacRole.findUnique({
      where: { id: current.parentRoleId },
      select: { parentRoleId: true },
    });
  }
  return false;
}

export async function createRole(input: {
  key: string;
  name: string;
  description?: string | null;
  parentRoleId?: string | null;
  scopeLevel?: DataScopeLevel;
  sortOrder?: number;
}): Promise<RbacRoleDetail> {
  const key = input.key.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(key)) {
    throw new Error('Role key must be lowercase letters, numbers, and underscores');
  }
  const existing = await prisma.rbacRole.findUnique({ where: { key } });
  if (existing) throw new Error('A role with this key already exists');

  if (input.parentRoleId) {
    const parent = await prisma.rbacRole.findUnique({ where: { id: input.parentRoleId } });
    if (!parent) throw new Error('Parent role not found');
  }

  const created = await prisma.rbacRole.create({
    data: {
      key,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      parentRoleId: input.parentRoleId ?? null,
      scopeLevel: input.scopeLevel ?? 'own',
      sortOrder: input.sortOrder ?? 0,
      isSystem: false,
      isActive: true,
    },
    include: {
      parent: { select: { id: true, key: true, name: true } },
      _count: { select: { users: true } },
    },
  });
  const { seedCustomRoleDefaultCapabilities } = await import('./approvalPolicy');
  await seedCustomRoleDefaultCapabilities(created.id);

  const { _count, parent, ...rest } = created;
  return { ...rest, userCount: _count.users, parent };
}

export async function updateRole(
  roleId: string,
  input: {
    name?: string;
    description?: string | null;
    parentRoleId?: string | null;
    scopeLevel?: DataScopeLevel;
    sortOrder?: number;
    isActive?: boolean;
  },
): Promise<RbacRoleDetail> {
  const role = await prisma.rbacRole.findUnique({ where: { id: roleId } });
  if (!role) throw new Error('Role not found');

  if (input.parentRoleId !== undefined) {
    if (input.parentRoleId === roleId) throw new Error('A role cannot be its own parent');
    if (input.parentRoleId) {
      const parent = await prisma.rbacRole.findUnique({ where: { id: input.parentRoleId } });
      if (!parent) throw new Error('Parent role not found');
      if (await isDescendantRole(roleId, input.parentRoleId)) {
        throw new Error('Cannot set parent to a descendant role');
      }
    }
  }

  if (input.scopeLevel !== undefined && input.scopeLevel !== role.scopeLevel) {
    // Users still store role key in `users.role` while roleId rollout is in progress,
    // so we must match by BOTH roleId and role key for transition safety checks.
    const usersWithRole = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [{ roleId: roleId }, { role: role.key }],
      },
      select: { id: true },
    });
    const roleUserIds = usersWithRole.map((u) => u.id);

    // Team -> Own is unsafe when users in this role are referenced as reporting managers.
    if (input.scopeLevel === 'own' && roleUserIds.length > 0) {
      const managedDirectReports = await prisma.user.count({
        where: {
          isActive: true,
          reportingManagerIds: { hasSome: roleUserIds },
          id: { notIn: roleUserIds },
        },
      });
      if (managedDirectReports > 0) {
        throw new Error(
          `Cannot change scope to Own: ${managedDirectReports} active user(s) still report to members of this role. Reassign reporting managers first.`,
        );
      }
    }

    // Agency/Global -> Team/Own should not strand child roles at higher scope than parent.
    if (input.scopeLevel === 'team' || input.scopeLevel === 'own') {
      const childRoles = await prisma.rbacRole.findMany({
        where: { parentRoleId: roleId, isActive: true },
        select: { name: true, scopeLevel: true },
      });
      const rank: Record<DataScopeLevel, number> = { own: 0, team: 1, agency: 2, global: 3 };
      const invalidChild = childRoles.find((c) => rank[c.scopeLevel] > rank[input.scopeLevel!]);
      if (invalidChild) {
        throw new Error(
          `Cannot set scope to ${input.scopeLevel}: child role "${invalidChild.name}" has broader scope (${invalidChild.scopeLevel}). Update child roles first.`,
        );
      }
    }
  }

  const updated = await prisma.rbacRole.update({
    where: { id: roleId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.parentRoleId !== undefined ? { parentRoleId: input.parentRoleId } : {}),
      ...(input.scopeLevel !== undefined ? { scopeLevel: input.scopeLevel } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      version: { increment: 1 },
    },
    include: {
      parent: { select: { id: true, key: true, name: true } },
      _count: { select: { users: true } },
    },
  });
  const { _count, parent, ...rest } = updated;
  return { ...rest, userCount: _count.users, parent };
}

export async function deleteRole(roleId: string): Promise<void> {
  const role = await prisma.rbacRole.findUnique({
    where: { id: roleId },
    include: { _count: { select: { users: true } } },
  });
  if (!role) throw new Error('Role not found');
  if (role.isSystem) throw new Error('System roles cannot be deleted');
  if (role._count.users > 0) {
    throw new Error('Reassign all users before deleting this role');
  }
  const childCount = await prisma.rbacRole.count({ where: { parentRoleId: roleId, isActive: true } });
  if (childCount > 0) throw new Error('Remove or reassign child roles first');

  await prisma.rbacRole.update({
    where: { id: roleId },
    data: { isActive: false, version: { increment: 1 } },
  });
}

export type RbacRoleUserRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  userType: string;
  isActive: boolean;
  subCompanyId: string | null;
  subCompanyName: string | null;
};

export async function listUsersForRole(roleId: string): Promise<RbacRoleUserRow[]> {
  const role = await prisma.rbacRole.findUnique({
    where: { id: roleId },
    select: { id: true, key: true },
  });
  if (!role) throw new Error('Role not found');

  const rows = await prisma.user.findMany({
    where: {
      OR: [{ roleId: role.id }, { role: role.key }],
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      userType: true,
      isActive: true,
      subCompanyId: true,
      subCompany: { select: { name: true } },
    },
    orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
  });

  const seen = new Set<string>();
  const out: RbacRoleUserRow[] = [];
  for (const u of rows) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    out.push({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      userType: u.userType,
      isActive: u.isActive,
      subCompanyId: isAgencyIndependentRole(u.role) ? null : u.subCompanyId,
      subCompanyName: agencyLabelForUser(u.role, u.subCompany?.name ?? null),
    });
  }
  return out;
}

export async function setRolePermissions(roleId: string, permissionKeys: string[]): Promise<string[]> {
  const role = await prisma.rbacRole.findUnique({ where: { id: roleId } });
  if (!role) throw new Error('Role not found');

  const uniqueKeys = [...new Set(permissionKeys.map((k) => k.trim()).filter(Boolean))];
  const permissions = await prisma.rbacPermission.findMany({
    where: { key: { in: uniqueKeys }, isGroup: false },
    select: { id: true, key: true },
  });
  const foundKeys = new Set(permissions.map((p) => p.key));
  const missing = uniqueKeys.filter((k) => !foundKeys.has(k));
  if (missing.length > 0) {
    throw new Error(`Unknown permissions: ${missing.join(', ')}`);
  }

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId } }),
    prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId, permissionId: p.id })),
      skipDuplicates: true,
    }),
    prisma.rbacRole.update({
      where: { id: roleId },
      data: { version: { increment: 1 } },
    }),
  ]);

  return permissions.map((p) => p.key);
}

export type ResetSystemRolesResult = {
  resetRoleKeys: string[];
  skippedRoleKeys: string[];
};

/** Restore default permission grants for all built-in system roles (custom roles unchanged). */
export async function resetSystemRolesToDefaults(): Promise<ResetSystemRolesResult> {
  const resetRoleKeys: string[] = [];
  const skippedRoleKeys: string[] = [];

  for (const roleKey of SYSTEM_ROLE_KEYS) {
    const permKeys = PERMISSIONS_BY_ROLE_KEY[roleKey];
    const role = await prisma.rbacRole.findUnique({
      where: { key: roleKey },
      select: { id: true, isSystem: true },
    });
    if (!role) {
      skippedRoleKeys.push(roleKey);
      continue;
    }
    await setRolePermissions(role.id, permKeys);
    resetRoleKeys.push(roleKey);
  }

  const { seedRoleApprovalCapabilities } = await import('./approvalPolicy');
  await seedRoleApprovalCapabilities();

  return { resetRoleKeys, skippedRoleKeys };
}
