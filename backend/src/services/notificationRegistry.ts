import type { ApprovalWorkflowType } from '@prisma/client';
import type { NotificationType } from './notifications';
import { ALL_WORKFLOW_TYPES, WORKFLOW_LABELS } from '../types/approval';
import {
  finalApproveNotificationForRequester,
  forwardNotification,
  rejectNotificationForRequester,
  submitNotification,
} from './approvalMessages';

export type NotificationCategory =
  | 'leads'
  | 'clients'
  | 'tasks'
  | 'follow_ups'
  | 'meetings'
  | 'proposals'
  | 'approvals'
  | 'settings'
  | 'bugs'
  | 'jobs';

export type ApprovalNotifyPhase = 'submit' | 'forward' | 'approved' | 'rejected';

export interface NotificationRegistryEntry {
  eventKey: string;
  storeAsType: NotificationType;
  category: NotificationCategory;
  label: string;
  description: string;
  defaultTitle: string;
  defaultBody: string;
  placeholders: string[];
  sampleContext: Record<string, string>;
  defaultEnabled: boolean;
}

const SAMPLE = {
  entityLabel: 'Acme Corp',
  actorName: 'Jane Smith',
  taskTitle: 'Follow up with client',
  ownerName: 'John Doe',
  clientName: 'Acme Corp',
  agencyName: 'Wudox',
  dueDate: 'Jun 15, 2026',
  dueTime: '2:00 PM',
  reason: 'Missing documentation',
  commentSnippet: 'Looks good',
  requestedDays: '14',
  newOwnerName: 'Alex Lee',
  minutesUntil: '60',
  meetingTitle: 'Discovery call',
  itemName: 'Healthcare',
  reporterName: 'Dev User',
  bugTitle: 'Login button broken',
  visibilityNote: 'Visible to your team.',
  rejectionComment: 'Please revise pricing',
  reviewerName: 'Manager One',
  activatorName: 'Director Two',
  meetingLinkNote: ' Meeting link is ready.',
  guestCompany: 'Beta Inc',
};

function entry(
  partial: Omit<NotificationRegistryEntry, 'placeholders' | 'sampleContext' | 'defaultEnabled'> & {
    placeholders?: string[];
    sampleContext?: Record<string, string>;
    defaultEnabled?: boolean;
  },
): NotificationRegistryEntry {
  const placeholders =
    partial.placeholders ??
    Array.from(
      new Set([
        ...extractFromTemplates(partial.defaultTitle, partial.defaultBody),
      ]),
    );
  return {
    ...partial,
    placeholders,
    sampleContext: partial.sampleContext ?? SAMPLE,
    defaultEnabled: partial.defaultEnabled ?? true,
  };
}

const JOB_SAMPLE = {
  ...SAMPLE,
  jobTitle: 'Forklift Operator',
  employeeName: 'Sam Carter',
  roleSuffix: ' as backup',
  reasonSuffix: ' Reason: Work complete',
};

function extractFromTemplates(...templates: string[]): string[] {
  const keys = new Set<string>();
  for (const t of templates) {
    for (const m of t.matchAll(/\{\{(\w+)\}\}/g)) keys.add(m[1]);
  }
  return [...keys];
}

