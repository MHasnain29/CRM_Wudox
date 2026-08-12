import type { ApprovalWorkflowType } from '@prisma/client';
import { listAssignableRoles } from './rbac';
import {
  ALL_WORKFLOW_TYPES,
  WORKFLOW_FINAL_PERMISSION,
  WORKFLOW_FINAL_PERMISSION_FALLBACK,
  WORKFLOW_FORWARD_PERMISSION,
  WORKFLOW_LABELS,
} from '../types/approval';

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

export type ApprovalMetadataPayload = {
  workflows: ApprovalWorkflowMetadata[];
  actorModes: Array<{ value: string; label: string }>;
  assignableRoles: AssignableRoleMetadata[];
};

const ACTOR_MODE_LABELS: Record<string, string> = {
  none: 'None',
  forward_only: 'Forward only',
  final_only: 'Final only',
  forward_final: 'Forward + Final',
};

export async function getApprovalMetadata(): Promise<ApprovalMetadataPayload> {
  const assignableRoles = await listAssignableRoles();

  return {
    workflows: ALL_WORKFLOW_TYPES.map((workflow) => ({
      workflow,
      label: WORKFLOW_LABELS[workflow],
      forwardPermission: WORKFLOW_FORWARD_PERMISSION[workflow],
      finalPermission: WORKFLOW_FINAL_PERMISSION[workflow],
      finalPermissionFallback: WORKFLOW_FINAL_PERMISSION_FALLBACK[workflow] ?? null,
    })),
    actorModes: [
      { value: 'none', label: ACTOR_MODE_LABELS.none },
      { value: 'forward_only', label: ACTOR_MODE_LABELS.forward_only },
      { value: 'final_only', label: ACTOR_MODE_LABELS.final_only },
      { value: 'forward_final', label: ACTOR_MODE_LABELS.forward_final },
    ],
    assignableRoles: assignableRoles.map((r) => ({
      key: r.key,
      name: r.name,
      parentKey: r.parentKey,
    })),
  };
}

/** Sync metadata for routes that do not need async roles (tests). */
export function getApprovalMetadataSync(): Omit<ApprovalMetadataPayload, 'assignableRoles'> & {
  assignableRoles?: AssignableRoleMetadata[];
} {
  return {
    workflows: ALL_WORKFLOW_TYPES.map((workflow) => ({
      workflow,
      label: WORKFLOW_LABELS[workflow],
      forwardPermission: WORKFLOW_FORWARD_PERMISSION[workflow],
      finalPermission: WORKFLOW_FINAL_PERMISSION[workflow],
      finalPermissionFallback: WORKFLOW_FINAL_PERMISSION_FALLBACK[workflow] ?? null,
    })),
    actorModes: [
      { value: 'none', label: ACTOR_MODE_LABELS.none },
      { value: 'forward_only', label: ACTOR_MODE_LABELS.forward_only },
      { value: 'final_only', label: ACTOR_MODE_LABELS.final_only },
      { value: 'forward_final', label: ACTOR_MODE_LABELS.forward_final },
    ],
  };
}
