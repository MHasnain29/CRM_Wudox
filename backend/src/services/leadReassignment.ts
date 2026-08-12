/**
 * Lead Reassignment Service
 *
 * Single source of truth for all lead ownership transfers. Every reassignment —
 * whether manager-initiated (Case 1, needs approval) or super-user-initiated
 * (Case 2, immediate) — flows through executeLeadReassignment().
 *
 * Mechanism: the source lead is marked closed_lost (so it appears in the old
 * associate's Closed Lost pipeline). A fresh Lead row is created for the new
 * owner, linked via reassignedFromLeadId for audit traceability.
 *
 * State machine (Case 1):
 *   pending → approved → completed
 *           → rejected
 *           → cancelled   (requester withdraws)
 *           → superseded  (new request replaces old)
 *
 * Case 2 inserts the row directly with status='completed' (audit record).
 */
import prisma from '../config/database';
import { emitToUsers } from '../socket';
import { notifyChainTargetUsers, submitEntityForApproval } from './approvalActions';
import { getPermissionsForRoleKey } from './rbac';
import { dispatchNotificationToUser } from './notificationDispatch';
import { getApprovalEventKey } from './notificationRegistry';
import { createActivityLog } from './activityLog';
import {
  getAgencyBranding,
  fetchClientDetailsForEmail,
  sendLeadAssignedEmail,
  sendLeadReassignmentRequestedEmail,
  sendLeadReassignmentApprovedEmail,
  sendLeadReassignmentRejectedEmail,
} from './email';
import { updateCalendarEvent, decryptToken } from './googleCalendar';
import { markLeadClosedLost, syncClientStatusFromLeadOutcomes } from './leadClientStatus';
import { env } from '../config/env';
import { LeadStatus, type LeadReassignmentRequest } from '@prisma/client';
import { getUserIdsWithPermissionInAgency, roleKeyHasMinScope } from './accessContext';
import { roleHasPermission } from './rbac';
import type { Permission } from '../config/permissions';

export type { LeadReassignmentRequest };

