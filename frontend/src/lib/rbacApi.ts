import { apiFetch } from './api';

export type DataScopeLevel = 'global' | 'agency' | 'team' | 'own';

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

export type RbacPermissionTreeNode = {
  id: string;
  key: string;
  name: string;
  module: string | null;
  parentId: string | null;
  sortOrder: number;
  isGroup: boolean;
  actionType: string | null;
  children: RbacPermissionTreeNode[];
};

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

function unwrapData<T>(result: Awaited<ReturnType<typeof apiFetch<T>>>): T {
  if (!result.ok) throw new Error('Request failed');
  const body = result.data as { data?: T };
  if (body && typeof body === 'object' && 'data' in body && (body as { data?: T }).data !== undefined) {
    return (body as { data: T }).data;
  }
  return result.data as T;
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const result = await apiFetch<T | { data: T }>(path, init);
  if (!result.ok) {
    let msg = `Request failed (${result.status})`;
    try {
      const errBody = result.data as { error?: string };
      if (errBody?.error) msg = errBody.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return unwrapData<T>(result as { ok: true; data: T | { data: T } });
}

export async function fetchRolesTree(): Promise<RbacRoleTreeNode[]> {
  return apiJson<RbacRoleTreeNode[]>('/roles');
}

export type AssignableRoleOption = {
  key: string;
  name: string;
  scopeLevel: DataScopeLevel;
  sortOrder: number;
  isSystem: boolean;
  parentKey: string | null;
};

export async function fetchAssignableRoles(): Promise<AssignableRoleOption[]> {
  return apiJson<AssignableRoleOption[]>('/roles/assignable');
}

export async function fetchPermissionsCatalog(): Promise<RbacPermissionTreeNode[]> {
  return apiJson<RbacPermissionTreeNode[]>('/roles/permissions');
}

export async function fetchRoleDetail(roleId: string): Promise<RbacRoleDetail> {
  return apiJson<RbacRoleDetail>(`/roles/${encodeURIComponent(roleId)}`);
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

export async function fetchRoleUsers(roleId: string): Promise<RbacRoleUserRow[]> {
  const data = await apiJson<{ roleId: string; roleKey: string; users: RbacRoleUserRow[] }>(
    `/roles/${encodeURIComponent(roleId)}/users`,
  );
  return data.users;
}

export async function fetchRolePermissionKeys(roleId: string): Promise<string[]> {
  const data = await apiJson<{ roleId: string; roleKey: string; permissions: string[] }>(
    `/roles/${encodeURIComponent(roleId)}/permissions`,
  );
  return data.permissions;
}

export async function createRbacRole(payload: {
  key: string;
  name: string;
  description?: string | null;
  parentRoleId?: string | null;
  scopeLevel?: DataScopeLevel;
  sortOrder?: number;
}): Promise<RbacRoleDetail> {
  return apiJson<RbacRoleDetail>('/roles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateRbacRole(
  roleId: string,
  payload: Partial<{
    name: string;
    description: string | null;
    parentRoleId: string | null;
    scopeLevel: DataScopeLevel;
    sortOrder: number;
    isActive: boolean;
  }>,
): Promise<RbacRoleDetail> {
  return apiJson<RbacRoleDetail>(`/roles/${encodeURIComponent(roleId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteRbacRole(roleId: string): Promise<void> {
  const result = await apiFetch(`/roles/${encodeURIComponent(roleId)}`, { method: 'DELETE' });
  if (!result.ok) {
    const errBody = result.data as { error?: string } | null;
    throw new Error(errBody?.error ?? `Delete failed (${result.status})`);
  }
}

export type ResetSystemRolesResult = {
  resetRoleKeys: string[];
  skippedRoleKeys: string[];
};

/** POST /roles/reset-defaults — restore all system roles to default permission grants. */
export async function resetSystemRolesToDefaults(): Promise<ResetSystemRolesResult> {
  const data = await apiJson<ResetSystemRolesResult & { message?: string }>('/roles/reset-defaults', {
    method: 'POST',
  });
  return { resetRoleKeys: data.resetRoleKeys, skippedRoleKeys: data.skippedRoleKeys };
}

export async function saveRolePermissions(roleId: string, permissionKeys: string[]): Promise<string[]> {
  const data = await apiJson<{ roleId: string; permissions: string[] }>(
    `/roles/${encodeURIComponent(roleId)}/permissions`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionKeys }),
    },
  );
  return data.permissions;
}

/** Flatten role tree for parent dropdowns. */
export function flattenRoles(nodes: RbacRoleTreeNode[], depth = 0): Array<RbacRoleTreeNode & { depth: number }> {
  const out: Array<RbacRoleTreeNode & { depth: number }> = [];
  for (const n of nodes) {
    out.push({ ...n, depth });
    out.push(...flattenRoles(n.children, depth + 1));
  }
  return out;
}

/** Collect all leaf permission keys from catalog tree. */
export function collectLeafPermissionKeys(nodes: RbacPermissionTreeNode[]): string[] {
  const keys: string[] = [];
  const walk = (list: RbacPermissionTreeNode[]) => {
    for (const n of list) {
      if (!n.isGroup) keys.push(n.key);
      if (n.children.length) walk(n.children);
    }
  };
  walk(nodes);
  return keys;
}

export function collectLeavesUnder(node: RbacPermissionTreeNode): RbacPermissionTreeNode[] {
  if (!node.isGroup) return [node];
  return node.children.flatMap(collectLeavesUnder);
}
