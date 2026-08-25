import type { ApprovalActorMode, ApprovalWorkflowType, Prisma } from '@prisma/client';
import prisma from '../config/database';
import {
  validateApprovalRouteHierarchy,
  type RoleHierarchyNode,
} from './roleHierarchy';
import {
  AGENCY_WORKFLOW_TYPES,
  ALL_WORKFLOW_TYPES,
  DATABASE_WORKFLOW_TYPES,
  type AgencyWorkflowsConfig,
  type OrgWorkflowsConfig,
  type WorkflowPolicyConfig,
} from '../types/approval';

const MANAGER_COMPANY_DIRECTOR_ROUTE = ['sales_manager', 'company_director'] as const;
const MANAGER_ONLY_ROUTE = ['sales_manager'] as const;

/** Workflows whose default route ends with per-agency Company Director. */
export const WORKFLOWS_WITH_COMPANY_DIRECTOR_FINAL = [
  'client_manual_add',
  'client_manual_edit',
  'client_import',
  'contact_import',
  'proposal_review',
] as const satisfies readonly ApprovalWorkflowType[];

const RECRUITMENT_MANAGER_ROUTE = ['recruitment_manager'] as const;

export const DEFAULT_WORKFLOW_POLICIES: AgencyWorkflowsConfig = {
  client_manual_add: { mode: 'route', route: [...MANAGER_COMPANY_DIRECTOR_ROUTE] },
  client_manual_edit: { mode: 'route', route: [...MANAGER_COMPANY_DIRECTOR_ROUTE] },
  client_import: { mode: 'route', route: [...MANAGER_COMPANY_DIRECTOR_ROUTE] },
  contact_import: { mode: 'route', route: [...MANAGER_COMPANY_DIRECTOR_ROUTE] },
  database_client_add: { mode: 'route', route: ['director'] },
  database_client_import: { mode: 'route', route: ['director'] },
  database_contact_import: { mode: 'route', route: ['director'] },
  lead_request: { mode: 'route', route: [...MANAGER_ONLY_ROUTE] },
  lead_extension: { mode: 'route', route: [...MANAGER_ONLY_ROUTE] },
  lead_reassignment: { mode: 'route', route: [...MANAGER_ONLY_ROUTE] },
  proposal_review: { mode: 'route', route: [...MANAGER_COMPANY_DIRECTOR_ROUTE] },
  proposal_extension: { mode: 'route', route: [...MANAGER_ONLY_ROUTE] },
  employee_add: { mode: 'route', route: [...RECRUITMENT_MANAGER_ROUTE] },
  employee_assignment: { mode: 'route', route: [...RECRUITMENT_MANAGER_ROUTE] },
};

/** System role defaults for RoleApprovalCapability seed. */
export const DEFAULT_ROLE_CAPABILITY_BY_KEY: Record<string, Partial<Record<ApprovalWorkflowType, ApprovalActorMode>>> = {
  super_admin: Object.fromEntries(ALL_WORKFLOW_TYPES.map((w) => [w, 'forward_final'])) as Record<
    ApprovalWorkflowType,
    ApprovalActorMode
  >,
  director: Object.fromEntries(ALL_WORKFLOW_TYPES.map((w) => [w, 'forward_final'])) as Record<
    ApprovalWorkflowType,
    ApprovalActorMode
  >,
  company_director: Object.fromEntries(ALL_WORKFLOW_TYPES.map((w) => [w, 'forward_final'])) as Record<
    ApprovalWorkflowType,
    ApprovalActorMode
  >,
  dev_team: {},
  it: {},
  sales_manager: Object.fromEntries(ALL_WORKFLOW_TYPES.map((w) => [w, 'forward_only'])) as Record<
    ApprovalWorkflowType,
    ApprovalActorMode
  >,
  recruitment_manager: {
    ...Object.fromEntries(ALL_WORKFLOW_TYPES.map((w) => [w, 'forward_only'])),
    employee_add: 'forward_final',
    employee_assignment: 'forward_final',
  } as Record<ApprovalWorkflowType, ApprovalActorMode>,
  operations_manager: {
    client_manual_add: 'forward_only',
    client_manual_edit: 'forward_only',
    client_import: 'forward_only',
    contact_import: 'forward_only',
    database_client_add: 'forward_only',
    database_client_import: 'forward_only',
    database_contact_import: 'forward_only',
    lead_request: 'forward_only',
    lead_extension: 'forward_only',
    lead_reassignment: 'forward_only',
    proposal_review: 'forward_final',
    proposal_extension: 'forward_final',
    employee_add: 'forward_final',
    employee_assignment: 'forward_final',
  },
  sales_associate: {},
  sales_executive: {},
  marketing: {},
  recruiter: {},
  sr_recruiter: {},
  data_entry_specialist: {},
  database_manager: {},
};

