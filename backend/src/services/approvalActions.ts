import type { ApprovalActorMode, ApprovalWorkflowType } from '@prisma/client';
import prisma from '../config/database';
import {
  buildApprovalChain,
  getCurrentTargetRole,
  getNextRoleInChain,
  initialStepIndexForSubmitter,
  isAtFinalApprovalStep,
  logApprovalStep,
  resolveUserApprovalOptions,
  enrichEntityChainState,
} from './approvalChain';
import { getCapabilityMapForRoleKey } from './approvalPolicy';
import { getUserIdsForRoleKeyInAgency, getUserIdsForRoleKeyOrgWide } from './accessContext';
import { dispatchNotification } from './notificationDispatch';
import { getApprovalEventKey } from './notificationRegistry';
import {
  loadEntityNotifyCtx,
  notifyRequesterAfterApprove,
} from './approvalNotifications';
import { userFacingApprovalError } from './approvalMessages';
import type { ApprovalEntityRef } from '../types/approval';
import {
  WORKFLOW_FINAL_PERMISSION,
  WORKFLOW_FINAL_PERMISSION_FALLBACK,
  GLOBAL_APPROVAL_SCOPE,
  isDatabaseWorkflow,
} from '../types/approval';
import { executePendingSubmissionApproval, executePendingEditApproval } from './clientApprovalExecutor';
import { approvePendingImportAsNew } from './pendingImportApproval';
import { notifyImportUploadersOfApproval } from './pendingImportApprovalNotify';
import { approvePendingContactImport } from './pendingContactImportApproval';
import { defaultLockDays } from './clientVisibilityPolicy';

export type ApprovalActionResult =
  | { ok: true; action: 'forward' | 'approve' | 'reject'; data?: unknown }
  | { ok: false; error: string; status: number };

const ENTITY_TABLE: Record<ApprovalWorkflowType, string> = {
  client_manual_add: 'pending_client_submissions',
  client_manual_edit: 'pending_client_edits',
  client_import: 'pending_imported_clients',
  contact_import: 'pending_imported_contacts',
  database_client_add: 'pending_client_submissions',
  database_client_import: 'pending_imported_clients',
  database_contact_import: 'pending_imported_contacts',
  lead_request: 'lead_requests',
  lead_extension: 'lead_extension_requests',
  lead_reassignment: 'lead_reassignment_requests',
  proposal_review: 'proposals',
  proposal_extension: 'proposal_extension_requests',
  employee_add: 'employees',
  employee_assignment: 'employee_assignments',
};

