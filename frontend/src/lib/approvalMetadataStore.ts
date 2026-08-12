import { ALL_APPROVAL_WORKFLOW_TYPES, type ApprovalWorkflowType } from './api';

export type ApprovalWorkflowMetadata = {
  workflow: ApprovalWorkflowType;
  label: string;
  forwardPermission: string;
  finalPermission: string;
  finalPermissionFallback: string | null;
};

export type AssignableRoleMetadata = {
  key: string;
  name: string;
  parentKey: string | null;
};

export type ApprovalMetadata = {
  workflows: ApprovalWorkflowMetadata[];
  actorModes: Array<{ value: string; label: string }>;
  assignableRoles: AssignableRoleMetadata[];
};

let cached: ApprovalMetadata | null = null;
let inflight: Promise<ApprovalMetadata> | null = null;

export function isApprovalMetadataComplete(data: ApprovalMetadata | null): data is ApprovalMetadata {
  if (!data) return false;
  const keys = new Set(data.workflows.map((w) => w.workflow));
  if (!ALL_APPROVAL_WORKFLOW_TYPES.every((workflow) => keys.has(workflow))) return false;
  return data.assignableRoles.every((r) => typeof r.parentKey === 'string' || r.parentKey === null);
}

export function getApprovalMetadataCache(): ApprovalMetadata | null {
  if (cached && !isApprovalMetadataComplete(cached)) {
    cached = null;
    inflight = null;
  }
  return cached;
}

export function setApprovalMetadataCache(data: ApprovalMetadata): void {
  cached = data;
}

export function clearApprovalMetadataCache(): void {
  cached = null;
  inflight = null;
}

export function getWorkflowMetadata(workflow: ApprovalWorkflowType): ApprovalWorkflowMetadata | undefined {
  return cached?.workflows.find((w) => w.workflow === workflow);
}

export function getActorModeLabel(mode: string): string {
  return cached?.actorModes.find((m) => m.value === mode)?.label ?? mode;
}

export function registerMetadataInflight(promise: Promise<ApprovalMetadata>): Promise<ApprovalMetadata> {
  inflight = promise;
  return promise.finally(() => {
    if (inflight === promise) inflight = null;
  });
}

export function getMetadataInflight(): Promise<ApprovalMetadata> | null {
  return inflight;
}