function actorCanFinal(mode: ApprovalActorMode): boolean {
  return mode === 'final_only' || mode === 'forward_final';
}

function actorCanForward(mode: ApprovalActorMode): boolean {
  return mode === 'forward_only' || mode === 'forward_final';
}

/** Convert legacy fixed_steps / full_hierarchy JSON to explicit routes. */
function migrateLegacyWorkflowPolicy(
  obj: Record<string, unknown>,
  workflow: ApprovalWorkflowType,
): WorkflowPolicyConfig {
  if (obj.mode === 'bypass') return { mode: 'bypass' };

  if (obj.mode === 'route' && Array.isArray(obj.route)) {
    const route = obj.route
      .filter((k): k is string => typeof k === 'string' && k.length > 0)
      .slice(0, 5);
    if (route.length > 0) return { mode: 'route', route };
  }

  const steps =
    typeof obj.steps === 'number' ? Math.min(5, Math.max(1, Math.floor(obj.steps))) : undefined;
  const legacyMode = obj.mode as string | undefined;

  if (legacyMode === 'full_hierarchy') {
    return { mode: 'route', route: [...MANAGER_COMPANY_DIRECTOR_ROUTE] };
  }

  if (legacyMode === 'fixed_steps') {
    const n = steps ?? 1;
    if (n >= 2) return { mode: 'route', route: [...MANAGER_COMPANY_DIRECTOR_ROUTE] };
    return { mode: 'route', route: [...MANAGER_ONLY_ROUTE] };
  }

  return DEFAULT_WORKFLOW_POLICIES[workflow];
}

function parseWorkflowPolicy(raw: unknown, workflow: ApprovalWorkflowType): WorkflowPolicyConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const mode = obj.mode as string | undefined;

  if (mode === 'bypass') return { mode: 'bypass' };

  if (mode === 'route' && Array.isArray(obj.route)) {
    const route = obj.route
      .filter((k): k is string => typeof k === 'string' && k.length > 0)
      .slice(0, 5);
    if (route.length > 0) return { mode: 'route', route };
    return null;
  }

  if (mode === 'fixed_steps' || mode === 'full_hierarchy') {
    return migrateLegacyWorkflowPolicy(obj, workflow);
  }

  return null;
}

export function parseAgencyWorkflowsJson(json: Prisma.JsonValue): AgencyWorkflowsConfig {
  const result = { ...DEFAULT_WORKFLOW_POLICIES };
  if (!json || typeof json !== 'object' || Array.isArray(json)) return result;
  for (const workflow of AGENCY_WORKFLOW_TYPES) {
    const parsed = parseWorkflowPolicy((json as Record<string, unknown>)[workflow], workflow);
    if (parsed) result[workflow] = parsed;
  }
  return result;
}

export function workflowsToJson(workflows: AgencyWorkflowsConfig): Prisma.InputJsonValue {
  return workflows as unknown as Prisma.InputJsonValue;
}

export type RouteValidationIssue = {
  workflow: ApprovalWorkflowType;
  message: string;
};

/** Set forward/final capability on each role in a route from its step position. */
function capabilityForRouteStep(
  isLast: boolean,
  current: ApprovalActorMode | undefined,
): ApprovalActorMode {
  const mode = current ?? 'none';
  if (isLast) {
    if (mode === 'final_only' || mode === 'forward_final') return mode;
    return 'forward_final';
  }
  if (mode === 'forward_final' || mode === 'forward_only') return mode;
  return 'forward_only';
}