function approvalStoreAsType(
  workflow: ApprovalWorkflowType,
  phase: ApprovalNotifyPhase,
): NotificationType {
  if (phase === 'submit' || phase === 'forward') {
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
  if (phase === 'rejected') {
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
  switch (workflow) {
    case 'lead_request':
      return 'lead_request_approved';
    case 'lead_reassignment':
      return 'lead_reassignment_approved';
    case 'proposal_review':
    case 'proposal_extension':
      return 'proposal_approved';
    case 'client_manual_add':
    case 'client_import':
    case 'contact_import':
    case 'database_contact_import':
      return 'client_created';
    case 'client_manual_edit':
      return 'client_pending_edit';
    default:
      return 'lead_request_approved';
  }
}

const LEAD_REQUEST_EVENT_KEYS: Record<ApprovalNotifyPhase, string> = {
  submit: 'lead_request_submitted',
  forward: 'lead_request_forwarded',
  approved: 'lead_request_approved',
  rejected: 'lead_request_rejected',
};

const LEAD_EXTENSION_EVENT_KEYS: Record<ApprovalNotifyPhase, string> = {
  submit: 'lead_extension_submitted',
  forward: 'lead_extension_forwarded',
  approved: 'lead_extension_approved',
  rejected: 'lead_extension_rejected',
};

const PROPOSAL_EXTENSION_EVENT_KEYS: Record<ApprovalNotifyPhase, string> = {
  submit: 'proposal_extension_submitted',
  forward: 'proposal_extension_forwarded',
  approved: 'proposal_extension_approved',
  rejected: 'proposal_extension_rejected',
};

const LEAD_REASSIGNMENT_EVENT_KEYS: Record<ApprovalNotifyPhase, string> = {
  submit: 'lead_reassignment_submitted',
  forward: 'lead_reassignment_forwarded',
  approved: 'lead_reassignment_approved_requester',
  rejected: 'lead_reassignment_rejected_requester',
};

const PROPOSAL_REVIEW_EVENT_KEYS: Record<ApprovalNotifyPhase, string> = {
  submit: 'proposal_submitted',
  forward: 'proposal_review_forwarded',
  approved: 'proposal_approved_review',
  rejected: 'proposal_rejected',
};

const CLIENT_MANUAL_ADD_EVENT_KEYS: Record<ApprovalNotifyPhase, string> = {
  submit: 'client_pending_submission_alert',
  forward: 'client_submission_forwarded',
  approved: 'client_created_approved',
  rejected: 'client_submission_declined',
};

const CLIENT_MANUAL_EDIT_EVENT_KEYS: Record<ApprovalNotifyPhase, string> = {
  submit: 'client_pending_edit_alert',
  forward: 'client_edit_forwarded',
  approved: 'client_updated',
  rejected: 'client_edit_declined',
};

const CLIENT_IMPORT_EVENT_KEYS: Record<ApprovalNotifyPhase, string> = {
  submit: 'client_import_row_pending',
  forward: 'client_import_forwarded',
  approved: 'client_import_approved',
  rejected: 'client_submission_declined',
};

const DEDICATED_APPROVAL_EVENT_KEYS: Partial<
  Record<ApprovalWorkflowType, Record<ApprovalNotifyPhase, string>>
> = {
  lead_request: LEAD_REQUEST_EVENT_KEYS,
  lead_extension: LEAD_EXTENSION_EVENT_KEYS,
  lead_reassignment: LEAD_REASSIGNMENT_EVENT_KEYS,
  proposal_review: PROPOSAL_REVIEW_EVENT_KEYS,
  proposal_extension: PROPOSAL_EXTENSION_EVENT_KEYS,
  client_manual_add: CLIENT_MANUAL_ADD_EVENT_KEYS,
  client_manual_edit: CLIENT_MANUAL_EDIT_EVENT_KEYS,
  client_import: CLIENT_IMPORT_EVENT_KEYS,
};

function buildApprovalEntriesClean(): NotificationRegistryEntry[] {
  const out: NotificationRegistryEntry[] = [];
  const phaseLabels: Record<ApprovalNotifyPhase, string> = {
    submit: 'Submit — approval needed',
    forward: 'Forward — your approval',
    approved: 'Approved — requester',
    rejected: 'Rejected — requester',
  };

  for (const workflow of ALL_WORKFLOW_TYPES) {
    const submit = submitNotification(workflow, { name: '{{actorName}}' }, { label: '{{entityLabel}}' });
    const forward = forwardNotification(workflow, { name: '{{actorName}}' }, { label: '{{entityLabel}}' });
    const approved = finalApproveNotificationForRequester(workflow, { label: '{{entityLabel}}' });
    const rejectedBase = rejectNotificationForRequester(workflow, { label: '{{entityLabel}}' }, null);

    const items: [ApprovalNotifyPhase, { title: string; body: string }, string[]][] = [
      ['submit', submit, ['entityLabel', 'actorName']],
      ['forward', forward, ['entityLabel', 'actorName']],
      ['approved', approved, ['entityLabel']],
      [
        'rejected',
        {
          title: rejectedBase.title,
          body: `${rejectedBase.body}{{reasonSuffix}}`,
        },
        ['entityLabel', 'reason', 'reasonSuffix'],
      ],
    ];

    for (const [phase, tpl, placeholders] of items) {
      out.push(
        entry({
          eventKey: `approval_${workflow}_${phase}`,
          storeAsType: approvalStoreAsType(workflow, phase),
          category: 'approvals',
          label: `${WORKFLOW_LABELS[workflow]} — ${phaseLabels[phase]}`,
          description: `Approval chain notification when ${WORKFLOW_LABELS[workflow].toLowerCase()} is ${phase}.`,
          defaultTitle: tpl.title,
          defaultBody: tpl.body,
          placeholders,
          sampleContext: {
            entityLabel: SAMPLE.entityLabel,
            actorName: SAMPLE.actorName,
            reason: SAMPLE.reason,
            reasonSuffix: ` Reason: ${SAMPLE.reason}`,
          },
        }),
      );
    }
  }
  return out;
}

const STATIC_ENTRIES: NotificationRegistryEntry[] = [
  // Leads
  entry({
    eventKey: 'lead_assigned_manual',
    storeAsType: 'lead_assigned',
    category: 'leads',
    label: 'Lead assigned (manual)',
    description: 'When a director/manager assigns a lead to an associate on create.',
    defaultTitle: 'Lead assigned to you',
    defaultBody: '{{actorName}} assigned you a lead for "{{entityLabel}}".',
    placeholders: ['entityLabel', 'actorName'],
    sampleContext: { entityLabel: SAMPLE.entityLabel, actorName: SAMPLE.actorName },
  }),
  entry({
    eventKey: 'lead_assigned_after_loss',
    storeAsType: 'lead_assigned',
    category: 'leads',
    label: 'Lost lead reassigned',
    description: 'When a director/manager reassigns a lost lead to a new owner.',
    defaultTitle: 'Lost lead reassigned to you',
    defaultBody: '{{actorName}} reassigned lost lead "{{entityLabel}}" to you.',
    placeholders: ['entityLabel', 'actorName'],
    sampleContext: { entityLabel: SAMPLE.entityLabel, actorName: SAMPLE.actorName },
  }),
  entry({
    eventKey: 'lead_assigned_reassignment',
    storeAsType: 'lead_assigned',
    category: 'leads',
    label: 'Lead assigned after reassignment',
    description: 'When reassignment completes and new owner receives the lead.',
    defaultTitle: 'Lead assigned to you',
    defaultBody: 'A lead for "{{entityLabel}}" has been assigned to you.',
  }),
  entry({
    eventKey: 'lead_request_submitted',
    storeAsType: 'lead_requested',
    category: 'leads',
    label: 'Lead request submitted',
    description: 'Sent to approvers when an associate submits a lead request.',
    defaultTitle: 'Lead request — approval needed',
    defaultBody: '{{actorName}} requested lead access to "{{entityLabel}}". Your approval is required.',
    placeholders: ['entityLabel', 'actorName'],
    sampleContext: { entityLabel: SAMPLE.entityLabel, actorName: SAMPLE.actorName },
  }),
  entry({
    eventKey: 'lead_request_forwarded',
    storeAsType: 'lead_requested',
    category: 'leads',
    label: 'Lead request forwarded',
    description: 'Sent when a lead request is forwarded to the next approver.',
    defaultTitle: 'Lead request — your approval',
    defaultBody: 'Forwarded to you: {{actorName}} requested lead access to "{{entityLabel}}".',
    placeholders: ['entityLabel', 'actorName'],
    sampleContext: { entityLabel: SAMPLE.entityLabel, actorName: SAMPLE.actorName },
  }),
  entry({
    eventKey: 'lead_request_approved',
    storeAsType: 'lead_request_approved',
    category: 'leads',
    label: 'Lead request approved',
    description: 'Sent to the requester when their lead request is approved.',
    defaultTitle: 'Lead assigned',
    defaultBody: 'Your lead for "{{entityLabel}}" was approved. You can work this client now.',
    placeholders: ['entityLabel'],
    sampleContext: { entityLabel: SAMPLE.entityLabel },
  }),
  entry({
    eventKey: 'lead_request_rejected',
    storeAsType: 'lead_request_rejected',
    category: 'leads',
    label: 'Lead request rejected',
    description: 'Sent to the requester when their lead request is declined.',
    defaultTitle: 'Lead request declined',
    defaultBody: 'Your lead request for "{{entityLabel}}" was declined.{{reasonSuffix}}',
    placeholders: ['entityLabel', 'reason', 'reasonSuffix'],
    sampleContext: {
      entityLabel: SAMPLE.entityLabel,
      reason: SAMPLE.reason,
      reasonSuffix: ` Reason: ${SAMPLE.reason}`,
    },
  }),
  entry({
    eventKey: 'lead_extension_submitted',
    storeAsType: 'lead_requested',
    category: 'leads',
    label: 'Lead extension submitted',
    description: 'Sent to approvers when someone requests a lead extension.',
    defaultTitle: 'Lead extension — approval needed',
    defaultBody: '{{actorName}} requested a lead extension for "{{entityLabel}}".',
    placeholders: ['entityLabel', 'actorName', 'requestedDays'],
    sampleContext: {
      entityLabel: SAMPLE.entityLabel,
      actorName: SAMPLE.actorName,
      requestedDays: SAMPLE.requestedDays,
    },
  }),
  entry({
    eventKey: 'lead_extension_forwarded',
    storeAsType: 'lead_requested',
    category: 'leads',
    label: 'Lead extension forwarded',
    description: 'Sent when a lead extension request is forwarded to the next approver.',
    defaultTitle: 'Lead extension — your approval',
    defaultBody: 'Forwarded to you: extension request for "{{entityLabel}}" from {{actorName}}.',
    placeholders: ['entityLabel', 'actorName'],
    sampleContext: { entityLabel: SAMPLE.entityLabel, actorName: SAMPLE.actorName },
  }),
  entry({
    eventKey: 'lead_extension_approved',
    storeAsType: 'lead_request_approved',
    category: 'leads',
    label: 'Lead extension approved',
    description: 'When a lead extension request is approved.',
    defaultTitle: 'Lead Extension Approved',
    defaultBody: 'Your extension request for "{{entityLabel}}" was approved.',
  }),
  entry({
    eventKey: 'lead_extension_rejected',
    storeAsType: 'lead_request_rejected',
    category: 'leads',
    label: 'Lead extension rejected',
    description: 'When a lead extension request is rejected.',
    defaultTitle: 'Lead Extension Rejected',
    defaultBody: 'Your extension request for "{{entityLabel}}" was rejected.',
  }),
  entry({
    eventKey: 'lead_request_approved_on_behalf',
    storeAsType: 'lead_request_approved',
    category: 'leads',
    label: 'Lead request approved on your behalf',
    description: 'Manager notified when another user approves a lead request.',
    defaultTitle: 'Lead request approved on your behalf',
    defaultBody: '{{actorName}} approved the lead request for "{{entityLabel}}" on your behalf.',
  }),
  entry({
    eventKey: 'lead_request_rejected_on_behalf',
    storeAsType: 'lead_request_rejected',
    category: 'leads',
    label: 'Lead request rejected on your behalf',
    description: 'Manager notified when another user rejects a lead request.',
    defaultTitle: 'Lead request rejected on your behalf',
    defaultBody: '{{actorName}} rejected the lead request for "{{entityLabel}}" on your behalf.',
  }),
  entry({
    eventKey: 'lead_request_superseded',
    storeAsType: 'lead_request_rejected',
    category: 'leads',
    label: 'Lead request superseded',
    description: 'When another lead request for the same client was approved first.',
    defaultTitle: 'Lead request declined',
    defaultBody: 'Your lead request for "{{entityLabel}}" was declined. Reason: Another request was approved first.',
  }),
  entry({
    eventKey: 'lead_reassignment_approved_owner',
    storeAsType: 'lead_reassignment_approved',
    category: 'leads',
    label: 'Lead reassigned (previous owner)',
    description: 'Previous owner notified when lead is reassigned.',
    defaultTitle: 'Lead reassigned',
    defaultBody: 'The lead for "{{entityLabel}}" has been reassigned to {{newOwnerName}}.',
    placeholders: ['entityLabel', 'newOwnerName'],
  }),
  entry({
    eventKey: 'lead_reassignment_approved_requester',
    storeAsType: 'lead_reassignment_approved',
    category: 'leads',
    label: 'Reassignment approved (requester)',
    description: 'Requester notified when reassignment is approved.',
    defaultTitle: 'Reassignment request approved',
    defaultBody: 'Your reassignment request for "{{entityLabel}}" was approved.',
  }),
  entry({
    eventKey: 'lead_reassignment_superseded',
    storeAsType: 'lead_reassignment_cancelled',
    category: 'leads',
    label: 'Reassignment superseded',
    description: 'When a reassignment request is superseded by another action.',
    defaultTitle: 'Reassignment request superseded',
    defaultBody: 'Your reassignment request for "{{entityLabel}}" was superseded.',
  }),
  entry({
    eventKey: 'lead_reassignment_rejected_requester',
    storeAsType: 'lead_reassignment_rejected',
    category: 'leads',
    label: 'Reassignment denied (requester)',
    description: 'Requester notified when reassignment is denied.',
    defaultTitle: 'Reassignment request denied',
    defaultBody: 'Your reassignment request for "{{entityLabel}}" was denied.{{reasonSuffix}}',
    placeholders: ['entityLabel', 'reason', 'reasonSuffix'],
    sampleContext: {
      entityLabel: SAMPLE.entityLabel,
      reason: SAMPLE.reason,
      reasonSuffix: ` Reason: ${SAMPLE.reason}`,
    },
  }),
  entry({
    eventKey: 'lead_reassignment_submitted',
    storeAsType: 'lead_reassignment_requested',
    category: 'leads',
    label: 'Lead reassignment submitted',
    description: 'Sent to approvers when a lead reassignment is requested.',
    defaultTitle: 'Lead reassignment — approval needed',
    defaultBody: '{{actorName}} requested a lead reassignment for "{{entityLabel}}".',
    placeholders: ['entityLabel', 'actorName'],
    sampleContext: { entityLabel: SAMPLE.entityLabel, actorName: SAMPLE.actorName },
  }),
  entry({
    eventKey: 'lead_reassignment_forwarded',
    storeAsType: 'lead_reassignment_requested',
    category: 'leads',
    label: 'Lead reassignment forwarded',
    description: 'Sent when a reassignment request is forwarded to the next approver.',
    defaultTitle: 'Reassignment — your approval',
    defaultBody: 'Forwarded to you: reassignment for "{{entityLabel}}" from {{actorName}}.',
    placeholders: ['entityLabel', 'actorName'],
    sampleContext: { entityLabel: SAMPLE.entityLabel, actorName: SAMPLE.actorName },
  }),

  // Clients
  entry({
    eventKey: 'client_created_direct',
    storeAsType: 'client_created',
    category: 'clients',
    label: 'New client added',
    description: 'Broadcast when a client is added directly.',
    defaultTitle: 'New client added',
    defaultBody: '{{actorName}} added client "{{entityLabel}}" in {{agencyName}}.',
    placeholders: ['entityLabel', 'actorName', 'agencyName'],
  }),
  entry({
    eventKey: 'client_created_approved',
    storeAsType: 'client_created',
    category: 'clients',
    label: 'Client submission approved',
    description: 'Submitter notified when pending client is approved.',
    defaultTitle: 'Client approved',
    defaultBody: '{{actorName}} approved your client submission "{{entityLabel}}". {{visibilityNote}}',
    placeholders: ['entityLabel', 'actorName', 'visibilityNote'],
  }),
  entry({
    eventKey: 'client_created_auto_approved',
    storeAsType: 'client_created',
    category: 'clients',
    label: 'Client auto-approved',
    description: 'Submitter notified when client auto-approves after visibility period.',
    defaultTitle: 'Client auto-approved',
    defaultBody:
      'Your client submission "{{entityLabel}}" was auto-approved after the Client Visibility period in Settings. {{visibilityNote}}',
    placeholders: ['entityLabel', 'visibilityNote'],
  }),
  entry({
    eventKey: 'client_updated',
    storeAsType: 'client_updated',
    category: 'clients',
    label: 'Client edit approved',
    description: 'Submitter notified when pending client edit is approved.',
    defaultTitle: 'Client edit approved',
    defaultBody: '{{actorName}} approved your edit request for "{{entityLabel}}".',
    placeholders: ['entityLabel', 'actorName'],
  }),
  entry({
    eventKey: 'client_edit_auto_approved',
    storeAsType: 'client_updated',
    category: 'clients',
    label: 'Client edit auto-approved',
    description: 'Submitter notified when client edit auto-approves after visibility period.',
    defaultTitle: 'Client edit auto-approved',
    defaultBody:
      'Your edit request for "{{entityLabel}}" was auto-approved after the Client Visibility period in Settings.',
    placeholders: ['entityLabel'],
  }),
  entry({
    eventKey: 'client_pending_submission_alert',
    storeAsType: 'client_pending_submission',
    category: 'clients',
    label: 'Client submission submitted',
    description: 'Approvers notified when a client submission is submitted.',
    defaultTitle: 'Client pending approval',
    defaultBody: '{{actorName}} submitted "{{entityLabel}}" for approval.',
    placeholders: ['entityLabel', 'actorName'],
  }),
  entry({
    eventKey: 'client_submission_forwarded',
    storeAsType: 'client_pending_submission',
    category: 'clients',
    label: 'Client submission forwarded',
    description: 'Sent when a client submission is forwarded to the next approver.',
    defaultTitle: 'Client submission — your approval',
    defaultBody: 'Forwarded to you: "{{entityLabel}}" submitted by {{actorName}}.',
    placeholders: ['entityLabel', 'actorName'],
    sampleContext: { entityLabel: SAMPLE.entityLabel, actorName: SAMPLE.actorName },
  }),
  entry({
    eventKey: 'client_pending_edit_alert',
    storeAsType: 'client_pending_edit',
    category: 'clients',
    label: 'Client edit submitted',
    description: 'Approvers notified when a client edit is submitted.',
    defaultTitle: 'Client edit pending approval',
    defaultBody: '{{actorName}} submitted edits for "{{entityLabel}}".',
    placeholders: ['entityLabel', 'actorName'],
  }),
  entry({
    eventKey: 'client_edit_forwarded',
    storeAsType: 'client_pending_edit',
    category: 'clients',
    label: 'Client edit forwarded',
    description: 'Sent when a client edit is forwarded to the next approver.',
    defaultTitle: 'Client edit — your approval',
    defaultBody: 'Forwarded to you: edits for "{{entityLabel}}" from {{actorName}}.',
    placeholders: ['entityLabel', 'actorName'],
    sampleContext: { entityLabel: SAMPLE.entityLabel, actorName: SAMPLE.actorName },
  }),
  entry({
    eventKey: 'client_import_pending_alert',
    storeAsType: 'client_pending_submission',
    category: 'clients',
    label: 'CSV import pending approval',
    description: 'Approvers notified of CSV import pending approval.',
    defaultTitle: 'CSV import pending approval',
    defaultBody: '{{actorName}} imported clients for approval.',
    placeholders: ['actorName'],
  }),
  entry({
    eventKey: 'client_import_row_pending',
    storeAsType: 'client_pending_submission',
    category: 'clients',
    label: 'Imported client submitted',
    description: 'Approvers notified when an imported client row awaits approval.',
    defaultTitle: 'CSV import pending approval',
    defaultBody: 'Imported client "{{entityLabel}}" is awaiting approval.',
    placeholders: ['entityLabel'],
  }),
  entry({
    eventKey: 'client_import_forwarded',
    storeAsType: 'client_pending_submission',
    category: 'clients',
    label: 'Client import forwarded',
    description: 'Sent when a client import is forwarded to the next approver.',
    defaultTitle: 'Import — your approval',
    defaultBody: 'Forwarded to you: import "{{entityLabel}}" from {{actorName}}.',
    placeholders: ['entityLabel', 'actorName'],
    sampleContext: { entityLabel: SAMPLE.entityLabel, actorName: SAMPLE.actorName },
  }),
  entry({
    eventKey: 'client_import_approved',
    storeAsType: 'client_created',
    category: 'clients',
    label: 'CSV import approved',
    description: 'Uploader notified when imported clients are approved.',
    defaultTitle: 'Import approved',
    defaultBody: '{{actorName}} approved your import: {{entityLabel}}.',
    placeholders: ['entityLabel', 'actorName', 'count'],
  }),
  entry({
    eventKey: 'client_submission_declined',
    storeAsType: 'client_pending_submission',
    category: 'clients',
    label: 'Client submission rejected',
    description: 'Submitter notified when client submission is declined.',
    defaultTitle: 'Client submission declined',
    defaultBody: 'The submission for "{{entityLabel}}" was declined.{{reasonSuffix}}',
    placeholders: ['entityLabel', 'reason', 'reasonSuffix'],
    sampleContext: {
      entityLabel: SAMPLE.entityLabel,
      reason: SAMPLE.reason,
      reasonSuffix: ` Reason: ${SAMPLE.reason}`,
    },
  }),
  entry({
    eventKey: 'client_edit_declined',
    storeAsType: 'client_pending_edit',
    category: 'clients',
    label: 'Client edit rejected',
    description: 'Submitter notified when client edit is declined.',
    defaultTitle: 'Client edit declined',
    defaultBody: 'Edits for "{{entityLabel}}" were declined.{{reasonSuffix}}',
    placeholders: ['entityLabel', 'reason', 'reasonSuffix'],
    sampleContext: {
      entityLabel: SAMPLE.entityLabel,
      reason: SAMPLE.reason,
      reasonSuffix: ` Reason: ${SAMPLE.reason}`,
    },
  }),

  // Tasks
  entry({
    eventKey: 'task_assigned',
    storeAsType: 'task_assigned',
    category: 'tasks',
    label: 'Task assigned',
    description: 'When a task is assigned to a user.',
    defaultTitle: '📋 New Task: "{{taskTitle}}"',
    defaultBody: 'Assigned by {{actorName}}.',
    placeholders: ['taskTitle', 'actorName'],
  }),

  // Lists
  entry({
    eventKey: 'list_assigned',
    storeAsType: 'list_assigned',
    category: 'clients',
    label: 'List assigned',
    description: 'When a list you created is assigned to another user.',
    defaultTitle: '📋 List assigned: "{{listName}}"',
    defaultBody: 'Assigned by {{actorName}}.',
    placeholders: ['listName', 'actorName'],
  }),
  entry({
    eventKey: 'list_assignee_left',
    storeAsType: 'list_assignee_left',
    category: 'clients',
    label: 'List assignee left',
    description: 'When someone assigned to your list is deactivated and removed from it.',
    defaultTitle: 'List update: {{userName}} left',
    defaultBody: '{{userName}} was removed from "{{listName}}".',
    placeholders: ['userName', 'listName'],
  }),
  entry({
    eventKey: 'task_completed_creator',
    storeAsType: 'task_completed',
    category: 'tasks',
    label: 'Task completed (creator)',
    description: 'Task creator notified when assignee completes the task.',
    defaultTitle: 'Task Completed: "{{taskTitle}}"',
    defaultBody: '{{actorName}} completed this task.',
    placeholders: ['taskTitle', 'actorName'],
  }),
  entry({
    eventKey: 'task_completed_owner',
    storeAsType: 'task_completed',
    category: 'tasks',
    label: 'Task completed (owner)',
    description: 'Task owner notified when someone else marks it complete.',
    defaultTitle: 'Task Completed: "{{taskTitle}}"',
    defaultBody: '{{actorName}} marked this task as complete.',
    placeholders: ['taskTitle', 'actorName'],
  }),
  entry({
    eventKey: 'task_comment',
    storeAsType: 'task_comment',
    category: 'tasks',
    label: 'Task comment',
    description: 'When someone comments on a task.',
    defaultTitle: '💬 Comment on "{{taskTitle}}"',
    defaultBody: '{{actorName}}: "{{commentSnippet}}"',
    placeholders: ['taskTitle', 'actorName', 'commentSnippet'],
    sampleContext: { ...SAMPLE, commentSnippet: 'Please review' },
  }),
  entry({
    eventKey: 'task_due_1h_owner',
    storeAsType: 'task_due_1h',
    category: 'tasks',
    label: 'Task due in 1 hour (owner)',
    description: 'Owner reminder 1 hour before due.',
    defaultTitle: '⏳ Task due in 1 hour: {{taskTitle}}',
    defaultBody: 'This task is due at {{dueTime}}. Wrap it up!',
    placeholders: ['taskTitle', 'dueTime'],
  }),
  entry({
    eventKey: 'task_due_1h_assigner',
    storeAsType: 'task_due_1h',
    category: 'tasks',
    label: 'Task due in 1 hour (assigner)',
    description: 'Assigner reminder 1 hour before assignee task due.',
    defaultTitle: '⏳ Assigned task due in 1 hour: {{taskTitle}}',
    defaultBody: 'Task assigned to {{ownerName}} is due at {{dueTime}}.',
    placeholders: ['taskTitle', 'ownerName', 'dueTime'],
  }),
  entry({
    eventKey: 'task_due_today_owner',
    storeAsType: 'task_due_today',
    category: 'tasks',
    label: 'Task due now (owner)',
    description: 'Owner reminder at due time.',
    defaultTitle: '⏰ Task due now: {{taskTitle}}',
    defaultBody: 'This task is due right now ({{dueTime}}). Please complete it.',
    placeholders: ['taskTitle', 'dueTime'],
  }),
  entry({
    eventKey: 'task_due_today_assigner',
    storeAsType: 'task_due_today',
    category: 'tasks',
    label: 'Task due now (assigner)',
    description: 'Assigner reminder at assignee task due time.',
    defaultTitle: '⏰ Assigned task due now: {{taskTitle}}',
    defaultBody: 'Task assigned to {{ownerName}} is due right now ({{dueTime}}).',
    placeholders: ['taskTitle', 'ownerName', 'dueTime'],
  }),
  entry({
    eventKey: 'task_overdue_owner',
    storeAsType: 'task_overdue',
    category: 'tasks',
    label: 'Task overdue (owner)',
    description: 'Owner reminder when task is overdue.',
    defaultTitle: '🚨 Task overdue: {{taskTitle}}',
    defaultBody: 'This task was due on {{dueDate}}. Please complete it ASAP.',
    placeholders: ['taskTitle', 'dueDate'],
  }),
  entry({
    eventKey: 'task_overdue_assigner',
    storeAsType: 'task_overdue',
    category: 'tasks',
    label: 'Task overdue (assigner)',
    description: 'Assigner reminder when assignee task is overdue.',
    defaultTitle: '🚨 Assigned task overdue: {{taskTitle}}',
    defaultBody: 'Task assigned to {{ownerName}} was due on {{dueDate}} and is still incomplete.',
    placeholders: ['taskTitle', 'ownerName', 'dueDate'],
  }),
  entry({
    eventKey: 'task_due_2h_manager',
    storeAsType: 'task_due_2h_manager',
    category: 'tasks',
    label: 'Team task due in 2 hours (manager)',
    description: 'Reporting manager escalation for pending tasks.',
    defaultTitle: '⏳ Team task due in 2 hours: {{taskTitle}}',
    defaultBody: '{{ownerName}} has a pending task due at {{dueTime}} that is not yet completed.',
    placeholders: ['taskTitle', 'ownerName', 'dueTime'],
  }),

  // Follow-ups
  entry({
    eventKey: 'follow_up_created',
    storeAsType: 'follow_up_created',
    category: 'follow_ups',
    label: 'Follow-up scheduled',
    description: 'When a follow-up is created for a client.',
    defaultTitle: '📋 Follow-up scheduled: {{clientName}}',
    defaultBody: 'A follow-up with {{clientName}} was scheduled.',
    placeholders: ['clientName'],
  }),
  entry({
    eventKey: 'follow_up_due_1h',
    storeAsType: 'follow_up_due_1h',
    category: 'follow_ups',
    label: 'Follow-up due in 1 hour',
    description: 'Reminder 1 hour before follow-up due.',
    defaultTitle: '⏳ Follow-up due in 1 hour: {{clientName}}',
    defaultBody: 'Your follow-up with {{clientName}} is due at {{dueTime}}.',
    placeholders: ['clientName', 'dueTime'],
  }),
  entry({
    eventKey: 'follow_up_due_today',
    storeAsType: 'follow_up_due_today',
    category: 'follow_ups',
    label: 'Follow-up due now',
    description: 'Reminder when follow-up is due.',
    defaultTitle: '⏰ Follow-up due now: {{clientName}}',
    defaultBody: 'Your follow-up with {{clientName}} is due right now ({{dueTime}}).',
    placeholders: ['clientName', 'dueTime'],
  }),
  entry({
    eventKey: 'follow_up_overdue',
    storeAsType: 'follow_up_overdue',
    category: 'follow_ups',
    label: 'Follow-up overdue',
    description: 'Reminder when follow-up is overdue.',
    defaultTitle: '🚨 Follow-up overdue: {{clientName}}',
    defaultBody: 'Your follow-up with {{clientName}} was due on {{dueDate}}. Please complete it.',
    placeholders: ['clientName', 'dueDate'],
  }),
  entry({
    eventKey: 'follow_up_due_2h_manager',
    storeAsType: 'follow_up_due_2h_manager',
    category: 'follow_ups',
    label: 'Team follow-up due in 2 hours (manager)',
    description: 'Reporting manager escalation for pending follow-ups.',
    defaultTitle: '⏳ Team follow-up due in 2 hours: {{clientName}}',
    defaultBody:
      '{{ownerName}} has a pending follow-up with {{clientName}} due at {{dueTime}} that is not yet completed.',
    placeholders: ['clientName', 'ownerName', 'dueTime'],
  }),

  // Meetings
  entry({
    eventKey: 'meeting_scheduled',
    storeAsType: 'meeting_scheduled',
    category: 'meetings',
    label: 'Meeting scheduled',
    description: 'When a user is invited to a meeting.',
    defaultTitle: '📅 Meeting scheduled: {{meetingTitle}}',
    defaultBody: 'You have a meeting on {{dueDate}} at {{dueTime}}.',
    placeholders: ['meetingTitle', 'dueDate', 'dueTime'],
  }),
  entry({
    eventKey: 'meeting_reminder_1h',
    storeAsType: 'meeting_reminder_1h',
    category: 'meetings',
    label: 'Meeting reminder (1 hour)',
    description: 'Reminder 1 hour before meeting starts.',
    defaultTitle: '⏰ Meeting in {{minutesUntil}} min: "{{meetingTitle}}"',
    defaultBody: 'Your meeting starts at {{dueTime}}.',
    placeholders: ['minutesUntil', 'meetingTitle', 'dueTime'],
  }),
  entry({
    eventKey: 'meeting_reminder_2h_manager',
    storeAsType: 'meeting_reminder_2h_manager',
    category: 'meetings',
    label: 'Team meeting in 2 hours (manager)',
    description: 'Reporting manager notified of upcoming team meeting.',
    defaultTitle: '⏳ Team meeting in 2 hours: "{{meetingTitle}}"',
    defaultBody:
      '{{ownerName}} has a meeting with {{clientName}} at {{dueTime}}.{{meetingLinkNote}}',
    placeholders: ['meetingTitle', 'ownerName', 'clientName', 'dueTime', 'meetingLinkNote'],
  }),
  entry({
    eventKey: 'meeting_reminder_2h_manager_booked',
    storeAsType: 'meeting_reminder_2h_manager',
    category: 'meetings',
    label: 'Booked meeting in 2 hours (manager)',
    description: 'Manager notified of host booked meeting in 2 hours.',
    defaultTitle: '⏳ Team meeting in 2 hours with {{guestName}}',
    defaultBody: '{{ownerName}} has a booked meeting at {{dueTime}}.{{guestCompanyNote}}',
    placeholders: ['guestName', 'ownerName', 'dueTime', 'guestCompanyNote'],
    sampleContext: {
      ...SAMPLE,
      guestName: 'Guest User',
      guestCompanyNote: ' (Beta Inc)',
    },
  }),

  // Proposals
  entry({
    eventKey: 'proposal_submitted',
    storeAsType: 'proposal_submitted',
    category: 'proposals',
    label: 'Proposal submitted for review',
    description: 'Managers notified when a proposal is submitted for approval.',
    defaultTitle: 'Proposal submitted for review',
    defaultBody: '{{actorName}} submitted a proposal for {{entityLabel}}.',
    placeholders: ['entityLabel', 'actorName'],
  }),
  entry({
    eventKey: 'proposal_review_forwarded',
    storeAsType: 'proposal_submitted',
    category: 'proposals',
    label: 'Proposal review forwarded',
    description: 'Sent when a proposal is forwarded to the next approver.',
    defaultTitle: 'Proposal — your approval',
    defaultBody: 'Forwarded to you: proposal for "{{entityLabel}}" from {{actorName}}.',
    placeholders: ['entityLabel', 'actorName'],
    sampleContext: { entityLabel: SAMPLE.entityLabel, actorName: SAMPLE.actorName },
  }),
  entry({
    eventKey: 'proposal_submitted_documents_ready',
    storeAsType: 'proposal_submitted',
    category: 'proposals',
    label: 'Documents ready for review',
    description: 'Managers notified when document exchange is complete.',
    defaultTitle: 'Documents Ready for Review',
    defaultBody:
      '{{actorName}} has completed the document exchange for {{entityLabel}} and submitted it for your review',
    placeholders: ['entityLabel', 'actorName'],
  }),
  entry({
    eventKey: 'proposal_returned_reassignment',
    storeAsType: 'proposal_submitted',
    category: 'proposals',
    label: 'Lead returned for reassignment',
    description: 'When awaiting-client timer expires and lead is returned.',
    defaultTitle: 'Lead Returned For Reassignment',
    defaultBody: '{{entityLabel}} was returned after awaiting-client timer expiry.',
    placeholders: ['entityLabel'],
  }),
  entry({
    eventKey: 'proposal_approved_documents_required',
    storeAsType: 'proposal_approved',
    category: 'proposals',
    label: 'Proposal approved — documents required',
    description: 'Owner notified to upload documents after approval.',
    defaultTitle: 'Proposal Approved — Documents Required',
    defaultBody:
      'Your proposal for {{entityLabel}} was approved by {{reviewerName}}. Please upload the required documents.',
    placeholders: ['entityLabel', 'reviewerName'],
  }),
  entry({
    eventKey: 'proposal_approved_review',
    storeAsType: 'proposal_approved',
    category: 'proposals',
    label: 'Review proposal approved',
    description: 'Owner notified when review proposal is approved.',
    defaultTitle: 'Review Proposal Approved',
    defaultBody:
      '{{reviewerName}} approved your review proposal for {{entityLabel}} — a review email is being sent to the client.',
    placeholders: ['entityLabel', 'reviewerName'],
  }),
  entry({
    eventKey: 'proposal_approved_lead_activated',
    storeAsType: 'proposal_approved',
    category: 'proposals',
    label: 'Lead activated',
    description: 'Owner notified when lead is activated.',
    defaultTitle: 'Lead Activated!',
    defaultBody: '{{entityLabel}} has been activated by {{activatorName}}',
    placeholders: ['entityLabel', 'activatorName'],
  }),
  entry({
    eventKey: 'proposal_extension_submitted',
    storeAsType: 'proposal_submitted',
    category: 'proposals',
    label: 'Proposal extension submitted',
    description: 'Sent to approvers when a proposal extension is requested.',
    defaultTitle: 'Proposal extension — approval needed',
    defaultBody: '{{actorName}} requested a proposal extension for "{{entityLabel}}".',
    placeholders: ['entityLabel', 'actorName'],
    sampleContext: { entityLabel: SAMPLE.entityLabel, actorName: SAMPLE.actorName },
  }),
  entry({
    eventKey: 'proposal_extension_forwarded',
    storeAsType: 'proposal_submitted',
    category: 'proposals',
    label: 'Proposal extension forwarded',
    description: 'Sent when a proposal extension is forwarded to the next approver.',
    defaultTitle: 'Proposal extension — your approval',
    defaultBody: 'Forwarded to you: extension for "{{entityLabel}}" from {{actorName}}.',
    placeholders: ['entityLabel', 'actorName'],
    sampleContext: { entityLabel: SAMPLE.entityLabel, actorName: SAMPLE.actorName },
  }),
  entry({
    eventKey: 'proposal_extension_approved',
    storeAsType: 'proposal_approved',
    category: 'proposals',
    label: 'Proposal extension approved',
    description: 'Requester notified when proposal extension is approved.',
    defaultTitle: 'Proposal Extension Approved',
    defaultBody: 'Your extension request for {{entityLabel}} was approved.',
    placeholders: ['entityLabel'],
  }),
  entry({
    eventKey: 'proposal_extension_rejected',
    storeAsType: 'proposal_rejected',
    category: 'proposals',
    label: 'Proposal extension rejected',
    description: 'Requester notified when proposal extension is rejected.',
    defaultTitle: 'Proposal Extension Rejected',
    defaultBody: 'Your extension request for {{entityLabel}} was rejected.',
    placeholders: ['entityLabel'],
  }),
  entry({
    eventKey: 'proposal_rejected',
    storeAsType: 'proposal_rejected',
    category: 'proposals',
    label: 'Proposal rejected',
    description: 'Owner notified when proposal is rejected.',
    defaultTitle: 'Proposal Rejected',
    defaultBody: 'Your proposal for {{entityLabel}} was rejected{{rejectionSuffix}}',
    placeholders: ['entityLabel', 'rejectionSuffix', 'rejectionComment'],
    sampleContext: { ...SAMPLE, rejectionSuffix: ': Missing info', rejectionComment: 'Missing info' },
  }),
  entry({
    eventKey: 'proposal_rejected_review',
    storeAsType: 'proposal_rejected',
    category: 'proposals',
    label: 'Review rejected — resubmission required',
    description: 'Owner notified when review requires changes.',
    defaultTitle: 'Review Rejected — Resubmission Required',
    defaultBody: '{{reviewerName}} has requested changes for {{entityLabel}}: {{rejectionComment}}',
    placeholders: ['entityLabel', 'reviewerName', 'rejectionComment'],
  }),
  entry({
    eventKey: 'proposal_signed',
    storeAsType: 'proposal_signed',
    category: 'proposals',
    label: 'Proposal signed',
    description: 'When client signs proposal via PandaDoc.',
    defaultTitle: 'Proposal signed',
    defaultBody: '{{entityLabel}} signed the proposal.',
    placeholders: ['entityLabel'],
  }),
  entry({
    eventKey: 'proposal_declined',
    storeAsType: 'proposal_declined',
    category: 'proposals',
    label: 'Proposal declined',
    description: 'When client declines proposal via PandaDoc.',
    defaultTitle: 'Proposal declined',
    defaultBody: '{{entityLabel}} declined the proposal.',
    placeholders: ['entityLabel'],
  }),
  entry({
    eventKey: 'employee_onboarding_signed',
    storeAsType: 'employee_onboarding_signed',
    category: 'jobs',
    label: 'Onboarding agreement signed',
    description: 'When an employee signs the onboarding PandaDoc agreement.',
    defaultTitle: 'Onboarding agreement signed',
    defaultBody: '{{employeeName}} signed the onboarding agreement.',
    placeholders: ['employeeName'],
    sampleContext: JOB_SAMPLE,
  }),
  entry({
    eventKey: 'employee_onboarding_declined',
    storeAsType: 'employee_onboarding_declined',
    category: 'jobs',
    label: 'Onboarding agreement declined',
    description: 'When an employee declines the onboarding PandaDoc agreement.',
    defaultTitle: 'Onboarding agreement declined',
    defaultBody: '{{employeeName}} declined the onboarding agreement.',
    placeholders: ['employeeName'],
    sampleContext: JOB_SAMPLE,
  }),
  entry({
    eventKey: 'client_training_signed',
    storeAsType: 'client_training_signed',
    category: 'jobs',
    label: 'Client training signed',
    description: 'When an employee signs Active Client training via PandaDoc.',
    defaultTitle: 'Client training completed',
    defaultBody: '{{employeeName}} signed training for {{clientName}}.',
    placeholders: ['employeeName', 'clientName'],
    sampleContext: { ...JOB_SAMPLE, clientName: 'Harbor Line Logistics' },
  }),
  entry({
    eventKey: 'client_training_declined',
    storeAsType: 'client_training_declined',
    category: 'jobs',
    label: 'Client training declined',
    description: 'When an employee declines Active Client training via PandaDoc.',
    defaultTitle: 'Client training declined',
    defaultBody: '{{employeeName}} declined training for {{clientName}}.',
    placeholders: ['employeeName', 'clientName'],
    sampleContext: { ...JOB_SAMPLE, clientName: 'Harbor Line Logistics' },
  }),

  // Settings
  entry({
    eventKey: 'industry_requested',
    storeAsType: 'industry_requested',
    category: 'settings',
    label: 'Industry request submitted',
    description: 'Admins notified of new industry request.',
    defaultTitle: 'New industry request',
    defaultBody: '{{actorName}} requested to add industry "{{itemName}}".',
    placeholders: ['actorName', 'itemName'],
  }),
  entry({
    eventKey: 'industry_request_approved',
    storeAsType: 'industry_request_approved',
    category: 'settings',
    label: 'Industry request approved',
    description: 'Requester notified when industry is approved.',
    defaultTitle: 'Industry request approved',
    defaultBody: 'Your request to add industry "{{itemName}}" was approved.',
    placeholders: ['itemName'],
  }),
  entry({
    eventKey: 'industry_request_rejected',
    storeAsType: 'industry_request_rejected',
    category: 'settings',
    label: 'Industry request rejected',
    description: 'Requester notified when industry request is rejected.',
    defaultTitle: 'Industry request rejected',
    defaultBody: 'Your request to add industry "{{itemName}}" was rejected.',
    placeholders: ['itemName'],
  }),
  entry({
    eventKey: 'tag_requested',
    storeAsType: 'tag_requested',
    category: 'settings',
    label: 'Tag request submitted',
    description: 'Admins notified of new tag request.',
    defaultTitle: 'New tag request',
    defaultBody: '{{actorName}} requested to add tag "{{itemName}}".',
    placeholders: ['actorName', 'itemName'],
  }),
  entry({
    eventKey: 'tag_request_approved',
    storeAsType: 'tag_request_approved',
    category: 'settings',
    label: 'Tag request approved',
    description: 'Requester notified when tag is approved.',
    defaultTitle: 'Tag request approved',
    defaultBody: 'Your request to add tag "{{itemName}}" was approved.',
    placeholders: ['itemName'],
  }),
  entry({
    eventKey: 'tag_request_rejected',
    storeAsType: 'tag_request_rejected',
    category: 'settings',
    label: 'Tag request rejected',
    description: 'Requester notified when tag request is rejected.',
    defaultTitle: 'Tag request rejected',
    defaultBody: 'Your request to add tag "{{itemName}}" was rejected.',
    placeholders: ['itemName'],
  }),
  entry({
    eventKey: 'job_title_requested',
    storeAsType: 'job_title_requested',
    category: 'settings',
    label: 'Job title request submitted',
    description: 'Admins notified of new job title request.',
    defaultTitle: 'New job title request',
    defaultBody: '{{actorName}} requested to add job title "{{itemName}}".',
    placeholders: ['actorName', 'itemName'],
  }),
  entry({
    eventKey: 'job_title_request_approved',
    storeAsType: 'job_title_request_approved',
    category: 'settings',
    label: 'Job title request approved',
    description: 'Requester notified when job title is approved.',
    defaultTitle: 'Job title request approved',
    defaultBody: 'Your request to add job title "{{itemName}}" was approved.',
    placeholders: ['itemName'],
  }),
  entry({
    eventKey: 'job_title_request_rejected',
    storeAsType: 'job_title_request_rejected',
    category: 'settings',
    label: 'Job title request rejected',
    description: 'Requester notified when job title request is rejected.',
    defaultTitle: 'Job title request rejected',
    defaultBody: 'Your request to add job title "{{itemName}}" was rejected.',
    placeholders: ['itemName'],
  }),

  // Bugs
  entry({
    eventKey: 'bug_report_submitted',
    storeAsType: 'bug_report_submitted',
    category: 'bugs',
    label: 'Bug report submitted',
    description: 'Admins notified of new bug report.',
    defaultTitle: 'New bug report',
    defaultBody: '{{reporterName}}: {{bugTitle}}',
    placeholders: ['reporterName', 'bugTitle'],
  }),
  entry({
    eventKey: 'bug_report_resolved',
    storeAsType: 'bug_report_resolved',
    category: 'bugs',
    label: 'Bug report resolved',
    description: 'Reporter notified when bug is resolved.',
    defaultTitle: 'Bug report resolved',
    defaultBody: 'Your report "{{bugTitle}}" has been resolved.',
    placeholders: ['bugTitle'],
  }),

  // Jobs (recruitment placements)
  entry({
    eventKey: 'job_closed',
    storeAsType: 'job_closed',
    category: 'jobs',
    label: 'Job closed',
    description: 'Job creator notified when someone closes their job.',
    defaultTitle: 'Job closed: {{jobTitle}}',
    defaultBody: '{{actorName}} closed "{{jobTitle}}" ({{clientName}}).',
    sampleContext: JOB_SAMPLE,
  }),
  entry({
    eventKey: 'job_filled',
    storeAsType: 'job_filled',
    category: 'jobs',
    label: 'Job marked filled',
    description: 'Job creator notified when someone marks their job filled.',
    defaultTitle: 'Job filled: {{jobTitle}}',
    defaultBody: '{{actorName}} marked "{{jobTitle}}" ({{clientName}}) as filled.',
    sampleContext: JOB_SAMPLE,
  }),
  entry({
    eventKey: 'job_reopened',
    storeAsType: 'job_reopened',
    category: 'jobs',
    label: 'Job reopened',
    description: 'Job creator notified when someone reopens their closed job.',
    defaultTitle: 'Job reopened: {{jobTitle}}',
    defaultBody: '{{actorName}} reopened "{{jobTitle}}" ({{clientName}}).',
    sampleContext: JOB_SAMPLE,
  }),
  entry({
    eventKey: 'job_placement_added',
    storeAsType: 'job_placement_added',
    category: 'jobs',
    label: 'Employee placed on job',
    description: 'Job creator notified when an employee lands on their job roster.',
    defaultTitle: 'Employee placed: {{employeeName}}',
    defaultBody: '{{actorName}} placed {{employeeName}} on "{{jobTitle}}"{{roleSuffix}}.',
    sampleContext: JOB_SAMPLE,
  }),
  entry({
    eventKey: 'job_placement_ended',
    storeAsType: 'job_placement_ended',
    category: 'jobs',
    label: 'Placement ended',
    description: 'Requester and job creator notified when a placement ends.',
    defaultTitle: 'Placement ended: {{employeeName}}',
    defaultBody: '{{actorName}} ended {{employeeName}}\'s placement on "{{jobTitle}}"{{reasonSuffix}}.',
    sampleContext: JOB_SAMPLE,
  }),
];

const ALL_ENTRIES: NotificationRegistryEntry[] = [
  ...STATIC_ENTRIES,
  ...buildApprovalEntriesClean(),
];

export const NOTIFICATION_REGISTRY: Record<string, NotificationRegistryEntry> = Object.fromEntries(
  ALL_ENTRIES.map((e) => [e.eventKey, e]),
);

export type NotificationEventKey = keyof typeof NOTIFICATION_REGISTRY;

export function getRegistryEntry(eventKey: string): NotificationRegistryEntry | undefined {
  return NOTIFICATION_REGISTRY[eventKey];
}

export function listRegistryEntries(): NotificationRegistryEntry[] {
  return ALL_ENTRIES;
}

export function getLegacyApprovalAliasKey(eventKey: string): string | undefined {
  for (const [workflow, phases] of Object.entries(DEDICATED_APPROVAL_EVENT_KEYS) as [
    ApprovalWorkflowType,
    Record<ApprovalNotifyPhase, string>,
  ][]) {
    if (!phases) continue;
    for (const phase of ['submit', 'forward', 'approved', 'rejected'] as ApprovalNotifyPhase[]) {
      if (phases[phase] === eventKey) {
        return `approval_${workflow}_${phase}`;
      }
    }
  }
  return undefined;
}

export function getApprovalEventKey(
  workflow: ApprovalWorkflowType,
  phase: ApprovalNotifyPhase,
): string {
  const dedicated = DEDICATED_APPROVAL_EVENT_KEYS[workflow];
  if (dedicated) return dedicated[phase];
  return `approval_${workflow}_${phase}`;
}

export function approvalStoreAsTypeForPhase(
  workflow: ApprovalWorkflowType,
  phase: ApprovalNotifyPhase,
): NotificationType {
  return approvalStoreAsType(workflow, phase);
}