async function loadEntityRef(
  workflow: ApprovalWorkflowType,
  entityId: string,
  subCompanyId: string,
): Promise<ApprovalEntityRef | null> {
  switch (workflow) {
    case 'client_manual_add':
    case 'database_client_add': {
      const row = await prisma.pendingClientSubmission.findFirst({
        where: isDatabaseWorkflow(workflow)
          ? { id: entityId, submissionSource: 'global_database' }
          : { id: entityId, subCompanyId },
      });
      if (!row) return null;
      const scopeId = row.subCompanyId ?? GLOBAL_APPROVAL_SCOPE;
      const submitterRole = row.submitterRole ?? (await prisma.user.findUnique({ where: { id: row.submittedById }, select: { role: true } }))?.role ?? 'sales_associate';
      const built = await buildApprovalChain(submitterRole, workflow, scopeId);
      const { chain, currentStepIndex } = enrichEntityChainState(row, built);
      return {
        workflow,
        entityType: ENTITY_TABLE[workflow],
        entityId: row.id,
        subCompanyId: scopeId,
        submitterRoleKey: submitterRole,
        submitterUserId: row.submittedById,
        chain,
        currentStepIndex,
      };
    }
    case 'client_manual_edit': {
      const row = await prisma.pendingClientEdit.findFirst({
        where: { id: entityId, subCompanyId },
      });
      if (!row) return null;
      const submitterRole = row.submitterRole ?? (await prisma.user.findUnique({ where: { id: row.submittedById }, select: { role: true } }))?.role ?? 'sales_associate';
      const built = await buildApprovalChain(submitterRole, workflow, subCompanyId);
      const { chain, currentStepIndex } = enrichEntityChainState(row, built);
      return {
        workflow,
        entityType: ENTITY_TABLE[workflow],
        entityId: row.id,
        subCompanyId,
        submitterRoleKey: submitterRole,
        submitterUserId: row.submittedById,
        chain,
        currentStepIndex,
      };
    }
    case 'client_import':
    case 'database_client_import': {
      const row = await prisma.pendingImportedClient.findFirst({
        where: isDatabaseWorkflow(workflow)
          ? { id: entityId, submissionSource: 'global_database' }
          : { id: entityId, subCompanyId },
      });
      if (!row) return null;
      const scopeId = row.subCompanyId ?? GLOBAL_APPROVAL_SCOPE;
      const importer = await prisma.user.findUnique({ where: { id: row.importedById }, select: { role: true } });
      const submitterRole = importer?.role ?? 'sales_associate';
      const built = await buildApprovalChain(submitterRole, workflow, scopeId);
      const { chain, currentStepIndex } = enrichEntityChainState(row, built);
      return {
        workflow,
        entityType: ENTITY_TABLE[workflow],
        entityId: row.id,
        subCompanyId: scopeId,
        submitterRoleKey: submitterRole,
        submitterUserId: row.importedById,
        chain,
        currentStepIndex,
      };
    }
    case 'contact_import':
    case 'database_contact_import': {
      const row = await prisma.pendingImportedContact.findFirst({
        where: isDatabaseWorkflow(workflow)
          ? { id: entityId, submissionSource: 'global_database' }
          : { id: entityId, subCompanyId },
      });
      if (!row) return null;
      const scopeId = row.subCompanyId ?? GLOBAL_APPROVAL_SCOPE;
      const importer = await prisma.user.findUnique({ where: { id: row.importedById }, select: { role: true } });
      const submitterRole = importer?.role ?? 'sales_associate';
      const built = await buildApprovalChain(submitterRole, workflow, scopeId);
      const { chain, currentStepIndex } = enrichEntityChainState(row, built);
      return {
        workflow,
        entityType: ENTITY_TABLE[workflow],
        entityId: row.id,
        subCompanyId: scopeId,
        submitterRoleKey: submitterRole,
        submitterUserId: row.importedById,
        chain,
        currentStepIndex,
      };
    }
    case 'lead_request': {
      const row = await prisma.leadRequest.findFirst({
        where: { id: entityId, subCompanyId, status: 'pending' },
      });
      if (!row) return null;
      const requester = await prisma.user.findUnique({ where: { id: row.requestedById }, select: { role: true } });
      const submitterRole = requester?.role ?? 'sales_associate';
      const built = await buildApprovalChain(submitterRole, workflow, subCompanyId);
      const { chain, currentStepIndex } = enrichEntityChainState(row, built);
      return {
        workflow,
        entityType: ENTITY_TABLE[workflow],
        entityId: row.id,
        subCompanyId,
        submitterRoleKey: submitterRole,
        submitterUserId: row.requestedById,
        chain,
        currentStepIndex,
      };
    }
    case 'lead_extension': {
      const row = await prisma.leadExtensionRequest.findFirst({
        where: { id: entityId, status: 'pending', lead: { subCompanyId } },
        include: { lead: { select: { subCompanyId: true } } },
      });
      if (!row || row.lead.subCompanyId !== subCompanyId) return null;
      const requester = await prisma.user.findUnique({ where: { id: row.requestedById }, select: { role: true } });
      const submitterRole = requester?.role ?? 'sales_associate';
      const built = await buildApprovalChain(submitterRole, workflow, subCompanyId);
      const { chain, currentStepIndex } = enrichEntityChainState(row, built);
      return {
        workflow,
        entityType: ENTITY_TABLE[workflow],
        entityId: row.id,
        subCompanyId,
        submitterRoleKey: submitterRole,
        submitterUserId: row.requestedById,
        chain,
        currentStepIndex,
      };
    }
    case 'lead_reassignment': {
      const row = await prisma.leadReassignmentRequest.findFirst({
        where: { id: entityId, subCompanyId, status: 'pending' },
      });
      if (!row) return null;
      const requester = await prisma.user.findUnique({ where: { id: row.requestedById }, select: { role: true } });
      const submitterRole = requester?.role ?? 'sales_associate';
      const built = await buildApprovalChain(submitterRole, workflow, subCompanyId);
      const { chain, currentStepIndex } = enrichEntityChainState(row, built);
      return {
        workflow,
        entityType: ENTITY_TABLE[workflow],
        entityId: row.id,
        subCompanyId,
        submitterRoleKey: submitterRole,
        submitterUserId: row.requestedById,
        chain,
        currentStepIndex,
      };
    }
    case 'proposal_review': {
      const row = await prisma.proposal.findFirst({
        where: { id: entityId, status: 'pending', lead: { subCompanyId } },
        include: { lead: { select: { subCompanyId: true } } },
      });
      if (!row || row.lead.subCompanyId !== subCompanyId) return null;
      const creator = row.createdById
        ? await prisma.user.findUnique({ where: { id: row.createdById }, select: { role: true } })
        : null;
      const submitterRole = creator?.role ?? 'sales_associate';
      const built = await buildApprovalChain(submitterRole, workflow, subCompanyId);
      const { chain, currentStepIndex } = enrichEntityChainState(row, built);
      return {
        workflow,
        entityType: ENTITY_TABLE[workflow],
        entityId: row.id,
        subCompanyId,
        submitterRoleKey: submitterRole,
        submitterUserId: row.createdById ?? row.reviewRequestedById ?? '',
        chain,
        currentStepIndex,
      };
    }
    case 'proposal_extension': {
      const row = await prisma.proposalExtensionRequest.findFirst({
        where: { id: entityId, status: 'pending', proposal: { lead: { subCompanyId } } },
        include: { proposal: { include: { lead: { select: { subCompanyId: true } } } } },
      });
      if (!row || row.proposal.lead.subCompanyId !== subCompanyId) return null;
      const requester = await prisma.user.findUnique({ where: { id: row.requestedById }, select: { role: true } });
      const submitterRole = requester?.role ?? 'sales_associate';
      const built = await buildApprovalChain(submitterRole, workflow, subCompanyId);
      const { chain, currentStepIndex } = enrichEntityChainState(row, built);
      return {
        workflow,
        entityType: ENTITY_TABLE[workflow],
        entityId: row.id,
        subCompanyId,
        submitterRoleKey: submitterRole,
        submitterUserId: row.requestedById,
        chain,
        currentStepIndex,
      };
    }
    case 'employee_add': {
      const row = await prisma.employee.findFirst({
        where: { id: entityId, approvalStatus: 'pending' },
        include: { addedBy: { select: { role: true, subCompanyId: true } } },
      });
      if (!row || row.addedBy.subCompanyId !== subCompanyId) return null;
      const submitterRole = row.submitterRole ?? row.addedBy.role ?? 'recruiter';
      const built = await buildApprovalChain(submitterRole, workflow, subCompanyId);
      const { chain, currentStepIndex } = enrichEntityChainState(row, built);
      return {
        workflow,
        entityType: ENTITY_TABLE[workflow],
        entityId: row.id,
        subCompanyId,
        submitterRoleKey: submitterRole,
        submitterUserId: row.addedById,
        chain,
        currentStepIndex,
      };
    }
    case 'employee_assignment': {
      const row = await prisma.employeeAssignment.findFirst({
        where: { id: entityId, status: 'pending' },
        include: {
          employee: { select: { addedBy: { select: { subCompanyId: true } } } },
        },
      });
      if (!row || row.employee.addedBy.subCompanyId !== subCompanyId) return null;
      const submitterRole =
        row.submitterRole ??
        (await prisma.user.findUnique({ where: { id: row.submittedById }, select: { role: true } }))
          ?.role ??
        'recruiter';
      const built = await buildApprovalChain(submitterRole, workflow, subCompanyId);
      const { chain, currentStepIndex } = enrichEntityChainState(row, built);
      return {
        workflow,
        entityType: ENTITY_TABLE[workflow],
        entityId: row.id,
        subCompanyId,
        submitterRoleKey: submitterRole,
        submitterUserId: row.submittedById,
        chain,
        currentStepIndex,
      };
    }
    default:
      return null;
  }
}