/** After route save, align RoleApprovalCapability with each role's position in the route. */
export async function syncApprovalCapabilitiesFromRoutes(
  workflows: AgencyWorkflowsConfig,
): Promise<void> {
  const roles = await prisma.rbacRole.findMany({
    select: {
      id: true,
      key: true,
      approvalCapabilities: { select: { workflow: true, mode: true } },
    },
  });
  const roleByKey = new Map(roles.map((r) => [r.key, r]));

  for (const workflow of AGENCY_WORKFLOW_TYPES) {
    const cfg = workflows[workflow];
    if (cfg.mode !== 'route') continue;

    for (let i = 0; i < cfg.route.length; i++) {
      const roleKey = cfg.route[i];
      const role = roleByKey.get(roleKey);
      if (!role) continue;

      const isLast = i === cfg.route.length - 1;
      const existing = role.approvalCapabilities.find((c) => c.workflow === workflow);
      const targetMode = capabilityForRouteStep(isLast, existing?.mode);

      if (existing?.mode === targetMode) continue;

      await prisma.roleApprovalCapability.upsert({
        where: { roleId_workflow: { roleId: role.id, workflow } },
        create: { roleId: role.id, workflow, mode: targetMode },
        update: { mode: targetMode },
      });
    }
  }
}

/** Validate explicit routes before save. */
export async function validateAgencyWorkflowsConfig(
  workflows: AgencyWorkflowsConfig,
): Promise<RouteValidationIssue[]> {
  const issues: RouteValidationIssue[] = [];
  const roles = await prisma.rbacRole.findMany({
    where: { isActive: true },
    select: {
      key: true,
      name: true,
      parent: { select: { key: true } },
      approvalCapabilities: { select: { workflow: true, mode: true } },
    },
  });
  const roleByKey = new Map(roles.map((r) => [r.key, r]));
  const hierarchyNodes: RoleHierarchyNode[] = roles.map((r) => ({
    key: r.key,
    name: r.name,
    parentKey: r.parent?.key ?? null,
  }));

  for (const workflow of AGENCY_WORKFLOW_TYPES) {
    const cfg = workflows[workflow];
    if (cfg.mode === 'bypass') continue;

    const route = cfg.route;
    if (!route.length) {
      issues.push({ workflow, message: 'Approval route must include at least one role.' });
      continue;
    }
    if (route.length > 5) {
      issues.push({ workflow, message: 'Approval route cannot exceed 5 roles.' });
      continue;
    }
    const unique = new Set(route);
    if (unique.size !== route.length) {
      issues.push({ workflow, message: 'Approval route cannot repeat the same role.' });
      continue;
    }

    for (const hierarchyIssue of validateApprovalRouteHierarchy(route, hierarchyNodes)) {
      issues.push({ workflow, message: hierarchyIssue.message });
    }

    for (let i = 0; i < route.length; i++) {
      const roleKey = route[i];
      const role = roleByKey.get(roleKey);
      if (!role) {
        issues.push({ workflow, message: `Unknown role "${roleKey}" in route.` });
        continue;
      }
      const cap = role.approvalCapabilities.find((c) => c.workflow === workflow);
      const mode = cap?.mode ?? ('none' as ApprovalActorMode);
      if (mode === 'none') {
        issues.push({
          workflow,
          message: `Role "${roleKey}" could not be configured for this workflow. Save again or pick a different role.`,
        });
        continue;
      }
      const isLast = i === route.length - 1;
      if (isLast) {
        if (!actorCanFinal(mode)) {
          issues.push({
            workflow,
            message: `Final role "${roleKey}" must be able to final-approve (Final only or Forward + Final).`,
          });
        }
      } else if (!actorCanForward(mode)) {
        issues.push({
          workflow,
          message: `Intermediate role "${roleKey}" must be able to forward (Forward only or Forward + Final).`,
        });
      }
    }
  }

  return issues;
}

export async function getAgencyApprovalPolicy(subCompanyId: string): Promise<{
  subCompanyId: string;
  workflows: AgencyWorkflowsConfig;
  allowLeadSelfAssign: boolean;
  updatedAt: Date | null;
}> {
  const row = await prisma.agencyApprovalPolicy.findUnique({ where: { subCompanyId } });
  if (!row) {
    return {
      subCompanyId,
      workflows: { ...DEFAULT_WORKFLOW_POLICIES },
      allowLeadSelfAssign: true,
      updatedAt: null,
    };
  }
  return {
    subCompanyId: row.subCompanyId,
    workflows: parseAgencyWorkflowsJson(row.workflows),
    allowLeadSelfAssign: row.allowLeadSelfAssign,
    updatedAt: row.updatedAt,
  };
}