async function fetchReassignmentApprovers(subCompanyId: string) {
  const ids = await getUserIdsWithPermissionInAgency(subCompanyId, 'leads:reassign_approve');
  if (ids.length === 0) return [];
  return prisma.user.findMany({
    where: { id: { in: ids }, subCompanyId, isActive: true },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
}

/** Team-scope reassigners without approve permission (managers, not directors). */
async function isTeamScopeReassigner(roleKey: string): Promise<boolean> {
  const canApprove = await roleHasPermission(roleKey, 'leads:reassign_approve' as Permission);
  if (canApprove) return false;
  const canReassign = await roleHasPermission(roleKey, 'leads:reassign' as Permission);
  return canReassign && (await roleKeyHasMinScope(roleKey, 'team'));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveDisplayName(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });
  return u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || 'User' : 'User';
}

async function getLeadDeadlineDays(subCompanyId: string): Promise<number> {
  const row = await prisma.leadDeadlineSetting.findUnique({
    where: { subCompanyId },
    select: { days: true },
  });
  return Math.max(0, row?.days ?? 7);
}

function computeLeadDeadline(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function displayName(u: { firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined, fallback = 'User'): string {
  if (!u) return fallback;
  return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || fallback;
}

// ---------------------------------------------------------------------------
// Core executor — used by both Case 1 (approval) and Case 2 (super-user)
// ---------------------------------------------------------------------------

interface ExecuteParams {
  sourceLeadId: string;
  newOwnerId: string;
  performedById: string;       // approver (Case 1) or super user (Case 2)
  trigger: 'approval' | 'super_user_override';
  // Case 1 only: existing pending request to mark completed
  existingRequestId?: string | null;
  // Case 1 only: requester who initiated the workflow (different from performedById)
  requesterId?: string | null;
  numberOfPositions?: number | null;
}

interface ExecuteResult {
  newLeadId: string;
  newOwnerEmail: string | null;
  newOwnerName: string;
  oldOwnerId: string;
  oldOwnerName: string;
  clientName: string;
  clientId: string;
  subCompanyId: string;
  requestId: string;        // the audit row in LeadReassignmentRequest
  requesterId: string;      // who triggered the workflow (manager for Case 1, super user for Case 2)
}

/**
 * Atomic core: mark source lead closed_lost + create fresh lead + write audit row.
 * Throws on any precondition failure. Caller wraps best-effort side effects.
 */
async function executeLeadReassignment(params: ExecuteParams): Promise<ExecuteResult> {
  const { sourceLeadId, newOwnerId, performedById, existingRequestId, requesterId, numberOfPositions } = params;

  // Re-fetch fresh inside the function (callers may pass stale IDs)
  const source = await prisma.lead.findUnique({
    where: { id: sourceLeadId },
    include: {
      client: { select: { id: true, name: true } },
      owner: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
  if (!source) {
    throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
  }
  if (source.status === LeadStatus.closed_lost) {
    throw Object.assign(new Error('Lead is already closed'), { statusCode: 400 });
  }
  if (source.ownerId === newOwnerId) {
    throw Object.assign(new Error('Proposed owner is already the lead owner'), { statusCode: 400 });
  }

  const newOwner = await prisma.user.findUnique({
    where: { id: newOwnerId },
    select: { id: true, firstName: true, lastName: true, email: true, isActive: true, subCompanyId: true },
  });
  if (!newOwner?.isActive) {
    throw Object.assign(new Error('Proposed owner is not active'), { statusCode: 400 });
  }
  if (newOwner.subCompanyId !== source.subCompanyId) {
    throw Object.assign(new Error('Proposed owner must be in the same agency as the lead'), { statusCode: 400 });
  }

  const oldOwnerName = displayName(source.owner);
  const newOwnerName = displayName(newOwner);
  const deadlineDays = await getLeadDeadlineDays(source.subCompanyId);

  // Pre-compute the audit row reason
  const effectiveRequesterId = requesterId ?? performedById;

  const isSourceClosedWon = source.status === LeadStatus.closed_won;

  // PHASE 1 — atomic transaction
  const txResult = await prisma.$transaction(async (tx) => {
    // 1a. For active leads: mark source closed_lost. For closed_won: leave as-is —
    // the win record stays on the old owner's history unchanged.
    if (!isSourceClosedWon) {
      await markLeadClosedLost(tx, {
        leadId: source.id,
        subCompanyId: source.subCompanyId,
        closedById: performedById,
        lossReason: `Reassigned to ${newOwnerName}`,
      });
    }

    // 1b. Reject any pending extension requests on the source lead
    await tx.leadExtensionRequest.updateMany({
      where: { leadId: source.id, status: 'pending' },
      data: { status: 'rejected', managerRemarks: 'Lead was reassigned.' },
    });

    // 1c. Create the lead for the new owner, preserving source state.
    // closed_won stays closed_won — the deal is already won, stage/status must match.
    const newLead = await tx.lead.create({
      data: {
        clientId: source.clientId,
        ownerId: newOwnerId,
        subCompanyId: source.subCompanyId,
        stage: source.stage,
        status: source.status,
        value: source.value,
        notes: source.notes,
        temperature: source.temperature,
        lastActivity: new Date(),
        leadDeadline: isSourceClosedWon ? null : computeLeadDeadline(deadlineDays),
        reassignedFromLeadId: source.id,
        reassignedById: performedById,
      },
    });

    // 1c-bis. Re-sync ClientSubCompany.status.
    await syncClientStatusFromLeadOutcomes({
      tx,
      clientId: source.clientId,
      subCompanyId: source.subCompanyId,
      touchLastActivityAt: new Date(),
    });

    // 1d. Audit row — update existing pending request OR create a new completed one
    let request: LeadReassignmentRequest;
    if (existingRequestId) {
      // Case 1: re-check that the request is still pending (race-safe)
      const existing = await tx.leadReassignmentRequest.findUnique({
        where: { id: existingRequestId },
        select: { status: true },
      });
      if (!existing) throw Object.assign(new Error('Reassignment request not found'), { statusCode: 404 });
      if (existing.status !== 'pending') {
        throw Object.assign(new Error('Reassignment request is no longer pending'), { statusCode: 409 });
      }
      request = await tx.leadReassignmentRequest.update({
        where: { id: existingRequestId },
        data: {
          status: 'completed',
          reviewedById: performedById,
          reviewedAt: new Date(),
        },
      });
    } else {
      // Case 2: insert a new completed audit row
      request = await tx.leadReassignmentRequest.create({
        data: {
          leadId: source.id,
          requestedById: effectiveRequesterId,
          currentOwnerId: source.ownerId,
          proposedOwnerId: newOwnerId,
          subCompanyId: source.subCompanyId,
          status: 'completed',
          reviewedById: performedById,
          reviewedAt: new Date(),
          numberOfPositions: numberOfPositions ?? null,
        },
      });
    }

    return { newLead, request };
  });

  return {
    newLeadId: txResult.newLead.id,
    newOwnerEmail: newOwner.email,
    newOwnerName,
    oldOwnerId: source.ownerId,
    oldOwnerName,
    clientName: source.client.name,
    clientId: source.clientId,
    subCompanyId: source.subCompanyId,
    requestId: txResult.request.id,
    requesterId: effectiveRequesterId,
  };
}

// ---------------------------------------------------------------------------
// Phase 2 (best-effort, outside tx): meetings, calendar, notifications, emails
// ---------------------------------------------------------------------------

async function runSideEffects(
  result: ExecuteResult,
  trigger: 'approval' | 'super_user_override',
  performedById: string,
): Promise<void> {
  const performerName = await resolveDisplayName(performedById);

  const newLead = await prisma.lead.findUnique({
    where: { id: result.newLeadId },
    select: { ownerId: true, stage: true, status: true, temperature: true, value: true, notes: true, nextFollowUp: true },
  });
  if (!newLead) return; // shouldn't happen — just created in tx
  const newOwnerId = newLead.ownerId;

  // 2a. Transfer future meetings from source lead to new lead
  let meetingsReassigned = 0;
  try {
    const futureMeetings = await prisma.meeting.findMany({
      where: {
        leadId: result.requestId ? undefined : undefined, // placeholder; real filter below
        startTime: { gte: new Date() },
        ownerId: result.oldOwnerId,
      },
      select: { id: true, googleCalendarEventId: true, title: true, startTime: true, endTime: true, leadId: true },
    });
    // Filter to meetings linked to the source lead specifically
    const sourceFutureMeetings = futureMeetings.filter((m) => m.leadId !== null);
    if (sourceFutureMeetings.length > 0) {
      const sourceLeadIds = sourceFutureMeetings
        .filter((m) => m.leadId)
        .map((m) => m.id);
      await prisma.meeting.updateMany({
        where: { id: { in: sourceLeadIds } },
        data: { leadId: result.newLeadId, ownerId: newOwnerId },
      });
      meetingsReassigned = sourceLeadIds.length;

      // Best-effort Google Calendar sync
      const gcalMeetings = sourceFutureMeetings.filter((m) => m.googleCalendarEventId);
      if (gcalMeetings.length > 0) {
        const agency = await prisma.subCompany.findUnique({
          where: { id: result.subCompanyId },
          select: { googleRefreshToken: true, googleCalendarConnected: true },
        });
        if (agency?.googleCalendarConnected && agency.googleRefreshToken) {
          const refreshToken = decryptToken(agency.googleRefreshToken);
          await Promise.allSettled(
            gcalMeetings.map((m) =>
              updateCalendarEvent({
                refreshToken,
                googleEventId: m.googleCalendarEventId!,
                title: m.title,
                startTime: m.startTime,
                endTime: m.endTime,
              }).catch((err) =>
                console.warn('[leadReassignment] gcal update failed for meeting', m.id, err)
              )
            )
          );
        }
      }
    }
  } catch (err) {
    console.warn('[leadReassignment] meeting transfer failed', err);
  }

  // 2b. Activity log + notifications + emails (best-effort)
  const notifyRequester = trigger === 'approval' && result.requesterId !== performedById;

  await Promise.allSettled([
    createActivityLog({
      userId: performedById,
      userName: performerName,
      subCompanyId: result.subCompanyId,
      type: 'lead_reassignment_completed',
      description: `Lead for "${result.clientName}" reassigned from ${result.oldOwnerName} to ${result.newOwnerName}`,
      metadata: {
        requestId: result.requestId,
        newLeadId: result.newLeadId,
        clientId: result.clientId,
        clientName: result.clientName,
        oldOwnerId: result.oldOwnerId,
        oldOwnerName: result.oldOwnerName,
        newOwnerName: result.newOwnerName,
        trigger,
        meetingsReassigned,
      },
    }),
    dispatchNotificationToUser({
      userId: newOwnerId,
      subCompanyId: result.subCompanyId,
      eventKey: 'lead_assigned_reassignment',
      context: { entityLabel: result.clientName },
      link: '/leads',
      relatedId: result.newLeadId,
    }),
    dispatchNotificationToUser({
      userId: result.oldOwnerId,
      subCompanyId: result.subCompanyId,
      eventKey: 'lead_reassignment_approved_owner',
      context: { entityLabel: result.clientName, newOwnerName: result.newOwnerName },
      link: '/leads',
      relatedId: result.newLeadId,
    }),
    notifyRequester
      ? dispatchNotificationToUser({
          userId: result.requesterId,
          subCompanyId: result.subCompanyId,
          eventKey: 'lead_reassignment_approved_requester',
          context: { entityLabel: result.clientName },
          link: '/leads',
          relatedId: result.newLeadId,
        })
      : Promise.resolve(),
    (async () => {
      try {
        if (!result.newOwnerEmail) return;
        const [clientDetails, agency] = await Promise.all([
          fetchClientDetailsForEmail(result.clientId, result.subCompanyId),
          getAgencyBranding(result.subCompanyId),
        ]);
        await sendLeadAssignedEmail({
          toEmail: result.newOwnerEmail,
          toName: result.newOwnerName,
          assignedByName: performerName,
          clientDetails,
          lead: {
            id: result.newLeadId,
            stage: newLead.stage,
            status: newLead.status,
            temperature: newLead.temperature ?? null,
            value: newLead.value,
            notes: newLead.notes ?? null,
            nextFollowUp: newLead.nextFollowUp,
          },
          leadsUrl: `${env.FRONTEND_URL}/leads`,
          agency,
        });
      } catch (err) {
        console.error('[leadReassignment] new-owner email failed', err);
      }
    })(),
    notifyRequester
      ? (async () => {
          try {
            const requester = await prisma.user.findUnique({
              where: { id: result.requesterId },
              select: { firstName: true, lastName: true, email: true },
            });
            if (!requester?.email) return;
            const agency = await getAgencyBranding(result.subCompanyId);
            await sendLeadReassignmentApprovedEmail({
              toEmail: requester.email,
              toName: displayName(requester),
              directorName: performerName,
              clientName: result.clientName,
              newOwnerName: result.newOwnerName,
              reviewNote: null,
              leadsUrl: `${env.FRONTEND_URL}/leads`,
              agency,
            });
          } catch (err) {
            console.error('[leadReassignment] approval email failed', err);
          }
        })()
      : Promise.resolve(),
  ]);

  // 2c. Socket broadcast — old + new owners + requester + performer + approvers
  const superUsers = await fetchReassignmentApprovers(result.subCompanyId);
  const recipientIds = [
    ...new Set(
      [
        result.oldOwnerId,
        newOwnerId,
        result.requesterId,
        performedById,
        ...superUsers.map((s) => s.id),
      ].filter(Boolean)
    ),
  ];
  emitToUsers(recipientIds, 'lead:refresh', { subCompanyId: result.subCompanyId });
  emitToUsers(recipientIds, 'client:refresh', { subCompanyId: result.subCompanyId });
  emitToUsers(recipientIds, 'reassignment:refresh', { subCompanyId: result.subCompanyId });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Case 1: Manager initiates a reassignment request. Supersedes any existing pending request.
 */
export async function createLeadReassignmentRequest(
  leadId: string,
  proposedOwnerId: string,
  requestedById: string,
  subCompanyId: string,
  numberOfPositions?: number | null,
): Promise<LeadReassignmentRequest> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { client: { select: { name: true } } },
  });
  if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
  if (lead.subCompanyId !== subCompanyId) {
    throw Object.assign(new Error('Lead does not belong to your agency'), { statusCode: 403 });
  }
  if (lead.status === LeadStatus.closed_lost) {
    throw Object.assign(new Error('Cannot reassign a closed lead'), { statusCode: 400 });
  }
  if (lead.ownerId === proposedOwnerId) {
    throw Object.assign(new Error('Proposed owner is already the lead owner'), { statusCode: 400 });
  }

  const requester = await prisma.user.findUnique({
    where: { id: requestedById },
    select: { role: true },
  });
  if (!requester) throw Object.assign(new Error('Requester not found'), { statusCode: 404 });
  const requesterRole = requester.role;
  const teamScopeReassigner = await isTeamScopeReassigner(requesterRole);
  const canApprove = await roleHasPermission(requesterRole, 'leads:reassign_approve' as Permission);

  // Team managers: must own the source associate via reportingManagerIds
  if (teamScopeReassigner) {
    const sourceOwner = await prisma.user.findUnique({
      where: { id: lead.ownerId },
      select: { reportingManagerIds: true },
    });
    if (!sourceOwner?.reportingManagerIds.includes(requestedById)) {
      throw Object.assign(
        new Error('You can only reassign leads of associates who report to you'),
        { statusCode: 403 }
      );
    }
  }

  // Validate proposed owner is active + same agency
  const proposedOwner = await prisma.user.findFirst({
    where: { id: proposedOwnerId, subCompanyId, isActive: true },
    select: { id: true, firstName: true, lastName: true, email: true, role: true, reportingManagerIds: true },
  });
  if (!proposedOwner) {
    throw Object.assign(new Error('Proposed owner must be an active user in your agency'), { statusCode: 400 });
  }

  // Team managers target direct reports only; approvers may target anyone in agency
  if (teamScopeReassigner) {
    if (!proposedOwner.reportingManagerIds.includes(requestedById)) {
      throw Object.assign(
        new Error('You can only reassign to associates who report to you'),
        { statusCode: 403 }
      );
    }
  } else if (!canApprove) {
    throw Object.assign(new Error('You do not have permission to reassign leads'), { statusCode: 403 });
  }

  // Supersede any existing pending request
  const existingPending = await prisma.leadReassignmentRequest.findFirst({
    where: { leadId, status: 'pending' },
  });
  if (existingPending) {
    await prisma.leadReassignmentRequest.update({
      where: { id: existingPending.id },
      data: { status: 'superseded', updatedAt: new Date() },
    });
    void dispatchNotificationToUser({
      userId: existingPending.requestedById,
      subCompanyId,
      eventKey: 'lead_reassignment_superseded',
      context: { entityLabel: lead.client.name },
      link: '/leads',
      relatedId: leadId,
    }).catch(() => {});
  }

  const request = await prisma.leadReassignmentRequest.create({
    data: {
      leadId,
      requestedById,
      currentOwnerId: lead.ownerId,
      proposedOwnerId,
      subCompanyId,
      currentStepIndex: 0,
      approvalChain: [],
      numberOfPositions: numberOfPositions ?? null,
    },
    include: {
      requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      currentOwner: { select: { id: true, firstName: true, lastName: true, email: true } },
      proposedOwner: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  const requesterPerms = (await getPermissionsForRoleKey(requesterRole)).map((p) => String(p));
  const approval = await submitEntityForApproval({
    workflow: 'lead_reassignment',
    entityId: request.id,
    subCompanyId,
    submitterUserId: requestedById,
    submitterRoleKey: requesterRole,
    submitterPermissions: requesterPerms,
  });

  if (approval.autoApproved) {
    await approveReassignmentRequest(request.id, requestedById);
    const completed = await prisma.leadReassignmentRequest.findUnique({ where: { id: request.id } });
    return completed ?? request;
  }

  const requesterName = await resolveDisplayName(requestedById);
  const currentOwnerName = await resolveDisplayName(lead.ownerId);
  const proposedOwnerName = displayName(proposedOwner);
  const clientName = lead.client.name;

  const notifierIds = approval.targetRoleKey
    ? await notifyChainTargetUsers({
        subCompanyId,
        targetRoleKey: approval.targetRoleKey,
        eventKey: getApprovalEventKey('lead_reassignment', 'submit'),
        context: { entityLabel: clientName, actorName: requesterName },
        link: '/leads?tab=reassignments',
        relatedId: leadId,
      })
    : [];

  const emailRecipients =
    notifierIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: notifierIds }, isActive: true },
          select: { id: true, email: true, firstName: true, lastName: true },
        })
      : await fetchReassignmentApprovers(subCompanyId);

  if (emailRecipients.length > 0) {
    void (async () => {
      try {
        const agency = await getAgencyBranding(subCompanyId);
        await Promise.allSettled(
          emailRecipients.map((d) =>
            sendLeadReassignmentRequestedEmail({
              toEmail: d.email,
              toName: displayName(d),
              requesterName,
              currentOwnerName,
              proposedOwnerName,
              clientName,
              note: undefined,
              requestUrl: `${env.FRONTEND_URL}/leads`,
              agency,
              requestedAt: request.requestedAt,
            }),
          ),
        );
      } catch (err) {
        console.error('[leadReassignment] approver email failed', err);
      }
    })();
  }

  void createActivityLog({
    userId: requestedById,
    userName: requesterName,
    subCompanyId,
    type: 'lead_reassignment_requested',
    description: `Requested reassignment of lead for "${clientName}" from ${currentOwnerName} to ${proposedOwnerName}`,
    metadata: { requestId: request.id, leadId, clientName, currentOwnerName, proposedOwnerName },
  }).catch(() => {});

  const ids = [...new Set([...notifierIds, requestedById])];
  emitToUsers(ids, 'reassignment:refresh', { subCompanyId });

  return request;
}

/**
 * Case 2: Super user reassigns immediately. No approval. Goes straight to execute.
 */
export async function createSuperUserReassignment(
  leadId: string,
  proposedOwnerId: string,
  performedById: string,
  subCompanyId: string,
  numberOfPositions?: number | null,
): Promise<{ newLeadId: string }> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { subCompanyId: true, status: true, ownerId: true },
  });
  if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
  if (lead.subCompanyId !== subCompanyId) {
    throw Object.assign(new Error('Lead does not belong to your agency'), { statusCode: 403 });
  }

  // Supersede any existing pending request for this lead (super user override takes precedence)
  const pending = await prisma.leadReassignmentRequest.findFirst({
    where: { leadId, status: 'pending' },
  });
  if (pending) {
    await prisma.leadReassignmentRequest.update({
      where: { id: pending.id },
      data: { status: 'superseded', updatedAt: new Date() },
    });
  }

  const result = await executeLeadReassignment({
    sourceLeadId: leadId,
    newOwnerId: proposedOwnerId,
    performedById,
    trigger: 'super_user_override',
    existingRequestId: null,
    numberOfPositions,
    requesterId: performedById,
  });

  // Fire side effects (best-effort)
  void runSideEffects(result, 'super_user_override', performedById).catch((err) =>
    console.error('[leadReassignment] side effects failed', err)
  );

  return { newLeadId: result.newLeadId };
}

