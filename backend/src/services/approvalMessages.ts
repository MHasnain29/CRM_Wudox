import type { ApprovalWorkflowType } from '@prisma/client';
import { WORKFLOW_LABELS } from '../types/approval';

export function formatRoleLabel(roleKey: string): string {
  return roleKey.replace(/_/g, ' ');
}

/** Map technical API errors to user-facing copy. */
export function userFacingApprovalError(
  error: string,
  ctx?: { targetRoleKey?: string | null; nextRoleKey?: string | null },
): string {
  const awaiting = ctx?.targetRoleKey ? formatRoleLabel(ctx.targetRoleKey) : 'the next approver';
  const next = ctx?.nextRoleKey ? formatRoleLabel(ctx.nextRoleKey) : 'the next approver';

  if (error === 'Not authorized for this approval step') {
    return `It is not your turn to act on this item. It is awaiting ${awaiting}. Check Settings → Roles → Approval queues and your permissions.`;
  }
  if (error === 'Intermediate step requires forward, not final approve') {
    return `This step requires Forward, not final approval. Send it to ${next} first.`;
  }
  if (error === 'No pending approval step') {
    return 'This item is no longer waiting for approval.';
  }
  if (error.includes('No approval path configured')) {
    return 'No approval path is configured. Check Settings → Approvals and Settings → Roles.';
  }
  return error;
}

type PersonCtx = { name: string };
type EntityCtx = { label: string };

export function submitNotification(
  workflow: ApprovalWorkflowType,
  submitter: PersonCtx,
  entity: EntityCtx,
): { title: string; body: string } {
  switch (workflow) {
    case 'lead_request':
      return {
        title: 'Lead request — approval needed',
        body: `${submitter.name} requested lead access to "${entity.label}". Your approval is required.`,
      };
    case 'lead_extension':
      return {
        title: 'Lead extension — approval needed',
        body: `${submitter.name} requested a lead extension for "${entity.label}".`,
      };
    case 'lead_reassignment':
      return {
        title: 'Lead reassignment — approval needed',
        body: `${submitter.name} requested a lead reassignment for "${entity.label}".`,
      };
    case 'client_manual_add':
      return {
        title: 'Client submission — approval needed',
        body: `${submitter.name} submitted "${entity.label}" for approval.`,
      };
    case 'client_manual_edit':
      return {
        title: 'Client edit — approval needed',
        body: `${submitter.name} submitted edits for "${entity.label}".`,
      };
    case 'client_import':
      return {
        title: 'Import — approval needed',
        body: `${submitter.name} imported "${entity.label}" for approval.`,
      };
    case 'contact_import':
    case 'database_contact_import':
      return {
        title: 'Contact import — approval needed',
        body: `${submitter.name} imported contacts for "${entity.label}" for approval.`,
      };
    case 'proposal_review':
      return {
        title: 'Proposal — approval needed',
        body: `${submitter.name} submitted a proposal for "${entity.label}".`,
      };
    case 'proposal_extension':
      return {
        title: 'Proposal extension — approval needed',
        body: `${submitter.name} requested a proposal extension for "${entity.label}".`,
      };
    default:
      return {
        title: `${WORKFLOW_LABELS[workflow]} — approval needed`,
        body: `${submitter.name} submitted "${entity.label}" for approval.`,
      };
  }
}

export function forwardNotification(
  workflow: ApprovalWorkflowType,
  submitter: PersonCtx,
  entity: EntityCtx,
): { title: string; body: string } {
  switch (workflow) {
    case 'lead_request':
      return {
        title: 'Lead request — your approval',
        body: `Forwarded to you: ${submitter.name} requested lead access to "${entity.label}".`,
      };
    case 'lead_extension':
      return {
        title: 'Lead extension — your approval',
        body: `Forwarded to you: extension request for "${entity.label}" from ${submitter.name}.`,
      };
    case 'lead_reassignment':
      return {
        title: 'Reassignment — your approval',
        body: `Forwarded to you: reassignment for "${entity.label}" from ${submitter.name}.`,
      };
    case 'client_manual_add':
      return {
        title: 'Client submission — your approval',
        body: `Forwarded to you: "${entity.label}" submitted by ${submitter.name}.`,
      };
    case 'client_manual_edit':
      return {
        title: 'Client edit — your approval',
        body: `Forwarded to you: edits for "${entity.label}" from ${submitter.name}.`,
      };
    case 'client_import':
      return {
        title: 'Import — your approval',
        body: `Forwarded to you: import "${entity.label}" from ${submitter.name}.`,
      };
    case 'contact_import':
    case 'database_contact_import':
      return {
        title: 'Contact import — your approval',
        body: `Forwarded to you: contact import for "${entity.label}" from ${submitter.name}.`,
      };
    case 'proposal_review':
      return {
        title: 'Proposal — your approval',
        body: `Forwarded to you: proposal for "${entity.label}" from ${submitter.name}.`,
      };
    case 'proposal_extension':
      return {
        title: 'Proposal extension — your approval',
        body: `Forwarded to you: extension for "${entity.label}" from ${submitter.name}.`,
      };
    default:
      return {
        title: `${WORKFLOW_LABELS[workflow]} — your approval`,
        body: `Forwarded to you: "${entity.label}" from ${submitter.name}.`,
      };
  }
}