export const DEFAULT_ALLOW_LEAD_SELF_ASSIGN = true;

/** Client manual add/edit final approver route for an agency (defaults to per-agency Company Director). */
export async function resolveDefaultClientDirectorRoute(_subCompanyId: string): Promise<string[]> {
  return [...MANAGER_COMPANY_DIRECTOR_ROUTE];
}

export async function getDefaultAgencyApprovalPolicyForSubCompany(subCompanyId: string): Promise<{
  workflows: AgencyWorkflowsConfig;
  allowLeadSelfAssign: boolean;
}> {
  const base = getDefaultAgencyApprovalPolicy();
  const finalRoute = await resolveDefaultClientDirectorRoute(subCompanyId);
  const workflows = { ...base.workflows };
  for (const workflow of WORKFLOWS_WITH_COMPANY_DIRECTOR_FINAL) {
    workflows[workflow] = { mode: 'route', route: finalRoute };
  }
  return {
    ...base,
    workflows,
  };
}

export const DEFAULT_ORG_WORKFLOW_POLICIES: OrgWorkflowsConfig = {
  database_client_add: { mode: 'route', route: ['director'] },
  database_client_import: { mode: 'route', route: ['director'] },
  database_contact_import: { mode: 'route', route: ['director'] },
};

export type DatabaseImportDestination = 'global' | 'agency' | 'both';
export type DatabaseManagerActionDestination = 'global' | 'agency';

export type OrgApprovalPolicyRecord = {
  workflows: OrgWorkflowsConfig;
  databaseImportDestination: DatabaseImportDestination;
  superUserClientDestination: DatabaseImportDestination;
  databaseImportAgencyId: string | null;
  databaseImportAgencyName: string | null;
  updatedAt: Date | null;
};

const ORG_APPROVAL_POLICY_ID = 'default';

const DEFAULT_DATABASE_IMPORT_DESTINATION: DatabaseImportDestination = 'global';
const DEFAULT_SUPER_USER_CLIENT_DESTINATION: DatabaseImportDestination = 'agency';

export function parseOrgWorkflowsJson(json: Prisma.JsonValue): OrgWorkflowsConfig {
  const result = { ...DEFAULT_ORG_WORKFLOW_POLICIES };
  if (!json || typeof json !== 'object' || Array.isArray(json)) return result;
  for (const workflow of DATABASE_WORKFLOW_TYPES) {
    const parsed = parseWorkflowPolicy((json as Record<string, unknown>)[workflow], workflow);
    if (parsed) result[workflow] = parsed;
  }
  return result;
}

export function orgWorkflowsToJson(workflows: OrgWorkflowsConfig): Prisma.InputJsonValue {
  return workflows as unknown as Prisma.InputJsonValue;
}

export async function getOrgApprovalPolicy(): Promise<OrgApprovalPolicyRecord> {
  const row = await prisma.orgApprovalPolicy.findUnique({
    where: { id: ORG_APPROVAL_POLICY_ID },
    include: { databaseImportAgency: { select: { name: true } } },
  });
  if (!row) {
    return {
      workflows: { ...DEFAULT_ORG_WORKFLOW_POLICIES },
      databaseImportDestination: DEFAULT_DATABASE_IMPORT_DESTINATION,
      superUserClientDestination: DEFAULT_SUPER_USER_CLIENT_DESTINATION,
      databaseImportAgencyId: null,
      databaseImportAgencyName: null,
      updatedAt: null,
    };
  }
  const destination = parseDatabaseImportDestination(row.databaseImportDestination);
  const superUserDestination = parseDatabaseImportDestination(row.superUserClientDestination);
  return {
    workflows: parseOrgWorkflowsJson(row.workflows),
    databaseImportDestination: destination,
    superUserClientDestination: superUserDestination,
    databaseImportAgencyId: row.databaseImportAgencyId,
    databaseImportAgencyName: row.databaseImportAgency?.name ?? null,
    updatedAt: row.updatedAt,
  };
}