/**
 * Case 1 approval flow: any super user approves. Runs execute inside a single tx.
 */
export async function approveReassignmentRequest(
  requestId: string,
  approverId: string,
): Promise<void> {
  const request = await prisma.leadReassignmentRequest.findUnique({ where: { id: requestId } });
  if (!request) throw Object.assign(new Error('Request not found'), { statusCode: 404 });
  if (request.status !== 'pending') {
    throw Object.assign(new Error('Request is no longer pending'), { statusCode: 409 });
  }

  const result = await executeLeadReassignment({
    sourceLeadId: request.leadId,
    newOwnerId: request.proposedOwnerId,
    performedById: approverId,
    trigger: 'approval',
    existingRequestId: requestId,
    requesterId: request.requestedById,
  });

  void runSideEffects(result, 'approval', approverId).catch((err) =>
    console.error('[leadReassignment] side effects failed', err)
  );
}

/**
 * Case 1: any super user rejects. Source lead unchanged.
 */
export async function rejectReassignmentRequest(
  requestId: string,
  approverId: string,
): Promise<void> {
  const request = await prisma.leadReassignmentRequest.findUnique({ where: { id: requestId } });
  if (!request) throw Object.assign(new Error('Request not found'), { statusCode: 404 });
  if (request.status !== 'pending') {
    throw Object.assign(new Error('Request is no longer pending'), { statusCode: 409 });
  }

  await prisma.leadReassignmentRequest.update({
    where: { id: requestId },
    data: { status: 'rejected', reviewedById: approverId, reviewedAt: new Date() },
  });

  const [lead, requester, approver] = await Promise.all([
    prisma.lead.findUnique({ where: { id: request.leadId }, include: { client: { select: { name: true } } } }),
    prisma.user.findUnique({ where: { id: request.requestedById }, select: { firstName: true, lastName: true, email: true } }),
    prisma.user.findUnique({ where: { id: approverId }, select: { firstName: true, lastName: true, email: true } }),
  ]);

  const clientName = lead?.client.name ?? 'Unknown';
  const currentOwnerName = await resolveDisplayName(request.currentOwnerId);
  const approverName = displayName(approver, 'Reviewer');
  const requesterName = displayName(requester);

  // Activity log + notify requester + email
  await Promise.allSettled([
    createActivityLog({
      userId: approverId,
      userName: approverName,
      subCompanyId: request.subCompanyId,
      type: 'lead_reassignment_rejected',
      description: `Denied reassignment request for lead "${clientName}"`,
      metadata: { requestId, leadId: request.leadId, clientName },
    }),
    dispatchNotificationToUser({
      userId: request.requestedById,
      subCompanyId: request.subCompanyId,
      eventKey: 'lead_reassignment_rejected_requester',
      context: { entityLabel: clientName },
      link: '/leads',
      relatedId: request.leadId,
    }),
    (async () => {
      try {
        if (!requester?.email) return;
        const agency = await getAgencyBranding(request.subCompanyId);
        await sendLeadReassignmentRejectedEmail({
          toEmail: requester.email,
          toName: requesterName,
          directorName: approverName,
          clientName,
          currentOwnerName,
          reviewNote: null,
          leadsUrl: `${env.FRONTEND_URL}/leads`,
          agency,
        });
      } catch (err) {
        console.error('[leadReassignment] rejection email failed', err);
      }
    })(),
  ]);

  const superUsers = await fetchReassignmentApprovers(request.subCompanyId);
  const ids = [request.requestedById, approverId, request.currentOwnerId, ...superUsers.map((s) => s.id)];
  emitToUsers(ids, 'lead:refresh', { subCompanyId: request.subCompanyId });
  emitToUsers(ids, 'reassignment:refresh', { subCompanyId: request.subCompanyId });
}