async function persistChainAdvance(
  workflow: ApprovalWorkflowType,
  entityId: string,
  chain: string[],
  newStepIndex: number,
  actorUserId: string,
  isForward: boolean,
): Promise<void> {
  const chainJson = chain as unknown as import('@prisma/client').Prisma.InputJsonValue;
  const data = { approvalChain: chainJson, currentStepIndex: newStepIndex };

  if (workflow === 'client_manual_add' || workflow === 'database_client_add') {
    await prisma.pendingClientSubmission.update({
      where: { id: entityId },
      data: {
        ...data,
        ...(isForward && newStepIndex === 1
          ? { managerApprovedAt: new Date(), managerApprovedById: actorUserId }
          : {}),
      },
    });
    return;
  }
  if (workflow === 'client_manual_edit') {
    await prisma.pendingClientEdit.update({
      where: { id: entityId },
      data: {
        ...data,
        ...(isForward && newStepIndex === 1
          ? { managerApprovedAt: new Date(), managerApprovedById: actorUserId }
          : {}),
      },
    });
    return;
  }
  if (workflow === 'client_import' || workflow === 'database_client_import') {
    await prisma.pendingImportedClient.update({ where: { id: entityId }, data });
    return;
  }
  if (workflow === 'contact_import' || workflow === 'database_contact_import') {
    await prisma.pendingImportedContact.update({ where: { id: entityId }, data });
    return;
  }
  if (workflow === 'lead_request') {
    await prisma.leadRequest.update({ where: { id: entityId }, data });
    return;
  }
  if (workflow === 'lead_extension') {
    await prisma.leadExtensionRequest.update({ where: { id: entityId }, data });
    return;
  }
  if (workflow === 'lead_reassignment') {
    await prisma.leadReassignmentRequest.update({ where: { id: entityId }, data });
    return;
  }
  if (workflow === 'proposal_review') {
    await prisma.proposal.update({ where: { id: entityId }, data });
    return;
  }
  if (workflow === 'proposal_extension') {
    await prisma.proposalExtensionRequest.update({ where: { id: entityId }, data });
    return;
  }
  if (workflow === 'employee_add') {
    await prisma.employee.update({ where: { id: entityId }, data });
    return;
  }
  if (workflow === 'employee_assignment') {
    await prisma.employeeAssignment.update({ where: { id: entityId }, data });
  }
}

