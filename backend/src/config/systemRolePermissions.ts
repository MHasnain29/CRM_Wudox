/**
 * Default permission grants for built-in (system) roles.
 * Single source of truth for:
 * - prisma/seed-rbac.ts (DB role_permissions)
 * - permissions.ts static fallback when a role has no DB rows
 *
 * After seed or when role_permissions exist in DB, getEffectivePermissionKeysForRoleKey()
 * uses DB only (except super_admin, which always receives the full catalog).
 */
export const SYSTEM_ROLE_KEYS = [
  'super_admin',
  'dev_team',
  'director',
  'company_director',
  'it',
  'sales_manager',
  'sales_associate',
  'sales_executive',
  'recruitment_manager',
  'recruiter',
  'sr_recruiter',
  'operations_manager',
  'data_entry_specialist',
  'database_manager',
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

/**
 * Shared workspace modules every system role gets by default (Emails / Bulk Emails use `calls:read`).
 * Merged into every role below so Shared email access cannot be omitted.
 */
export const SHARED_DEFAULT_PERMISSION_KEYS = [
  'calls:read',
  'emails:reply_as',
] as const;

function withSharedDefaults(keys: string[]): string[] {
  return [...new Set([...SHARED_DEFAULT_PERMISSION_KEYS, ...keys])];
}

/** Default grants per system role (Settings → Roles baseline; re-applied by npm run prisma:seed-rbac). */
export const PERMISSIONS_BY_ROLE_KEY: Record<SystemRoleKey, string[]> = {
  super_admin: withSharedDefaults([
    'users:read', 'users:write', 'users:delete', 'users:directory',
    'clients:read', 'clients:write', 'clients:contacts:add', 'clients:contacts:edit', 'clients:delete', 'clients:approve', 'clients:manager_recommend', 'clients:ownership',
    'proposals:read', 'proposals:write', 'proposals:review', 'proposals:manager_recommend',
    'leads:read', 'leads:write', 'leads:assign', 'leads:manager_recommend', 'leads:approve', 'leads:reassign', 'leads:reassign_approve',
    'pipeline:read', 'pipeline:write', 'pipeline:configure',
    'calls:write', 'tasks:read', 'tasks:write',
    'meetings:read', 'meetings:write', 'meetings:add_participants', 'jobs:read', 'jobs:write',
    'employees:read', 'employees:write', 'employees:offboard', 'employees:approve', 'employees:manager_recommend', 'analytics:read',
    'settings:read', 'settings:write', 'voice:use', 'phone_system:read', 'phone_system:write', 'inbound_calls:read', 'bug_reports:submit', 'bug_reports:read',
    'agencies:cross_org', 'agencies:global',
    'roles:read', 'roles:write', 'roles:create', 'roles:delete',
    'remarks:write', 'remarks:public',
    'client_notes:configure', 'client_notes:fields:write', 'client_notes:fields:read',
    'emails:delete',
    'email:configure_signature',
    'users:link_agency',
  ]),
  dev_team: withSharedDefaults([
    'users:read', 'users:directory', 'clients:read', 'leads:read', 'pipeline:read', 'tasks:read',
    'meetings:read', 'meetings:add_participants', 'jobs:read', 'employees:read', 'analytics:read',
    'settings:read', 'settings:write', 'roles:read', 'phone_system:read', 'phone_system:write', 'bug_reports:submit', 'bug_reports:read',
  ]),
  director: withSharedDefaults([
    'users:read', 'users:write', 'users:directory',
    'clients:read', 'clients:write', 'clients:contacts:add', 'clients:contacts:edit', 'clients:delete', 'clients:approve', 'clients:manager_recommend', 'clients:ownership',
    'proposals:read', 'proposals:write', 'proposals:review', 'proposals:manager_recommend',
    'leads:read', 'leads:write', 'leads:assign', 'leads:manager_recommend', 'leads:approve', 'leads:reassign', 'leads:reassign_approve',
    'pipeline:read', 'pipeline:write', 'pipeline:configure',
    'calls:write', 'tasks:read', 'tasks:write',
    'meetings:read', 'meetings:write', 'meetings:add_participants', 'jobs:read', 'jobs:write',
    'employees:read', 'employees:write', 'employees:offboard', 'employees:approve', 'employees:manager_recommend', 'analytics:read',
    'settings:read', 'settings:write', 'voice:use', 'phone_system:read', 'phone_system:write', 'inbound_calls:read', 'bug_reports:submit', 'bug_reports:read', 'agencies:cross_org',
    'roles:read', 'roles:write', 'roles:create', 'roles:delete',
    'remarks:write', 'remarks:public',
    'client_notes:configure', 'client_notes:fields:write', 'client_notes:fields:read',
    'emails:delete',
    'email:configure_signature',
    'users:link_agency',
    'lists:assign',
  ]),
  company_director: withSharedDefaults([
    'users:read', 'users:write', 'users:directory',
    'clients:read', 'clients:write', 'clients:contacts:add', 'clients:contacts:edit', 'clients:delete', 'clients:approve', 'clients:manager_recommend', 'clients:ownership',
    'proposals:read', 'proposals:write', 'proposals:review', 'proposals:manager_recommend',
    'leads:read', 'leads:write', 'leads:assign', 'leads:manager_recommend', 'leads:approve', 'leads:reassign', 'leads:reassign_approve',
    'pipeline:read', 'pipeline:write', 'pipeline:configure',
    'calls:write', 'tasks:read', 'tasks:write',
    'meetings:read', 'meetings:write', 'meetings:add_participants', 'jobs:read', 'jobs:write',
    'employees:read', 'employees:write', 'employees:offboard', 'employees:approve', 'employees:manager_recommend', 'analytics:read',
    'settings:read', 'settings:write', 'voice:use', 'phone_system:read', 'phone_system:write', 'inbound_calls:read', 'bug_reports:submit', 'bug_reports:read',
    'roles:read', 'roles:write', 'roles:create', 'roles:delete',
    'remarks:write', 'remarks:public',
    'client_notes:configure', 'client_notes:fields:write', 'client_notes:fields:read',
    'emails:delete',
    'email:configure_signature',
    'lists:assign',
  ]),
  sales_manager: withSharedDefaults([
    'users:read', 'users:write', 'users:directory',
    'clients:read', 'clients:write', 'clients:contacts:add', 'clients:manager_recommend',
    'proposals:read', 'proposals:write', 'proposals:review', 'proposals:manager_recommend',
    'leads:read', 'leads:write', 'leads:assign', 'leads:manager_recommend', 'leads:reassign', 'pipeline:read', 'pipeline:write',
    'calls:write', 'tasks:read', 'tasks:write',
    'meetings:read', 'meetings:write', 'meetings:add_participants', 'jobs:read', 'jobs:write',
    'employees:read', 'analytics:read', 'settings:read', 'voice:use', 'phone_system:read', 'bug_reports:submit',
    'remarks:write', 'remarks:public',
    'client_notes:fields:write', 'client_notes:fields:read',
    'emails:delete',
    'lists:assign',
  ]),
  /** Recruitment side only — Jobs/Employees (+ shared users/tasks/meetings/emails). No Marketing modules. */
  recruitment_manager: withSharedDefaults([
    'users:read', 'users:write', 'users:directory',
    'jobs:read', 'jobs:write',
    'employees:read', 'employees:write', 'employees:offboard', 'employees:approve', 'employees:manager_recommend',
    'calls:write',
    'tasks:read', 'tasks:write',
    'meetings:read', 'meetings:write', 'meetings:add_participants',
    'analytics:read', 'settings:read', 'voice:use', 'bug_reports:submit',
    'remarks:write', 'remarks:public',
    'emails:delete',
  ]),
  sales_associate: withSharedDefaults([
    'users:read',
    'clients:read', 'clients:write', 'clients:contacts:add',
    'leads:read', 'leads:write', 'leads:reassign', 'pipeline:read', 'pipeline:write',
    'calls:write', 'tasks:read', 'tasks:write',
    'meetings:read', 'meetings:write', 'meetings:add_participants', 'analytics:read', 'voice:use', 'bug_reports:submit',
    'remarks:write',
    'client_notes:fields:write', 'client_notes:fields:read',
  ]),
  sales_executive: withSharedDefaults([
    'users:read', 'users:directory',
    'clients:read', 'clients:write', 'clients:contacts:add',
    'leads:read', 'leads:write', 'leads:reassign', 'pipeline:read', 'pipeline:write',
    'calls:write', 'tasks:read', 'tasks:write',
    'meetings:read', 'meetings:write', 'meetings:add_participants', 'voice:use', 'bug_reports:submit',
    'remarks:write',
    'client_notes:fields:write', 'client_notes:fields:read',
  ]),
  /** Recruitment side only — Jobs/Employees (+ shared). */
  recruiter: withSharedDefaults([
    'users:read', 'users:directory',
    'jobs:read', 'jobs:write',
    'employees:read', 'employees:write', 'employees:manager_recommend',
    'calls:write',
    'tasks:read', 'tasks:write',
    'meetings:read', 'meetings:write', 'meetings:add_participants',
    'voice:use', 'bug_reports:submit',
  ]),
  /** Same as recruiter + analytics and employee approve (senior desk). */
  sr_recruiter: withSharedDefaults([
    'users:read', 'users:directory',
    'jobs:read', 'jobs:write',
    'employees:read', 'employees:write', 'employees:approve', 'employees:manager_recommend',
    'calls:write',
    'tasks:read', 'tasks:write',
    'meetings:read', 'meetings:write', 'meetings:add_participants',
    'analytics:read', 'voice:use', 'bug_reports:submit',
  ]),
  data_entry_specialist: withSharedDefaults([
    'users:read', 'users:directory',
    'clients:read', 'clients:write', 'clients:contacts:add', 'leads:read', 'leads:write', 'pipeline:read', 'pipeline:write',
    'calls:write', 'tasks:read', 'tasks:write', 'meetings:add_participants', 'bug_reports:submit',
    'remarks:write',
  ]),
  database_manager: withSharedDefaults([
    'clients:read', 'clients:write', 'clients:contacts:add', 'meetings:add_participants', 'analytics:read', 'bug_reports:submit',
  ]),
  operations_manager: withSharedDefaults([
    'users:read', 'users:directory', 'clients:read', 'clients:write', 'clients:contacts:add', 'clients:contacts:edit', 'clients:manager_recommend', 'clients:ownership',
    'proposals:read', 'proposals:write', 'proposals:review', 'proposals:manager_recommend',
    'leads:read', 'leads:write', 'leads:assign', 'leads:manager_recommend', 'leads:approve', 'leads:reassign', 'leads:reassign_approve',
    'pipeline:read', 'pipeline:write',
    'calls:write', 'tasks:read', 'tasks:write', 'meetings:read', 'meetings:write', 'meetings:add_participants',
    'jobs:read', 'jobs:write', 'employees:read', 'employees:write', 'employees:approve', 'employees:manager_recommend', 'analytics:read', 'settings:read',
    'bug_reports:submit', 'bug_reports:read', 'agencies:cross_org',
    'remarks:write', 'remarks:public',
    'client_notes:configure', 'client_notes:fields:write', 'client_notes:fields:read',
    'emails:delete',
    'email:configure_signature',
    'lists:assign',
  ]),
  it: withSharedDefaults([
    'users:read', 'users:directory', 'clients:read', 'leads:read', 'pipeline:read', 'tasks:read',
    'meetings:read', 'meetings:add_participants', 'jobs:read', 'employees:read', 'analytics:read', 'settings:read', 'settings:write',
    'roles:read', 'bug_reports:submit',
  ]),
};
