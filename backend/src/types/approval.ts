import type { ApprovalActorMode, ApprovalWorkflowType } from '@prisma/client';

export type ApprovalPolicyMode = 'bypass' | 'route';

export type WorkflowPolicyConfig =
  | { mode: 'bypass' }
  | { mode: 'route'; route: string[] };

export type AgencyWorkflowsConfig = Record<
  (typeof AGENCY_WORKFLOW_TYPES)[number],
  WorkflowPolicyConfig
>;

export function getPolicyRoute(cfg: WorkflowPolicyConfig): string[] {
  return cfg.mode === 'route' ? cfg.route : [];
}

export type ApprovalChainState = {
  chain: string[];
  currentStepIndex: number;
};

export type ApprovalActionType = 'forward' | 'approve' | 'reject';

export type UserApprovalAction = ApprovalActionType | null;

export type ApprovalEntityRef = {
  workflow: ApprovalWorkflowType;
  entityType: string;
  entityId: string;
  subCompanyId: string;
  submitterRoleKey: string;
  submitterUserId: string;
  chain: string[];
  currentStepIndex: number;
};

export type RoleCapabilityMap = Map<ApprovalWorkflowType, ApprovalActorMode>;

/** Sentinel scope for org-wide (database manager) approval entities. */
export const GLOBAL_APPROVAL_SCOPE = '__global__';

export function isDatabaseWorkflow(workflow: ApprovalWorkflowType): boolean {
  return (
    workflow === 'database_client_add' ||
    workflow === 'database_client_import' ||
    workflow === 'database_contact_import'
  );
}

export const DATABASE_WORKFLOW_TYPES = [
  'database_client_add',
  'database_client_import',
  'database_contact_import',
] as const satisfies readonly ApprovalWorkflowType[];

export const AGENCY_WORKFLOW_TYPES: ApprovalWorkflowType[] = [
  'client_manual_add',
  'client_manual_edit',
  'client_import',
  'contact_import',
  'lead_request',
  'lead_extension',
  'lead_reassignment',
  'proposal_review',
  'proposal_extension',
  'employee_add',
  'employee_assignment',
];

export const ALL_WORKFLOW_TYPES: ApprovalWorkflowType[] = [
  ...AGENCY_WORKFLOW_TYPES,
  ...DATABASE_WORKFLOW_TYPES,
];

export type OrgWorkflowsConfig = Record<
  (typeof DATABASE_WORKFLOW_TYPES)[number],
  WorkflowPolicyConfig
>;

export const WORKFLOW_FORWARD_PERMISSION: Record<ApprovalWorkflowType, string> = {
  client_manual_add: 'clients:manager_recommend',
  client_manual_edit: 'clients:manager_recommend',
  client_import: 'clients:manager_recommend',
  contact_import: 'clients:manager_recommend',
  database_client_add: 'clients:manager_recommend',
  database_client_import: 'clients:manager_recommend',
  database_contact_import: 'clients:manager_recommend',
  lead_request: 'leads:manager_recommend',
  lead_extension: 'leads:manager_recommend',
  lead_reassignment: 'leads:manager_recommend',
  proposal_review: 'proposals:manager_recommend',
  proposal_extension: 'proposals:manager_recommend',
  employee_add: 'employees:manager_recommend',
  employee_assignment: 'employees:manager_recommend',
};

export const WORKFLOW_FINAL_PERMISSION: Record<ApprovalWorkflowType, string> = {
  client_manual_add: 'clients:approve',
  client_manual_edit: 'clients:approve',
  client_import: 'clients:approve',
  contact_import: 'clients:approve',
  database_client_add: 'clients:approve',
  database_client_import: 'clients:approve',
  database_contact_import: 'clients:approve',
  lead_request: 'leads:approve',
  lead_extension: 'leads:approve',
  lead_reassignment: 'leads:reassign_approve',
  proposal_review: 'proposals:review',
  proposal_extension: 'proposals:review',
  employee_add: 'employees:approve',
  employee_assignment: 'employees:approve',
};

/** Fallback when leads:approve absent — single-step lead flows may use leads:assign. */
export const WORKFLOW_FINAL_PERMISSION_FALLBACK: Partial<Record<ApprovalWorkflowType, string>> = {
  lead_request: 'leads:assign',
  lead_extension: 'leads:assign',
};

export const WORKFLOW_LABELS: Record<ApprovalWorkflowType, string> = {
  client_manual_add: 'Client manual add',
  client_manual_edit: 'Client manual edit',
  client_import: 'Client CSV import',
  contact_import: 'Contact CSV import',
  database_client_add: 'Global database — manual add',
  database_client_import: 'Global database — CSV import',
  database_contact_import: 'Global database — contact CSV import',
  lead_request: 'Lead request',
  lead_extension: 'Lead extension',
  lead_reassignment: 'Lead reassignments',
  proposal_review: 'Proposal review',
  proposal_extension: 'Proposal extension',
  employee_add: 'New employee',
  employee_assignment: 'Employee client/job link',
};