async function executeFinalApproval(
  workflow: ApprovalWorkflowType,
  entityId: string,
  subCompanyId: string,
  approverUserId: string,
  _remarks?: string,
): Promise<ApprovalActionResult> {
  switch (workflow) {
    case 'client_manual_add':
    case 'database_client_add': {
      const result = await executePendingSubmissionApproval({
        pendingId: entityId,
        subCompanyId: subCompanyId === GLOBAL_APPROVAL_SCOPE ? null : subCompanyId,
        approverUserId,
      });
      if (!result.ok) return { ok: false, error: result.error ?? 'Failed', status: result.error === 'Not found' ? 404 : 500 };
      return { ok: true, action: 'approve', data: result.client };
    }
    case 'client_manual_edit': {
      const result = await executePendingEditApproval({
        pendingEditId: entityId,
        subCompanyId,
        approverUserId,
      });
      if (!result.ok) return { ok: false, error: result.error ?? 'Failed', status: result.error === 'Not found' ? 404 : 500 };
      return { ok: true, action: 'approve', data: result.client };
    }
    case 'client_import':
    case 'database_client_import': {
      const pending = await prisma.pendingImportedClient.findFirst({
        where: isDatabaseWorkflow(workflow)
          ? { id: entityId, submissionSource: 'global_database' }
          : { id: entityId, subCompanyId },
        include: { importedBy: { select: { role: true } } },
      });
      if (!pending) return { ok: false, error: 'Not found', status: 404 };
      if (isDatabaseWorkflow(workflow)) {
        const { executeGlobalPendingImportApproval } = await import('./pendingImportApproval');
        const row = await executeGlobalPendingImportApproval({
          pendingId: entityId,
          approverUserId,
        });
        if (!row) return { ok: false, error: 'Failed', status: 500 };
        await notifyImportUploadersOfApproval({
          subCompanyId: pending.subCompanyId ?? subCompanyId,
          actorUserId: approverUserId,
          groups: [
            {
              importedById: pending.importedById,
              count: 1,
              sampleName: pending.name,
              clientId: row.clientId,
            },
          ],
        });
        return { ok: true, action: 'approve', data: row };
      }
      const visibilitySetting = await prisma.clientVisibilitySetting.findUnique({
        where: { subCompanyId },
        select: { days: true },
      });
      const lockDays = defaultLockDays(visibilitySetting?.days);
      const row = await prisma.$transaction((tx) =>
        approvePendingImportAsNew(tx, { pending, subCompanyId, lockDays, codeSuffix: '0' }),
      );
      await notifyImportUploadersOfApproval({
        subCompanyId,
        actorUserId: approverUserId,
        groups: [
          {
            importedById: pending.importedById,
            count: 1,
            sampleName: pending.name,
            clientId: row.clientId,
          },
        ],
      });
      return { ok: true, action: 'approve', data: row };
    }
    case 'contact_import':
    case 'database_contact_import': {
      const pending = await prisma.pendingImportedContact.findFirst({
        where: isDatabaseWorkflow(workflow)
          ? { id: entityId, submissionSource: 'global_database' }
          : { id: entityId, subCompanyId },
      });
      if (!pending) return { ok: false, error: 'Not found', status: 404 };
      const row = await prisma.$transaction((tx) => approvePendingContactImport(tx, pending));
      return { ok: true, action: 'approve', data: row };
    }
    case 'lead_request': {
      const { executeLeadRequestApproval } = await import('./leadRequestApproval');
      const result = await executeLeadRequestApproval(entityId, approverUserId, _remarks);
      if (!result.ok) return { ok: false, error: result.error, status: 400 };
      return { ok: true, action: 'approve' };
    }
    case 'lead_extension': {
      const row = await prisma.leadExtensionRequest.findUnique({
        where: { id: entityId },
        include: { lead: { select: { leadDeadline: true } } },
      });
      if (!row || row.status !== 'pending') return { ok: false, error: 'Not found', status: 404 };
      const now = new Date();
      const base =
        row.lead.leadDeadline && row.lead.leadDeadline.getTime() > now.getTime()
          ? row.lead.leadDeadline
          : now;
      await prisma.$transaction(async (tx) => {
        await tx.leadExtensionRequest.update({
          where: { id: entityId },
          data: {
            status: 'approved',
            reviewedAt: now,
            reviewedById: approverUserId,
            managerRemarks: _remarks ?? null,
          },
        });
        await tx.lead.update({
          where: { id: row.leadId },
          data: {
            extensionStatus: 'approved',
            extensionReviewedAt: now,
            leadDeadline: new Date(base.getTime() + row.requestedDays * 24 * 60 * 60 * 1000),
          },
        });
      });
      return { ok: true, action: 'approve' };
    }
    case 'proposal_review': {
      const updated = await prisma.proposal.updateMany({
        where: { id: entityId, status: 'pending' },
        data: {
          status: 'approved',
          reviewedById: approverUserId,
          reviewedAt: new Date(),
        },
      });
      if (updated.count === 0) return { ok: false, error: 'Not found', status: 404 };
      return { ok: true, action: 'approve' };
    }
    case 'proposal_extension': {
      const ext = await prisma.proposalExtensionRequest.findUnique({
        where: { id: entityId },
        include: { proposal: { select: { awaitingClientDueAt: true } } },
      });
      if (!ext || ext.status !== 'pending') return { ok: false, error: 'Not found', status: 404 };
      const now = new Date();
      const base =
        ext.proposal.awaitingClientDueAt && ext.proposal.awaitingClientDueAt > now
          ? ext.proposal.awaitingClientDueAt
          : now;
      await prisma.$transaction(async (tx) => {
        await tx.proposalExtensionRequest.update({
          where: { id: entityId },
          data: {
            status: 'approved',
            reviewedById: approverUserId,
            reviewedAt: now,
            reviewComment: _remarks ?? null,
          },
        });
        await tx.proposal.update({
          where: { id: ext.proposalId },
          data: {
            awaitingClientDueAt: new Date(base.getTime() + ext.requestedDays * 24 * 60 * 60 * 1000),
          },
        });
      });
      return { ok: true, action: 'approve' };
    }
    case 'lead_reassignment': {
      const { approveReassignmentRequest } = await import('./leadReassignment');
      try {
        await approveReassignmentRequest(entityId, approverUserId);
        return { ok: true, action: 'approve' };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed';
        const status = (err as { statusCode?: number }).statusCode ?? 400;
        return { ok: false, error: message, status };
      }
    }
    case 'employee_add': {
      const { finalizeEmployeeAddApproval } = await import('./employeeApproval');
      const result = await finalizeEmployeeAddApproval(entityId, [subCompanyId], approverUserId);
      if (!result.ok) return { ok: false, error: result.error, status: result.status };
      return { ok: true, action: 'approve' };
    }
    case 'employee_assignment': {
      const { finalizeEmployeeAssignmentApproval } = await import('./employeeAssignments');
      const result = await finalizeEmployeeAssignmentApproval(
        entityId,
        [subCompanyId],
        approverUserId,
      );
      if (!result.ok) return { ok: false, error: result.error, status: result.status };
      return { ok: true, action: 'approve' };
    }
    default:
      return { ok: false, error: 'Unsupported workflow', status: 400 };
  }
}

