import type { ApprovalWorkflowType, PendingManualSubmissionRecord } from '@/lib/api';
import { formatRoleLabel } from '@/lib/approvalMessages';

export function isGlobalDatabasePendingSubmission(
  record: Pick<PendingManualSubmissionRecord, 'subCompanyId' | 'submissionSource'>,
): boolean {
  return record.submissionSource === 'global_database' || record.subCompanyId === null;
}

export function resolveManualSubmissionWorkflow(
  record: Pick<PendingManualSubmissionRecord, 'subCompanyId' | 'submissionSource'>,
): Extract<ApprovalWorkflowType, 'client_manual_add' | 'database_client_add'> {
  return isGlobalDatabasePendingSubmission(record) ? 'database_client_add' : 'client_manual_add';
}

function parseApprovalChain(chain: unknown): string[] {
  if (!Array.isArray(chain)) return [];
  return chain.filter((step): step is string => typeof step === 'string' && step.length > 0);
}

export function getPendingManualApprovalStatus(record: PendingManualSubmissionRecord): {
  badge: string;
  detail?: string;
} {
  if (isGlobalDatabasePendingSubmission(record)) {
    const chain = parseApprovalChain(record.approvalChain);
    const stepIndex = record.currentStepIndex ?? 0;
    const targetRole = chain[stepIndex];
    if (targetRole) {
      const label = formatRoleLabel(targetRole);
      const isFinal = stepIndex >= chain.length - 1;
      return {
        badge: `Awaiting ${label}`,
        detail: isFinal ? 'Final approval' : undefined,
      };
    }
    return { badge: 'Pending approval' };
  }

  const managerApproved = !!(record.managerApprovedAt && record.managerApprovedById);
  if (managerApproved) {
    const managerName = record.managerApprovedBy
      ? [record.managerApprovedBy.firstName, record.managerApprovedBy.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || record.managerApprovedBy.email
      : undefined;
    return {
      badge: 'Manager approved',
      detail: managerName ? `by ${managerName}` : undefined,
    };
  }

  return { badge: 'Awaiting review' };
}
