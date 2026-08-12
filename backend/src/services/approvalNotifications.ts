import type { ApprovalWorkflowType } from '@prisma/client';
import prisma from '../config/database';
import type { NotificationType } from './notifications';
import { dispatchNotificationToUser } from './notificationDispatch';
import { getApprovalEventKey } from './notificationRegistry';
import {
  forwardNotification,
  submitNotification,
} from './approvalMessages';

type EntityNotifyCtx = {
  label: string;
  requesterUserId: string;
  submitterName: string;
  link: string;
};

async function loadEntityNotifyCtx(
  workflow: ApprovalWorkflowType,
  entityId: string,
): Promise<EntityNotifyCtx | null> {
  switch (workflow) {
    case 'lead_request': {
      const row = await prisma.leadRequest.findUnique({
        where: { id: entityId },
        include: {
          client: { select: { name: true } },
          requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (!row) return null;
      const submitterName =
        `${row.requestedBy.firstName ?? ''} ${row.requestedBy.lastName ?? ''}`.trim() ||
        row.requestedBy.email;
      return {
        label: row.client.name,
        requesterUserId: row.requestedById,
        submitterName,
        link: `/leads?review=${entityId}`,
      };
    }
    case 'lead_extension': {
      const row = await prisma.leadExtensionRequest.findUnique({
        where: { id: entityId },
        include: {
          lead: { select: { client: { select: { name: true } } } },
          requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (!row) return null;
      const submitterName =
        `${row.requestedBy.firstName ?? ''} ${row.requestedBy.lastName ?? ''}`.trim() ||
        row.requestedBy.email;
      return {
        label: row.lead.client.name,
        requesterUserId: row.requestedById,
        submitterName,
        link: '/leads',
      };
    }
    case 'lead_reassignment': {
      const row = await prisma.leadReassignmentRequest.findUnique({
        where: { id: entityId },
        include: {
          lead: { select: { client: { select: { name: true } } } },
          requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (!row) return null;
      const submitterName =
        `${row.requestedBy.firstName ?? ''} ${row.requestedBy.lastName ?? ''}`.trim() ||
        row.requestedBy.email;
      return {
        label: row.lead.client.name,
        requesterUserId: row.requestedById,
        submitterName,
        link: '/leads',
      };
    }
    case 'client_manual_add': {
      const row = await prisma.pendingClientSubmission.findUnique({
        where: { id: entityId },
        include: {
          submittedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (!row) return null;
      const submitterName =
        `${row.submittedBy.firstName ?? ''} ${row.submittedBy.lastName ?? ''}`.trim() ||
        row.submittedBy.email;
      return {
        label: row.name,
        requesterUserId: row.submittedById,
        submitterName,
        link: '/clients?tab=pending',
      };
    }
    case 'client_manual_edit': {
      const row = await prisma.pendingClientEdit.findUnique({
        where: { id: entityId },
        include: {
          submittedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (!row) return null;
      const submitterName =
        `${row.submittedBy.firstName ?? ''} ${row.submittedBy.lastName ?? ''}`.trim() ||
        row.submittedBy.email;
      return {
        label: row.name,
        requesterUserId: row.submittedById,
        submitterName,
        link: '/clients?tab=pending',
      };
    }
    case 'client_import': {
      const row = await prisma.pendingImportedClient.findUnique({
        where: { id: entityId },
        include: {
          importedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (!row) return null;
      const submitterName =
        `${row.importedBy.firstName ?? ''} ${row.importedBy.lastName ?? ''}`.trim() ||
        row.importedBy.email;
      return {
        label: row.name,
        requesterUserId: row.importedById,
        submitterName,
        link: '/clients?tab=pending',
      };
    }
    case 'contact_import':
    case 'database_contact_import': {
      const row = await prisma.pendingImportedContact.findUnique({
        where: { id: entityId },
        include: {
          importedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
          targetClient: { select: { name: true } },
        },
      });
      if (!row) return null;
      const submitterName =
        `${row.importedBy.firstName ?? ''} ${row.importedBy.lastName ?? ''}`.trim() ||
        row.importedBy.email;
      return {
        label: row.targetClient.name,
        requesterUserId: row.importedById,
        submitterName,
        link: '/clients?tab=pending',
      };
    }
    case 'proposal_review': {
      const row = await prisma.proposal.findUnique({
        where: { id: entityId },
        include: {
          lead: { select: { client: { select: { name: true } } } },
          createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (!row) return null;
      const submitter = row.createdBy;
      const submitterName = submitter
        ? `${submitter.firstName ?? ''} ${submitter.lastName ?? ''}`.trim() || submitter.email
        : 'Associate';
      return {
        label: row.lead.client.name,
        requesterUserId: row.createdById ?? row.reviewRequestedById ?? '',
        submitterName,
        link: '/proposals',
      };
    }
    case 'proposal_extension': {
      const row = await prisma.proposalExtensionRequest.findUnique({
        where: { id: entityId },
        include: {
          proposal: { select: { lead: { select: { client: { select: { name: true } } } } } },
          requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (!row) return null;
      const submitterName =
        `${row.requestedBy.firstName ?? ''} ${row.requestedBy.lastName ?? ''}`.trim() ||
        row.requestedBy.email;
      return {
        label: row.proposal.lead.client.name,
        requesterUserId: row.requestedById,
        submitterName,
        link: '/proposals',
      };
    }
    case 'employee_add': {
      const row = await prisma.employee.findUnique({
        where: { id: entityId },
        include: {
          addedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (!row) return null;
      const submitterName =
        `${row.addedBy.firstName ?? ''} ${row.addedBy.lastName ?? ''}`.trim() ||
        row.addedBy.email;
      return {
        label: `${row.firstName} ${row.lastName}`.trim(),
        requesterUserId: row.addedById,
        submitterName,
        link: `/employees?review=${entityId}`,
      };
    }
    case 'employee_assignment': {
      const row = await prisma.employeeAssignment.findUnique({
        where: { id: entityId },
        include: {
          employee: { select: { firstName: true, lastName: true } },
          client: { select: { name: true } },
          job: { select: { title: true } },
          submittedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (!row) return null;
      const submitterName =
        `${row.submittedBy.firstName ?? ''} ${row.submittedBy.lastName ?? ''}`.trim() ||
        row.submittedBy.email;
      const targetLabel =
        row.targetType === 'client'
          ? row.client?.name ?? 'Client'
          : row.job?.title ?? 'Job';
      return {
        label: `${row.employee.firstName} ${row.employee.lastName} → ${targetLabel}`,
        requesterUserId: row.submittedById,
        submitterName,
        link: `/employees?assignment=${entityId}`,
      };
    }
    default:
      return null;
  }
}

function submitNotificationType(workflow: ApprovalWorkflowType): NotificationType {
  switch (workflow) {
    case 'client_manual_add':
    case 'client_import':
    case 'contact_import':
    case 'database_contact_import':
      return 'client_pending_submission';
    case 'client_manual_edit':
      return 'client_pending_edit';
    case 'proposal_review':
    case 'proposal_extension':
      return 'proposal_submitted';
    case 'lead_reassignment':
      return 'lead_reassignment_requested';
    default:
      return 'lead_requested';
  }
}

function forwardNotificationType(workflow: ApprovalWorkflowType): NotificationType {
  return submitNotificationType(workflow);
}

function rejectNotificationType(workflow: ApprovalWorkflowType): NotificationType {
  switch (workflow) {
    case 'lead_request':
      return 'lead_request_rejected';
    case 'lead_reassignment':
      return 'lead_reassignment_rejected';
    case 'proposal_review':
    case 'proposal_extension':
      return 'proposal_rejected';
    case 'client_manual_add':
    case 'client_import':
    case 'contact_import':
    case 'database_contact_import':
      return 'client_pending_submission';
    case 'client_manual_edit':
      return 'client_pending_edit';
    default:
      return 'lead_request_rejected';
  }
}

/** First-step submit notification to chain target role. */
export function buildSubmitNotifyPayload(
  workflow: ApprovalWorkflowType,
  submitterName: string,
  entityLabel: string,
): { title: string; body: string } {
  return submitNotification(workflow, { name: submitterName }, { label: entityLabel });
}

/** After forward — notify next approver. */
export function buildForwardNotifyPayload(
  workflow: ApprovalWorkflowType,
  submitterName: string,
  entityLabel: string,
): { title: string; body: string } {
  return forwardNotification(workflow, { name: submitterName }, { label: entityLabel });
}

/** After final reject — notify requester (workflows without dedicated reject handlers). */
export async function notifyRequesterAfterReject(params: {
  workflow: ApprovalWorkflowType;
  entityId: string;
  subCompanyId: string;
  reason?: string | null;
}): Promise<void> {
  if (params.workflow === 'lead_reassignment') return;

  const ctx = await loadEntityNotifyCtx(params.workflow, params.entityId);
  if (!ctx || !ctx.requesterUserId) return;

  await dispatchNotificationToUser({
    eventKey: getApprovalEventKey(params.workflow, 'rejected'),
    userId: ctx.requesterUserId,
    subCompanyId: params.subCompanyId,
    context: {
      entityLabel: ctx.label,
      reason: params.reason?.trim() ?? '',
      reasonSuffix: params.reason?.trim() ? ` Reason: ${params.reason.trim()}` : '',
    },
    link: ctx.link,
    relatedId: params.entityId,
  });
}

/** After final approve — notify requester (workflows without dedicated approve handlers). */
export async function notifyRequesterAfterApprove(params: {
  workflow: ApprovalWorkflowType;
  entityId: string;
  subCompanyId: string;
}): Promise<void> {
  const skip: ApprovalWorkflowType[] = [
    'lead_request',
    'client_manual_add',
    'client_manual_edit',
    'lead_reassignment',
  ];
  if (skip.includes(params.workflow)) return;

  const ctx = await loadEntityNotifyCtx(params.workflow, params.entityId);
  if (!ctx || !ctx.requesterUserId) return;

  await dispatchNotificationToUser({
    eventKey: getApprovalEventKey(params.workflow, 'approved'),
    userId: ctx.requesterUserId,
    subCompanyId: params.subCompanyId,
    context: { entityLabel: ctx.label },
    link: ctx.link,
    relatedId: params.entityId,
  });
}

export {
  loadEntityNotifyCtx,
  forwardNotificationType,
  submitNotificationType,
  rejectNotificationType,
};
