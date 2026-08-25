import type { AssignableRoleOption } from '@/lib/rbacApi';
import { ASSOCIATE_LEVEL_ROLES, ROLE_OPTIONS, SALES_ROLES, SUPER_USERS_SCREEN_ROLES, DATABASE_MANAGER_SCREEN_ROLES } from '@/lib/roleOptions';

const SUPER_USERS_SCREEN_ROLE_SET = new Set<string>(SUPER_USERS_SCREEN_ROLES);
const DATABASE_MANAGER_SCREEN_ROLE_SET = new Set<string>(DATABASE_MANAGER_SCREEN_ROLES);

/** Roles reserved for the Super Users screen — hidden from regular Add/Edit User forms. */
export function excludeSuperUsersScreenRoles(
  options: { role: string; label: string }[],
): { role: string; label: string }[] {
  return options.filter(
    (o) => !SUPER_USERS_SCREEN_ROLE_SET.has(o.role) && !DATABASE_MANAGER_SCREEN_ROLE_SET.has(o.role),
  );
}

/** Per-user role display: custom Role Title (`userType`) first, then API `roleLabel`, then role key. */
export function getUserRoleTitle(
  user: { userType?: string | null; role: string; roleLabel?: string },
  assignableRoles?: AssignableRoleOption[],
): string {
  const trimmed = user.userType?.trim();
  if (trimmed) return trimmed;
  const fromApi = user.roleLabel?.trim();
  if (fromApi) return fromApi;
  return getRoleLabel(user.role, assignableRoles);
}

