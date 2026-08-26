import type { ApprovalWorkflowType } from '@/lib/api';

const ROLE_LABELS: Record<string, string> = {
  director: 'Director',
  operations_manager: 'Operations Manager',
  sales_manager: 'Sales Manager',
  company_director: 'Company Director',
  recruitment_manager: 'Recruitment Manager',
  marketing: 'Sales & Marketing Executive',
};

/** Human-readable role name from key. */
export function formatRoleLabel(roleKey: string): string {
  if (ROLE_LABELS[roleKey]) return ROLE_LABELS[roleKey];
  return roleKey
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function approvalActionSuccessToast(
  workflow: ApprovalWorkflowType,
  action: 'forward' | 'approve' | 'reject',
): string {
  const map: Record<ApprovalWorkflowType, Record<'forward' | 'approve' | 'reject', string>> = {
    lead_request: {
      forward: 'Lead request forwarded to the next approver',
      approve: 'Lead assigned to the requester',
      reject: 'Lead request declined',
    },
    lead_extension: {
      forward: 'Extension request forwarded to the next approver',
      approve: 'Lead extension approved',
      reject: 'Lead extension declined',
    },
    lead_reassignment: {
      forward: 'Reassignment forwarded to the next approver',
      approve: 'Lead reassigned',
      reject: 'Reassignment denied',
    },
    client_manual_add: {
      forward: 'Client submission forwarded to the next approver',
      approve: 'Client added to the agency',
      reject: 'Client submission declined',
    },
    client_manual_edit: {
      forward: 'Client edit forwarded to the next approver',
      approve: 'Client changes applied',
      reject: 'Client edit declined',
    },
    client_import: {
      forward: 'Import forwarded to the next approver',
      approve: 'Import approved and client added',
      reject: 'Import declined',
    },
    contact_import: {
      forward: 'Contact import forwarded to the next approver',
      approve: 'Contacts approved and added',
      reject: 'Contact import declined',
    },
    database_client_add: {
      forward: 'Global client submission forwarded to the next approver',
      approve: 'Client added to the global database',
      reject: 'Global client submission declined',
    },
    database_client_import: {
      forward: 'Global import forwarded to the next approver',
      approve: 'Global import approved and clients added',
      reject: 'Global import declined',
    },
    database_contact_import: {
      forward: 'Global contact import forwarded to the next approver',
      approve: 'Global contact import approved and contacts added',
      reject: 'Global contact import declined',
    },
    proposal_review: {
      forward: 'Proposal forwarded to the next approver',
      approve: 'Proposal approved',
      reject: 'Proposal declined',
    },
    proposal_extension: {
      forward: 'Extension request forwarded to the next approver',
      approve: 'Proposal timer extended',
      reject: 'Proposal extension declined',
    },
  };
  return map[workflow][action];
}

export function proposalFinalApproveToast(isForReview: boolean): string {
  return isForReview
    ? 'Review email is being sent to the client'
    : 'Proposal approved — email sent to client (awaiting client approval)';
}

export function leadRequestSubmitToast(autoApproved: boolean, hasAttachments: boolean): string {
  if (autoApproved) {
    return hasAttachments
      ? 'Lead assigned to you. Attachments were saved to the client.'
      : 'Lead assigned to you.';
  }
  return hasAttachments
    ? 'Lead request submitted with attachments. It will follow your agency approval route.'
    : 'Lead request submitted. It will follow your agency approval route.';
}

export function formatApprovalHistoryLine(h: {
  action: string;
  actorName?: string;
  actorRoleKey: string;
  createdAt: string;
  stepIndex: number;
}): string {
  const name = h.actorName ?? formatRoleLabel(h.actorRoleKey);
  const date = new Date(h.createdAt).toLocaleString();
  if (h.action === 'direct_approve') {
    return `Directly approved by ${name} on ${date}`;
  }
  if (h.action === 'approve') {
    return `Approved by ${name} on ${date}`;
  }
  if (h.action === 'forward') {
    return `Forwarded by ${name} (step ${h.stepIndex + 1}) on ${date}`;
  }
  if (h.action === 'reject') {
    return `Rejected by ${name} on ${date}`;
  }
  return `${h.action} by ${name} on ${date}`;
}

export function directApprovalSuccessToast(workflow: ApprovalWorkflowType): string {
  return `${approvalActionSuccessToast(workflow, 'approve')} (intermediate steps skipped)`;
}

export function mapApprovalApiError(message: string, targetRoleKey?: string | null): string {
  const awaiting = targetRoleKey ? formatRoleLabel(targetRoleKey) : 'the next approver';
  if (message === 'Not authorized for this approval step') {
    return `It is not your turn to act on this item. It is awaiting ${awaiting}. Check your role's approval settings in Settings → Roles.`;
  }
  if (message === 'Intermediate step requires forward, not final approve') {
    return 'This step requires Forward, not final approval. Send it to the next approver first.';
  }
  if (message === 'No pending approval step') {
    return 'This item is no longer waiting for approval.';
  }
  if (message.includes('No approval path configured')) {
    return 'No approval path is configured. Check Settings → Approvals and Settings → Roles.';
  }
  return message;
}

export function bulkApprovalToastTitle(
  action: 'approve' | 'reject' | 'forward',
  count: number,
): string {
  const n = count === 1 ? '1 item' : `${count} items`;
  if (action === 'forward') return `Forwarded ${n} to the next approver`;
  if (action === 'approve') return `Approved and applied ${n}`;
  return `Declined ${n}`;
}