export function parseDatabaseImportDestination(raw: string | null | undefined): DatabaseImportDestination {
  if (raw === 'agency') return 'agency';
  if (raw === 'both') return 'both';
  return 'global';
}

/** Org setting: which upload paths Database Manager may use. */
export async function getDatabaseManagerDestinationMode(): Promise<DatabaseImportDestination> {
  const policy = await getOrgApprovalPolicy();
  return policy.databaseImportDestination;
}

/** Org setting: global vs agency add/import for Super Users screen roles. */
export async function getSuperUserDestinationMode(): Promise<DatabaseImportDestination> {
  const policy = await getOrgApprovalPolicy();
  return policy.superUserClientDestination;
}

/** @deprecated Use getDatabaseManagerDestinationMode */
export async function getDatabaseManagerClientDestination(): Promise<DatabaseImportDestination> {
  return getDatabaseManagerDestinationMode();
}

/** Resolve per-upload/add destination from org mode + user choice. */
export function resolveClientDestinationMode(
  orgMode: DatabaseImportDestination,
  requested?: DatabaseManagerActionDestination | null,
): { action: DatabaseManagerActionDestination } | { error: string } {
  if (orgMode === 'global') {
    if (requested === 'agency') {
      return { error: 'Agency uploads are disabled — org is set to global database only (Settings → Approvals).' };
    }
    return { action: 'global' };
  }
  if (orgMode === 'agency') {
    if (requested === 'global') {
      return { error: 'Global uploads are disabled — org is set to agency only (Settings → Approvals).' };
    }
    return { action: 'agency' };
  }
  if (requested !== 'global' && requested !== 'agency') {
    return { error: 'Choose whether to upload to the global database or an agency.' };
  }
  return { action: requested };
}

/** @deprecated Use resolveClientDestinationMode */
export function resolveDatabaseManagerActionDestination(
  orgMode: DatabaseImportDestination,
  requested?: DatabaseManagerActionDestination | null,
): { action: DatabaseManagerActionDestination } | { error: string } {
  return resolveClientDestinationMode(orgMode, requested);
}

export async function upsertOrgApprovalPolicy(params: {
  workflows: OrgWorkflowsConfig;
  databaseImportDestination?: DatabaseImportDestination;
  superUserClientDestination?: DatabaseImportDestination;
  databaseImportAgencyId?: string | null;
}): Promise<OrgApprovalPolicyRecord> {
  const merged = parseOrgWorkflowsJson(params.workflows as unknown as Prisma.JsonValue);
  const issues = await validateOrgWorkflowsConfig(merged);
  if (issues.length > 0) {
    const err = new Error(issues.map((i) => `${i.workflow}: ${i.message}`).join(' ')) as Error & {
      statusCode?: number;
    };
    err.statusCode = 400;
    throw err;
  }

  const existing = await prisma.orgApprovalPolicy.findUnique({
    where: { id: ORG_APPROVAL_POLICY_ID },
    select: { databaseImportDestination: true, superUserClientDestination: true, databaseImportAgencyId: true },
  });

  const destination: DatabaseImportDestination =
    params.databaseImportDestination ??
    parseDatabaseImportDestination(existing?.databaseImportDestination);

  const superUserDestination: DatabaseImportDestination =
    params.superUserClientDestination ??
    parseDatabaseImportDestination(existing?.superUserClientDestination);

  const row = await prisma.orgApprovalPolicy.upsert({
    where: { id: ORG_APPROVAL_POLICY_ID },
    create: {
      id: ORG_APPROVAL_POLICY_ID,
      workflows: orgWorkflowsToJson(merged),
      databaseImportDestination: destination,
      superUserClientDestination: superUserDestination,
      databaseImportAgencyId: null,
    },
    update: {
      workflows: orgWorkflowsToJson(merged),
      databaseImportDestination: destination,
      superUserClientDestination: superUserDestination,
      databaseImportAgencyId: null,
    },
    include: { databaseImportAgency: { select: { name: true } } },
  });
  return {
    workflows: parseOrgWorkflowsJson(row.workflows),
    databaseImportDestination: parseDatabaseImportDestination(row.databaseImportDestination),
    superUserClientDestination: parseDatabaseImportDestination(row.superUserClientDestination),
    databaseImportAgencyId: row.databaseImportAgencyId,
    databaseImportAgencyName: row.databaseImportAgency?.name ?? null,
    updatedAt: row.updatedAt,
  };
}

