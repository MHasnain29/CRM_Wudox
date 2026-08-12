import type { ApprovalActorMode, ApprovalWorkflowType } from '@prisma/client';
import prisma from '../config/database';
import { getDataScopeLevelForRoleKey } from './rbac';
import { getAgencyApprovalPolicy, getCapabilityMapForRoleKey, getOrgApprovalPolicy } from './approvalPolicy';
import { GLOBAL_APPROVAL_SCOPE, isDatabaseWorkflow } from '../types/approval';
import { canSeniorOverrideTarget, getRoleParentKeyMap } from './roleHierarchy';
import type { AgencyWorkflowsConfig, ApprovalEntityRef, UserApprovalAction } from '../types/approval';
import { getPolicyRoute } from '../types/approval';
import {
  WORKFLOW_FINAL_PERMISSION,
  WORKFLOW_FINAL_PERMISSION_FALLBACK,
  WORKFLOW_FORWARD_PERMISSION,
} from '../types/approval';

/** Workflows that always enter the approval queue even when submitter data scope is above own. */
const WORKFLOWS_ALWAYS_ROUTED: ReadonlySet<ApprovalWorkflowType> = new Set([
  'client_manual_add',
  'client_manual_edit',
  'client_import',
  'contact_import',
  'lead_reassignment',
  'database_client_add',
  'database_client_import',
  'database_contact_import',
  'employee_add',
  'employee_assignment',
]);

function actorCanFinal(mode: ApprovalActorMode): boolean {
  return mode === 'final_only' || mode === 'forward_final';
}

function actorCanForward(mode: ApprovalActorMode): boolean {
  return mode === 'forward_only' || mode === 'forward_final';
}

/** Team+ scope or agency bypass policy skips the approval queue. */
export async function shouldBypassWorkflow(
  submitterRoleKey: string,
  workflow: ApprovalWorkflowType,
  workflows: AgencyWorkflowsConfig,
): Promise<boolean> {
  const wf = workflows[workflow];
  if (wf?.mode === 'bypass') return true;

  if (!WORKFLOWS_ALWAYS_ROUTED.has(workflow)) {
    const scope = await getDataScopeLevelForRoleKey(submitterRoleKey);
    if (scope && scope !== 'own') return true;
  }

  return false;
}

/** Skip intermediate steps when the submitter is the current target (route to the next approver). */
export function initialStepIndexForSubmitter(chain: string[], submitterRoleKey: string): number {
  if (chain.length === 0) return 0;
  let index = 0;
  while (index < chain.length - 1 && chain[index] === submitterRoleKey) {
    index++;
  }
  return index;
}

function resolveStepRejectEligibility(params: {
  entity: Pick<ApprovalEntityRef, 'chain' | 'currentStepIndex'>;
  userRoleKey: string;
  targetRole: string;
  actorIndex: number;
  canForward: boolean;
  canFinal: boolean;
  canFinalFallback: boolean;
  hierarchyOverride?: boolean;
}): boolean {
  const {
    entity,
    userRoleKey,
    targetRole,
    actorIndex,
    canForward,
    canFinal,
    canFinalFallback,
    hierarchyOverride,
  } = params;

  if (hierarchyOverride && (canFinal || canFinalFallback)) return true;

  if (actorIndex < entity.currentStepIndex) return false;

  const isLastStep = entity.currentStepIndex === entity.chain.length - 1;

  if (actorIndex > entity.currentStepIndex) {
    return canFinal || canFinalFallback;
  }

  if (userRoleKey === targetRole) {
    if (isLastStep) {
      return canFinal || canFinalFallback || (entity.chain.length === 1 && canForward);
    }
    return false;
  }

  return false;
}

export type ApprovalRoutingResult = {
  chain: string[];
  /** True when policy bypass or submitter data scope above own — no queue. */
  bypassed: boolean;
  /** True when approval is required but route is missing or has no capable roles. */
  misconfigured: boolean;
};

