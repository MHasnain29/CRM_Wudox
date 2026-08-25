/**
 * Demo RBAC data: all system roles in hierarchy + permission catalog tree.
 * Used by prisma/seed-rbac.ts (idempotent upsert).
 */

import type { DataScopeLevel } from '@prisma/client';

export type RoleSeed = {
  key: string;
  name: string;
  description?: string;
  parentKey: string | null;
  sortOrder: number;
  scopeLevel: DataScopeLevel;
};

/** Organizational hierarchy (matches current CRM org structure). */
export const ROLE_HIERARCHY: RoleSeed[] = [
  {
    key: 'super_admin',
    name: 'Super Admin',
    description: 'Full system access across all agencies',
    parentKey: null,
    sortOrder: 0,
    scopeLevel: 'global',
  },
  {
    key: 'director',
    name: 'Director',
    description: 'Full access within assigned agency',
    parentKey: 'super_admin',
    sortOrder: 2,
    scopeLevel: 'agency',
  },
  {
    key: 'company_director',
    name: 'Company Director',
    description: 'Per-agency director; full access for one company (no cross-org)',
    parentKey: 'director',
    sortOrder: 25,
    scopeLevel: 'agency',
  },
  {
    key: 'it',
    name: 'IT',
    description: 'Technical support and settings',
    parentKey: 'super_admin',
    sortOrder: 3,
    scopeLevel: 'agency',
  },
  {
    key: 'sales_manager',
    name: 'Sales Manager',
    description: 'Manages sales team within agency',
    parentKey: 'company_director',
    sortOrder: 10,
    scopeLevel: 'team',
  },
  {
    key: 'sales_associate',
    name: 'Sales Associate',
    description: 'Field sales; own pipeline and clients',
    parentKey: 'sales_manager',
    sortOrder: 11,
    scopeLevel: 'own',
  },
  {
    key: 'sales_executive',
    name: 'Sales Executive',
    description: 'Field sales; own pipeline and clients',
    parentKey: 'sales_manager',
    sortOrder: 12,
    scopeLevel: 'own',
  },
  {
    key: 'marketing',
    name: 'Marketing',
    description: 'Client outreach; same access as Sales Associate',
    parentKey: 'sales_manager',
    sortOrder: 13,
    scopeLevel: 'own',
  },
  {
    key: 'recruitment_manager',
    name: 'Recruitment Manager',
    description: 'Manages recruiters within agency',
    parentKey: 'director',
    sortOrder: 20,
    scopeLevel: 'team',
  },
  {
    key: 'recruiter',
    name: 'Recruiter',
    description: 'Recruitment operations',
    parentKey: 'recruitment_manager',
    sortOrder: 21,
    scopeLevel: 'own',
  },
  {
    key: 'sr_recruiter',
    name: 'Senior Recruiter',
    description: 'Senior recruitment operations',
    parentKey: 'recruitment_manager',
    sortOrder: 22,
    scopeLevel: 'own',
  },
  {
    key: 'operations_manager',
    name: 'Operations Manager',
    description: 'Cross-functional operations oversight',
    parentKey: 'director',
    sortOrder: 30,
    scopeLevel: 'team',
  },
  {
    key: 'data_entry_specialist',
    name: 'Data Entry Specialist',
    description: 'Client and lead data entry',
    parentKey: 'director',
    sortOrder: 40,
    scopeLevel: 'own',
  },
  {
    key: 'database_manager',
    name: 'Database Manager',
    description: 'Global database client management (org-wide, agency-independent)',
    parentKey: 'director',
    sortOrder: 50,
    scopeLevel: 'global',
  },

  // ── Software House Roles ──────────────────────────────────────────────────
  {
    key: 'cto',
    name: 'CTO',
    description: 'Chief Technical Officer — full visibility over all projects and dev team',
    parentKey: 'director',
    sortOrder: 60,
    scopeLevel: 'agency',
  },
  {
    key: 'project_manager',
    name: 'Project Manager',
    description: 'Manages projects, team leads, and IC roles within their scope',
    parentKey: 'cto',
    sortOrder: 61,
    scopeLevel: 'team',
  },
  {
    key: 'team_lead',
    name: 'Team Lead',
    description: 'Leads a development team; can approve leave for direct reports',
    parentKey: 'project_manager',
    sortOrder: 63,
    scopeLevel: 'team',
  },
  {
    key: 'developer',
    name: 'Developer',
    description: 'Software developer — sees own projects and tasks',
    parentKey: 'team_lead',
    sortOrder: 64,
    scopeLevel: 'own',
  },
  {
    key: 'qa_engineer',
    name: 'QA Engineer',
    description: 'Quality assurance — sees assigned projects and tasks',
    parentKey: 'team_lead',
    sortOrder: 65,
    scopeLevel: 'own',
  },
  {
    key: 'ui_ux_designer',
    name: 'UI/UX Designer',
    description: 'Designs screens and flows — sees assigned projects and tasks',
    parentKey: 'team_lead',
    sortOrder: 66,
    scopeLevel: 'own',
  },
  {
    key: 'business_analyst',
    name: 'Business Analyst',
    description: 'Gathers requirements — sees assigned projects and tasks',
    parentKey: 'team_lead',
    sortOrder: 67,
    scopeLevel: 'own',
  },
  {
    key: 'devops_engineer',
    name: 'DevOps Engineer',
    description: 'Handles deployments and infrastructure — sees assigned projects and tasks',
    parentKey: 'team_lead',
    sortOrder: 68,
    scopeLevel: 'own',
  },
  {
    key: 'hr',
    name: 'HR',
    description: 'Human resources — manages leave types, balances, and approvals for all staff',
    parentKey: 'director',
    sortOrder: 70,
    scopeLevel: 'agency',
  },
  {
    key: 'finance',
    name: 'Finance',
    description: 'Finance/Accounts — views leave calendar for payroll purposes',
    parentKey: 'director',
    sortOrder: 71,
    scopeLevel: 'agency',
  },
];