export async function resetOrgApprovalPolicyToDefaults(): Promise<OrgApprovalPolicyRecord> {
  return upsertOrgApprovalPolicy({
    workflows: { ...DEFAULT_ORG_WORKFLOW_POLICIES },
    databaseImportDestination: DEFAULT_DATABASE_IMPORT_DESTINATION,
    superUserClientDestination: DEFAULT_SUPER_USER_CLIENT_DESTINATION,
    databaseImportAgencyId: null,
  });
}

/** True when org Global Database policy skips the approval queue (direct add). */
export async function orgDatabaseWorkflowBypassesApproval(
  workflow: keyof OrgWorkflowsConfig,
): Promise<boolean> {
  const { workflows } = await getOrgApprovalPolicy();
  return workflows[workflow]?.mode === 'bypass';
}

export async function validateOrgWorkflowsConfig(
  workflows: OrgWorkflowsConfig,
): Promise<RouteValidationIssue[]> {
  const allowedRoles = new Set(['director', 'operations_manager']);
  const issues: RouteValidationIssue[] = [];
  for (const workflow of DATABASE_WORKFLOW_TYPES) {
    const cfg = workflows[workflow];
    if (cfg.mode === 'bypass') continue;
    const route = cfg.route;
    if (!route.length) {
      issues.push({ workflow, message: 'Approval route must include at least one role.' });
      continue;
    }
    for (const roleKey of route) {
      if (!allowedRoles.has(roleKey)) {
        issues.push({
          workflow,
          message: `Only Director and Operations Manager may appear in global database routes (got "${roleKey}").`,
        });
      }
    }
  }
  return issues;
}

export async function ensureOrgApprovalPolicyDefaults(): Promise<void> {
  const exists = await prisma.orgApprovalPolicy.findUnique({
    where: { id: ORG_APPROVAL_POLICY_ID },
    select: { id: true },
  });
  if (exists) return;
  await prisma.orgApprovalPolicy.create({
    data: {
      id: ORG_APPROVAL_POLICY_ID,
      workflows: orgWorkflowsToJson(DEFAULT_ORG_WORKFLOW_POLICIES),
      databaseImportDestination: DEFAULT_DATABASE_IMPORT_DESTINATION,
      superUserClientDestination: DEFAULT_SUPER_USER_CLIENT_DESTINATION,
    },
  });
}

export function getDefaultAgencyApprovalPolicy(): {
  workflows: AgencyWorkflowsConfig;
  allowLeadSelfAssign: boolean;
} {
  return {
    workflows: JSON.parse(JSON.stringify(DEFAULT_WORKFLOW_POLICIES)) as AgencyWorkflowsConfig,
    allowLeadSelfAssign: DEFAULT_ALLOW_LEAD_SELF_ASSIGN,
  };
}

function ensureCompanyDirectorFinalRoute(cfg: WorkflowPolicyConfig): WorkflowPolicyConfig {
  if (cfg.mode !== 'route') return cfg;
  const route = cfg.route.map((roleKey) => (roleKey === 'director' ? 'company_director' : roleKey));
  const isManagerOnly = route.length === 1 && route[0] === 'sales_manager';
  if (isManagerOnly) {
    return { mode: 'route', route: [...MANAGER_COMPANY_DIRECTOR_ROUTE] };
  }
  if (route.every((roleKey, i) => roleKey === cfg.route[i])) return cfg;
  return { mode: 'route', route };
}

