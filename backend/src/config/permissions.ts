/**
 * RBAC: roles and permissions.
 * Use with requirePermission / requireRole middleware and data-scope helpers.
 */
import { PERMISSIONS_BY_ROLE_KEY } from './systemRolePermissions';

export type Permission =
  | 'users:read'
  | 'users:write'
  | 'users:delete'
  | 'clients:read'
  | 'clients:write'
  | 'clients:contacts:add'
  | 'clients:contacts:edit'
  | 'clients:delete'
  | 'leads:read'
  | 'leads:write'
  | 'leads:assign'
  | 'leads:reassign'
  | 'leads:reassign_approve'
  | 'pipeline:read'
  | 'pipeline:write'
  | 'pipeline:configure'
  | 'calls:read'
  | 'calls:write'
  | 'tasks:read'
  | 'tasks:write'
  | 'meetings:read'
  | 'meetings:write'
  | 'meetings:add_participants'
  | 'jobs:read'
  | 'jobs:write'
  | 'employees:read'
  | 'employees:write'
  | 'employees:offboard'
  | 'employees:approve'
  | 'employees:manager_recommend'
  | 'analytics:read'
  | 'settings:read'
  | 'settings:write'
  | 'voice:use'
  | 'users:directory'
  | 'bug_reports:submit'
  | 'bug_reports:read'
  | 'roles:read'
  | 'roles:write'
  | 'roles:create'
  | 'roles:delete'
  | 'agencies:cross_org'
  | 'agencies:global'
  | 'clients:manager_recommend'
  | 'clients:approve'
  | 'proposals:read'
  | 'proposals:write'
  | 'proposals:review'
  | 'remarks:write'
  | 'remarks:public'
  | 'client_notes:configure'
  | 'client_notes:fields:write'
  | 'client_notes:fields:read'
  | 'clients:ownership'
  | 'emails:reply_as'
  | 'emails:delete'
  | 'email:configure_signature'
  | 'phone_system:read'
  | 'phone_system:write'
  | 'inbound_calls:read'
  | 'users:link_agency'
  | 'lists:assign'
  | 'projects:read'
  | 'projects:write'
  | 'leave:read'
  | 'leave:write'
  | 'leave:approve'
  | 'notices:read'
  | 'notices:write';

/** Role as stored in DB and JWT (UserRole enum values) */
export type Role = string;

/** Super admin bypasses all permission checks */
const SUPER_ADMIN = 'super_admin';

/** Full catalog used for super_admin static fallback and hasPermission bypass. */
const ALL_PERMISSIONS: Permission[] = [
  'users:read', 'users:write', 'users:delete', 'users:directory',
  'clients:read', 'clients:write', 'clients:contacts:add', 'clients:contacts:edit', 'clients:delete', 'clients:approve', 'clients:manager_recommend',
  'proposals:read', 'proposals:write', 'proposals:review',
  'leads:read', 'leads:write', 'leads:assign', 'leads:reassign', 'leads:reassign_approve',
  'pipeline:read', 'pipeline:write', 'pipeline:configure',
  'calls:read', 'calls:write', 'tasks:read', 'tasks:write',
  'meetings:read', 'meetings:write', 'meetings:add_participants', 'jobs:read', 'jobs:write',
  'employees:read', 'employees:write', 'employees:offboard', 'employees:approve', 'employees:manager_recommend', 'analytics:read',
  'settings:read', 'settings:write', 'voice:use', 'bug_reports:submit', 'bug_reports:read',
  'agencies:cross_org', 'agencies:global',
  'roles:read', 'roles:write', 'roles:create', 'roles:delete',
  'remarks:write', 'remarks:public',
  'client_notes:configure', 'client_notes:fields:write', 'client_notes:fields:read',
  'clients:ownership',
  'emails:reply_as',
  'emails:delete',
  'email:configure_signature',
  'phone_system:read', 'phone_system:write', 'inbound_calls:read',
  'users:link_agency',
  'lists:assign',
  'projects:read',
  'projects:write',
  'leave:read',
  'leave:write',
  'leave:approve',
  'notices:read',
  'notices:write',
];

/** Static fallback when role has no rows in role_permissions (see getEffectivePermissionKeysForRoleKey). */
const PERMISSIONS_BY_ROLE: Record<Role, Permission[]> = Object.fromEntries(
  Object.entries(PERMISSIONS_BY_ROLE_KEY).map(([role, keys]) => [role, keys as Permission[]]),
) as Record<Role, Permission[]>;

export function hasPermission(role: Role, permission: Permission): boolean {
  if (role === SUPER_ADMIN) return true;
  const list = PERMISSIONS_BY_ROLE[role];
  if (!list) return false;
  return list.includes(permission);
}

export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

export function hasAllPermissions(role: Role, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

/** Human-readable labels for roles (for UI and docs) */
export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  dev_team: 'Dev Team',
  director: 'Director',
  company_director: 'Company Director',
  sales_manager: 'Sales Manager',
  recruitment_manager: 'Recruitment Manager',
  sales_associate: 'Sales Associate',
  sales_executive: 'Sales Executive',
  recruiter: 'Recruiter',
  sr_recruiter: 'Senior Recruiter',
  data_entry_specialist: 'Data Entry Specialist',
  database_manager: 'Database Manager',
  operations_manager: 'Operations Manager',
  it: 'IT',
  cto: 'CTO',
  project_manager: 'Project Manager',
  team_lead: 'Team Lead',
  developer: 'Developer',
  qa_engineer: 'QA Engineer',
  ui_ux_designer: 'UI/UX Designer',
  business_analyst: 'Business Analyst',
  devops_engineer: 'DevOps Engineer',
  hr: 'HR',
  finance: 'Finance',
};

export function getRoleLabel(role: Role): string {
  return ROLE_LABELS[role] ?? role;
}

/** Roles that can see all data in their sub-company (no scope filter) */
export const SUBCOMPANY_WIDE_ROLES: Role[] = ['super_admin', 'director', 'company_director', 'dev_team'];

/** Roles that can see their team (reportingManagerIds) plus own */
export const MANAGER_ROLES: Role[] = ['sales_manager', 'recruitment_manager', 'operations_manager'];

/** Field roles: own leads/clients only; must not see other associates' pipeline status in the same agency */
export const ASSOCIATE_ROLES: Role[] = ['sales_associate', 'sales_executive'];

/** @deprecated Prefer RBAC scopeLevel === 'own' via isOwnScopeRole. */
export function isAssociateRole(role: string | undefined): boolean {
  return !!role && ASSOCIATE_ROLES.includes(role);
}

/** Whether a role key is own-scope (field staff), from RBAC or static fallback. */
export async function isOwnScopeRole(role: string | undefined): Promise<boolean> {
  if (!role) return false;
  const { getDataScopeLevelForRoleKey } = await import('../services/rbac');
  const scope = await getDataScopeLevelForRoleKey(role);
  if (scope) return scope === 'own';
  return isAssociateRole(role);
}

export function getPermissionsForRole(role: Role): Permission[] {
  if (role === SUPER_ADMIN) return [...ALL_PERMISSIONS];
  return PERMISSIONS_BY_ROLE[role] ?? [];
}