/**
 * Requester cancels their own pending request.
 */
export async function cancelReassignmentRequest(
  requestId: string,
  requestedById: string,
): Promise<void> {
  const request = await prisma.leadReassignmentRequest.findUnique({ where: { id: requestId } });
  if (!request) throw Object.assign(new Error('Request not found'), { statusCode: 404 });
  if (request.requestedById !== requestedById) {
    throw Object.assign(new Error('You can only cancel your own requests'), { statusCode: 403 });
  }
  if (request.status !== 'pending') {
    throw Object.assign(new Error('Request is no longer pending'), { statusCode: 409 });
  }

  await prisma.leadReassignmentRequest.update({
    where: { id: requestId },
    data: { status: 'cancelled', updatedAt: new Date() },
  });

  const [lead, requester] = await Promise.all([
    prisma.lead.findUnique({ where: { id: request.leadId }, include: { client: { select: { name: true } } } }),
    prisma.user.findUnique({ where: { id: requestedById }, select: { firstName: true, lastName: true, email: true } }),
  ]);
  const clientName = lead?.client.name ?? 'Unknown';
  const requesterName = displayName(requester);

  void createActivityLog({
    userId: requestedById,
    userName: requesterName,
    subCompanyId: request.subCompanyId,
    type: 'lead_reassignment_cancelled',
    description: `Cancelled reassignment request for lead "${clientName}"`,
    metadata: { requestId, leadId: request.leadId, clientName },
  }).catch(() => {});

  const superUsers = await fetchReassignmentApprovers(request.subCompanyId);
  const ids = [requestedById, ...superUsers.map((s) => s.id)];
  emitToUsers(ids, 'reassignment:refresh', { subCompanyId: request.subCompanyId });
}