export async function performApprovalAction(params: {
  workflow: ApprovalWorkflowType;
  entityId: string;
  subCompanyId: string;
  actorUserId: string;
  actorRoleKey: string;
  actorPermissions: string[];
  action: 'forward' | 'approve' | 'reject';
  remarks?: string;
}): Promise<ApprovalActionResult> {
  const entity = await loadEntityRef(params.workflow, params.entityId, params.subCompanyId);
  if (!entity) return { ok: false, error: 'Not found', status: 404 };

  const options = await resolveUserApprovalOptions(
    params.actorRoleKey,
    params.actorPermissions,
    entity,
  );
  if (params.action === 'reject') {
    if (!options.canReject) {
      return { ok: false, error: 'Not authorized for this approval step', status: 403 };
    }
  } else if (options.allowedAction !== params.action) {
    return { ok: false, error: 'Not authorized for this approval step', status: 403 };
  }

  const targetRole = getCurrentTargetRole(entity);
  if (!targetRole) return { ok: false, error: 'No pending approval step', status: 400 };

  const actorIndex = entity.chain.indexOf(params.actorRoleKey);

  if (params.action === 'forward') {
    const newIndex = entity.currentStepIndex + 1;
    await persistChainAdvance(params.workflow, params.entityId, entity.chain, newIndex, params.actorUserId, true);
    await logApprovalStep({
      workflow: params.workflow,
      entityType: entity.entityType,
      entityId: params.entityId,
      stepIndex: entity.currentStepIndex,
      targetRoleKey: targetRole,
      actorUserId: params.actorUserId,
      actorRoleKey: params.actorRoleKey,
      action: 'forward',
      remarks: params.remarks,
    });
    await notifyAfterApprovalForward({
      workflow: params.workflow,
      entityId: params.entityId,
      subCompanyId: params.subCompanyId,
      chain: entity.chain,
      newStepIndex: newIndex,
    });
    return { ok: true, action: 'forward', data: { currentStepIndex: newIndex, chain: entity.chain } };
  }

  if (params.action === 'approve') {
    const isDirect = options.isDirectApproval;
    const isLast = entity.currentStepIndex >= entity.chain.length - 1 || entity.chain.length <= 1;
    if (!isLast && !isDirect) {
      return { ok: false, error: 'Intermediate step requires forward, not final approve', status: 400 };
    }

    if (isDirect) {
      await logApprovalStep({
        workflow: params.workflow,
        entityType: entity.entityType,
        entityId: params.entityId,
        stepIndex: actorIndex >= 0 ? actorIndex : entity.chain.length,
        targetRoleKey: params.actorRoleKey,
        actorUserId: params.actorUserId,
        actorRoleKey: params.actorRoleKey,
        action: 'direct_approve',
        remarks: params.remarks ?? null,
      });
    } else {
      await logApprovalStep({
        workflow: params.workflow,
        entityType: entity.entityType,
        entityId: params.entityId,
        stepIndex: entity.currentStepIndex,
        targetRoleKey: targetRole,
        actorUserId: params.actorUserId,
        actorRoleKey: params.actorRoleKey,
        action: 'approve',
        remarks: params.remarks,
      });
    }
    const finalResult = await executeFinalApproval(
      params.workflow,
      params.entityId,
      params.subCompanyId,
      params.actorUserId,
      params.remarks,
    );
    if (finalResult.ok && params.workflow === 'lead_request') {
      const { completeLeadRequestApprovalOutcome } = await import('./leadRequestApproval');
      await completeLeadRequestApprovalOutcome({
        requestId: params.entityId,
        actorUserId: params.actorUserId,
        remarks: params.remarks,
      }).catch((err) => console.error('Lead request approval notifications failed', err));
    } else if (finalResult.ok) {
      await notifyRequesterAfterApprove({
        workflow: params.workflow,
        entityId: params.entityId,
        subCompanyId: params.subCompanyId,
      }).catch((err) => console.error('Approval outcome notification failed', err));
    }
    return finalResult;
  }

  // reject
  await logApprovalStep({
    workflow: params.workflow,
    entityType: entity.entityType,
    entityId: params.entityId,
    stepIndex: actorIndex >= 0 ? actorIndex : entity.currentStepIndex,
    targetRoleKey: params.actorRoleKey,
    actorUserId: params.actorUserId,
    actorRoleKey: params.actorRoleKey,
    action: 'reject',
    remarks: params.remarks,
  });

  const rejectNotifyCtx = await loadEntityNotifyCtx(params.workflow, params.entityId);

  switch (params.workflow) {
    case 'client_manual_add':
    case 'database_client_add':
      await prisma.pendingClientSubmission.delete({ where: { id: params.entityId } });
      break;
    case 'client_manual_edit':
      await prisma.pendingClientEdit.delete({ where: { id: params.entityId } });
      break;
    case 'client_import':
    case 'database_client_import':
      await prisma.pendingImportedClient.delete({ where: { id: params.entityId } });
      break;
    case 'contact_import':
    case 'database_contact_import':
      await prisma.pendingImportedContact.delete({ where: { id: params.entityId } });
      break;
    case 'lead_request': {
      const lr = await prisma.leadRequest.update({
        where: { id: params.entityId },
        data: { status: 'rejected', reviewedById: params.actorUserId, reviewedAt: new Date() },
        select: { requestedById: true, subCompanyId: true },
      });
      if (params.remarks?.trim()) {
        const actor = await prisma.user.findUnique({
          where: { id: params.actorUserId },
          select: { firstName: true, lastName: true, email: true },
        });
        const actorName =
          `${actor?.firstName ?? ''} ${actor?.lastName ?? ''}`.trim() || actor?.email || 'Reviewer';
        await prisma.leadRequestComment.create({
          data: {
            requestId: params.entityId,
            userId: params.actorUserId,
            userName: actorName,
            text: params.remarks.trim(),
          },
        });
      }
      const { emitToUsers } = await import('../socket');
      emitToUsers([lr.requestedById], 'lead:refresh', { subCompanyId: lr.subCompanyId });
      break;
    }
    case 'lead_extension': {
      const now = new Date();
      const extRow = await prisma.leadExtensionRequest.update({
        where: { id: params.entityId },
        data: {
          status: 'rejected',
          reviewedById: params.actorUserId,
          reviewedAt: now,
          managerRemarks: params.remarks ?? null,
        },
        select: { leadId: true },
      });
      await prisma.lead.update({
        where: { id: extRow.leadId },
        data: {
          extensionStatus: 'rejected',
          extensionReviewedAt: now,
          reviewedBy: params.actorUserId,
          managerRemarks: params.remarks ?? null,
        },
      });
      break;
    }
    case 'lead_reassignment': {
      const { rejectReassignmentRequest } = await import('./leadReassignment');
      await rejectReassignmentRequest(params.entityId, params.actorUserId);
      break;
    }
    case 'proposal_review':
      await prisma.proposal.update({
        where: { id: params.entityId },
        data: {
          status: 'rejected',
          rejectionComment: params.remarks ?? null,
          reviewedById: params.actorUserId,
          reviewedAt: new Date(),
        },
      });
      break;
    case 'proposal_extension': {
      const now = new Date();
      const extRow = await prisma.proposalExtensionRequest.update({
        where: { id: params.entityId },
        data: {
          status: 'rejected',
          reviewedById: params.actorUserId,
          reviewedAt: now,
          reviewComment: params.remarks ?? null,
        },
        select: { proposalId: true },
      });
      await prisma.proposal.update({
        where: { id: extRow.proposalId },
        data: { awaitingClientReason: params.remarks ?? null },
      });
      break;
    }
    case 'employee_add': {
      const { finalizeEmployeeAddRejection } = await import('./employeeApproval');
      await finalizeEmployeeAddRejection(
        params.entityId,
        [params.subCompanyId],
        params.actorUserId,
        params.remarks,
      );
      break;
    }
    case 'employee_assignment': {
      const { finalizeEmployeeAssignmentRejection } = await import('./employeeAssignments');
      await finalizeEmployeeAssignmentRejection(
        params.entityId,
        [params.subCompanyId],
        params.actorUserId,
        params.remarks,
      );
      break;
    }
  }

  if (rejectNotifyCtx?.requesterUserId) {
    if (params.workflow !== 'lead_reassignment') {
      await dispatchNotification({
        eventKey: getApprovalEventKey(params.workflow, 'rejected'),
        userIds: [rejectNotifyCtx.requesterUserId],
        subCompanyId: params.subCompanyId,
        context: {
          entityLabel: rejectNotifyCtx.label,
          reason: params.remarks?.trim() ?? '',
          reasonSuffix: params.remarks?.trim() ? ` Reason: ${params.remarks.trim()}` : '',
        },
        link: rejectNotifyCtx.link,
        relatedId: params.entityId,
      }).catch((err) => console.error('Reject notification failed', err));
    }
  }

  return { ok: true, action: 'reject' };
}