/** Display label for a role key (RBAC name, static catalog, or formatted key). */
export function getRoleLabel(
  roleKey: string,
  assignableRoles?: AssignableRoleOption[],
): string {
  const fromRbac = assignableRoles?.find((r) => r.key === roleKey);
  if (fromRbac) return fromRbac.name;
  const fromStatic = ROLE_OPTIONS.find((r) => r.role === roleKey);
  if (fromStatic) return fromStatic.label;
  return roleKey
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function sortIndexForRoleKey(key: string, assignableRoles: AssignableRoleOption[]): number {
  const rbac = assignableRoles.find((r) => r.key === key);
  if (rbac) return rbac.sortOrder;
  const staticIdx = ROLE_OPTIONS.findIndex((o) => o.role === key);
  return staticIdx >= 0 ? staticIdx : 9999;
}

/** Merge RBAC roles with static fallbacks (RBAC wins on duplicate keys). Preserves catalog order. */
export function buildRoleOptionsForSelect(
  assignableRoles: AssignableRoleOption[],
): { role: string; label: string }[] {
  const byKey = new Map<string, { role: string; label: string }>();
  for (const opt of ROLE_OPTIONS) {
    byKey.set(opt.role, opt);
  }
  for (const r of assignableRoles) {
    byKey.set(r.key, { role: r.key, label: r.name });
  }
  return Array.from(byKey.values()).sort(
    (a, b) =>
      sortIndexForRoleKey(a.role, assignableRoles) - sortIndexForRoleKey(b.role, assignableRoles) ||
      a.label.localeCompare(b.label),
  );
}

/** Performance targets: SALES_ROLES + custom (non-system) RBAC roles only. */
export function buildPerformanceTargetRoleOptions(
  assignableRoles: AssignableRoleOption[],
): { role: string; label: string }[] {
  const salesSet = new Set<string>(SALES_ROLES);
  const custom = assignableRoles.filter((r) => !r.isSystem && !salesSet.has(r.key));
  const options = buildRoleOptionsForSelect(assignableRoles).filter((o) => salesSet.has(o.role));
  for (const r of custom) {
    if (!options.some((o) => o.role === r.key)) {
      options.push({ role: r.key, label: r.name });
    }
  }
  return options;
}

/** Who may assign which roles when creating/editing users (UX rules; not page access). */
/** Whether a role key is own-scope (field staff), from RBAC or static fallback. */
export function isOwnScopeRoleKey(
  roleKey: string,
  assignableRoles?: AssignableRoleOption[],
): boolean {
  const fromRbac = assignableRoles?.find((r) => r.key === roleKey);
  if (fromRbac) return fromRbac.scopeLevel === 'own';
  return (ASSOCIATE_LEVEL_ROLES as readonly string[]).includes(roleKey);
}

export function getOwnScopeRoleKeys(assignableRoles: AssignableRoleOption[]): Set<string> {
  const keys = new Set<string>();
  for (const r of assignableRoles) {
    if (r.scopeLevel === 'own') keys.add(r.key);
  }
  for (const k of ASSOCIATE_LEVEL_ROLES) keys.add(k);
  return keys;
}

/** Own-scope roles that are direct children of `parentRoleKey` in RBAC hierarchy. */
export function getOwnScopeChildRolesForParent(
  parentRoleKey: string,
  assignableRoles: AssignableRoleOption[],
): string[] {
  return assignableRoles
    .filter((r) => r.parentKey === parentRoleKey && r.scopeLevel === 'own')
    .map((r) => r.key);
}

export function isTeamScopeRoleKey(
  roleKey: string,
  assignableRoles?: AssignableRoleOption[],
): boolean {
  const fromRbac = assignableRoles?.find((r) => r.key === roleKey);
  if (fromRbac) return fromRbac.scopeLevel === 'team';
  return ['sales_manager', 'recruitment_manager'].includes(roleKey);
}

/** Own-scope and team-scope roles under a parent in the RBAC tree (recursive). */
export function getDescendantRoleKeysForParent(
  parentRoleKey: string,
  assignableRoles: AssignableRoleOption[],
): Set<string> {
  const keys = new Set<string>();
  const queue = [parentRoleKey];
  while (queue.length > 0) {
    const parentKey = queue.shift()!;
    for (const role of assignableRoles) {
      if (role.parentKey === parentKey && !keys.has(role.key)) {
        keys.add(role.key);
        queue.push(role.key);
      }
    }
  }
  return keys;
}

export function filterRolesForActor(
  options: { role: string; label: string }[],
  actorRole: string | undefined,
  assignableRoles?: AssignableRoleOption[],
): { role: string; label: string }[] {
  let filtered = options;

  if (actorRole && assignableRoles?.length) {
    const actorMeta = assignableRoles.find((r) => r.key === actorRole);
    if (actorMeta?.scopeLevel === 'team') {
      const childKeys = new Set(getOwnScopeChildRolesForParent(actorRole, assignableRoles));
      if (childKeys.size > 0) {
        filtered = options.filter((o) => childKeys.has(o.role));
      } else {
        filtered = options.filter((o) => {
          const meta = assignableRoles.find((r) => r.key === o.role);
          return meta?.scopeLevel === 'own';
        });
      }
    } else if (actorMeta?.key === 'company_director') {
      const descendantKeys = getDescendantRoleKeysForParent('company_director', assignableRoles);
      if (descendantKeys.size > 0) {
        filtered = options.filter((o) => descendantKeys.has(o.role));
      }
    } else if (actorMeta?.scopeLevel === 'agency' || actorMeta?.scopeLevel === 'global') {
      filtered = options.filter((o) => {
        const meta = assignableRoles.find((r) => r.key === o.role);
        return meta?.scopeLevel !== 'global' && !['super_admin', 'dev_team'].includes(o.role);
      });
    }
  } else if (actorRole === 'sales_manager') {
    filtered = options.filter((o) => o.role === 'sales_associate' || o.role === 'marketing');
  } else if (actorRole === 'recruitment_manager') {
    filtered = options.filter((o) => ['recruiter', 'sr_recruiter'].includes(o.role));
  } else if (actorRole) {
    filtered = options.filter((o) => !['super_admin', 'dev_team', 'director', 'company_director'].includes(o.role));
  }

  return excludeSuperUsersScreenRoles(filtered);
}