export function finalApproveNotificationForRequester(
  workflow: ApprovalWorkflowType,
  entity: EntityCtx,
): { title: string; body: string } {
  switch (workflow) {
    case 'lead_request':
      return {
        title: 'Lead assigned',
        body: `Your lead for "${entity.label}" was approved. You can work this client now.`,
      };
    case 'lead_extension':
      return {
        title: 'Lead extension approved',
        body: `Your extension request for "${entity.label}" was approved.`,
      };
    case 'lead_reassignment':
      return {
        title: 'Reassignment approved',
        body: `Your reassignment request for "${entity.label}" was approved.`,
      };
    case 'client_manual_add':
      return {
        title: 'Client approved',
        body: `"${entity.label}" was added to your agency client list.`,
      };
    case 'client_manual_edit':
      return {
        title: 'Client edit approved',
        body: `Changes to "${entity.label}" were applied.`,
      };
    case 'client_import':
      return {
        title: 'Import approved',
        body: `"${entity.label}" was approved and added.`,
      };
    case 'contact_import':
    case 'database_contact_import':
      return {
        title: 'Contact import approved',
        body: `Contacts for "${entity.label}" were approved and added.`,
      };
    case 'proposal_review':
      return {
        title: 'Proposal approved',
        body: `Your proposal for "${entity.label}" was approved.`,
      };
    case 'proposal_extension':
      return {
        title: 'Proposal extension approved',
        body: `Your extension request for "${entity.label}" was approved.`,
      };
    default:
      return {
        title: 'Approved',
        body: `"${entity.label}" was approved.`,
      };
  }
}

export function rejectNotificationForRequester(
  workflow: ApprovalWorkflowType,
  entity: EntityCtx,
  reason?: string | null,
): { title: string; body: string } {
  const suffix = reason?.trim() ? ` Reason: ${reason.trim()}` : '';
  switch (workflow) {
    case 'lead_request':
      return {
        title: 'Lead request declined',
        body: `Your lead request for "${entity.label}" was declined.${suffix}`,
      };
    case 'lead_extension':
      return {
        title: 'Lead extension declined',
        body: `Your extension request for "${entity.label}" was declined.${suffix}`,
      };
    case 'lead_reassignment':
      return {
        title: 'Reassignment denied',
        body: `Your reassignment request for "${entity.label}" was denied.${suffix}`,
      };
    case 'client_manual_add':
      return {
        title: 'Client submission declined',
        body: `The submission for "${entity.label}" was declined.${suffix}`,
      };
    case 'client_manual_edit':
      return {
        title: 'Client edit declined',
        body: `Edits for "${entity.label}" were declined.${suffix}`,
      };
    case 'client_import':
      return {
        title: 'Import declined',
        body: `The import for "${entity.label}" was declined.${suffix}`,
      };
    case 'contact_import':
    case 'database_contact_import':
      return {
        title: 'Contact import declined',
        body: `The contact import for "${entity.label}" was declined.${suffix}`,
      };
    case 'proposal_review':
      return {
        title: 'Proposal declined',
        body: `Your proposal for "${entity.label}" was declined.${suffix}`,
      };
    case 'proposal_extension':
      return {
        title: 'Proposal extension declined',
        body: `Your extension request for "${entity.label}" was declined.${suffix}`,
      };
    default:
      return {
        title: 'Request declined',
        body: `"${entity.label}" was declined.${suffix}`,
      };
  }
}