/** Resolve explicit agency or org route for a workflow (used on submit and status reload). */
export async function resolveApprovalRouting(
  submitterRoleKey: string,
  workflow: ApprovalWorkflowType,
  subCompanyId: string,
): Promise<ApprovalRoutingResult> {
  if (isDatabaseWorkflow(workflow)) {
    const orgPolicy = await getOrgApprovalPolicy();
    const workflows = orgPolicy.workflows;
    const wfPolicy = workflows[workflow as keyof typeof workflows];
    if (!wfPolicy) {
      return { chain: [], bypassed: false, misconfigured: true };
    }
    if (wfPolicy.mode === 'bypass') {
      return { chain: [], bypassed: true, misconfigured: false };
    }
    if (wfPolicy.mode !== 'route') {
      return { chain: [], bypassed: false, misconfigured: true };
    }
    const route = getPolicyRoute(wfPolicy);
    if (route.length === 0) {
      return { chain: [], bypassed: false, misconfigured: true };
    }
    const filtered: string[] = [];
    for (const roleKey of route) {
      const cap = await getCapabilityMapForRoleKey(roleKey);
      const mode = cap.get(workflow) ?? 'none';
      if (mode !== 'none') filtered.push(roleKey);
    }
    if (filtered.length === 0) {
      return { chain: [], bypassed: false, misconfigured: true };
    }
    return { chain: filtered, bypassed: false, misconfigured: false };
  }

  if (subCompanyId === GLOBAL_APPROVAL_SCOPE) {
    return { chain: [], bypassed: false, misconfigured: true };
  }

  const policy = await getAgencyApprovalPolicy(subCompanyId);
  const workflows = policy.workflows;

  if (await shouldBypassWorkflow(submitterRoleKey, workflow, workflows)) {
    return { chain: [], bypassed: true, misconfigured: false };
  }

  const wfPolicy = workflows[workflow];
  if (wfPolicy.mode !== 'route') {
    return { chain: [], bypassed: false, misconfigured: true };
  }

  const route = getPolicyRoute(wfPolicy);
  if (route.length === 0) {
    return { chain: [], bypassed: false, misconfigured: true };
  }

  const filtered: string[] = [];
  for (const roleKey of route) {
    const cap = await getCapabilityMapForRoleKey(roleKey);
    const mode = cap.get(workflow) ?? 'none';
    if (mode !== 'none') filtered.push(roleKey);
  }

  if (filtered.length === 0) {
    return { chain: [], bypassed: false, misconfigured: true };
  }

  return { chain: filtered, bypassed: false, misconfigured: false };
}

/** Build runtime chain from agency explicit route (filters roles with none capability). */
export async function buildApprovalChain(
  submitterRoleKey: string,
  workflow: ApprovalWorkflowType,
  subCompanyId: string,
): Promise<string[]> {
  const routing = await resolveApprovalRouting(submitterRoleKey, workflow, subCompanyId);
  return routing.chain;
}

export function getCurrentTargetRole(entity: Pick<ApprovalEntityRef, 'chain' | 'currentStepIndex'>): string | null {
  if (!entity.chain.length) return null;
  if (entity.currentStepIndex >= entity.chain.length) return null;
  return entity.chain[entity.currentStepIndex] ?? null;
}

export function getNextRoleInChain(entity: Pick<ApprovalEntityRef, 'chain' | 'currentStepIndex'>): string | null {
  const nextIndex = entity.currentStepIndex + 1;
  if (nextIndex >= entity.chain.length) return null;
  return entity.chain[nextIndex] ?? null;
}

export function isChainComplete(entity: Pick<ApprovalEntityRef, 'chain' | 'currentStepIndex'>): boolean {
  if (entity.chain.length === 0) return true;
  return entity.currentStepIndex >= entity.chain.length;
}

/** True when the entity is on the last chain step (ready for final approve). */
export function isAtFinalApprovalStep(entity: Pick<ApprovalEntityRef, 'chain' | 'currentStepIndex'>): boolean {
  if (entity.chain.length === 0) return true;
  return entity.currentStepIndex >= entity.chain.length - 1;
}

/** Index of a role in the chain, or -1 if absent. */
export function getActorIndexInChain(chain: string[], roleKey: string): number {
  return chain.indexOf(roleKey);
}

/** Senior role later in the route can final-approve while item waits on a junior step. */
export function isDirectApprovalOverride(
  chain: string[],
  currentStepIndex: number,
  actorRoleKey: string,
): boolean {
  const actorIndex = getActorIndexInChain(chain, actorRoleKey);
  return actorIndex > currentStepIndex;
}

export type ApprovalUserOptions = {
  allowedAction: UserApprovalAction;
  isDirectApproval: boolean;
  canReject: boolean;
  skippedRoleKeys: string[];
};