/** Pending queue for super-user approvers. */
export async function getPendingReassignmentRequests(
  subCompanyIds: string[],
): Promise<LeadReassignmentRequest[]> {
  return prisma.leadReassignmentRequest.findMany({
    where: { status: 'pending', subCompanyId: { in: subCompanyIds } },
    include: {
      lead: { include: { client: { select: { id: true, name: true } } } },
      requestedBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      currentOwner: { select: { id: true, firstName: true, lastName: true, email: true } },
      proposedOwner: { select: { id: true, firstName: true, lastName: true, email: true } },
      subCompany: { select: { id: true, name: true } },
    },
    orderBy: { requestedAt: 'asc' },
  });
}

/** Requester's own history (manager view). */
export async function getMyReassignmentRequests(
  requestedById: string,
  subCompanyIds: string[],
): Promise<LeadReassignmentRequest[]> {
  return prisma.leadReassignmentRequest.findMany({
    where: { requestedById, subCompanyId: { in: subCompanyIds } },
    include: {
      lead: { include: { client: { select: { id: true, name: true } } } },
      currentOwner: { select: { id: true, firstName: true, lastName: true } },
      proposedOwner: { select: { id: true, firstName: true, lastName: true } },
      reviewedBy: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { requestedAt: 'desc' },
  });
}

/** All requests in the agencies the caller can access (super-user history). */
export async function getAllReassignmentRequests(
  subCompanyIds: string[],
): Promise<LeadReassignmentRequest[]> {
  return prisma.leadReassignmentRequest.findMany({
    where: { subCompanyId: { in: subCompanyIds } },
    include: {
      lead: { include: { client: { select: { id: true, name: true } } } },
      requestedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
      currentOwner: { select: { id: true, firstName: true, lastName: true } },
      proposedOwner: { select: { id: true, firstName: true, lastName: true } },
      reviewedBy: { select: { id: true, firstName: true, lastName: true } },
      subCompany: { select: { id: true, name: true } },
    },
    orderBy: { requestedAt: 'desc' },
  });
}

/** History for a specific lead. */
export async function getLeadReassignmentHistory(leadId: string): Promise<LeadReassignmentRequest[]> {
  return prisma.leadReassignmentRequest.findMany({
    where: { leadId },
    include: {
      requestedBy: { select: { id: true, firstName: true, lastName: true } },
      currentOwner: { select: { id: true, firstName: true, lastName: true } },
      proposedOwner: { select: { id: true, firstName: true, lastName: true } },
      reviewedBy: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { requestedAt: 'desc' },
  });
}