/** Patch approval routes to company_director (per-agency final approver). */
export async function patchAgencyApprovalRoutesForCompanyDirector(subCompanyId: string): Promise<void> {
  const existing = await prisma.agencyApprovalPolicy.findUnique({
    where: { subCompanyId },
    select: { workflows: true, allowLeadSelfAssign: true },
  });
  const workflows = existing
    ? mergeWorkflowsWithDefaults(parseAgencyWorkflowsJson(existing.workflows))
    : getDefaultAgencyApprovalPolicy().workflows;

  const updated = { ...workflows };
  for (const workflow of WORKFLOWS_WITH_COMPANY_DIRECTOR_FINAL) {
    updated[workflow] = ensureCompanyDirectorFinalRoute(workflows[workflow]);
  }

  await upsertAgencyApprovalPolicy(subCompanyId, {
    workflows: updated,
    allowLeadSelfAssign: existing?.allowLeadSelfAssign ?? DEFAULT_ALLOW_LEAD_SELF_ASSIGN,
  });
}

export async function resetAgencyApprovalPolicyToDefaults(subCompanyId: string): Promise<{
  subCompanyId: string;
  workflows: AgencyWorkflowsConfig;
  allowLeadSelfAssign: boolean;
  updatedAt: Date;
}> {
  const defaults = await getDefaultAgencyApprovalPolicyForSubCompany(subCompanyId);
  return upsertAgencyApprovalPolicy(subCompanyId, defaults);
}

/** Idempotent defaults when a new agency is created (Settings → Agencies). */
export async function ensureAgencyApprovalPolicyDefaults(subCompanyId: string): Promise<void> {
  const exists = await prisma.agencyApprovalPolicy.findUnique({
    where: { subCompanyId },
    select: { subCompanyId: true },
  });
  if (exists) return;
  const defaults = await getDefaultAgencyApprovalPolicyForSubCompany(subCompanyId);
  await upsertAgencyApprovalPolicy(subCompanyId, defaults);
}

/** Ensure every workflow key exists (older saves may omit newer workflows). */
export function mergeWorkflowsWithDefaults(
  workflows: Partial<AgencyWorkflowsConfig> | AgencyWorkflowsConfig,
): AgencyWorkflowsConfig {
  return parseAgencyWorkflowsJson(workflows as Prisma.JsonValue);
}

export async function upsertAgencyApprovalPolicy(
  subCompanyId: string,
  data: { workflows: AgencyWorkflowsConfig; allowLeadSelfAssign: boolean },
): Promise<{ subCompanyId: string; workflows: AgencyWorkflowsConfig; allowLeadSelfAssign: boolean; updatedAt: Date }> {
  const workflows = mergeWorkflowsWithDefaults(data.workflows);
  await syncApprovalCapabilitiesFromRoutes(workflows);
  const issues = await validateAgencyWorkflowsConfig(workflows);
  if (issues.length > 0) {
    const err = new Error(issues.map((i) => `${i.workflow}: ${i.message}`).join(' ')) as Error & {
      statusCode?: number;
      issues?: RouteValidationIssue[];
    };
    err.statusCode = 400;
    err.issues = issues;
    throw err;
  }

  const row = await prisma.agencyApprovalPolicy.upsert({
    where: { subCompanyId },
    create: {
      subCompanyId,
      workflows: workflowsToJson(workflows),
      allowLeadSelfAssign: data.allowLeadSelfAssign,
    },
    update: {
      workflows: workflowsToJson(workflows),
      allowLeadSelfAssign: data.allowLeadSelfAssign,
    },
  });
  return {
    subCompanyId: row.subCompanyId,
    workflows: parseAgencyWorkflowsJson(row.workflows),
    allowLeadSelfAssign: row.allowLeadSelfAssign,
    updatedAt: row.updatedAt,
  };
}

export async function getRoleApprovalCapabilities(roleId: string): Promise<
  { workflow: ApprovalWorkflowType; mode: ApprovalActorMode }[]
> {
  const rows = await prisma.roleApprovalCapability.findMany({
    where: { roleId },
    orderBy: { workflow: 'asc' },
  });
  return rows.map((r) => ({ workflow: r.workflow, mode: r.mode }));
}

export async function setRoleApprovalCapabilities(
  roleId: string,
  capabilities: { workflow: ApprovalWorkflowType; mode: ApprovalActorMode }[],
): Promise<{ workflow: ApprovalWorkflowType; mode: ApprovalActorMode }[]> {
  await prisma.$transaction(async (tx) => {
    await tx.roleApprovalCapability.deleteMany({ where: { roleId } });
    const toCreate = capabilities.filter((c) => c.mode !== 'none');
    if (toCreate.length > 0) {
      await tx.roleApprovalCapability.createMany({
        data: toCreate.map((c) => ({ roleId, workflow: c.workflow, mode: c.mode })),
      });
    }
  });
  return getRoleApprovalCapabilities(roleId);
}