export async function resolveUserApprovalOptions(
  userRoleKey: string,
  userPermissions: string[],
  entity: ApprovalEntityRef,
): Promise<ApprovalUserOptions> {
  const empty: ApprovalUserOptions = {
    allowedAction: null,
    isDirectApproval: false,
    canReject: false,
    skippedRoleKeys: [],
  };

  if (isChainComplete(entity)) return empty;

  const targetRole = getCurrentTargetRole(entity);
  if (!targetRole) return empty;

  const capability = await getCapabilityMapForRoleKey(userRoleKey);
  const mode = capability.get(entity.workflow) ?? 'none';
  if (mode === 'none') return empty;

  const parentByKey = await getRoleParentKeyMap();
  const actorIndex = getActorIndexInChain(entity.chain, userRoleKey);
  const hierarchyOverride =
    actorIndex < 0 && canSeniorOverrideTarget(userRoleKey, targetRole, parentByKey);

  const isLastStep = entity.currentStepIndex === entity.chain.length - 1;
  const forwardPerm = WORKFLOW_FORWARD_PERMISSION[entity.workflow];
  const finalPerm =
    WORKFLOW_FINAL_PERMISSION[entity.workflow] ??
    WORKFLOW_FINAL_PERMISSION_FALLBACK[entity.workflow];

  const canForward = Boolean(actorCanForward(mode) && userPermissions.includes(forwardPerm));
  const canFinal = Boolean(
    actorCanFinal(mode) && finalPerm && userPermissions.includes(finalPerm),
  );
  const canFinalFallback = Boolean(
    finalPerm &&
      WORKFLOW_FINAL_PERMISSION_FALLBACK[entity.workflow] &&
      userPermissions.includes(WORKFLOW_FINAL_PERMISSION_FALLBACK[entity.workflow]!),
  );

  const canReject = resolveStepRejectEligibility({
    entity,
    userRoleKey,
    targetRole,
    actorIndex,
    canForward,
    canFinal,
    canFinalFallback,
    hierarchyOverride,
  });

  const inChainSenior = actorIndex > entity.currentStepIndex;

  const skippedRoleKeys =
    inChainSenior || hierarchyOverride
      ? entity.chain.slice(
          entity.currentStepIndex,
          inChainSenior ? actorIndex : entity.chain.length,
        )
      : [];

  // Senior direct final-approve (in route or hierarchy override — skips junior steps).
  if ((inChainSenior || hierarchyOverride) && (canFinal || canFinalFallback)) {
    return {
      allowedAction: 'approve',
      isDirectApproval: true,
      canReject,
      skippedRoleKeys,
    };
  }

  if (actorIndex < 0) {
    return { ...empty, canReject };
  }

  if (userRoleKey !== targetRole) {
    return { ...empty, canReject };
  }

  if (isLastStep) {
    if (canFinal || canFinalFallback) {
      return { allowedAction: 'approve', isDirectApproval: false, canReject, skippedRoleKeys: [] };
    }
    if (entity.chain.length === 1 && canForward) {
      return { allowedAction: 'approve', isDirectApproval: false, canReject, skippedRoleKeys: [] };
    }
    return { ...empty, canReject };
  }

  if (canForward) {
    return { allowedAction: 'forward', isDirectApproval: false, canReject, skippedRoleKeys: [] };
  }

  return { ...empty, canReject };
}

/** @deprecated Use resolveUserApprovalOptions — returns primary action only. */
export async function resolveUserApprovalAction(
  userRoleKey: string,
  userPermissions: string[],
  entity: ApprovalEntityRef,
): Promise<UserApprovalAction> {
  const options = await resolveUserApprovalOptions(userRoleKey, userPermissions, entity);
  return options.allowedAction;
}

export async function logApprovalStep(params: {
  workflow: ApprovalWorkflowType;
  entityType: string;
  entityId: string;
  stepIndex: number;
  targetRoleKey: string;
  actorUserId: string;
  actorRoleKey: string;
  action: 'forward' | 'approve' | 'reject' | 'direct_approve';
  remarks?: string | null;
}): Promise<void> {
  await prisma.approvalStep.create({
    data: {
      workflow: params.workflow,
      entityType: params.entityType,
      entityId: params.entityId,
      stepIndex: params.stepIndex,
      targetRoleKey: params.targetRoleKey,
      actorUserId: params.actorUserId,
      actorRoleKey: params.actorRoleKey,
      action: params.action,
      remarks: params.remarks ?? null,
    },
  });
}

export async function getApprovalHistory(
  entityType: string,
  entityId: string,
): Promise<
  {
    id: string;
    stepIndex: number;
    targetRoleKey: string;
    actorUserId: string;
    actorRoleKey: string;
    actorName: string;
    action: string;
    remarks: string | null;
    createdAt: Date;
  }[]
> {
  const rows = await prisma.approvalStep.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      stepIndex: true,
      targetRoleKey: true,
      actorUserId: true,
      actorRoleKey: true,
      action: true,
      remarks: true,
      createdAt: true,
    },
  });
  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.actorUserId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  const nameById = new Map(
    users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]),
  );

  return rows.map((r) => ({
    ...r,
    actorName: nameById.get(r.actorUserId) ?? r.actorRoleKey.replace(/_/g, ' '),
  }));
}

/** Infer chain state from legacy managerApprovedAt (client pending rows). */
export function resolveLegacyStepIndex(
  chain: string[],
  managerApprovedAt: Date | null | undefined,
): number {
  if (chain.length === 0) return 0;
  if (managerApprovedAt && chain.length >= 2) return 1;
  return 0;
}

export function enrichEntityChainState<T extends { approvalChain?: unknown; currentStepIndex?: number; managerApprovedAt?: Date | null }>(
  row: T,
  builtChain: string[],
): { chain: string[]; currentStepIndex: number } {
  const stored = Array.isArray(row.approvalChain)
    ? (row.approvalChain as string[]).filter((k) => typeof k === 'string')
    : [];
  const chainsMatch =
    stored.length === builtChain.length && stored.every((k, i) => k === builtChain[i]);
  const chain =
    stored.length > 0 && chainsMatch
      ? stored
      : builtChain.length > 0
        ? builtChain
        : stored.length > 0
          ? stored
          : builtChain;
  let currentStepIndex =
    typeof row.currentStepIndex === 'number' && row.currentStepIndex >= 0
      ? row.currentStepIndex
      : resolveLegacyStepIndex(chain, row.managerApprovedAt);
  if (chain.length > 0) {
    currentStepIndex = Math.min(currentStepIndex, chain.length - 1);
  }
  return { chain, currentStepIndex };
}