export async function getApprovalStatusForEntity(
  workflow: ApprovalWorkflowType,
  entityId: string,
  subCompanyId: string,
  actorRoleKey: string,
  actorPermissions: string[],
): Promise<{
  chain: string[];
  currentStepIndex: number;
  targetRoleKey: string | null;
  nextRoleKey: string | null;
  isFinalStep: boolean;
  totalSteps: number;
  allowedAction: 'forward' | 'approve' | 'reject' | null;
  isDirectApproval: boolean;
  canReject: boolean;
  skippedRoleKeys: string[];
  history: Awaited<ReturnType<typeof import('./approvalChain').getApprovalHistory>>;
} | null> {
  const entity = await loadEntityRef(workflow, entityId, subCompanyId);
  if (!entity) return null;
  const { getApprovalHistory } = await import('./approvalChain');
  const options = await resolveUserApprovalOptions(actorRoleKey, actorPermissions, entity);
  return {
    chain: entity.chain,
    currentStepIndex: entity.currentStepIndex,
    targetRoleKey: getCurrentTargetRole(entity),
    nextRoleKey: getNextRoleInChain(entity),
    isFinalStep: isAtFinalApprovalStep(entity),
    totalSteps: entity.chain.length,
    allowedAction: options.allowedAction,
    isDirectApproval: options.isDirectApproval,
    canReject: options.canReject,
    skippedRoleKeys: options.skippedRoleKeys,
    history: await getApprovalHistory(entity.entityType, entityId),
  };
}