/** Effective capabilities for UI — DB rows only; missing workflows = none. */
export async function getEffectiveRoleApprovalCapabilities(
  roleId: string,
): Promise<Record<ApprovalWorkflowType, ApprovalActorMode>> {
  const rows = await getRoleApprovalCapabilities(roleId);
  return Object.fromEntries(
    ALL_WORKFLOW_TYPES.map((w) => [
      w,
      rows.find((r) => r.workflow === w)?.mode ?? ('none' as ApprovalActorMode),
    ]),
  ) as Record<ApprovalWorkflowType, ApprovalActorMode>;
}

/** Fill missing system-role workflows from code defaults (e.g. after new enum values ship). */
export function mergeSystemRoleCapabilityDefaults(
  roleKey: string,
  dbCapabilities: Map<ApprovalWorkflowType, ApprovalActorMode>,
): Map<ApprovalWorkflowType, ApprovalActorMode> {
  const map = new Map(dbCapabilities);
  const defaults = DEFAULT_ROLE_CAPABILITY_BY_KEY[roleKey];
  if (!defaults) return map;
  for (const workflow of ALL_WORKFLOW_TYPES) {
    if (map.has(workflow)) continue;
    const mode = defaults[workflow];
    if (mode && mode !== 'none') {
      map.set(workflow, mode);
    }
  }
  return map;
}

/** Runtime capability map — DB rows plus system-role defaults for workflows missing in DB. */
export async function getCapabilityMapForRoleKey(
  roleKey: string,
): Promise<Map<ApprovalWorkflowType, ApprovalActorMode>> {
  const role = await prisma.rbacRole.findUnique({
    where: { key: roleKey },
    select: {
      approvalCapabilities: { select: { workflow: true, mode: true } },
    },
  });

  const map = new Map<ApprovalWorkflowType, ApprovalActorMode>();
  for (const c of role?.approvalCapabilities ?? []) {
    map.set(c.workflow, c.mode);
  }
  return mergeSystemRoleCapabilityDefaults(roleKey, map);
}

/** Default capabilities for new custom roles (persisted to DB on create). */
export async function seedCustomRoleDefaultCapabilities(roleId: string): Promise<void> {
  await prisma.roleApprovalCapability.createMany({
    data: ALL_WORKFLOW_TYPES.map((workflow) => ({
      roleId,
      workflow,
      mode: 'forward_only' as ApprovalActorMode,
    })),
    skipDuplicates: true,
  });
}

export async function seedAgencyApprovalPolicies(): Promise<number> {
  const agencies = await prisma.subCompany.findMany({ select: { id: true } });
  let created = 0;
  for (const agency of agencies) {
    const exists = await prisma.agencyApprovalPolicy.findUnique({
      where: { subCompanyId: agency.id },
    });
    if (exists) continue;
    await prisma.agencyApprovalPolicy.create({
      data: {
        subCompanyId: agency.id,
        workflows: workflowsToJson(DEFAULT_WORKFLOW_POLICIES),
        allowLeadSelfAssign: true,
      },
    });
    created++;
  }
  return created;
}

export async function seedRoleApprovalCapabilities(): Promise<number> {
  const roles = await prisma.rbacRole.findMany({
    where: { isSystem: true },
    select: { id: true, key: true },
  });
  let upserted = 0;
  for (const role of roles) {
    const defaults = DEFAULT_ROLE_CAPABILITY_BY_KEY[role.key];
    if (!defaults || Object.keys(defaults).length === 0) continue;
    for (const [workflow, mode] of Object.entries(defaults)) {
      if (!mode || mode === 'none') continue;
      await prisma.roleApprovalCapability.upsert({
        where: { roleId_workflow: { roleId: role.id, workflow: workflow as ApprovalWorkflowType } },
        create: { roleId: role.id, workflow: workflow as ApprovalWorkflowType, mode },
        update: { mode },
      });
      upserted++;
    }
  }
  return upserted;
}