/** Permission catalog: group nodes (isGroup) + leaf keys (resource:action). */
export type PermissionSeed = {
  key: string;
  name: string;
  module: string;
  parentKey: string | null;
  sortOrder: number;
  isGroup: boolean;
  actionType?: 'read' | 'write' | 'delete' | 'custom';
};

export const PERMISSION_CATALOG: PermissionSeed[] = [
  { key: 'module.users', name: 'Users', module: 'users', parentKey: null, sortOrder: 100, isGroup: true },
  { key: 'users:read', name: 'View users', module: 'users', parentKey: 'module.users', sortOrder: 101, isGroup: false, actionType: 'read' },
  { key: 'users:write', name: 'Create & edit users', module: 'users', parentKey: 'module.users', sortOrder: 102, isGroup: false, actionType: 'write' },
  { key: 'users:delete', name: 'Delete users', module: 'users', parentKey: 'module.users', sortOrder: 103, isGroup: false, actionType: 'delete' },
  {
    key: 'users:directory',
    name: 'Users page (admin directory)',
    module: 'users',
    parentKey: 'module.users',
    sortOrder: 104,
    isGroup: false,
    actionType: 'read',
  },

  { key: 'module.clients', name: 'Clients', module: 'clients', parentKey: null, sortOrder: 200, isGroup: true },
  { key: 'clients:read', name: 'View clients', module: 'clients', parentKey: 'module.clients', sortOrder: 201, isGroup: false, actionType: 'read' },
  { key: 'clients:write', name: 'Create & edit clients', module: 'clients', parentKey: 'module.clients', sortOrder: 202, isGroup: false, actionType: 'write' },
  { key: 'clients:contacts:add', name: 'Add client contacts', module: 'clients', parentKey: 'module.clients', sortOrder: 203, isGroup: false, actionType: 'custom' },
  { key: 'clients:contacts:edit', name: 'Edit client contacts', module: 'clients', parentKey: 'module.clients', sortOrder: 204, isGroup: false, actionType: 'custom' },
  { key: 'clients:delete', name: 'Delete clients', module: 'clients', parentKey: 'module.clients', sortOrder: 205, isGroup: false, actionType: 'delete' },
  {
    key: 'clients:manager_recommend',
    name: 'Recommend pending client (manager)',
    module: 'clients',
    parentKey: 'module.clients',
    sortOrder: 206,
    isGroup: false,
    actionType: 'custom',
  },
  {
    key: 'clients:approve',
    name: 'Approve pending client (director)',
    module: 'clients',
    parentKey: 'module.clients',
    sortOrder: 207,
    isGroup: false,
    actionType: 'custom',
  },
  {
    key: 'clients:ownership',
    name: 'Manage client ownership',
    module: 'clients',
    parentKey: 'module.clients',
    sortOrder: 208,
    isGroup: false,
    actionType: 'custom',
  },

  { key: 'module.client_notes', name: 'Client notes', module: 'client_notes', parentKey: null, sortOrder: 250, isGroup: true },
  {
    key: 'client_notes:configure',
    name: 'Configure client note fields',
    module: 'client_notes',
    parentKey: 'module.client_notes',
    sortOrder: 251,
    isGroup: false,
    actionType: 'write',
  },
  {
    key: 'client_notes:fields:write',
    name: 'Edit client note field values',
    module: 'client_notes',
    parentKey: 'module.client_notes',
    sortOrder: 252,
    isGroup: false,
    actionType: 'write',
  },
  {
    key: 'client_notes:fields:read',
    name: 'Read client note field values',
    module: 'client_notes',
    parentKey: 'module.client_notes',
    sortOrder: 253,
    isGroup: false,
    actionType: 'read',
  },

  { key: 'module.proposals', name: 'Proposals', module: 'proposals', parentKey: null, sortOrder: 350, isGroup: true },
  { key: 'proposals:read', name: 'View proposals', module: 'proposals', parentKey: 'module.proposals', sortOrder: 351, isGroup: false, actionType: 'read' },
  { key: 'proposals:write', name: 'Create & edit proposals', module: 'proposals', parentKey: 'module.proposals', sortOrder: 352, isGroup: false, actionType: 'write' },
  { key: 'proposals:review', name: 'Review & approve proposals', module: 'proposals', parentKey: 'module.proposals', sortOrder: 353, isGroup: false, actionType: 'custom' },
  {
    key: 'proposals:manager_recommend',
    name: 'Forward proposal approval (manager)',
    module: 'proposals',
    parentKey: 'module.proposals',
    sortOrder: 354,
    isGroup: false,
    actionType: 'custom',
  },

  { key: 'module.leads', name: 'Leads', module: 'leads', parentKey: null, sortOrder: 300, isGroup: true },
  { key: 'leads:read', name: 'View leads', module: 'leads', parentKey: 'module.leads', sortOrder: 301, isGroup: false, actionType: 'read' },
  { key: 'leads:write', name: 'Create & edit leads', module: 'leads', parentKey: 'module.leads', sortOrder: 302, isGroup: false, actionType: 'write' },
  { key: 'leads:assign', name: 'Assign leads', module: 'leads', parentKey: 'module.leads', sortOrder: 303, isGroup: false, actionType: 'custom' },
  {
    key: 'leads:manager_recommend',
    name: 'Forward lead approval (manager)',
    module: 'leads',
    parentKey: 'module.leads',
    sortOrder: 304,
    isGroup: false,
    actionType: 'custom',
  },
  {
    key: 'leads:approve',
    name: 'Final approve lead requests',
    module: 'leads',
    parentKey: 'module.leads',
    sortOrder: 305,
    isGroup: false,
    actionType: 'custom',
  },
  { key: 'leads:reassign', name: 'Request lead reassignment', module: 'leads', parentKey: 'module.leads', sortOrder: 306, isGroup: false, actionType: 'custom' },
  { key: 'leads:reassign_approve', name: 'Approve lead reassignment', module: 'leads', parentKey: 'module.leads', sortOrder: 307, isGroup: false, actionType: 'custom' },

  { key: 'module.pipeline', name: 'Pipeline', module: 'pipeline', parentKey: null, sortOrder: 295, isGroup: true },
  {
    key: 'pipeline:read',
    name: 'View pipeline board',
    module: 'pipeline',
    parentKey: 'module.pipeline',
    sortOrder: 296,
    isGroup: false,
    actionType: 'read',
  },
  {
    key: 'pipeline:write',
    name: 'Move leads on pipeline',
    module: 'pipeline',
    parentKey: 'module.pipeline',
    sortOrder: 297,
    isGroup: false,
    actionType: 'write',
  },
  {
    key: 'pipeline:configure',
    name: 'Configure pipeline stages',
    module: 'pipeline',
    parentKey: 'module.pipeline',
    sortOrder: 298,
    isGroup: false,
    actionType: 'write',
  },

  { key: 'module.calls', name: 'Calls & Remarks', module: 'calls', parentKey: null, sortOrder: 400, isGroup: true },
  { key: 'calls:read', name: 'View calls', module: 'calls', parentKey: 'module.calls', sortOrder: 401, isGroup: false, actionType: 'read' },
  { key: 'calls:write', name: 'Log & edit calls', module: 'calls', parentKey: 'module.calls', sortOrder: 402, isGroup: false, actionType: 'write' },
  { key: 'remarks:write', name: 'Add remarks', module: 'calls', parentKey: 'module.calls', sortOrder: 403, isGroup: false, actionType: 'write' },
  { key: 'remarks:public', name: 'Create public / shared remarks', module: 'calls', parentKey: 'module.calls', sortOrder: 404, isGroup: false, actionType: 'custom' },

  { key: 'module.tasks', name: 'Tasks', module: 'tasks', parentKey: null, sortOrder: 500, isGroup: true },
  { key: 'tasks:read', name: 'View tasks', module: 'tasks', parentKey: 'module.tasks', sortOrder: 501, isGroup: false, actionType: 'read' },
  { key: 'tasks:write', name: 'Create & edit tasks', module: 'tasks', parentKey: 'module.tasks', sortOrder: 502, isGroup: false, actionType: 'write' },

  { key: 'module.meetings', name: 'Meetings', module: 'meetings', parentKey: null, sortOrder: 600, isGroup: true },
  { key: 'meetings:read', name: 'View meetings', module: 'meetings', parentKey: 'module.meetings', sortOrder: 601, isGroup: false, actionType: 'read' },
  { key: 'meetings:write', name: 'Schedule & edit meetings', module: 'meetings', parentKey: 'module.meetings', sortOrder: 602, isGroup: false, actionType: 'write' },
  { key: 'meetings:add_participants', name: 'Add meeting participants', module: 'meetings', parentKey: 'module.meetings', sortOrder: 603, isGroup: false, actionType: 'custom' },

  { key: 'module.jobs', name: 'Jobs', module: 'jobs', parentKey: null, sortOrder: 700, isGroup: true },
  { key: 'jobs:read', name: 'View jobs', module: 'jobs', parentKey: 'module.jobs', sortOrder: 701, isGroup: false, actionType: 'read' },
  { key: 'jobs:write', name: 'Create & edit jobs', module: 'jobs', parentKey: 'module.jobs', sortOrder: 702, isGroup: false, actionType: 'write' },

  { key: 'module.employees', name: 'Employees', module: 'employees', parentKey: null, sortOrder: 800, isGroup: true },
  { key: 'employees:read', name: 'View employees', module: 'employees', parentKey: 'module.employees', sortOrder: 801, isGroup: false, actionType: 'read' },
  { key: 'employees:write', name: 'Create & edit employees', module: 'employees', parentKey: 'module.employees', sortOrder: 802, isGroup: false, actionType: 'write' },
  { key: 'employees:offboard', name: 'Offboard employees', module: 'employees', parentKey: 'module.employees', sortOrder: 803, isGroup: false, actionType: 'write' },
  { key: 'employees:manager_recommend', name: 'Forward employee approvals', module: 'employees', parentKey: 'module.employees', sortOrder: 804, isGroup: false, actionType: 'write' },
  { key: 'employees:approve', name: 'Approve employees', module: 'employees', parentKey: 'module.employees', sortOrder: 805, isGroup: false, actionType: 'write' },

  { key: 'module.analytics', name: 'Reports & analytics', module: 'analytics', parentKey: null, sortOrder: 900, isGroup: true },
  { key: 'analytics:read', name: 'View reports', module: 'analytics', parentKey: 'module.analytics', sortOrder: 901, isGroup: false, actionType: 'read' },

  { key: 'module.settings', name: 'Settings', module: 'settings', parentKey: null, sortOrder: 1000, isGroup: true },
  { key: 'settings:read', name: 'View settings', module: 'settings', parentKey: 'module.settings', sortOrder: 1001, isGroup: false, actionType: 'read' },
  { key: 'settings:write', name: 'Edit settings', module: 'settings', parentKey: 'module.settings', sortOrder: 1002, isGroup: false, actionType: 'write' },
  {
    key: 'bug_reports:submit',
    name: 'Report a bug',
    module: 'settings',
    parentKey: 'module.settings',
    sortOrder: 1003,
    isGroup: false,
    actionType: 'custom',
  },
  {
    key: 'bug_reports:read',
    name: 'Bug reports page (view & close)',
    module: 'settings',
    parentKey: 'module.settings',
    sortOrder: 1004,
    isGroup: false,
    actionType: 'read',
  },

  { key: 'module.agencies', name: 'Agencies', module: 'agencies', parentKey: null, sortOrder: 1050, isGroup: true },
  {
    key: 'agencies:cross_org',
    name: 'Switch agencies (org-wide)',
    module: 'agencies',
    parentKey: 'module.agencies',
    sortOrder: 1051,
    isGroup: false,
    actionType: 'read',
  },
  {
    key: 'agencies:global',
    name: 'All agencies (system-wide)',
    module: 'agencies',
    parentKey: 'module.agencies',
    sortOrder: 1052,
    isGroup: false,
    actionType: 'read',
  },

  { key: 'module.voice', name: 'Voice calling', module: 'voice', parentKey: null, sortOrder: 1100, isGroup: true },
  { key: 'voice:use', name: 'Use in-app calling', module: 'voice', parentKey: 'module.voice', sortOrder: 1101, isGroup: false, actionType: 'custom' },
  { key: 'inbound_calls:read', name: 'View inbound call history', module: 'voice', parentKey: 'module.voice', sortOrder: 1102, isGroup: false, actionType: 'read' },

  { key: 'module.phone_system', name: 'Phone system', module: 'phone_system', parentKey: null, sortOrder: 1120, isGroup: true },
  { key: 'phone_system:read', name: 'View phone system settings', module: 'phone_system', parentKey: 'module.phone_system', sortOrder: 1121, isGroup: false, actionType: 'read' },
  { key: 'phone_system:write', name: 'Edit phone system settings', module: 'phone_system', parentKey: 'module.phone_system', sortOrder: 1122, isGroup: false, actionType: 'write' },

  { key: 'module.emails', name: 'Emails', module: 'emails', parentKey: null, sortOrder: 1150, isGroup: true },
  { key: 'emails:reply_as', name: 'Send email on behalf of employees', module: 'emails', parentKey: 'module.emails', sortOrder: 1151, isGroup: false, actionType: 'custom' },

  { key: 'module.lists', name: 'Lists', module: 'lists', parentKey: null, sortOrder: 1160, isGroup: true },
  { key: 'lists:assign', name: 'Assign lists to users', module: 'lists', parentKey: 'module.lists', sortOrder: 1161, isGroup: false, actionType: 'custom' },

  { key: 'module.roles', name: 'Roles & permissions', module: 'roles', parentKey: null, sortOrder: 1200, isGroup: true },
  { key: 'roles:read', name: 'View roles', module: 'roles', parentKey: 'module.roles', sortOrder: 1201, isGroup: false, actionType: 'read' },
  { key: 'roles:write', name: 'Edit role permissions', module: 'roles', parentKey: 'module.roles', sortOrder: 1202, isGroup: false, actionType: 'write' },
  { key: 'roles:create', name: 'Create roles', module: 'roles', parentKey: 'module.roles', sortOrder: 1203, isGroup: false, actionType: 'write' },
  { key: 'roles:delete', name: 'Delete roles', module: 'roles', parentKey: 'module.roles', sortOrder: 1204, isGroup: false, actionType: 'delete' },

  // ── Software House: Projects ──────────────────────────────────────────────
  { key: 'module.projects', name: 'Projects', module: 'projects', parentKey: null, sortOrder: 1300, isGroup: true },
  { key: 'projects:read', name: 'View projects', module: 'projects', parentKey: 'module.projects', sortOrder: 1301, isGroup: false, actionType: 'read' },
  { key: 'projects:write', name: 'Create & edit projects', module: 'projects', parentKey: 'module.projects', sortOrder: 1302, isGroup: false, actionType: 'write' },

  // ── Software House: Leave ─────────────────────────────────────────────────
  { key: 'module.leave', name: 'Leave management', module: 'leave', parentKey: null, sortOrder: 1400, isGroup: true },
  { key: 'leave:read', name: 'View leave (own)', module: 'leave', parentKey: 'module.leave', sortOrder: 1401, isGroup: false, actionType: 'read' },
  { key: 'leave:write', name: 'Request leave', module: 'leave', parentKey: 'module.leave', sortOrder: 1402, isGroup: false, actionType: 'write' },
  { key: 'leave:approve', name: 'Approve & reject leave requests', module: 'leave', parentKey: 'module.leave', sortOrder: 1403, isGroup: false, actionType: 'custom' },

  // ── Hubstaff time tracking ────────────────────────────────────────────────
  { key: 'module.hubstaff', name: 'Hubstaff time tracking', module: 'hubstaff', parentKey: null, sortOrder: 1500, isGroup: true },
  { key: 'hubstaff:view_all', name: 'View time tracking for all users', module: 'hubstaff', parentKey: 'module.hubstaff', sortOrder: 1501, isGroup: false, actionType: 'read' },
  { key: 'hubstaff:manage', name: 'Connect Hubstaff & manage user mapping', module: 'hubstaff', parentKey: 'module.hubstaff', sortOrder: 1502, isGroup: false, actionType: 'custom' },
];

export { PERMISSIONS_BY_ROLE_KEY } from '../src/config/systemRolePermissions';