function roleCanFinalApprove(mode: ApprovalActorMode): boolean {
  return mode === 'final_only' || mode === 'forward_final';
}

function submitterCanSelfFinalize(
  workflow: ApprovalWorkflowType,
  mode: ApprovalActorMode,
  permissions: string[],
): boolean {
  if (!roleCanFinalApprove(mode)) return false;
  const finalPerm = WORKFLOW_FINAL_PERMISSION[workflow];
  const fallback = WORKFLOW_FINAL_PERMISSION_FALLBACK[workflow];
  if (permissions.includes(finalPerm)) return true;
  if (fallback && permissions.includes(fallback)) return true;
  return false;
}

/**
 * Initialize chain on create; auto-apply when agency bypass or submitter can self-finalize.
 */
/** Notify the next role in the chain after a forward action. */
async function notifyAfterApprovalForward(params: {
  workflow: ApprovalWorkflowType;
  entityId: string;
  subCompanyId: string;
  chain: string[];
  newStepIndex: number;
}): Promise<void> {
  const targetRoleKey = params.chain[params.newStepIndex] ?? null;
  if (!targetRoleKey) return;

  const ctx = await loadEntityNotifyCtx(params.workflow, params.entityId);
  if (!ctx) return;

  await notifyChainTargetUsers({
    subCompanyId: params.subCompanyId,
    targetRoleKey,
    eventKey: getApprovalEventKey(params.workflow, 'forward'),
    context: {
      entityLabel: ctx.label,
      actorName: ctx.submitterName,
    },
    link: ctx.link,
    relatedId: params.entityId,
  });
}

/** Notify users in the chain's current target role. */
export async function notifyChainTargetUsers(params: {
  subCompanyId: string;
  targetRoleKey: string | null;
  eventKey: string;
  context: Record<string, string>;
  link: string;
  relatedId: string;
  alsoNotifyUserIds?: string[];
}): Promise<string[]> {
  const ids = params.targetRoleKey
    ? params.subCompanyId === GLOBAL_APPROVAL_SCOPE
      ? await getUserIdsForRoleKeyOrgWide(params.targetRoleKey)
      : await getUserIdsForRoleKeyInAgency(params.subCompanyId, params.targetRoleKey)
    : [];
  const all = [...new Set([...ids, ...(params.alsoNotifyUserIds ?? [])])];
  if (all.length === 0) return [];
  const notifySubCompanyId =
    params.subCompanyId === GLOBAL_APPROVAL_SCOPE
      ? (await prisma.subCompany.findFirst({ select: { id: true }, orderBy: { name: 'asc' } }))?.id ?? params.subCompanyId
      : params.subCompanyId;
  await dispatchNotification({
    eventKey: params.eventKey,
    userIds: all,
    subCompanyId: notifySubCompanyId,
    context: params.context,
    link: params.link,
    relatedId: params.relatedId,
  });
  return all;
}

/** One approver alert per CSV upload batch (not per imported row). */
export async function notifyPendingImportBatchApproval(params: {
  subCompanyId: string;
  targetRoleKey: string;
  actorName: string;
  pendingCount: number;
  link: string;
  relatedId: string;
}): Promise<string[]> {
  if (params.pendingCount <= 0) return [];
  return notifyChainTargetUsers({
    subCompanyId: params.subCompanyId,
    targetRoleKey: params.targetRoleKey,
    eventKey: 'client_import_pending_alert',
    context: { actorName: params.actorName },
    link: params.link,
    relatedId: params.relatedId,
  });
}

/** Authorize an approval action without executing side effects (for legacy routes with extra business logic). */
export async function authorizeApprovalAction(params: {
  workflow: ApprovalWorkflowType;
  entityId: string;
  subCompanyId: string;
  actorRoleKey: string;
  actorPermissions: string[];
  action: 'forward' | 'approve' | 'reject';
}): Promise<
  | { ok: true; entity: ApprovalEntityRef; targetRoleKey: string | null }
  | { ok: false; error: string; status: number }
> {
  const entity = await loadEntityRef(params.workflow, params.entityId, params.subCompanyId);
  if (!entity) return { ok: false, error: 'Not found', status: 404 };
  const options = await resolveUserApprovalOptions(params.actorRoleKey, params.actorPermissions, entity);
  if (params.action === 'reject') {
    if (!options.canReject) {
      return { ok: false, error: 'Not authorized for this approval step', status: 403 };
    }
  } else if (options.allowedAction !== params.action) {
    return { ok: false, error: 'Not authorized for this approval step', status: 403 };
  }
  return { ok: true, entity, targetRoleKey: getCurrentTargetRole(entity) };
}

export async function submitEntityForApproval(params: {
  workflow: ApprovalWorkflowType;
  entityId: string;
  subCompanyId: string;
  submitterUserId: string;
  submitterRoleKey: string;
  submitterPermissions: string[];
}): Promise<{
  chain: string[];
  autoApproved: boolean;
  targetRoleKey: string | null;
  misconfigured?: boolean;
}> {
  const { chain, bypassed, misconfigured } = await initializeEntityApprovalChain({
    workflow: params.workflow,
    entityId: params.entityId,
    subCompanyId: params.subCompanyId,
    submitterRoleKey: params.submitterRoleKey,
  });

  if (misconfigured) {
    return { chain, autoApproved: false, targetRoleKey: null, misconfigured: true };
  }

  const cap = await getCapabilityMapForRoleKey(params.submitterRoleKey);
  const submitterMode = cap.get(params.workflow) ?? 'none';
  const shouldAutoApprove =
    bypassed || submitterCanSelfFinalize(params.workflow, submitterMode, params.submitterPermissions);

  const initialStep = initialStepIndexForSubmitter(chain, params.submitterRoleKey);
  const initialTarget = chain[initialStep] ?? null;

  if (!shouldAutoApprove) {
    return { chain, autoApproved: false, targetRoleKey: initialTarget };
  }

  const result = await executeFinalApproval(
    params.workflow,
    params.entityId,
    params.subCompanyId,
    params.submitterUserId,
  );
  if (!result.ok) {
    console.error('Auto-approve after empty approval chain failed', result.error);
    return { chain, autoApproved: false, targetRoleKey: initialTarget };
  }
  return { chain, autoApproved: true, targetRoleKey: null };
}

export async function initializeEntityApprovalChain(params: {
  workflow: ApprovalWorkflowType;
  entityId: string;
  subCompanyId: string;
  submitterRoleKey: string;
}): Promise<{ chain: string[]; currentStepIndex: number; bypassed: boolean; misconfigured: boolean }> {
  const { resolveApprovalRouting } = await import('./approvalChain');
  const { chain, bypassed, misconfigured } = await resolveApprovalRouting(
    params.submitterRoleKey,
    params.workflow,
    params.subCompanyId,
  );
  const chainJson = chain as unknown as import('@prisma/client').Prisma.InputJsonValue;
  const currentStepIndex = initialStepIndexForSubmitter(chain, params.submitterRoleKey);
  const data = { approvalChain: chainJson, currentStepIndex };

  if (params.workflow === 'client_manual_add' || params.workflow === 'database_client_add') {
    await prisma.pendingClientSubmission.update({ where: { id: params.entityId }, data });
  } else if (params.workflow === 'client_manual_edit') {
    await prisma.pendingClientEdit.update({ where: { id: params.entityId }, data });
  } else if (params.workflow === 'client_import' || params.workflow === 'database_client_import') {
    await prisma.pendingImportedClient.update({ where: { id: params.entityId }, data });
  } else if (params.workflow === 'contact_import' || params.workflow === 'database_contact_import') {
    await prisma.pendingImportedContact.update({ where: { id: params.entityId }, data });
  } else if (params.workflow === 'lead_request') {
    await prisma.leadRequest.update({ where: { id: params.entityId }, data });
  } else if (params.workflow === 'lead_extension') {
    await prisma.leadExtensionRequest.update({ where: { id: params.entityId }, data });
  } else if (params.workflow === 'lead_reassignment') {
    await prisma.leadReassignmentRequest.update({ where: { id: params.entityId }, data });
  } else if (params.workflow === 'proposal_review') {
    await prisma.proposal.update({ where: { id: params.entityId }, data });
  } else if (params.workflow === 'proposal_extension') {
    await prisma.proposalExtensionRequest.update({ where: { id: params.entityId }, data });
  } else if (params.workflow === 'employee_add') {
    await prisma.employee.update({
      where: { id: params.entityId },
      data: { ...data, submitterRole: params.submitterRoleKey },
    });
  } else if (params.workflow === 'employee_assignment') {
    await prisma.employeeAssignment.update({
      where: { id: params.entityId },
      data: { ...data, submitterRole: params.submitterRoleKey },
    });
  }

  return { chain, currentStepIndex, bypassed, misconfigured };
}

export { loadEntityRef, ENTITY_TABLE, userFacingApprovalError };
